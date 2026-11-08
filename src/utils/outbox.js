// =============================================================
//  未送信の箱（outbox）
//
//  通信エラーなどでスプシに保存できなかった操作をここに入れ、あとで自動で送り直す。
//  ・箱の中身は端末の金庫（vault）に暗号化して置く。鍵がかかっても消さない（PRF の端末）
//  ・同じ対象への保存は最新の1件だけ残す（古い内容で上書きしないため）
//  ・対象は「同じ内容を2回送っても結果が変わらない」保存だけ（二重登録を防ぐ）
//  ・送り直すタイミング：金庫を開いたとき／通信が戻ったとき／画面に戻ったとき／1分ごと
//  ・サーバーに断られたもの（内容の誤りなど）は「エラー」として残し、画面から再送か破棄を選ぶ
// =============================================================
import { vaultGet, vaultSet, subscribeVault, getVaultState } from '../auth/vault'

const KEY = 'outbox'
const listeners = new Set()
let sender = null
let flushing = false

export function setOutboxSender(fn) { sender = fn }

export const outboxItems = () => (getVaultState().status === 'unlocked' && vaultGet(KEY)) || []
function save(items) {
  vaultSet(KEY, items)
  listeners.forEach((fn) => fn(items))
}
export function subscribeOutbox(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function enqueue({ key, label, body, error }) {
  const item = {
    id: crypto.randomUUID(), key, label, body,
    createdAt: Date.now(), attempts: 1, status: 'pending', lastError: error || '',
  }
  save([...outboxItems().filter((x) => x.key !== key), item])
}

// 直接送れたときは、同じ対象の古い未送信分は不要になる
export function supersede(key) {
  const items = outboxItems()
  if (items.some((x) => x.key === key)) save(items.filter((x) => x.key !== key))
}

export function discard(id) {
  save(outboxItems().filter((x) => x.id !== id))
}

export async function flushOutbox({ includeErrors = false } = {}) {
  if (flushing || !sender || getVaultState().status !== 'unlocked') return
  flushing = true
  try {
    for (const item of outboxItems()) {
      if (item.status === 'error' && !includeErrors) continue
      try {
        await sender(item.body)
        save(outboxItems().filter((x) => x.id !== item.id))
      } catch (e) {
        const patch = { attempts: item.attempts + 1, lastError: e.message || String(e), status: e.retryable ? 'pending' : 'error' }
        save(outboxItems().map((x) => (x.id === item.id ? { ...x, ...patch } : x)))
        if (e.retryable) break // 通信できないときは後ろも送れないので、次の機会に
      }
    }
  } finally {
    flushing = false
  }
}

// ─── 自動で送り直す ─────────────────────────────
let timer = null
subscribeVault((v) => {
  clearInterval(timer)
  timer = null
  if (v.status !== 'unlocked') return
  setTimeout(() => flushOutbox(), 3000)
  timer = setInterval(() => { if (outboxItems().length) flushOutbox() }, 60_000)
})
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushOutbox())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && outboxItems().length) flushOutbox()
  })
}
