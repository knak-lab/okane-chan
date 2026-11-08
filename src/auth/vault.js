// =============================================================
//  端末の金庫（vault）：指紋・顔認証で開ける、暗号化された端末保存
//
//  ・データは AES-GCM で暗号化して IndexedDB に置く。平文では端末に残さない
//  ・暗号の鍵は、パスキー（WebAuthn）の PRF 拡張から作る。指紋・顔認証が通ったときだけ取り出せる
//    → 鍵がかかっている間は、端末にデータがあっても誰にも読めない
//  ・開いたあとは「セッション鍵」（取り出し不可の CryptoKey）を IndexedDB に置き、
//    最後の操作から LOCK_AFTER_MS 以内なら、アプリを閉じて開き直しても認証なしで開ける
//  ・PRF に対応していない端末やパスキーを使わない場合は、セッションの間だけ使い捨ての鍵で暗号化し、
//    鍵がかかったら端末のデータも消す（安全側）
//  ・本当の守りはサーバー側（GAS）の Google アカウント確認。ここは端末を触られたとき用の鍵
// =============================================================

export const LOCK_AFTER_MS = 60 * 60 * 1000 // 無操作でこの時間たったら鍵をかける

const APP_ID = 'okane-chan'
const DB_NAME = `${APP_ID}-vault`
const LAST_ACTIVE_KEY = `${APP_ID}:vault:lastActive`
const HKDF_INFO = new TextEncoder().encode(`${APP_ID} data v1`)

// ─── IndexedDB ───────────────────────────────────
let dbPromise = null
function db() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('meta')    // パスキーの情報（暗号化しない。秘密は含まない）
      d.createObjectStore('data')    // 暗号化したデータ { iv, ct }
      d.createObjectStore('session') // セッション鍵（取り出し不可の CryptoKey）
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

async function tx(store, mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const s = t.objectStore(store)
    let result
    Promise.resolve(fn(s)).then((r) => { result = r })
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

const idbGet = (store, key) => tx(store, 'readonly', (s) => req(s.get(key)))
const idbPut = (store, key, value) => tx(store, 'readwrite', (s) => { s.put(value, key) })
const idbDel = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key) })
const idbClear = (store) => tx(store, 'readwrite', (s) => { s.clear() })
async function idbEntries(store) {
  return tx(store, 'readonly', async (s) => {
    const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())])
    return keys.map((k, i) => [k, values[i]])
  })
}

// ─── 状態 ────────────────────────────────────────
// status: checking | setup（初回：パスキー未登録）| locked | unlocked
let state = { status: 'checking', mode: '', email: '' }
let dataKey = null      // 開いている間だけメモリに置く
let memory = new Map()  // 復号済みのデータ（同期で読めるように）
const listeners = new Set()
const persistTimers = new Map()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn(state))
}
export const getVaultState = () => state
export function subscribeVault(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ─── 暗号化 ──────────────────────────────────────
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const random = (n) => crypto.getRandomValues(new Uint8Array(n))

async function keyFromPrf(prfOutput) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: HKDF_INFO },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}
const randomKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

async function encrypt(key, value) {
  const iv = random(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { iv, ct }
}
async function decrypt(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt))
}

// ─── 同期で使える保存 API（開いている間だけ有効） ──────
export function vaultGet(key) {
  return memory.has(key) ? memory.get(key) : null
}
export function vaultSet(key, value) {
  if (!dataKey) return
  memory.set(key, value)
  schedulePersist(key)
}
export function vaultRemove(key) {
  memory.delete(key)
  clearTimeout(persistTimers.get(key))
  persistTimers.delete(key)
  idbDel('data', key).catch(() => {})
}

function schedulePersist(key) {
  clearTimeout(persistTimers.get(key))
  persistTimers.set(key, setTimeout(async () => {
    persistTimers.delete(key)
    const key0 = dataKey
    if (!key0 || !memory.has(key)) return
    try { await idbPut('data', key, await encrypt(key0, memory.get(key))) }
    catch (e) { console.warn('[vault] 保存できませんでした', key, e) }
  }, 300))
}

async function loadAll(key) {
  memory = new Map()
  for (const [k, v] of await idbEntries('data')) {
    try { memory.set(k, await decrypt(key, v)) }
    catch { await idbDel('data', k) } // 別の鍵で暗号化された古いデータは読めないので捨てる
  }
}

// ─── パスキー（WebAuthn + PRF） ───────────────────
export const webauthnAvailable = () =>
  typeof window !== 'undefined' && Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext)

function prfFirst(cred) {
  const r = cred?.getClientExtensionResults?.().prf?.results?.first
  return r ? new Uint8Array(r) : null
}

async function getPrf(meta) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(meta.credId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: unb64(meta.salt) } } },
    },
  })
  if (!cred) throw new Error('cancelled')
  return prfFirst(cred)
}

// ─── 起動・開閉 ───────────────────────────────────
function lastActive() {
  try { return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0 } catch { return 0 }
}
export function touch() {
  try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())) } catch { /* noop */ }
}
const expired = () => Date.now() - lastActive() > LOCK_AFTER_MS

