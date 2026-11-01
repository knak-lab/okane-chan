import { useMemo, useState, useEffect, Fragment } from 'react'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import { readCache, writeCache } from '../utils/localCache'
import { ALL_CATEGORIES } from '../utils/categorize'
import { saveCustomRule } from '../utils/customRules'
import OsaifuInput from './OsaifuInput'
import BucketYearChart from './BucketYearChart'
import './AccView.css'

const MONTHS_CACHE_KEY = 'acc:months'
const monthDataCacheKey = (month) => `acc:month:${month}`

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
  // 明細でカテゴリ編集中の取引: { id, category, keyword }
  const [editDraft, setEditDraft] = useState(null)
  const [catSave, setCatSave] = useState({ id: null, status: 'idle', msg: '' })

  const isCumulative = selectedMonth === CUMULATIVE
  // 「累計」選択時は最新の実月（当月）を基準にJan〜当月のデータを扱う
  const displayMonth = isCumulative ? availableMonths[0] : selectedMonth

  // 月リスト取得（初回のみ）。前回起動時のリストがあれば通信を待たずに即使う
  useEffect(() => {
    if (!isGasReady()) return
    const cachedMonths = readCache(MONTHS_CACHE_KEY)
    if (cachedMonths?.length > 0) {
      setAvailableMonths(cachedMonths)
      setSelected(cachedMonths[0])
    }
    gasApi.getMonths().then(r => {
      const ms = [...new Set([...(r.months || []), ...currentFiscalYearMonths()])]
        .sort()
        .reverse()
      setAvailableMonths(ms)
      if (ms.length > 0) setSelected(ms[0])
      writeCache(MONTHS_CACHE_KEY, ms)
    })
    gasApi.getLastImportedAt().then(r => setLastImportedAt(r.lastImportedAt || '')).catch(() => {})
  }, [])

  // 月が変わるたびにデータ再取得（切替連打時に古い応答が新しい応答を上書きしないようガード）。
  // キャッシュを即表示して裏で最新を取り直す。編集は明細のカテゴリ変更だけで、
  // 取引1件の行を取引番号で上書きするため、古いキャッシュが他の取引を巻き戻すことは無い。
  useEffect(() => {
    if (!displayMonth || availableMonths.length === 0) return
    let cancelled = false
    const cacheKey = monthDataCacheKey(displayMonth)
    const cached = readCache(cacheKey)
    if (cached) {
      setTransactions(cached.transactions)
      setAnnualPlan(cached.annualPlan)
      setAnnualTx(cached.annualTx)
      setCommonAccounts(cached.commonAccounts)
      setStatus('done')
    } else {
      setStatus('loading')
    }
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
        const nextTransactions = result.transactions || []
        const nextAnnualPlan = planResult.plan || null
        const nextAnnualTx = [
          ...nextTransactions,
          ...priorResults.flatMap(r => r.transactions || []),
        ]
        const grouped = {}
        for (const r of (assetResult.assets || [])) {
          if (r['区分'] !== '共通') continue
          const key = `${r['種別']}__${r['口座名']}`
          if (!grouped[key]) grouped[key] = { 種別: r['種別'], 口座名: r['口座名'], records: [] }
          if (r['月']) grouped[key].records.push({ month: r['月'], amount: r['金額'] ?? '' })
        }
        const nextCommonAccounts = Object.values(grouped).map(a => ({
          ...a,
          records: a.records.sort((x, y) => y.month.localeCompare(x.month)),
        }))
        setTransactions(nextTransactions)
        setAnnualPlan(nextAnnualPlan)
        setAnnualTx(nextAnnualTx)
        setCommonAccounts(nextCommonAccounts)
        setStatus('done')
        writeCache(cacheKey, {
          transactions: nextTransactions,
          annualPlan: nextAnnualPlan,
          annualTx: nextAnnualTx,
          commonAccounts: nextCommonAccounts,
        })
      })
      .catch(() => { if (!cancelled && !cached) setStatus('error') })
    return () => { cancelled = true }
  }, [displayMonth, availableMonths])

  // 月/累計の切替時は開いていた明細を閉じる
  useEffect(() => { setOpenBucket(null) }, [selectedMonth])
  useEffect(() => {
    setEditDraft(null)
    setCatSave({ id: null, status: 'idle', msg: '' })
  }, [openBucket])

  // 明細のカテゴリ変更。画面は先に書き換え、その1件のカテゴリ列だけをスプシに保存する。
  // ruleKeyword があればカテゴリルールにも追加する（今後のCSV取込の自動分類に効く）。
  // 取引の保存に失敗したら元のカテゴリに戻す。
  const handleCategoryChange = async (tx, newCategory, ruleKeyword) => {
    if (!tx.id || newCategory === tx.category) return
    const replace = (category) => (list) => list.map(t => t.id === tx.id ? { ...t, category } : t)
    setTransactions(replace(newCategory))
    setAnnualTx(replace(newCategory))
    setEditDraft(null)
    setCatSave({ id: tx.id, status: 'saving', msg: '保存中…' })
    // ルールは送信失敗しても端末に保留され、次回起動時に再送される
    const ruleSync = ruleKeyword ? saveCustomRule(ruleKeyword, newCategory).then(() => '', e => e.message) : null
    try {
      await gasApi.updateTransactionCategory(tx.id, newCategory)
      // 次回起動時に古いカテゴリが一瞬表示されないよう、この月のキャッシュも書き換える
      const cacheKey = monthDataCacheKey(displayMonth)
      const cached = readCache(cacheKey)
      if (cached) {
        writeCache(cacheKey, {
          ...cached,
          transactions: replace(newCategory)(cached.transactions),
          annualTx: replace(newCategory)(cached.annualTx),
        })
      }
      const ruleError = ruleSync ? await ruleSync : ''
      const msg = `「${tx.description}」を${newCategory}に変更しました`
        + (ruleKeyword ? (ruleError
          ? `（ルールは未送信。次回起動時に再送します）`
          : `（ルール「${ruleKeyword}」→${newCategory} も追加）`) : '')
      setCatSave({ id: tx.id, status: 'saved', msg })
    } catch (e) {
      setTransactions(replace(tx.category))
      setAnnualTx(replace(tx.category))
      setCatSave({ id: tx.id, status: 'error', msg: `保存に失敗しました：${e.message}` })
    }
  }

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
            {/* 中計（安心＋彩り）当月のみ */}
            <tr className="acc-mid-row">
              <td className="acc-td-name acc-mid-label">安心＋彩り</td>
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
              // 明細は選択中の月だけ（「累計」選択時は1月〜当月）。年間バケットも残り/消化率は年間のまま
              const detailSrc = isCumulative ? annualBillable : billable
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
                          {catSave.status !== 'idle' && (
                            <p className={`acc-cat-save acc-cat-save--${catSave.status}`}>{catSave.msg}</p>
                          )}
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
                                {detail.map(t => {
                                  const isEditing = editDraft?.id === t.id
                                  const changed = isEditing && editDraft.category !== t.category
                                  const keyword = isEditing ? editDraft.keyword.trim() : ''
                                  return (
                                    <Fragment key={t.id}>
                                      <tr
                                        className={t.id ? 'acc-detail-row--editable' : undefined}
                                        onClick={() => t.id && setEditDraft(isEditing ? null : {
                                          id: t.id, category: t.category, keyword: t.description,
                                        })}
                                      >
                                        <td className="acc-detail-date">{t.date}</td>
                                        <td className="acc-detail-desc">{t.description}</td>
                                        <td className="acc-detail-amount">¥{t.amount.toLocaleString()}</td>
                                      </tr>
                                      {isEditing && (
                                        <tr className="acc-detail-edit-row">
                                          <td colSpan={3}>
                                            <label className="acc-cat-edit">
                                              カテゴリ
                                              <select
                                                value={editDraft.category}
                                                onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                                                autoFocus
                                              >
                                                {ALL_CATEGORIES.map(cat => (
                                                  <option key={cat} value={cat}>{cat}</option>
                                                ))}
                                              </select>
                                            </label>
                                            {changed && (
                                              <div className="acc-cat-confirm">
                                                <p className="acc-cat-confirm-q">カテゴリルールも変更しますか？</p>
                                                <label className="acc-cat-edit">
                                                  キーワード
                                                  <input
                                                    type="text"
                                                    value={editDraft.keyword}
                                                    onChange={e => setEditDraft(d => ({ ...d, keyword: e.target.value }))}
                                                  />
                                                </label>
                                                <p className="acc-cat-confirm-note">
                                                  ルールも変更すると、今後のCSV取込で「{keyword || '…'}」を含む取引が{editDraft.category}になります
                                                </p>
                                                <div className="acc-cat-confirm-btns">
                                                  <button
                                                    type="button"
                                                    className="acc-cat-btn acc-cat-btn--primary"
                                                    onClick={() => handleCategoryChange(t, editDraft.category)}
                                                  >
                                                    この明細のみ
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="acc-cat-btn"
                                                    disabled={!keyword}
                                                    onClick={() => handleCategoryChange(t, editDraft.category, keyword)}
                                                  >
                                                    ルールも変更
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  )
                                })}
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
          <span className="acc-hesokin-label">安心＋彩り プール金</span>
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
