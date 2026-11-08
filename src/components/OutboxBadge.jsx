import { useEffect, useState } from 'react'
import { discard, flushOutbox, outboxItems, subscribeOutbox } from '../utils/outbox'
import './OutboxBadge.css'

const fmtTime = (ms) => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

// スプシに保存できていない操作の件数。タップで中身を見て、再送・破棄できる
export default function OutboxBadge() {
  const [items, setItems] = useState(outboxItems())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeOutbox(setItems), [])
  useEffect(() => { if (items.length === 0) setOpen(false) }, [items.length])

  if (items.length === 0) return null
  const hasError = items.some((x) => x.status === 'error')

  const resend = async () => {
    setBusy(true)
    try { await flushOutbox({ includeErrors: true }) } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className={`outbox-badge${hasError ? ' outbox-badge--error' : ''}`} onClick={() => setOpen((v) => !v)}>
        {hasError ? '⚠' : '⏳'} 未送信 {items.length}件
      </button>
      {open && (
        <div className="outbox-panel">
          <p className="outbox-lead">
            スプシに保存できていない操作です。通信が戻ると自動で送り直します。
          </p>
          <ul className="outbox-list">
            {items.map((x) => (
              <li key={x.id} className="outbox-item">
                <div className="outbox-item-main">
                  <span className="outbox-item-label">{x.label}</span>
                  <span className="outbox-item-meta">
                    {fmtTime(x.createdAt)}・{x.status === 'error' ? 'サーバーに断られました' : `${x.attempts}回試行`}
                  </span>
                  {x.lastError && <span className="outbox-item-err">{x.lastError}</span>}
                </div>
                <button type="button" className="outbox-discard"
                  onClick={() => { if (window.confirm(`「${x.label}」の未送信の保存を破棄しますか？`)) discard(x.id) }}>
                  破棄
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="outbox-resend" disabled={busy} onClick={resend}>
            {busy ? '送信中…' : '今すぐ送り直す'}
          </button>
        </div>
      )}
    </>
  )
}
