import { useState } from 'react'
import { WHATIF_FIELDS, whatIfField, currentValue } from '../utils/lpChecks'
import { goTo, GO_LABEL } from '../utils/nav'
import './LPCheck.css'

const ICON = { ng: '❌', warn: '⚠️', info: 'ℹ️' }

// ▲1,234万円 のような短い表記
const manSign = (n) => `${n < 0 ? '▲' : ''}${Math.round(Math.abs(n) / 10_000).toLocaleString()}万円`
const diffMan = (d) => (d === 0 ? '±0' : `${d > 0 ? '+' : '▲'}${Math.round(Math.abs(d) / 10_000).toLocaleString()}万`)

// 3桁区切りの数値入力（入力途中の「1.」などはそのまま保持）
const toNum = (s) => Number(String(s).replace(/[,，¥\s]/g, ''))
const fmtInput = (v) => (Number(v) || 0).toLocaleString('ja-JP', { maximumFractionDigits: 2 })
function NumInput({ value, onChange }) {
  const [draft, setDraft] = useState(null)
  return (
    <input type="text" inputMode="decimal" className="lpc-num"
      value={draft ?? fmtInput(value)}
      onChange={e => {
        const raw = e.target.value
        const n = toNum(raw)
        if (raw.trim() === '' || raw === '-') { setDraft(raw); onChange(0); return }
        if (Number.isNaN(n)) return
        setDraft(/^-?[\d,]+$/.test(raw.trim()) ? fmtInput(n) : raw)
        onChange(n)
      }}
      onBlur={() => setDraft(null)} />
  )
}

function CheckList({ items, okText }) {
  if (!items.length) return <p className="lpc-ok">✅ {okText}</p>
  return (
    <ul className="lpc-list">
      {items.map((c, i) => (
        <li key={i} className={`lpc-item lpc-${c.level}`}>
          <span className="lpc-icon">{ICON[c.level]}</span>
          <span className="lpc-text">{c.text}
            {c.go && GO_LABEL[c.go] && (
              <button className="lpc-go" onClick={() => goTo(...c.go.split('/'))}>{GO_LABEL[c.go]} →</button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

// 「尽きる年齢」の表示
function zeroText(s, endAge) {
  return s.zeroAge ? `${s.zeroAge}歳で尽きる` : `${endAge}歳まで持つ`
}
function zeroDiff(base, s) {
  if (!base.zeroAge && !s.zeroAge) return null
  if (base.zeroAge && !s.zeroAge) return { text: '尽きなくなる', good: true }
  if (!base.zeroAge && s.zeroAge) return { text: `${s.zeroAge}歳で尽きる`, good: false }
  const d = s.zeroAge - base.zeroAge
  return d === 0 ? { text: '変わらず', good: null } : { text: `${d > 0 ? '+' : ''}${d}年`, good: d > 0 }
}

function ResultLine({ base, s, endAge }) {
  const zd = zeroDiff(base, s)
  const ed = s.endAssets - base.endAssets
  const rd = s.retireAssets - base.retireAssets
  const cls = (good) => (good == null ? '' : good ? ' pos' : ' neg')
  return (
    <div className="lpc-result">
      {s.pass !== undefined && <span className={`lpc-pass ${s.pass ? 'pos' : 'neg'}`}>{s.pass ? '✅ 合格' : '❌ 不合格'}</span>}
      <span>資産：<strong>{zeroText(s, endAge)}</strong>
        {zd && <em className={`lpc-diff${cls(zd.good)}`}>（{zd.text}）</em>}</span>
      <span>退職直前 {manSign(s.retireAssets)}
        <em className={`lpc-diff${cls(rd === 0 ? null : rd > 0)}`}>（{diffMan(rd)}）</em></span>
      <span>{endAge}歳時点 {manSign(s.endAssets)}
        <em className={`lpc-diff${cls(ed === 0 ? null : ed > 0)}`}>（{diffMan(ed)}）</em></span>
    </div>
  )
}

// checks: { data, plan }（lpChecks の dataChecks / planChecks）
// results: runWhatIfs の結果。計算は SimTab で行い、AI相談にも同じものを渡す
export default function LPCheck({ checks, results, simParams, events, whatIfs, setWhatIfs }) {
  const { data, plan } = checks
  const base = results.base.s

  const update = (id, patch) => setWhatIfs(ws => ws.map(w => (w.id === id ? { ...w, ...patch } : w)))
  const remove = (id) => setWhatIfs(ws => ws.filter(w => w.id !== id))
  const addRow = () => {
    const used = new Set(whatIfs.map(w => w.key))
    const f = WHATIF_FIELDS.find(x => !used.has(x.key)) || WHATIF_FIELDS[0]
    setWhatIfs(ws => [...ws, { id: `w${Date.now()}`, key: f.key, value: currentValue(f.key, simParams, events) }])
  }

  const countBadge = (items) => {
    const ng = items.filter(c => c.level === 'ng').length
    const warn = items.filter(c => c.level === 'warn').length
    return ng + warn ? <span className="lpc-badge">{ng ? `❌${ng} ` : ''}{warn ? `⚠️${warn}` : ''}</span> : <span className="lpc-badge ok">✅</span>
  }

  return (
    <details className="sim-section sim-collapse lpc">
      <summary className="sim-section-title">
        📊 LPチェック {countBadge([...plan, ...data])}
        <span className="sim-section-note">入力を変えるとすぐ反映（AIは使いません）</span>
      </summary>

      <details className="lpc-block" open>
        <summary>① プランのリスク {countBadge(plan)}</summary>
        <CheckList items={plan} okText="大きなリスクなし" />
      </details>

      <div className="lpc-block">
        <div className="lpc-block-title">② もしも比較</div>
        <p className="lpc-base">
          今のプラン：<strong>{zeroText(base, simParams.endAge)}</strong>
          ／ 退職直前 {manSign(base.retireAssets)} ／ {simParams.endAge}歳時点 {manSign(base.endAssets)}
        </p>

        {whatIfs.map((w, i) => {
          const f = whatIfField(w.key) || WHATIF_FIELDS[0]
          const r = results.rows[i]
          return (
            <div key={w.id} className="lpc-whatif">
              <div className="lpc-cond">
                <span>もしも</span>
                <select value={w.key} className="lpc-select"
                  onChange={e => update(w.id, { key: e.target.value, value: currentValue(e.target.value, simParams, events) })}>
                  {WHATIF_FIELDS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <span>が</span>
                <NumInput value={w.value} onChange={v => update(w.id, { value: v })} />
                <span>{f.unit} なら</span>
                <button className="lpc-del" onClick={() => remove(w.id)} aria-label="この条件を消す">×</button>
              </div>
              <div className="lpc-now">今の値：{fmtInput(currentValue(w.key, simParams, events))} {f.unit}
                {f.target === 'home' && !events.home?.enabled && '（マイホームがオフなので影響なし）'}</div>
              <ResultLine base={base} s={r.s} endAge={r.endAge} />
            </div>
          )
        })}

        {results.all && (
          <div className="lpc-whatif lpc-all">
            <div className="lpc-cond"><strong>全部あわせると</strong></div>
            <ResultLine base={base} s={results.all.s} endAge={results.all.endAge} />
          </div>
        )}

        <button className="lpc-add" onClick={addRow}>＋ 条件を追加</button>
      </div>

      <details className="lpc-block" open>
        <summary>③ データの過不足 {countBadge(data)}</summary>
        <CheckList items={data} okText="気になる点なし" />
      </details>
    </details>
  )
}
