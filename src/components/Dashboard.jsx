import { useMemo, useState, useEffect, Fragment } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
  PieChart, Pie,
} from 'recharts'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import { ALL_CATEGORIES } from '../utils/categorize'
import './Dashboard.css'

const fmt = (n) => `¥${Math.round(n).toLocaleString()}`

function getFiscalPriorMonths(selectedMonth, availableMonths) {
  const [year, month] = selectedMonth.split('-').map(Number)
  const fiscalStart = month >= 4 ? `${year}-04` : `${year - 1}-04`
  return availableMonths.filter(m => m >= fiscalStart && m < selectedMonth)
}

function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <p className="chart-tip-label">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color || '#8b949e' }}>
          {p.name}：{fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="chart-tip">
      <p style={{ color: d.payload.color }}>{d.name}</p>
      <p>{fmt(d.value)}</p>
      <p className="chart-tip-label">{d.payload.pct}%</p>
    </div>
  )
}

function renderPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct }) {
  if (pct < 5) return null
  const rad = (Math.PI / 180) * -midAngle
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  return (
    <text x={cx + r * Math.cos(rad)} y={cy + r * Math.sin(rad)} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {pct}%
    </text>
  )
}

export default function Dashboard({ transactions, onLoad }) {
  const [months, setMonths]           = useState([])
  const [selectedMonth, setSelected]  = useState('')
  const [loadStatus, setLoadStatus]   = useState('idle') // idle | loading | done | error
  const [loadMsg, setLoadMsg]         = useState('')
  const [selectedBucket, setSelectedBucket] = useState(null)
  const [saveStatus, setSaveStatus]   = useState('idle')
  const [saveMsg, setSaveMsg]         = useState('')
  const [annualPlan, setAnnualPlan]       = useState(null)
  const [annualTransactions, setAnnualTx] = useState([])

  // 起動時に月一覧を取得してそのまま最新月を自動読み込み
  useEffect(() => {
    if (!isGasReady()) return
    setLoadStatus('loading')
    gasApi.getMonths()
      .then(async r => {
        const ms = r.months || []
        setMonths(ms)
        if (ms.length === 0) { setLoadStatus('idle'); return }
        const first = ms[0]
        setSelected(first)
        const year = first.split('-')[0]
        const priorMonths = getFiscalPriorMonths(first, ms)
        const [result, planResult, ...priorResults] = await Promise.all([
          gasApi.getTransactions(first),
          gasApi.getAnnualPlan(year),
          ...priorMonths.map(m => gasApi.getTransactions(m)),
        ])
        onLoad(result.transactions || [])
        setAnnualPlan(planResult.plan || null)
        setAnnualTx([
          ...(result.transactions || []),
          ...priorResults.flatMap(r => r.transactions || []),
        ])
        setLoadStatus('done')
        setLoadMsg(`${result.transactions?.length ?? 0}件を読み込みました`)
      })
      .catch(e => { setLoadStatus('error'); setLoadMsg(e.message) })
  }, [])

  const handleCategoryChange = (id, newCategory) => {
    onLoad(transactions.map((t) => t.id === id ? { ...t, category: newCategory } : t))
    setSaveStatus('idle')
  }

  const handleSave = async () => {
    setSaveStatus('saving')
    setSaveMsg('')
    try {
      const result = await gasApi.saveTransactions(transactions)
      setSaveStatus('saved')
      const detail = result.inserted != null
        ? `${result.inserted}件追加・${result.updated}件更新`
        : `${result.saved}件保存`
      setSaveMsg(detail)
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  const handleLoad = async () => {
    if (!selectedMonth) return
    setLoadStatus('loading')
    setLoadMsg('')
    try {
      const year = selectedMonth.split('-')[0]
      const priorMonths = getFiscalPriorMonths(selectedMonth, months)
      const [result, planResult, ...priorResults] = await Promise.all([
        gasApi.getTransactions(selectedMonth),
        gasApi.getAnnualPlan(year),
        ...priorMonths.map(m => gasApi.getTransactions(m)),
      ])
      onLoad(result.transactions || [])
      setAnnualPlan(planResult.plan || null)
      setAnnualTx([
        ...(result.transactions || []),
        ...priorResults.flatMap(r => r.transactions || []),
      ])
      setLoadStatus('done')
      setLoadMsg(`${result.transactions?.length ?? 0}件を読み込みました`)
    } catch (e) {
      setLoadStatus('error')
      setLoadMsg(e.message)
    }
  }

  // 「対象外」は集計から除く（会社経費立て替え等）
  const billable = useMemo(
    () => transactions.filter((t) => t.category !== '対象外'),
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
        const vals = annualPlan[`支出_${b.name}`]
        // 年間バケット：4月の値を年間予算として使用
        const idx = ANNUAL_BUCKET_NAMES.includes(b.name) ? 3 : monthIdx
        return [b.name, vals?.[idx] ?? b.budget]
      })
    )
  }, [annualPlan, selectedMonth])

  const bucketData = useMemo(() => {
    return BUCKET_CONFIG.map((b) => {
      const budget = effectiveBudgets[b.name] ?? b.budget
      // 年間バケットは4月〜当月の累計、月次バケットは当月のみ
      const src = ANNUAL_BUCKET_NAMES.includes(b.name) ? annualBillable : billable
      const actual = src
        .filter((t) => b.categories.includes(t.category))
        .reduce((sum, t) => sum + t.amount, 0)
      const ratio = budget > 0 ? actual / budget : 0
      return { ...b, budget, actual, ratio, remaining: budget - actual }
    })
  }, [billable, annualBillable, effectiveBudgets])

  const totalSpent = useMemo(
    () => billable.reduce((sum, t) => sum + t.amount, 0),
    [billable]
  )

  const totalBudget     = useMemo(() => bucketData.reduce((s, b) => s + b.budget, 0), [bucketData])
  const remainingBudget = totalBudget - totalSpent
  const budgetPct       = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0

  const midData = useMemo(() => {
    const MID_NAMES = ['安心ライフ費', '暮らしの彩り費']
    const rows   = bucketData.filter(b => MID_NAMES.includes(b.name))
    const budget = rows.reduce((s, b) => s + b.budget, 0)
    const actual = rows.reduce((s, b) => s + b.actual, 0)
    const ratio  = budget > 0 ? actual / budget : 0
    return { budget, actual, remaining: budget - actual, ratio }
  }, [bucketData])

  const pieData = useMemo(() => {
    const total = bucketData.reduce((s, b) => s + b.actual, 0)
    return bucketData
      .filter((b) => b.actual > 0)
      .map((b) => ({ ...b, pct: total > 0 ? Math.round((b.actual / total) * 100) : 0 }))
  }, [bucketData])

  const hasData = transactions.length > 0

  return (
    <div className="dashboard">

      {/* シートローダー */}
      {isGasReady() && (
        <div className="sheet-loader">
          <span className="sheet-loader-label">スプレッドシートから読み込む</span>
          <select
            className="month-select"
            value={selectedMonth}
            onChange={e => { setSelected(e.target.value); setLoadStatus('idle'); setLoadMsg('') }}
            disabled={months.length === 0}
          >
            {months.length === 0
              ? <option value="">データなし</option>
              : months.map(m => <option key={m} value={m}>{m}</option>)
            }
          </select>
          <button
            className={`load-btn load-btn--${loadStatus}`}
            onClick={handleLoad}
            disabled={!selectedMonth || loadStatus === 'loading'}
          >
            {loadStatus === 'loading' ? '読込中…' : '読み込む'}
          </button>
          {loadMsg && (
            <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>
          )}
          {hasData && (
            <>
              <button
                className={`save-btn-dash save-btn-dash--${saveStatus}`}
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '変更を保存'}
              </button>
              {saveMsg && (
                <span className={`load-msg load-msg--${saveStatus}`}>{saveMsg}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">今月の支出</span>
          <span className="kpi-value">{fmt(totalSpent)}</span>
          <span className="kpi-sub">{budgetPct.toFixed(1)}% 使用</span>
        </div>
        <div className={`kpi-card ${remainingBudget < 0 ? 'kpi-danger' : ''}`}>
          <span className="kpi-label">残り予算</span>
          <span className="kpi-value">
            {remainingBudget < 0 ? '-' : ''}{fmt(Math.abs(remainingBudget))}
          </span>
          <span className="kpi-sub">
            {remainingBudget < 0 ? '予算オーバー ⚠' : `/ ${fmt(totalBudget)}`}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">取引件数</span>
          <span className="kpi-value">{transactions.length}<span className="kpi-unit"> 件</span></span>
          <span className="kpi-sub">PayPay支払い</span>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-row">

        {/* Bar chart */}
        <div className="chart-card chart-bar">
          <p className="chart-title">予算 vs 実績</p>
          {hasData ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={bucketData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#E2E8F0' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
                  tick={{ fill: '#94A3B8', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(244,121,32,0.05)' }} />
                <Legend
                  formatter={(v) => <span style={{ color: '#64748B', fontSize: 11 }}>{v}</span>}
                  wrapperStyle={{ paddingTop: 8 }}
                />
                <Bar dataKey="budget" name="予算" fill="#E2E8F0" radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="actual" name="実績" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {bucketData.map((b) => (
                    <Cell key={b.name} fill={b.ratio > 1 ? '#f85149' : b.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-data">CSVをアップロードするとグラフが表示されます</div>
          )}
        </div>

        {/* Pie chart */}
        <div className="chart-card chart-pie">
          <p className="chart-title">支出内訳（消・浪・投・他）</p>
          {hasData && pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="actual"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={3}
                  labelLine={false}
                  label={renderPieLabel}
                >
                  {pieData.map((b) => (
                    <Cell key={b.name} fill={b.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<PieTip />} />
                <Legend
                  formatter={(v) => <span style={{ color: '#64748B', fontSize: 11 }}>{v}</span>}
                  wrapperStyle={{ paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-data">データなし</div>
          )}
        </div>
      </div>

      {/* Budget table */}
      <div className="chart-card">
        <p className="chart-title">カテゴリ別一覧</p>
        <table className="budget-table">
          <thead>
            <tr>
              <th>バケット</th>
              <th className="col-cats-head">カテゴリ</th>
              <th className="r col-budget-head">予算</th>
              <th className="r">実績</th>
              <th className="r col-remaining-head">残り</th>
              <th>消化率</th>
            </tr>
          </thead>
          <tbody>
            {bucketData.map((b) => {
              const isOpen = selectedBucket === b.name
              const detail = transactions
                .filter((t) => b.categories.includes(t.category))
                .sort((x, y) => (x.date < y.date ? 1 : -1))
              return (
                <Fragment key={b.name}>
                  <tr
                    className={`bucket-row ${isOpen ? 'bucket-row--open' : ''}`}
                    onClick={() => setSelectedBucket(isOpen ? null : b.name)}
                  >
                    <td>
                      <span className="expand-icon">{isOpen ? '▾' : '▸'}</span>
                      <span className="dot" style={{ background: b.color }} />
                      <span className="bucket-name">{b.name}</span>
                      {ANNUAL_BUCKET_NAMES.includes(b.name) && (
                        <span className="annual-badge">年間</span>
                      )}
                    </td>
                    <td className="cats col-cats">
                      {b.categories.map((c) => (
                        <span key={c} className="cat-tag">{c}</span>
                      ))}
                    </td>
                    <td className="r mono col-budget">{fmt(b.budget)}</td>
                    <td className="r mono">{fmt(b.actual)}</td>
                    <td className={`r mono col-remaining ${b.remaining < 0 ? 'text-danger' : 'text-ok'}`}>
                      {b.remaining < 0 ? '-' : ''}{fmt(Math.abs(b.remaining))}
                    </td>
                    <td className="progress-cell">
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${Math.min(b.ratio * 100, 100)}%`,
                            background: b.ratio > 1 ? '#f85149' : b.color,
                          }}
                        />
                      </div>
                      <span className="progress-pct">{Math.round(b.ratio * 100)}%</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row-wrap">
                      <td colSpan={6} className="detail-cell">
                        <div className="detail-panel">
                          {detail.length === 0 ? (
                            <p className="detail-empty">該当する取引がありません</p>
                          ) : (
                            <table className="detail-table">
                              <thead>
                                <tr>
                                  <th>日付</th>
                                  <th>決済先</th>
                                  <th className="r">金額</th>
                                  <th>カテゴリ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((t) => (
                                  <tr key={t.id}>
                                    <td className="detail-date">{t.date}</td>
                                    <td className="detail-desc">{t.description}</td>
                                    <td className="detail-amount r mono">¥{t.amount.toLocaleString()}</td>
                                    <td className="detail-cat">
                                      <select
                                        value={t.category}
                                        onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {ALL_CATEGORIES.map((cat) => (
                                          <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                      </select>
                                    </td>
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
          <tfoot>
            <tr className="tfoot-total">
              <td><strong>月次合計</strong></td>
              <td className="col-cats" />
              <td className="r mono col-budget"><strong>{fmt(totalBudget)}</strong></td>
              <td className="r mono"><strong>{fmt(totalSpent)}</strong></td>
              <td className={`r mono col-remaining ${remainingBudget < 0 ? 'text-danger' : 'text-ok'}`}>
                <strong>{remainingBudget < 0 ? '-' : ''}{fmt(Math.abs(remainingBudget))}</strong>
              </td>
              <td className="progress-cell">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(budgetPct, 100)}%`,
                      background: budgetPct > 100 ? '#f85149' : '#58a6ff',
                    }}
                  />
                </div>
                <span className="progress-pct">{Math.round(budgetPct)}%</span>
              </td>
            </tr>
            <tr className="tfoot-mid">
              <td>
                <span className="mid-label">中計</span>
                <span className="mid-sub">安心ライフ費＋暮らしの彩り費</span>
              </td>
              <td className="col-cats" />
              <td className="r mono col-budget">{fmt(midData.budget)}</td>
              <td className="r mono">{fmt(midData.actual)}</td>
              <td className={`r mono col-remaining ${midData.remaining < 0 ? 'text-danger' : 'text-ok'}`}>
                {midData.remaining < 0 ? '-' : ''}{fmt(Math.abs(midData.remaining))}
              </td>
              <td className="progress-cell">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(midData.ratio * 100, 100)}%`,
                      background: midData.ratio > 1 ? '#f85149' : '#7C3AED',
                    }}
                  />
                </div>
                <span className="progress-pct">{Math.round(midData.ratio * 100)}%</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

    </div>
  )
}
