import { useEffect, useRef, useState } from 'react'
import './LPYearTable.css'

// LPの年ごとの表。最初は閉じていて、開くと「収入・支出・収支・年末の資産」の要約、
// 「詳細」で内訳の列も出す。全画面にするとスマホを横にして大きく見られる
const man = (v) => {
  const n = Math.round((Number(v) || 0) / 10_000)
  return n === 0 ? '' : n.toLocaleString()
}

// 詳細の列（見出しのまとまり → 列）
const DETAIL = [
  { group: '収入', cls: 'in', cols: [
    ['incomeMe', 'あなた'], ['incomeWife', '妻'], ['pension', '年金'],
    ['allowance', '児童手当'], ['loanDeduct', 'ローン控除'], ['otherIncome', '臨時・返戻・DC'],
  ] },
  { group: '支出', cls: 'out', cols: [
    ['living', '生活'], ['childLiving', '子供生活'], ['dog', 'ワン'], ['housing', '家賃/ローン'],
    ['homeKeep', '固定資産税・維持'], ['yutori', 'ときめき冒険'], ['ninkatsu', '妊活'],
    ['homeDown', '頭金'], ['car', '車'], ['edu', '教育費'], ['premium', '保険料'], ['oneOff', '臨時'],
  ] },
  { group: '投資', cls: 'mv', cols: [
    ['fundInvest', '積立'], ['withdrawn', '取り崩し'], ['autoDraw', '計画外'],
  ] },
  { group: '年末の資産', cls: 'bal', cols: [
    ['endCash', '預金'], ['endInvest', '投信'], ['endDc', 'DC'], ['endIns', '保険'],
  ] },
]

export default function LPYearTable({ sim, wifeAge, kids }) {
  const [detail, setDetail] = useState(false)
  const [full, setFull] = useState(false)
  const boxRef = useRef(null)
  const thisYear = new Date().getFullYear()
  const startAge = sim[0]?.age ?? 0
  const firstKid = (kids || []).find(c => c?.enabled)

  // 全画面：使えるブラウザでは本当の全画面＋横向き固定を試し、使えなければ画面いっぱいの重ね表示にする
  const openFull = async () => {
    setFull(true)
    try {
      await boxRef.current?.requestFullscreen?.()
      await screen.orientation?.lock?.('landscape')
    } catch { /* iPhone など：重ね表示のまま、端末を横にして見る */ }
  }
  const closeFull = async () => {
    setFull(false)
    try { screen.orientation?.unlock?.() } catch { /* なし */ }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  // 重ね表示の間は後ろの画面をスクロールさせない
  useEffect(() => {
    if (!full) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [full])

  const rows = sim.filter(d => d.flow)
  const table = (
    <div className="lpy-scroll">
      <table className={`lpy-table${detail ? ' lpy-table--detail' : ''}`}>
        <thead>
          <tr>
            <th className="lpy-sticky" rowSpan={detail ? 2 : 1}>年</th>
            <th rowSpan={detail ? 2 : 1}>年齢</th>
            {firstKid && <th rowSpan={detail ? 2 : 1}>子</th>}
            <th className="lpy-in" rowSpan={detail ? 2 : 1}>収入</th>
            <th className="lpy-out" rowSpan={detail ? 2 : 1}>支出</th>
            <th rowSpan={detail ? 2 : 1}>収支</th>
            <th className="lpy-bal" rowSpan={detail ? 2 : 1}>資産</th>
            {detail && DETAIL.map(g => <th key={g.group} className={`lpy-${g.cls} lpy-group`} colSpan={g.cols.length}>{g.group}</th>)}
          </tr>
          {detail && (
            <tr>
              {DETAIL.flatMap(g => g.cols.map(([k, label]) => <th key={k} className={`lpy-${g.cls}`}>{label}</th>))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map(d => {
            const f = d.flow
            const t = d.age - startAge
            const kidAge = firstKid ? Number(firstKid.currentAge) + t : null
            return (
              <tr key={d.age} className={f.autoDraw > 0 ? 'lpy-row--auto' : ''}>
                <td className="lpy-sticky">{thisYear + t}</td>
                <td>{d.age}<span className="lpy-sub">/{Number(wifeAge) + t}</span></td>
                {firstKid && <td>{kidAge >= 0 ? kidAge : ''}</td>}
                <td>{man(f.income)}</td>
                <td>{man(f.expense)}</td>
                <td className={f.balance < 0 ? 'lpy-neg' : ''}>{f.balance < 0 ? '▲' : ''}{man(Math.abs(f.balance))}</td>
                <td className={`lpy-strong${f.endTotal < 0 ? ' lpy-neg' : ''}`}>{man(f.endTotal)}</td>
                {detail && DETAIL.flatMap(g => g.cols.map(([k]) => (
                  <td key={k} className={k === 'autoDraw' && f[k] > 0 ? 'lpy-neg' : ''}>{man(f[k])}</td>
                )))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const toolbar = (
    <div className="lpy-toolbar">
      <span className="lpy-unit">単位：万円（年齢は あなた/妻）</span>
      <button type="button" className={`lpy-btn${detail ? ' active' : ''}`} onClick={() => setDetail(v => !v)}>
        {detail ? '要約だけ' : '詳細を見る'}
      </button>
      {full
        ? <button type="button" className="lpy-btn" onClick={closeFull}>✕ 閉じる</button>
        : <button type="button" className="lpy-btn" onClick={openFull}>⛶ 全画面</button>}
    </div>
  )

  return (
    <details className="sim-section sim-collapse lpy">
      <summary className="sim-section-title">
        📋 年ごとの表 <span className="sim-section-note">収入・支出・収支・年末の資産</span>
      </summary>
      <div ref={boxRef} className={full ? 'lpy-full' : ''}>
        {toolbar}
        {full && <p className="lpy-hint">スマホは横向きにすると見やすくなります</p>}
        {table}
        <p className="lpy-note">収支＝収入−支出（投信への積立・取り崩しは資産の移動なので含めない）。「計画外」は預金が足りずに保険・投信を自動で崩した額で、その年は色が付きます</p>
      </div>
    </details>
  )
}
