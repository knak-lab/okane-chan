import { useEffect, useRef, useState } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import { vaultGet, vaultSet, vaultRemove } from '../auth/vault'
import './AIChat.css'

// 会話は端末の金庫（暗号化した端末保存）にだけ置く
const STORE_KEY = 'aichat:current'

// 料金の目安（Claude Sonnet 5.5、1ドル=150円）。1質問ごとの usage から計算する
const USD_JPY = 150
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } // $ / 100万トークン
function costYen(u = {}) {
  const usd = ((u.input_tokens || 0) * PRICE.input
    + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite
    + (u.cache_read_input_tokens || 0) * PRICE.cacheRead
    + (u.output_tokens || 0) * PRICE.output) / 1_000_000
  return usd * USD_JPY
}
const fmtYen = (y) => (y < 1 ? `${y.toFixed(1)}円` : `${Math.round(y)}円`)

const SUGGESTIONS = [
  'このプランで一番の問題は何？',
  '退職後の赤字を減らすには、何から考えればいい？',
  'データで先に埋めるべきものはどれ？',
  'もしも比較の結果をどう読めばいい？',
]

// ─── 簡易マークダウン（太字・箇条書き・段落） ─────────────
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>)
}
function MarkdownView({ text }) {
  const out = []
  let list = []
  let key = 0
  const flush = () => {
    if (!list.length) return
    out.push(<ul key={key++}>{list.map((t, i) => <li key={i}>{renderInline(t)}</li>)}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*([-*]|\d+\.) /.test(line)) list.push(line.replace(/^\s*([-*]|\d+\.) /, ''))
    else if (line.trim() === '') flush()
    else {
      flush()
      out.push(<p key={key++}>{renderInline(line.replace(/^#+ /, ''))}</p>)
    }
  }
  flush()
  return <div className="aic-md">{out}</div>
}

const textOf = (content) => (Array.isArray(content)
  ? content.filter(b => b.type === 'text').map(b => b.text).join('')
  : String(content || ''))

// API に送る形にする（画面用の usage などは外す）
const toApi = (m) => (m.role === 'system'
  ? { role: 'system', lpUpdate: m.lpUpdate }
  : { role: m.role, content: m.content })

// context: SimTab が作る LPタブの中身（AIが読む材料）
export default function AIChat({ context }) {
  const [conv, setConv]       = useState(() => vaultGet(STORE_KEY))
  const [input, setInput]     = useState('')
  const [pending, setPending] = useState(null)   // 送信中の質問
  const [error, setError]     = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [conv, pending])

  const save = (c) => {
    setConv(c)
    if (c) vaultSet(STORE_KEY, c)
    else vaultRemove(STORE_KEY)
  }

  const send = async (question) => {
    const q = question.trim()
    if (!q || pending) return
    if (!isGasReady()) { setError('GAS URLが設定されていません'); return }

    // 相談を始めたときのLPを会話の土台にし、途中で数字が変わったら「更新」として差し込む
    const ctxJson = JSON.stringify(context)
    const base = conv || { lp: context, lastContextJson: ctxJson, messages: [] }
    const added = [{ role: 'user', content: q }]
    if (conv && ctxJson !== conv.lastContextJson) added.push({ role: 'system', lpUpdate: context })
    const messages = [...base.messages, ...added]

    setError('')
    setInput('')
    setPending(q)
    try {
      const res = await gasApi.aiChat({ lp: base.lp, messages: messages.map(toApi) })
      save({
        ...base,
        lastContextJson: ctxJson,
        messages: [...messages, { role: 'assistant', content: res.content, cost: costYen(res.usage) }],
      })
    } catch (e) {
      setError(String(e?.message || e))
      setInput(q) // 送れなかった質問は入力欄に戻す
    } finally {
      setPending(null)
    }
  }

  const reset = () => {
    if (conv?.messages?.length && !window.confirm('今の相談を消して、新しい相談を始めますか？')) return
    save(null)
    setError('')
  }

  const messages = conv?.messages || []
  const total = messages.reduce((s, m) => s + (m.cost || 0), 0)

  return (
    <div className="aic">
      <div className="aic-head">
        <div>
          <h3 className="aic-title">💬 AI相談</h3>
          <p className="aic-desc">LPタブの数字とチェック結果を知ったうえで答えます。1質問あたり数円が目安。</p>
        </div>
        {messages.length > 0 && <button className="aic-reset" onClick={reset}>新しい相談</button>}
      </div>

      <div className="aic-log">
        {messages.length === 0 && !pending && (
          <div className="aic-suggest">
            {SUGGESTIONS.map(s => (
              <button key={s} className="aic-chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') return <div key={i} className="aic-msg aic-user">{m.content}</div>
          if (m.role === 'system') return <div key={i} className="aic-note">LPの数字が変わったので、新しい数字をAIに伝えました</div>
          return (
            <div key={i} className="aic-msg aic-ai">
              <MarkdownView text={textOf(m.content)} />
              {m.cost != null && <div className="aic-cost">約{fmtYen(m.cost)}</div>}
            </div>
          )
        })}

        {pending && (
          <>
            <div className="aic-msg aic-user">{pending}</div>
            <div className="aic-msg aic-ai aic-thinking"><span className="aic-spinner" />考え中…（5〜20秒）</div>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="aic-error">
          <strong>エラー:</strong> {error}
          {error.includes('CLAUDE_API_KEY') && (
            <p>GASエディタ → プロジェクトの設定 → スクリプトプロパティ に <code>CLAUDE_API_KEY</code> を追加してください。</p>
          )}
        </div>
      )}

      <form className="aic-form" onSubmit={e => { e.preventDefault(); send(input) }}>
        <textarea className="aic-input" rows={2} value={input} placeholder="例：ローン25年と退職後80%、どっちが効く？"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input) } }} />
        <button className="aic-send" type="submit" disabled={!input.trim() || !!pending}>送信</button>
      </form>
      {messages.length > 0 && <div className="aic-total">この相談の合計 約{fmtYen(total)}（目安）</div>}
    </div>
  )
}
