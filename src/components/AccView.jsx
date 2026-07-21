import { useMemo, useState, useEffect, Fragment } from 'react'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import OsaifuInput from './OsaifuInput'
import BucketYearChart from './BucketYearChart'
import './AccView.css'

const fmt = (n) => `¥${Math.round(n).toLocaleString()}`
const CUMULATIVE = '累計'

function getFiscalPriorMonths(selectedMonth, availableMonths) {
  const year = selectedMonth.split('-')[0]
  const fiscalStart = `${year}-01`
  return availableMonths.filter(m => m >= fiscalStart && m < selectedMonth)
}

// 今年度（1月〜当月）の月リストをデータの有無に関わらず生成
function currentFiscalYearMonths() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return Array.from({ length: month }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

export default function AccView() {
  const [transactions, setTransactions]   = useState([])
  const [annualPlan, setAnnualPlan]       = useState(null)
  const [annualTransactions, setAnnualTx] = useState([])
  const [availableMonths, setAvailableMonths] = useState([])
  const [selectedMonth, setSelected]      = useState('')
  const [status, setStatus]               = useState('idle')
  const [commonAccounts, setCommonAccounts] = useState([])
  const [openBucket, setOpenBucket] = useState(null)
  const [lastImportedAt, setLastImportedAt] = useState('')

  const isCumulative = selectedMonth === CUMULATIVE
  // 「累計」選択時は最新の実月（当月）を基準にJan〜当月のデータを扱う
  const displayMonth = isCumulative ? availableMonths[0] : selectedMonth

  // 月リスト取得（初回のみ）
  useEffect(() => {
    if (!isGasReady()) return
    gasApi.getMonths().then(r => {
      const ms = [...new Set([...(r.months || []), ...currentFiscalYearMonths()])]
        .sort()
        .reverse()
      setAvailableMonths(ms)
      if (ms.length > 0) setSelected(ms[0])
    })
    gasApi.getLastImportedAt().then(r => setLastImportedAt(r.lastImportedAt || '')).catch(() => {})
  }, [])

  // 月が変わるたびにデータ再取得（切替連打時に古い応答が新しい応答を上書きしないようガード）
  useEffect(() => {
    if (!displayMonth || availableMonths.length === 0) return
    let cancelled = false
    setStatus('loading')
    const year = displayMonth.split('-')[0]
    const priorMonths = getFiscalPriorMonths(displayMonth, availableMonths)
    Promise.all([
      gasApi.getTransactions(displayMonth),
      gasApi.getAnnualPlan(year),
      gasApi.getAssets(),
      ...priorMonths.map(m => gasApi.getTransactions(m)),
    ])
      .then(([result, planResult, assetResult, ...priorResults]) => {
        if (cancelled) return
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
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [displayMonth, availableMonths])

  // 月/累計の切替時は開いていた明細を閉じる
  useEffect(() => { setOpenBucket(null) }, [selectedMonth])

  const billable = useMemo(
    () => transactions.filter(t => t.category !== '対象外'),
    [transactions]
  )

  const annualBillable = useMemo(
    () => annualTransactions.filter(t => t.category !== '対象外'),
    [annualTransactions]
  )

  const effectiveBudgets = useMemo(() => {
    if (!annualPlan || !displayMonth) return {}
    const monthIdx = parseInt(displayMonth.split('-')[1], 10) - 1
    return Object.fromEntries(
      BUCKET_CONFIG.map(b => {
        const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
        const vals = annualPlan[`支出_${b.name}`]
        const idx = isAnnual ? 3 : monthIdx
        const fallback = isAnnual ? 0 : b.budget
        return [b.name, vals?.[idx] ?? fallback]
      })
    )
  }, [annualPlan, displayMonth])

  // 「累計」選択時、月間バケットの予算をJan〜当月の月別予算合計に置き換える
  const cumulativeBucketBudgets = useMemo(() => {
    if (!isCumulative || !displayMonth) return {}
    const fiscalMonths = [...getFiscalPriorMonths(displayMonth, availableMonths), displayMonth].filter(Boolean)
    const sums = {}
    for (const b of BUCKET_CONFIG) {
      if (ANNUAL_BUCKET_NAMES.includes(b.name)) continue
      sums[b.name] = fiscalMonths.reduce((total, month) => {
        const monthIdx = parseInt(month.split('-')[1], 10) - 1
        const budget = annualPlan ? (annualPlan[`支出_${b.name}`]?.[monthIdx] ?? b.budget) : b.budget
        return total + budget
      }, 0)
    }
    return sums
  }, [isCumulative, displayMonth, availableMonths, annualPlan])

  const bucketData = useMemo(() => {
    return BUCKET_CONFIG.map(b => {
      const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
      const budget = isAnnual
        ? (effectiveBudgets[b.name] ?? 0)
        : isCumulative
          ? (cumulativeBucketBudgets[b.name] ?? 0)
          : (effectiveBudgets[b.name] ?? b.budget)
      const src = (isAnnual || isCumulative) ? annualBillable : billable
      const actual = src
        .filter(t => b.categories.includes(t.category))
        .reduce((s, t) => s + t.amount, 0)
      const ratio = budget > 0 ? actual / budget : 0
      return { ...b, budget, actual, ratio, remaining: budget - actual }
    })
  }, [billable, annualBillable, effectiveBudgets, isCumulative, cumulativeBucketBudgets])

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
    const fiscalMonths = [...getFiscalPriorMonths(displayMonth, availableMonths), displayMonth].filter(Boolean)
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
  }, [annualPlan, displayMonth, availableMonths, annualTransactions])

  const cumulativePeriodLabel = useMemo(() => {
    const ms = [...cumulativeMidData.months].sort()
    return ms.length > 0
      ? `${parseInt(ms[0].split('-')[1], 10)}〜${parseInt(ms[ms.length - 1].split('-')[1], 10)}月累計`
      : ''
  }, [cumulativeMidData.months])

  return (
    <div className="acc-view">

      {/* 年間推移グラフ */}
      <BucketYearChart />

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
              <option value={CUMULATIVE}>{CUMULATIVE}</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {isCumulative && cumulativePeriodLabel && (
            <span className="acc-hesokin-period">{cumulativePeriodLabel}</span>
          )}
          {status === 'loading' && <span className="acc-loading">読込中…</span>}
          {lastImportedAt && (
            <span className="acc-import-at">PayPay取込更新日：{lastImportedAt}</span>
          )}
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
            {bucketData.filter(b => !['家賃', '妊活'].includes(b.name)).map(b => {
              const isOpen = openBucket === b.name
              const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
              const detailSrc = (isAnnual || isCumulative) ? annualBillable : billable
              const detail = detailSrc
                .filter(t => b.categories.includes(t.category))
                .sort((x, y) => (x.date < y.date ? 1 : -1))
              return (
                <Fragment key={b.name}>
                  <tr
                    className={`acc-row acc-row--expandable ${isOpen ? 'acc-row--open' : ''}`}
                    onClick={() => setOpenBucket(isOpen ? null : b.name)}
                  >
                    <td className="acc-td-name">
                      <span className="acc-expand-icon">{isOpen ? '▾' : '▸'}</span>
                      <span className="acc-dot" style={{ background: b.color }} />
                      {b.name}
                      <span className={`acc-period-tag ${isAnnual ? 'acc-period-tag--annual' : 'acc-period-tag--monthly'}`}>
                        {isAnnual ? '年間' : '月間'}
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
                  {isOpen && (
                    <tr className="acc-detail-row-wrap">
                      <td colSpan={3} className="acc-detail-cell">
                        <div className="acc-detail-panel">
                          {detail.length === 0 ? (
                            <p className="acc-detail-empty">該当する取引がありません</p>
                          ) : (
                            <table className="acc-detail-table">
                              <thead>
                                <tr>
                                  <th>日付</th>
                                  <th>決済先</th>
                                  <th className="acc-th-r">金額</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map(t => (
                                  <tr key={t.id}>
                                    <td className="acc-detail-date">{t.date}</td>
                                    <td className="acc-detail-desc">{t.description}</td>
                                    <td className="acc-detail-amount">¥{t.amount.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* へそくり */}
      <div className="acc-card acc-card--hesokin">
        <div className="acc-card-header">
          <p className="acc-card-title">へそくり</p>
          {cumulativePeriodLabel && <span className="acc-hesokin-period">{cumulativePeriodLabel}</span>}
        </div>
        <div className="acc-hesokin-body">
          <span className={`acc-hesokin-amount ${cumulativeMidData.remaining < 0 ? 'acc-neg' : 'acc-pos'}`}>
            {cumulativeMidData.remaining < 0 ? '-' : ''}{fmt(Math.abs(cumulativeMidData.remaining))}
          </span>
          <span className="acc-hesokin-label">安心＋暮らし プール金</span>
        </div>
        <div className="acc-hesokin-sub">
          <span>累計予算 {fmt(cumulativeMidData.budget)}</span>
          <span>累計実績 {fmt(cumulativeMidData.actual)}</span>
        </div>
      </div>

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