async function openWith(key, meta) {
  dataKey = key
  await loadAll(key)
  await idbPut('session', 'key', key)
  touch()
  setState({ status: 'unlocked', mode: meta?.mode || 'session', email: meta?.email || state.email })
  startIdleWatch()
}

// 起動時：セッションが生きていればそのまま開く。切れていれば鍵をかける
export async function initVault() {
  try {
    const meta = await idbGet('meta', 'passkey')
    const session = await idbGet('session', 'key')
    if (session && !expired()) return openWith(session, meta)
    stopIdleWatch()
    dataKey = null
    memory = new Map()
    await lockStorage(meta)
    setState({ status: meta ? 'locked' : 'setup', mode: meta?.mode || '', email: meta?.email || '' })
  } catch (e) {
    console.warn('[vault] 初期化に失敗', e)
    setState({ status: 'setup', mode: '' })
  }
}

// 初回：パスキーを登録して開く（Google ログイン後に呼ぶ）
export async function registerPasskey(email) {
  const salt = random(32)
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'お金ちゃん管理', id: location.hostname },
      user: { id: random(16), name: email || 'okane-chan', displayName: `お金ちゃん（${email || ''}）` },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } },
    },
  })
  if (!cred) throw new Error('cancelled')
  const enabled = cred.getClientExtensionResults?.().prf?.enabled
  const meta = { credId: b64(cred.rawId), salt: b64(salt), mode: enabled ? 'prf' : 'uv', email, createdAt: Date.now() }
  let key
  if (enabled) {
    // 登録時に PRF の値が返らない端末では、もう一度認証して取り出す
    const out = prfFirst(cred) || await getPrf(meta)
    if (!out) throw new Error('prf_unavailable')
    key = await keyFromPrf(out)
  } else {
    key = await randomKey()
  }
  await idbPut('meta', 'passkey', meta)
  await openWith(key, meta)
}

// パスキーを使わずに開く（セッションの間だけ。鍵がかかると端末のデータも消える）
export async function openWithoutPasskey(email) {
  await openWith(await randomKey(), { mode: 'session', email })
}

// 指紋・顔認証で開く
export async function unlockWithPasskey() {
  const meta = await idbGet('meta', 'passkey')
  if (!meta) return setState({ status: 'setup' })
  const out = await getPrf(meta)
  if (meta.mode === 'prf') {
    if (!out) throw new Error('prf_unavailable')
    return openWith(await keyFromPrf(out), meta)
  }
  return openWith(await randomKey(), meta) // uv：本人確認だけ。データは前回の鍵がかかったときに消えている
}

// 鍵をかける：メモリとセッション鍵を消す（PRF 以外では端末のデータも消す）
async function lockStorage(meta) {
  await idbDel('session', 'key').catch(() => {})
  if (meta?.mode !== 'prf') await idbClear('data').catch(() => {})
}

export async function lock() {
  stopIdleWatch()
  // 保存待ちのものを書いてから鍵を捨てる（PRF なら次に開いたとき読める）
  const key0 = dataKey
  const pending = [...persistTimers.keys()]
  persistTimers.forEach(clearTimeout)
  persistTimers.clear()
  if (key0) {
    for (const k of pending) {
      if (memory.has(k)) { try { await idbPut('data', k, await encrypt(key0, memory.get(k))) } catch { /* noop */ } }
    }
  }
  dataKey = null
  memory = new Map()
  const meta = await idbGet('meta', 'passkey').catch(() => null)
  await lockStorage(meta)
  setState({ status: meta ? 'locked' : 'setup', mode: meta?.mode || '' })
}

// すべて消す（ログアウト・アカウント切り替え）。パスキー自体はパスワードマネージャーに残る
export async function wipeVault() {
  stopIdleWatch()
  persistTimers.forEach(clearTimeout)
  persistTimers.clear()
  dataKey = null
  memory = new Map()
  await Promise.all(['meta', 'data', 'session'].map((s) => idbClear(s).catch(() => {})))
  try { localStorage.removeItem(LAST_ACTIVE_KEY) } catch { /* noop */ }
  setState({ status: 'setup', mode: '', email: '' })
}

// ─── 無操作の監視 ─────────────────────────────────
let idleTimer = null
let lastTouch = 0
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel']

function onActivity() {
  const now = Date.now()
  if (now - lastTouch < 15_000) return // 書き込みは15秒に1回まで
  lastTouch = now
  touch()
}
function checkIdle() {
  if (state.status === 'unlocked' && expired()) lock()
}
function onVisibility() {
  if (document.visibilityState === 'visible') checkIdle()
}

function startIdleWatch() {
  stopIdleWatch()
  ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true, capture: true }))
  document.addEventListener('visibilitychange', onVisibility)
  idleTimer = setInterval(checkIdle, 30_000)
}
function stopIdleWatch() {
  ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity, { capture: true }))
  document.removeEventListener('visibilitychange', onVisibility)
  clearInterval(idleTimer)
  idleTimer = null
}
