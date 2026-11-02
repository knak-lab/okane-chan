import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { BUCKET_CONFIG, ANNUAL_BUCKET_NAMES } from '../config/budget'
import { gasApi, isGasReady } from '../utils/gasApi'
import { readCache, writeCache } from '../utils/localCache'

const TOTAL = '合計'
const MID = '安心＋彩り'
const MID2 = 'ときめき＋冒険'
const MID_NAMES  = ['安心ライフ費', '暮らしの彩り費']
const MID2_NAMES = ['ときめきチョイス費', '冒険予算']
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// 3系統固定色（バケット切替に依存しないエンティティ色）
const COLOR_ACTUAL = '#2a78d6' // 今年度実績（棒）
const COLOR_PREV   = '#008300' // 前年度実績（線・破線）
const COLOR_BUDGET = '#e34948' // 今年度予算（線・点線）
const COLOR_PREV_MUTED = '#b4b2a9' // 合計・ときめき＋冒険の前年度線（主役を引き立てるため控えめに）

// 積上棒のバケット色（線より目立たないアース系の淡色）
const STACK_COLORS = {
  安心ライフ費:       '#a7b8c9',
  家賃:               '#cfc6b8',
  暮らしの彩り費:     '#c9b8d3',
  ときめきチョイス費: '#e3c1a0',
  冒険予算:           '#b5c7a8',
}

const yen = (v) => `¥${Math.round(v).toLocaleString()}`

const fmtMan = (v) => `${+(v / 10000).toFixed(1)}万`

const cumsum = (arr) => { let s = 0; return arr.map(v => (s += v)) }

