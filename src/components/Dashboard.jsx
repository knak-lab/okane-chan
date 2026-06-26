import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
  PieChart, Pie,
} from 'recharts'
import { BUCKET_CONFIG, TOTAL_BUDGET } from '../config/budget'
import './Dashboard.css'

const fmt = (n) => `¥${Math.round(n).toLocaleString()}`

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

export default function Dashboard({ transactions }) {
  const bucketData = useMemo(() => {
    return BUCKET_CONFIG.map((b) => {
      const actual = transactions
        .filter((t) => b.categories.includes(t.category))
        .reduce((sum, t) => sum + t.amount, 0)
      const ratio = b.budget > 0 ? actual / b.budget : 0
      return { ...b, actual, ratio, remaining: b.budget - actual }
    })
  }, [transactions])

  const totalSpent = useMemo(
    () => transactions.reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  )

  const remainingBudget = TOTAL_BUDGET - totalSpent
  const budgetPct = TOTAL_BUDGET > 0 ? (totalSpent / TOTAL_BUDGET) * 100 : 0

  const pieData = useMemo(() => {
    const total = bucketData.reduce((s, b) => s + b.actual, 0)
    return bucketData
      .filter((b) => b.actual > 0)
      .map((b) => ({ ...b, pct: total > 0 ? Math.round((b.actual / total) * 100) : 0 }))
  }, [bucketData])

  const hasData = transactions.length > 0

  return (
    <div className="dashboard">

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
            {remainingBudget < 0 ? '予算オーバー ⚠' : `/ ${fmt(TOTAL_BUDGET)}`}
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
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                  axisLine={{ stroke: '#30363d' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
                  tick={{ fill: '#8b949e', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend
                  formatter={(v) => <span style={{ color: '#8b949e', fontSize: 11 }}>{v}</span>}
                  wrapperStyle={{ paddingTop: 8 }}
                />
                <Bar dataKey="budget" name="予算" fill="#21262d" radius={[3, 3, 0, 0]} maxBarSize={28} />
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
                  formatter={(v) => <span style={{ color: '#8b949e', fontSize: 11 }}>{v}</span>}
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
              <th>達成率</th>
            </tr>
          </thead>
          <tbody>
            {bucketData.map((b) => (
              <tr key={b.name}>
                <td>
                  <span className="dot" style={{ background: b.color }} />
                  <span className="bucket-name">{b.name}</span>
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
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>合計</strong></td>
              <td className="col-cats" />
              <td className="r mono col-budget"><strong>{fmt(TOTAL_BUDGET)}</strong></td>
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
          </tfoot>
        </table>
      </div>

    </div>
  )
}
