import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'

const TOTAL = '合計'
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// 3系統固定色（バケット切替に依存しないエンティティ色）
const COLOR_ACTUAL = '#2a78d6' // 今年度実績（棒）
const COLOR_PREV   = '#008300' // 前年度実績（線・破線）
const COLOR_BUDGET = '#e34948' // 今年度予算（線・点線）

const yen = (v) => `¥${Math.round(v).toLocaleString()}`

export default function BucketYearChart() {
  const [transactions, setTransactions] = useState([])
  const [annualPlan, setAnnualPlan]     = useState(null)
  const [status, setStatus]             = useState('idle')
  const [bucketName, setBucketName]     = useState(TOTAL)

  const now = useMemo(() => new Date(), [])
  const currentYear  = now.getFullYear()
  const prevYear     = currentYear - 1
  const currentMonth = now.getMonth() + 1

  useEffect(() => {
    if (!isGasReady()) return
    setStatus('loading')
    Promise.all([
      gasApi.getTransactions(''),
      gasApi.getAnnualPlan(currentYear),
    ])
      .then(([txResult, planResult]) => {
        setTransactions(txResult.transactions || [])
        setAnnualPlan(planResult.plan || null)
        setStatus('done')
      })
      .catch(() => setStatus('error'))
  }, [currentYear])

  const billable = useMemo(
    () => transactions.filter(t => t.category !== '対象外'),
    [transactions]
  )

  const targetBuckets = useMemo(
    () => bucketName === TOTAL ? BUCKET_CONFIG : BUCKET_CONFIG.filter(b => b.name === bucketName),
    [bucketName]
  )

  const categories = useMemo(
    () => targetBuckets.flatMap(b => b.categories),
    [targetBuckets]
  )

  // 年×月別の実績合計（対象カテゴリのみ）
  const actualByYearMonth = useMemo(() => {
    const sums = { [currentYear]: Array(12).fill(0), [prevYear]: Array(12).fill(0) }
    for (const t of billable) {
      if (!categories.includes(t.category)) continue
      const m = /^(\d{4})\/(\d{2})/.exec(t.date || '')
      if (!m) continue
      const y = Number(m[1])
      if (!sums[y]) continue
      sums[y][Number(m[2]) - 1] += t.amount
    }
    return sums
  }, [billable, categories, currentYear, prevYear])

  // 今年度の月別予算合計（年間バケットは年間総額÷12で月按分）
  const budgetByMonth = useMemo(() => {
    const arr = Array(12).fill(0)
    for (const b of targetBuckets) {
      const isAnnual = ANNUAL_BUCKET_NAMES.includes(b.name)
      const vals = annualPlan?.[`支出_${b.name}`]
      if (isAnnual) {
        const total = vals?.[3] ?? 0
        for (let i = 0; i < 12; i++) arr[i] += total / 12
      } else {
        for (let i = 0; i < 12; i++) arr[i] += vals?.[i] ?? b.budget
      }
    }
    return arr
  }, [annualPlan, targetBuckets])

  const chartData = useMemo(() => MONTHS.map(m => ({
    month: `${m}月`,
    今年度実績: m <= currentMonth ? actualByYearMonth[currentYear][m - 1] : null,
    前年度実績: actualByYearMonth[prevYear][m - 1],
    今年度予算: budgetByMonth[m - 1],
  })), [actualByYearMonth, budgetByMonth, currentMonth, currentYear, prevYear])

  return (
    <div className="acc-card">
      <div className="acc-card-header">
        <p className="acc-card-title">推移グラフ</p>
        <select
          className="acc-month-select"
          value={bucketName}
          onChange={e => setBucketName(e.target.value)}
        >
          <option value={TOTAL}>{TOTAL}</option>
          {BUCKET_CONFIG.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        {status === 'loading' && <span className="acc-loading">読込中…</span>}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#e1e0d9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#898781' }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={v => `${Math.round(v / 10000)}万`}
          />
          <Tooltip
            formatter={(v) => v == null ? '—' : yen(v)}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="今年度実績" fill={COLOR_ACTUAL} barSize={20} radius={[4, 4, 0, 0]} />
          <Line
            dataKey="前年度実績" stroke={COLOR_PREV} strokeWidth={2}
            strokeDasharray="6 4" dot={{ r: 4 }} connectNulls
          />
          <Line
            dataKey="今年度予算" stroke={COLOR_BUDGET} strokeWidth={2}
            strokeDasharray="2 3" dot={{ r: 4 }} connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
