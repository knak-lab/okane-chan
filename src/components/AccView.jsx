import { useMemo, useState, useEffect } from 'react'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import OsaifuInput from './OsaifuInput'
import './AccView.css'

const fmt = (n) => `¥${Math.round(n).toLocaleString()}`

function getFiscalPriorMonths(selectedMonth, availableMonths) {
  const year = selectedMonth.split('-')[0]
  const fiscalStart = `${year}-01`
  return availableMonths.filter(m => m >= fiscalStart && m < selectedMonth)
}

export default function AccView() {
  const [transactions, setTransactions]   = useState([])
  const [annualPlan, setAnnualPlan]       = useState(null)
  const [annualTransactions, setAnnualTx] = useState([])
  const [availableMonths, setAvailableMonths] = useState([])
  const [selectedMonth, setSelected]      = useState('')
  const [status, setStatus]               = useState('idle')
  const [commonAccounts, setCommonAccounts] = useState([])

  // 月リスト取得（初回のみ）
  useEffect(() => {
    if (!isGasReady()) return
    gasApi.getMonths().then(r => {
      const ms = r.months || []
      setAvailableMonths(ms)
      if (ms.length > 0) setSelected(ms[0])
    })
  }, [])

  // 月が変わるたびにデータ再取得
  useEffect(() => {
    if (!selectedMonth || availableMonths.length === 0) return
    setStatus('loading')
    const year = selectedMonth.split('-')[0]
    const priorMonths = getFiscalPriorMonths(selectedMonth, availableMonths)
    Promise.all([
      gasApi.getTransactions(selectedMonth),
      gasApi.getAnnualPlan(year),
      gasApi.getAssets(),
      ...priorMonths.map(m => gasApi.getTransactions(m)),
    ])
      .then(([result, planResult, assetResult, ...priorResults]) => {
        setTransactions(result.transactions || [])
        setAnnualPlan(planResult.plan || null)
        setAnnualTx([
          ...(result.transactions || []),
          ...priorResults.flatMap(r => r.transactions || []),
        ])
        const grouped = {}
        for (const r of (assetResult.assets || [])) {
          if (r['区分'] !== '共通') continue
          const key = `${r['種別']}__${r['口座名']}`
          if (!grouped[key]) grouped[key] = { 種別: r['種別'], 口座名: r['口座名'], records: [] }
          if (r['月']) grouped[key].records.push({ month: r['月'], amount: r['金額'] ?? '' })
        }
        setCommonAccounts(
          Object.values(grouped).map(a => ({
            ...a,
            records: a.records.sort((x, y) => y.month.localeCompare(x.month)),
          }))
        )
        setStatus('done')
      })
      .catch(() => setStatus('error'))
  }, [selectedMonth, availableMonths])

  const billable = useMemo(
    () => transactions.filter(t => t.category !== '対象外'),
    [transactions]
  )

  const annualBillable = useMemo(
    () => annualTransactions.filter(t => t.category !== '対象外'),
    [annualTransactions]
  )

  const effectiveBudgets = useMemo(() => {
    if (!annualPlan || !selectedMonth) return {}
    const monthIdx = parseInt(selectedMonth.split('-')[1], 10) - 1
    return Object.fromEntries(
      BUCKET_CONFIG.map(b => {
        const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
        const vals = annualPlan[`支出_${b.name}`]
        const idx = isAnnual ? 3 : monthIdx
        const fallback = isAnnual ? 0 : b.budget
        return [b.name, vals?.[idx] ?? fallback]
      })
    )
  }, [annualPlan, selectedMonth])

  const bucketData = useMemo(() => {
    return BUCKET_CONFIG.map(b => {
      const budget = effectiveBudgets[b.name] ?? (ANNUAL_BUCKET_NAMES.includes(b.name) ? 0 : b.budget)
      const src = ANNUAL_BUCKET_NAMES.includes(b.name) ? annualBillable : billable
      const actual = src
        .filter(t => b.categories.includes(t.category))
        .reduce((s, t) => s + t.amount, 0)
      const ratio = budget > 0 ? actual / budget : 0
      return { ...b, budget, actual, ratio, remaining: budget - actual }
    })
  }, [billable, annualBillable, effectiveBudgets])

  const midData = useMemo(() => {
    const rows = bucketData.filter(b => ['安心ライフ費', '暮らしの彩り費'].includes(b.name))
    const budget = rows.reduce((s, b) => s + b.budget, 0)
    const actual = rows.reduce((s, b) => s + b.actual, 0)
    const remaining = budget - actual
    const ratio = budget > 0 ? actual / budget : 0
    return { budget, actual, remaining, ratio }
  }, [bucketData])

  const cumulativeMidData = useMemo(() => {
    const midBuckets = BUCKET_CONFIG.filter(b => ['安心ライフ費', '暮らしの彩り費'].includes(b.name))
    const fiscalMonths = [...getFiscalPriorMonths(selectedMonth, availableMonths), selectedMonth].filter(Boolean)
    let totalBudget = 0
    let totalActual = 0
    for (const month of fiscalMonths) {
      const monthIdx = parseInt(month.split('-')[1], 10) - 1
      const monthPrefix = month.replace('-', '/')
      for (const b of midBuckets) {
        const budget = annualPlan
          ? (annualPlan[`支出_${b.name}`]?.[monthIdx] ?? b.budget)
          : b.budget
        totalBudget += budget
        const actual = annualTransactions
          .filter(t => t.category !== '対象外' && t.date?.startsWith(monthPrefix) && b.categories.includes(t.category))
          .reduce((s, t) => s + t.amount, 0)
        totalActual += actual
      }
    }
    const remaining = totalBudget - totalActual
    const ratio = totalBudget > 0 ? totalActual / totalBudget : 0
    return { budget: totalBudget, actual: totalActual, remaining, ratio, months: fiscalMonths }
  }, [annualPlan, selectedMonth, availableMonths, annualTransactions])

  return (
    <div className="acc-view">

      {/* 支払サマリ（簡易） */}
      <div className="acc-card">
        <div className="acc-card-header">
          <p className="acc-card-title">支払サマリ</p>
          {availableMonths.length > 0 && (
            <select
              className="acc-month-select"
              value={selectedMonth}
              onChange={e => setSelected(e.target.value)}
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {status === 'loading' && <span className="acc-loading">読込中…</span>}
        </div>

        <table className="acc-table">
          <thead>
            <tr>
              <th className="acc-th-name">バケット</th>
              <th className="acc-th-r">残り</th>
              <th className="acc-th-bar">消化率</th>
            </tr>
          </thead>
          <tbody>
            {/* 中計（安心＋暮らし）当月のみ */}
            <tr className="acc-mid-row">
              <td className="acc-td-name acc-mid-label">安心＋暮らし</td>
              <td className={`acc-td-r ${midData.remaining < 0 ? 'acc-neg' : 'acc-pos'}`}>
                {midData.remaining < 0 ? '-' : ''}{fmt(Math.abs(midData.remaining))}
              </td>
              <td className="acc-td-bar">
                <div className="acc-track">
                  <div
                    className="acc-fill"
                    style={{
                      width: `${Math.min(midData.ratio * 100, 100)}%`,
                      background: midData.ratio > 1 ? '#f85149' : '#64748B',
                    }}
                  />
                </div>
                <span className="acc-pct">{Math.round(midData.ratio * 100)}%</span>
              </td>
            </tr>
            {bucketData.filter(b => !['家賃', '妊活'].includes(b.name)).map(b => (
              <tr key={b.name} className="acc-row">
                <td className="acc-td-name">
                  <span className="acc-dot" style={{ background: b.color }} />
                  {b.name}
                  <span className={`acc-period-tag ${ANNUAL_BUCKET_NAMES.includes(b.name) ? 'acc-period-tag--annual' : 'acc-period-tag--monthly'}`}>
                    {ANNUAL_BUCKET_NAMES.includes(b.name) ? '年間' : '月間'}
                  </span>
                </td>
                <td className={`acc-td-r ${b.remaining < 0 ? 'acc-neg' : 'acc-pos'}`}>
                  {b.remaining < 0 ? '-' : ''}{fmt(Math.abs(b.remaining))}
                </td>
                <td className="acc-td-bar">
                  <div className="acc-track">
                    <div
                      className="acc-fill"
                      style={{
                        width: `${Math.min(b.ratio * 100, 100)}%`,
                        background: b.ratio > 1 ? '#f85149' : b.color,
                      }}
                    />
                  </div>
                  <span className="acc-pct">{Math.round(b.ratio * 100)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* へそくり */}
      {(() => {
        const ms = [...cumulativeMidData.months].sort()
        const periodLabel = ms.length > 0
          ? `${parseInt(ms[0].split('-')[1], 10)}〜${parseInt(ms[ms.length - 1].split('-')[1], 10)}月累計`
          : ''
        return (
          <div className="acc-card acc-card--hesokin">
            <div className="acc-card-header">
              <p className="acc-card-title">へそくり</p>
              {periodLabel && <span className="acc-hesokin-period">{periodLabel}</span>}
            </div>
            <div className="acc-hesokin-body">
              <span className={`acc-hesokin-amount ${cumulativeMidData.remaining < 0 ? 'acc-neg' : 'acc-pos'}`}>
                {cumulativeMidData.remaining < 0 ? '-' : ''}{fmt(Math.abs(cumulativeMidData.remaining))}
              </span>
              <span className="acc-hesokin-label">安心＋暮らし プール金</span>
            </div>
          </div>
        )
      })()}

      {/* 共通口座 */}
      {commonAccounts.length > 0 && (() => {
        const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
        const latestAmt = (a) => a.records.find(r => r.amount !== '' && r.amount != null)?.amount ?? null
        const total = commonAccounts.reduce((s, a) => s + parseAmt(latestAmt(a)), 0)
        return (
          <div className="acc-card">
            <div className="acc-card-header">
              <p className="acc-card-title">共通口座</p>
              <span className="acc-common-total">合計 {fmt(total)}</span>
            </div>
            <table className="acc-table">
              <tbody>
                {commonAccounts.map((a, i) => {
                  const amt = latestAmt(a)
                  return (
                    <tr key={i} className="acc-row">
                      <td className="acc-td-name">
                        <span className="acc-common-type">{a.種別}</span>
                        {a.口座名}
                      </td>
                      <td className={`acc-td-r ${amt == null ? '' : 'acc-pos'}`}>
                        {amt == null ? '—' : fmt(parseAmt(amt))}
                      </td>
                      <td className="acc-td-bar" />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* 現金やりとり */}
      <p className="acc-section-label">現金やりとり</p>
      <OsaifuInput />

    </div>
  )
}