// 1, 2, 2.5, 5, 10 × 10^n のうち raw 以上で最小のきりの良い目盛り幅
function niceStep(raw) {
  if (!(raw > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

// 左右2軸の 0 の高さを揃える目盛りを作る。両軸とも 0 より下を同じ段数、上を同じ段数にする。
function alignedTicks(left, right, intervals = 5) {
  const range = (vals) => [Math.min(0, ...vals), Math.max(0, ...vals)]
  const [lMin, lMax] = range(left)
  const [rMin, rMax] = range(right)
  const negFrac = Math.max(
    lMax > lMin ? -lMin / (lMax - lMin) : 0,
    rMax > rMin ? -rMin / (rMax - rMin) : 0,
  )
  const neg = negFrac > 0 ? Math.min(intervals - 1, Math.max(1, Math.ceil(intervals * negFrac))) : 0
  const pos = intervals - neg
  const ticks = (min, max) => {
    const step = niceStep(Math.max(max / pos, neg > 0 ? -min / neg : 0))
    return Array.from({ length: intervals + 1 }, (_, i) => (i - neg) * step)
  }
  return { left: ticks(lMin, lMax), right: ticks(rMin, rMax) }
}

// 指定カテゴリの、指定年の月別実績合計
function monthlyActual(transactions, categories, year) {
  const arr = Array(12).fill(0)
  for (const t of transactions) {
    if (!categories.includes(t.category)) continue
    const m = /^(\d{4})\/(\d{2})/.exec(t.date || '')
    if (!m || Number(m[1]) !== year) continue
    arr[Number(m[2]) - 1] += t.amount
  }
  return arr
}

export default function BucketYearChart() {
  const [transactions, setTransactions] = useState([])
  const [annualPlan, setAnnualPlan]     = useState(null)
  const [prevAnnualPlan, setPrevAnnualPlan] = useState(null)
  const [status, setStatus]             = useState('idle')
  const [bucketName, setBucketName]     = useState(TOTAL)

  const now = useMemo(() => new Date(), [])
  const currentYear  = now.getFullYear()
  const prevYear     = currentYear - 1
  const currentMonth = now.getMonth() + 1

  // 表示専用（編集操作なし）のため、前回値をキャッシュから即表示し裏で最新を取り直す
  useEffect(() => {
    if (!isGasReady()) return
    const cacheKey = `bucketYearChart:${currentYear}`
    const cached = readCache(cacheKey)
    if (cached) {
      setTransactions(cached.transactions)
      setAnnualPlan(cached.annualPlan)
      setPrevAnnualPlan(cached.prevAnnualPlan)
      setStatus('done')
    } else {
      setStatus('loading')
    }
    Promise.all([
      gasApi.getTransactions(''),
      gasApi.getAnnualPlan(currentYear),
      gasApi.getAnnualPlan(prevYear),
    ])
      .then(([txResult, planResult, prevPlanResult]) => {
        const nextTransactions = txResult.transactions || []
        const nextAnnualPlan = planResult.plan || null
        const nextPrevAnnualPlan = prevPlanResult.plan || null
        setTransactions(nextTransactions)
        setAnnualPlan(nextAnnualPlan)
        setPrevAnnualPlan(nextPrevAnnualPlan)
        setStatus('done')
        writeCache(cacheKey, {
          transactions: nextTransactions,
          annualPlan: nextAnnualPlan,
          prevAnnualPlan: nextPrevAnnualPlan,
        })
      })
      .catch(() => { if (!cached) setStatus('error') })
  }, [currentYear, prevYear])

  const billable = useMemo(
    () => transactions.filter(t => t.category !== '対象外'),
    [transactions]
  )

  const targetBuckets = useMemo(() => {
    if (bucketName === TOTAL) return BUCKET_CONFIG.filter(b => b.name !== '妊活')
    if (bucketName === MID) return BUCKET_CONFIG.filter(b => MID_NAMES.includes(b.name))
    if (bucketName === MID2) return BUCKET_CONFIG.filter(b => MID2_NAMES.includes(b.name))
    return BUCKET_CONFIG.filter(b => b.name === bucketName)
  }, [bucketName])

  // 合計・安心＋彩り・ときめき＋冒険はバケット別の積上棒で表示する
  const isStacked = bucketName === TOTAL || bucketName === MID || bucketName === MID2
  // 合計は1月からの累計で表示し、予算は年間総額と月割累計の補助線にする
  const isCumulative = bucketName === TOTAL

  // 選択中のバケットが全て年間予算バケットか（ときめき/冒険/妊活単体・ときめき+冒険の組み合わせ時）
  const isAnnualOnly = targetBuckets.length > 0 && targetBuckets.every(b => ANNUAL_BUCKET_NAMES.includes(b.name))

  const categories = useMemo(
    () => targetBuckets.flatMap(b => b.categories),
    [targetBuckets]
  )

  // 年×月別の実績合計（対象カテゴリのみ）
  const actualByYearMonth = useMemo(() => ({
    [currentYear]: monthlyActual(billable, categories, currentYear),
    [prevYear]: monthlyActual(billable, categories, prevYear),
  }), [billable, categories, currentYear, prevYear])

  // 積上棒用：今年度のバケット別・月別実績
  const actualByBucket = useMemo(() => Object.fromEntries(
    targetBuckets.map(b => [b.name, monthlyActual(billable, b.categories, currentYear)])
  ), [billable, targetBuckets, currentYear])

  // 安心＋彩りの月別「予算 − 実績」。生活を切り詰めて浮いた分（使い過ぎならマイナス）を
  // ときめき＋冒険の予算に上乗せする。年間計画が無い年は上乗せしない。
  const midSurplusByYear = useMemo(() => {
    const midBuckets = BUCKET_CONFIG.filter(b => MID_NAMES.includes(b.name))
    const calc = (year, plan) => {
      if (!plan) return Array(12).fill(0)
      const actual = monthlyActual(billable, midBuckets.flatMap(b => b.categories), year)
      return actual.map((a, i) =>
        midBuckets.reduce((s, b) => s + (plan[`支出_${b.name}`]?.[i] ?? b.budget), 0) - a
      )
    }
    return { [currentYear]: calc(currentYear, annualPlan), [prevYear]: calc(prevYear, prevAnnualPlan) }
  }, [billable, annualPlan, prevAnnualPlan, currentYear, prevYear])

  const addsMidSurplus = bucketName === MID2

  // 今年度の月別予算合計（年間バケットは年間総額÷12で月按分）。
  // 選択中バケットが全て年間予算（ときめき/冒険/妊活）の場合は、月按分ではなく
  // 「総額 - 当月までの累計実績」＝残高を表示する。
  const budgetByMonth = useMemo(() => {
    if (isAnnualOnly) {
      const annualTotal = targetBuckets.reduce(
        (s, b) => s + (annualPlan?.[`支出_${b.name}`]?.[3] ?? 0), 0
      )
      const arr = Array(12).fill(null)
      let cumulative = 0
      let surplus = 0
      for (let i = 0; i < 12 && i < currentMonth; i++) {
        cumulative += actualByYearMonth[currentYear][i]
        // 生活の浮きは確定した先月分までを上乗せ（当月は未確定なので含めない）
        if (addsMidSurplus && i < currentMonth - 1) surplus += midSurplusByYear[currentYear][i]
        arr[i] = annualTotal + surplus - cumulative
      }
      return arr
    }
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
  }, [annualPlan, targetBuckets, isAnnualOnly, actualByYearMonth, addsMidSurplus, midSurplusByYear, currentYear, currentMonth])

  // 前年度の月別「実績」表示用データ。年間予算バケットのみ選択時は、月別実績ではなく
  // 前年度の予算残高推移（前年度予算総額 − 前年度当月までの累計実績）を表示する。
  const prevBudgetByMonth = useMemo(() => {
    if (!isAnnualOnly) return null
    const annualTotal = targetBuckets.reduce(
      (s, b) => s + (prevAnnualPlan?.[`支出_${b.name}`]?.[3] ?? 0), 0
    )
    const arr = Array(12).fill(0)
    let cumulative = 0
    let surplus = 0
    for (let i = 0; i < 12; i++) {
      cumulative += actualByYearMonth[prevYear][i]
      if (addsMidSurplus) surplus += midSurplusByYear[prevYear][i]
      arr[i] = annualTotal + surplus - cumulative
    }
    return arr
  }, [prevAnnualPlan, targetBuckets, isAnnualOnly, actualByYearMonth, addsMidSurplus, midSurplusByYear, prevYear])

  const chartData = useMemo(() => {
    const acc = isCumulative ? cumsum : (arr) => arr
    const current  = acc(actualByYearMonth[currentYear])
    const prev     = isAnnualOnly ? prevBudgetByMonth : acc(actualByYearMonth[prevYear])
    const budget   = acc(budgetByMonth)
    const byBucket = Object.fromEntries(targetBuckets.map(b => [b.name, acc(actualByBucket[b.name])]))
    return MONTHS.map(m => ({
      month: `${m}月`,
      今年度実績: m <= currentMonth ? current[m - 1] : null,
      ...(isStacked && Object.fromEntries(targetBuckets.map(b => [
        b.name, m <= currentMonth ? byBucket[b.name][m - 1] : null,
      ]))),
      前年度実績: prev[m - 1],
      今年度予算: budget[m - 1],
    }))
  }, [actualByYearMonth, actualByBucket, isStacked, isCumulative, targetBuckets, budgetByMonth, prevBudgetByMonth, isAnnualOnly, currentMonth, currentYear, prevYear])

  // 合計表示の年間予算総額（月別予算の12か月分。年間バケットは総額をそのまま含む）
  const annualBudgetTotal = isCumulative ? budgetByMonth.reduce((s, v) => s + v, 0) : null

  // 2軸表示（年間予算バケット）のときは、棒（左軸）と残高線（右軸）の 0 を揃える
  const axisTicks = useMemo(() => {
    if (!isAnnualOnly) return null
    const isNum = (v) => typeof v === 'number'
    const bars  = chartData.map(d => d.今年度実績).filter(isNum)
    const lines = chartData.flatMap(d => [d.今年度予算, d.前年度実績]).filter(isNum)
    if (![...bars, ...lines].some(v => v !== 0)) return null
    return alignedTicks(bars, lines)
  }, [isAnnualOnly, chartData])

  const budgetLineName = isAnnualOnly
    ? (addsMidSurplus ? '予算残高(＋生活の浮き)' : '予算残高')
    : isCumulative ? '予算累計(月割)' : '今年度予算'
  const prevLineName = isAnnualOnly ? '前年度予算残高' : isCumulative ? '前年度累計' : '前年度実績'
  const mutePrev = addsMidSurplus || isCumulative

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
          <option value={MID}>{MID}</option>
          <option value={MID2}>{MID2}</option>
          {BUCKET_CONFIG.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        {status === 'loading' && <span className="acc-loading">読込中…</span>}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#e1e0d9" vertical={false} />
          {/* スマホ幅でも12か月すべて出すため、間引きを止めて目盛りは数字だけにする（ツールチップは「○月」のまま） */}
          <XAxis
            dataKey="month" interval={0} tickFormatter={v => v.replace('月', '')}
            tick={{ fontSize: 10, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: '#898781' }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={fmtMan}
            {...(axisTicks && {
              ticks: axisTicks.left,
              domain: [axisTicks.left[0], axisTicks.left[axisTicks.left.length - 1]],
            })}
          />
          {isAnnualOnly && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: COLOR_BUDGET }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={fmtMan}
              {...(axisTicks && {
                ticks: axisTicks.right,
                domain: [axisTicks.right[0], axisTicks.right[axisTicks.right.length - 1]],
              })}
            />
          )}
          <Tooltip
            formatter={(v) => v == null ? '—' : yen(v)}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {isStacked
            ? targetBuckets.map((b, i) => (
                <Bar
                  key={b.name} yAxisId="left" dataKey={b.name} stackId="actual"
                  fill={STACK_COLORS[b.name] ?? b.color} barSize={20}
                  radius={i === targetBuckets.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))
            : <Bar yAxisId="left" dataKey="今年度実績" fill={COLOR_ACTUAL} barSize={20} radius={[4, 4, 0, 0]} />}
          <Line
            yAxisId={isAnnualOnly ? 'right' : 'left'}
            dataKey="前年度実績" name={prevLineName}
            stroke={mutePrev ? COLOR_PREV_MUTED : COLOR_PREV}
            strokeWidth={mutePrev ? 1.5 : 2}
            strokeDasharray="6 4" dot={{ r: mutePrev ? 2 : 4 }} connectNulls
          />
          <Line
            yAxisId={isAnnualOnly ? 'right' : 'left'}
            dataKey="今年度予算" name={budgetLineName}
            stroke={COLOR_BUDGET}
            strokeWidth={addsMidSurplus ? 3 : isCumulative ? 1.5 : 2}
            strokeDasharray={addsMidSurplus ? undefined : '2 3'}
            dot={addsMidSurplus ? { r: 5 } : isCumulative ? false : { r: 4 }} connectNulls
          />
          {isCumulative && annualBudgetTotal > 0 && (
            <ReferenceLine
              yAxisId="left" y={annualBudgetTotal} ifOverflow="extendDomain"
              stroke={COLOR_BUDGET} strokeOpacity={0.6} strokeDasharray="6 4"
              label={{ value: `年間予算 ${fmtMan(annualBudgetTotal)}`, position: 'insideTopLeft', fontSize: 10, fill: COLOR_BUDGET }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
