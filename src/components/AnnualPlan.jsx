import { useState, useEffect } from 'react'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import './AnnualPlan.css'

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
const INCOME_ITEMS = ['給与', 'ボーナス']

const fmtNum = (n) => `¥${Math.abs(Math.round(n)).toLocaleString()}`

function makeEmptyPlan() {
  const p = {}
  INCOME_ITEMS.forEach(item => { p[`収入_${item}`] = Array(12).fill(0) })
  BUCKET_CONFIG.forEach(b    => { p[`支出_${b.name}`] = Array(12).fill(b.budget) })
  return p
}

export default function AnnualPlan() {
  const currentYear = new Date().getFullYear()
  const [year, setYear]       = useState(currentYear)
  const [plan, setPlan]       = useState(makeEmptyPlan)
  const [planKey, setPlanKey] = useState(0)
  const [status, setStatus]   = useState('idle')
  const [msg, setMsg]         = useState('')

  useEffect(() => {
    if (!isGasReady()) return
    setStatus('loading')
    gasApi.getAnnualPlan(year)
      .then(r => {
        setPlan(r.plan || makeEmptyPlan())
        setPlanKey(k => k + 1)
        setStatus('idle')
        setMsg('')
      })
      .catch(e => { setStatus('error'); setMsg(e.message) })
  }, [year])

  const handleCell = (key, i, raw) => {
    const num = Number(String(raw).replace(/[,¥\s]/g, '')) || 0
    setPlan(prev => {
      const current = prev[key] ?? Array(12).fill(0)
      return { ...prev, [key]: current.map((v, j) => j === i ? num : v) }
    })
  }

  const handleSave = async () => {
    setStatus('saving'); setMsg('')
    try {
      await gasApi.saveAnnualPlan(year, plan)
      setStatus('saved'); setMsg('保存しました')
    } catch (e) { setStatus('error'); setMsg(e.message) }
  }

  const monthlyBuckets = BUCKET_CONFIG.filter(b => !ANNUAL_BUCKET_NAMES.includes(b.name))

  const incomeM  = MONTHS.map((_, i) => INCOME_ITEMS.reduce((s, item) => s + (plan[`収入_${item}`]?.[i] || 0), 0))
  const expenseM = MONTHS.map((_, i) => monthlyBuckets.reduce((s, b) => s + (plan[`支出_${b.name}`]?.[i] || 0), 0))
  const balanceM = MONTHS.map((_, i) => incomeM[i] - expenseM[i])
  const totalIn      = incomeM.reduce((s, v) => s + v, 0)
  const totalExM     = expenseM.reduce((s, v) => s + v, 0)
  const annualTotal  = BUCKET_CONFIG
    .filter(b => ANNUAL_BUCKET_NAMES.includes(b.name))
    .reduce((s, b) => s + (plan[`支出_${b.name}`]?.[3] || 0), 0)
  const totalEx  = totalExM + annualTotal
  const totalBal = totalIn - totalEx

  return (
    <div className="annual-plan">
      <div className="ap-toolbar">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ap-year-select">
          {[currentYear - 1, currentYear, currentYear + 1].map(y => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <button
          className={`ap-save-btn ap-save-btn--${status}`}
          onClick={handleSave}
          disabled={status === 'saving' || status === 'loading'}
        >
          {status === 'saving' ? '保存中…' : status === 'saved' ? '✓ 保存済み' : '保存'}
        </button>
        {status === 'loading' && <span className="ap-msg">読込中…</span>}
        {msg && <span className={`ap-msg ap-msg--${status}`}>{msg}</span>}
      </div>

      <div className="ap-scroll">
        <table className="ap-table" key={`${year}-${planKey}`}>
          <thead>
            <tr>
              <th className="ap-th-label">項目</th>
              {MONTHS.map(m => <th key={m} className="ap-th-month">{m}</th>)}
              <th className="ap-th-total">合計</th>
            </tr>
          </thead>
          <tbody>

            <tr className="ap-section-hdr"><td colSpan={14}>収入</td></tr>
            {INCOME_ITEMS.map(item => {
              const key = `収入_${item}`
              const row = plan[key] || Array(12).fill(0)
              return (
                <tr key={key} className="ap-data-row">
                  <td className="ap-row-label">{item}</td>
                  {row.map((v, i) => (
                    <td key={i} className="ap-cell">
                      <input
                        type="text"
                        defaultValue={v || ''}
                        onBlur={e => handleCell(key, i, e.target.value)}
                        className="ap-input"
                        placeholder="0"
                      />
                    </td>
                  ))}
                  <td className="ap-total-cell">{fmtNum(row.reduce((s, v) => s + v, 0))}</td>
                </tr>
              )
            })}
            <tr className="ap-subtotal-row">
              <td className="ap-row-label">収入計</td>
              {incomeM.map((v, i) => <td key={i} className="ap-subtotal-cell">{fmtNum(v)}</td>)}
              <td className="ap-total-cell ap-subtotal-cell">{fmtNum(totalIn)}</td>
            </tr>

            <tr className="ap-section-hdr"><td colSpan={14}>支出（予算）</td></tr>
            {BUCKET_CONFIG.map(b => {
              const key = `支出_${b.name}`
              const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
              const row = plan[key] ?? Array(12).fill(0)

              if (isAnnual) {
                const annualValue = row[3] || 0
                return (
                  <tr key={key} className="ap-data-row ap-annual-row">
                    <td className="ap-row-label">
                      <span className="ap-dot" style={{ background: b.color }} />
                      {b.name}
                      <span className="ap-annual-badge">年間</span>
                    </td>
                    <td colSpan={12} className="ap-annual-cell">
                      <input
                        type="text"
                        defaultValue={annualValue || ''}
                        onBlur={e => handleCell(key, 3, e.target.value)}
                        className="ap-input ap-annual-input"
                        placeholder="0"
                      />
                    </td>
                    <td className="ap-total-cell">{fmtNum(annualValue)}</td>
                  </tr>
                )
              }

              return (
                <tr key={key} className="ap-data-row">
                  <td className="ap-row-label">
                    <span className="ap-dot" style={{ background: b.color }} />
                    {b.name}
                  </td>
                  {row.map((v, i) => (
                    <td key={i} className="ap-cell">
                      <input
                        type="text"
                        defaultValue={v || ''}
                        onBlur={e => handleCell(key, i, e.target.value)}
                        className="ap-input"
                        placeholder="0"
                      />
                    </td>
                  ))}
                  <td className="ap-total-cell">{fmtNum(row.reduce((s, v) => s + v, 0))}</td>
                </tr>
              )
            })}
            <tr className="ap-subtotal-row">
              <td className="ap-row-label">支出計</td>
              {expenseM.map((v, i) => <td key={i} className="ap-subtotal-cell">{fmtNum(v)}</td>)}
              <td className="ap-total-cell ap-subtotal-cell ap-subtotal-annual">{fmtNum(totalEx)}</td>
            </tr>

            <tr className="ap-balance-row">
              <td className="ap-row-label">収支差</td>
              {balanceM.map((v, i) => (
                <td key={i} className={`ap-balance-cell ${v < 0 ? 'ap-neg' : 'ap-pos'}`}>
                  {v < 0 ? '-' : '+'}{fmtNum(v)}
                </td>
              ))}
              <td className={`ap-total-cell ap-balance-cell ${totalBal < 0 ? 'ap-neg' : 'ap-pos'}`}>
                {totalBal < 0 ? '-' : '+'}{fmtNum(totalBal)}
              </td>
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  )
}
