import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { gasApi, isGasReady } from '../utils/gasApi'
import AIDiag from './AIDiag'
import './SimTab.css'

// ─── 定数 ───────────────────────────────────────
const EDU_COST = {
  'オール公立':                 10_000_000,
  '中学まで公立・高校以降私立': 15_000_000,
  '中学から私立':               18_000_000,
  'オール私立':                 23_000_000,
}
const EDU_KEYS = Object.keys(EDU_COST)
const BIRTH_YEAR = 1984  // 2026年 = 42歳

// ─── ユーティリティ ─────────────────────────────
const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt      = (v) => `¥${Math.round(Math.abs(v)).toLocaleString()}`
const fmtSign  = (v) => (v < 0 ? '▲' : '') + fmt(v)

const formatYAxis = (v) => {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(0)}億`
  if (v >= 10_000)       return `${Math.round(v / 10_000)}万`
  return v === 0 ? '0' : `${v}`
}

// ─── シミュレーション計算 ─────────────────────────
function runSim(startAge, endAge, startAssets, retireAge, pensionStartAge,
                ratePercent, monthlyInvest, monthlyExpense, pensionMonthly,
                insuranceReturn, events) {
  if (endAge < startAge) return []
  const r     = (ratePercent || 0) / 100
  let assets  = startAssets
  const data  = []

  for (let age = startAge; age <= endAge; age++) {
    data.push({ age, assets: Math.round(assets) })

    const retired    = age >= retireAge
    const hasPension = age >= pensionStartAge

    const annualInvest  = retired ? 0 : monthlyInvest * 12
    const annualExpense = retired ? monthlyExpense * 12 : 0
    const annualPension = retired && hasPension ? pensionMonthly * 12 : 0
    const interest      = assets * r

    // ライフイベントコスト
    let eventCost = 0
    if (events) {
      for (const child of [events.child1, events.child2]) {
        if (!child.enabled) continue
        const childAge = child.currentAge + (age - startAge)
        if (childAge >= 6 && childAge < 22) {
          eventCost += EDU_COST[child.edu] / 16
        }
      }
      const c = events.car
      if (c.enabled) {
        if (age === startAge + Number(c.yearsFromNow)) eventCost += Number(c.price)
        eventCost += Number(c.monthlyFee) * 12
      }
    }

    // 退職時に保険返戻金を一括加算
    const lump = age === retireAge && insuranceReturn > 0 ? insuranceReturn : 0

    assets = assets + interest + annualInvest - annualExpense + annualPension - eventCost + lump
  }
  return data
}

function findZeroAge(data) {
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].assets > 0 && data[i].assets <= 0) return data[i].age
  }
  return null
}

function calcRequiredExtra(startAge, endAge, startAssets, retireAge, pensionStartAge,
                            rate, monthlyInvest, monthlyExpense, pensionMonthly, insuranceReturn) {
  const sim = (extra) => {
    const d = runSim(startAge, endAge, startAssets, retireAge, pensionStartAge,
                     rate, monthlyInvest + extra, monthlyExpense, pensionMonthly, insuranceReturn, null)
    return d.length ? d[d.length - 1].assets : 0
  }
  if (sim(0) >= 0) return 0
  let lo = 0, hi = 2_000_000
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    sim(mid) >= 0 ? (hi = mid) : (lo = mid)
  }
  return Math.ceil(hi / 1000) * 1000
}

// ─── サブコンポーネント ─────────────────────────

function ChildEvent({ label, state, onChange }) {
  return (
    <div className="sim-event">
      <button
        className={`sim-event-toggle${state.enabled ? ' active' : ''}`}
        onClick={() => onChange(p => ({ ...p, enabled: !p.enabled }))}
      >
        {label}
      </button>
      {state.enabled && (
        <div className="sim-event-body">
          <label className="sim-ef">
            <span className="sim-ef-label">現在年齢</span>
            <div className="sim-ef-row">
              <input type="number" className="sim-mini-input" min="0" max="21"
                value={state.currentAge}
                onChange={e => onChange(p => ({ ...p, currentAge: Number(e.target.value) || 0 }))} />
              <span className="sim-ef-unit">歳</span>
            </div>
          </label>
          <label className="sim-ef">
            <span className="sim-ef-label">教育方針</span>
            <select className="sim-mini-select" value={state.edu}
              onChange={e => onChange(p => ({ ...p, edu: e.target.value }))}>
              {EDU_KEYS.map(k => (
                <option key={k} value={k}>{k}（約{(EDU_COST[k] / 10000).toLocaleString()}万）</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

function SumCard({ label, value, sub, pos, neg }) {
  return (
    <div className={`sim-sum-card${pos ? ' pos' : neg ? ' neg' : ''}`}>
      <span className="sim-sum-label">{label}</span>
      <span className="sim-sum-value">{value}</span>
      {sub && <span className="sim-sum-sub">{sub}</span>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="sim-tooltip">
      <p className="sim-tt-age">{label}歳</p>
      {payload.map(p => (
        <p key={p.dataKey} className="sim-tt-row" style={{ color: p.color }}>
          <span>{p.name === 'base' ? 'ベース' : 'イベントあり'}</span>
          <span>¥{Math.max(0, Math.round(p.value)).toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

// ─── メインコンポーネント ──────────────────────────
export default function SimTab() {
  const [params, setParams] = useState({
    currentAge:     new Date().getFullYear() - BIRTH_YEAR,
    retireAge:      65,
    lifeExpectancy: 90,
    returnRate:      5,
    pensionStartAge: 65,
  })

  const [vals, setVals] = useState({
    totalAssets:       0,
    monthlyInvestment: 0,
    monthlyExpense:    0,
    pensionMonthly:    0,
    insuranceReturn:   0,
  })

  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')

  const [child1, setChild1] = useState({ enabled: false, currentAge: 3,  edu: 'オール公立' })
  const [child2, setChild2] = useState({ enabled: false, currentAge: 0,  edu: 'オール公立' })
  const [car,    setCar]    = useState({ enabled: false, yearsFromNow: 3, price: 3_000_000, monthlyFee: 30_000 })

  useEffect(() => { if (isGasReady()) loadData() }, [])

  const loadData = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const settled = await Promise.allSettled([
        gasApi.getAssets(),
        gasApi.getInvestmentFunds(),
        gasApi.getDCAccounts(),
        gasApi.getMonths(),
        gasApi.getPensionData(),
        gasApi.getInsurances(),
        fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY').then(r => r.json()).catch(() => null),
      ])
      const [assetsRes, fundsRes, dcRes, monthsRes, pensionRes, insRes, rateRes] =
        settled.map(r => r.status === 'fulfilled' ? r.value : null)

      // 総資産: 口座ごとに最新の非空金額を合計（空月レコードをスキップ）
      const accMap = {}
      ;(assetsRes?.assets || []).forEach(r => {
        const key = `${r['区分']}__${r['種別']}__${r['口座名']}`
        if (!accMap[key]) accMap[key] = []
        accMap[key].push(r)
      })
      const depositAssets = Object.values(accMap).reduce((s, recs) => {
        const sorted = [...recs].sort((a, b) => (b['月'] || '').localeCompare(a['月'] || ''))
        const latest = sorted.find(r => r['金額'] !== '' && r['金額'] != null)
        return s + (latest ? parseAmt(latest['金額']) : 0)
      }, 0)
      // 投資信託: ファンドごとに最新評価額を合計
      const fundLatest = {}
      ;(fundsRes?.records || []).forEach(r => {
        const key = r['ファンド名']
        if (!fundLatest[key] || r['年月'] > fundLatest[key]['年月']) fundLatest[key] = r
      })
      const totalFunds = Object.values(fundLatest).reduce((s, r) => s + parseAmt(r['評価額']), 0)
      const totalAssets = depositAssets + totalFunds

      // 月額積立: 投資信託 + DC（新スキーマ対応、旧スキーマもフォールバック）
      const monthlyFunds = (fundsRes?.masters || []).reduce((s, m) => {
        const json = m['積立スケジュール(JSON)']
        if (json) {
          try {
            const sched = JSON.parse(json)
            const cur = sched.find(p => !p.endMonth) || sched[sched.length - 1]
            return s + parseAmt(cur?.amount || 0)
          } catch { return s }
        }
        return s + parseAmt(m['積立額(円/月)'] || 0)
      }, 0)
      const monthlyDC = (dcRes?.masters || []).reduce((s, m) =>
        s + parseAmt(m['会社掛金(円/月)']) + parseAmt(m['自己掛金(円/月)']), 0)

      // 月平均支出: 直近3ヶ月平均（出金合計）
      const recentMonths = (monthsRes?.months || []).slice(0, 3)
      let monthlyExpense = 0
      if (recentMonths.length > 0) {
        const txResults = await Promise.allSettled(recentMonths.map(m => gasApi.getTransactions(m)))
        const totals = txResults
          .filter(r => r.status === 'fulfilled')
          .map(r => (r.value.transactions || []).reduce((s, t) => {
            if (t.amount > 0 && t.category !== 'ポイント' && t.category !== '収入・相殺') return s + t.amount
            return s
          }, 0))
        if (totals.length > 0)
          monthlyExpense = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)
      }

      // 年金: 最新レコード
      const pRecs = (pensionRes?.records || [])
        .sort((a, b) => b['確認年月'].localeCompare(a['確認年月']))
      const pensionMonthly = parseAmt(pRecs[0]?.['受給見込み額(月額)'])

      // 保険返戻予定額: 退職年度に最近接の解約年度の一括額(USD) × USD/JPY
      const usdJpy = rateRes?.rates?.JPY || 150
      const currentAgeNow = new Date().getFullYear() - BIRTH_YEAR
      const policyYearsToRetire = params.retireAge - currentAgeNow
      const { masters: insMasters = [], surrenderValues: svRows = [] } = insRes || {}
      let totalInsUSD = 0
      insMasters.forEach(m => {
        const insName = m['保険名']
        const startYear = parseInt((m['開始年月'] || '').split('/')[0]) || new Date().getFullYear()
        const policyYearAtRetire = (new Date().getFullYear() + policyYearsToRetire) - startYear
        const svs = svRows
          .filter(s => s['保険名'] === insName)
          .map(s => ({ year: parseFloat(s['解約年度']) || 0, usd: parseFloat(s['一括額(USD)']) || 0 }))
          .filter(s => s.usd > 0)
          .sort((a, b) => a.year - b.year)
        if (!svs.length) return
        let best = svs[0]
        for (const s of svs) {
          if (Math.abs(s.year - policyYearAtRetire) < Math.abs(best.year - policyYearAtRetire)) best = s
        }
        totalInsUSD += best.usd
      })
      const insuranceReturn = Math.round(totalInsUSD * usdJpy)

      setParams(p => ({ ...p, currentAge: currentAgeNow }))
      setVals(v => ({ ...v, totalAssets, monthlyInvestment: monthlyFunds + monthlyDC, monthlyExpense, pensionMonthly, insuranceReturn }))
      setLoadStatus('done')
      setLoadMsg('データを取得しました（各項目は手動で上書き可能です）')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const updP = (k) => (e) => setParams(p => ({ ...p, [k]: Number(e.target.value) || 0 }))
  const updV = (k) => (e) => setVals(p => ({ ...p, [k]: parseAmt(e.target.value) }))

  const { currentAge, retireAge, lifeExpectancy, returnRate, pensionStartAge } = params
  const { totalAssets, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn } = vals

  // ─── シミュレーション ────────────────────────────
  const { simBase, simEvents, hasEvents } = useMemo(() => {
    const h    = child1.enabled || child2.enabled || car.enabled
    const base = runSim(currentAge, lifeExpectancy, totalAssets, retireAge, pensionStartAge,
                        returnRate, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn, null)
    const ev   = h ? runSim(currentAge, lifeExpectancy, totalAssets, retireAge, pensionStartAge,
                            returnRate, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn,
                            { child1, child2, car }) : null
    return { simBase: base, simEvents: ev, hasEvents: h }
  }, [currentAge, lifeExpectancy, totalAssets, retireAge, pensionStartAge,
      returnRate, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn,
      child1, child2, car])

  const requiredExtra = useMemo(() =>
    calcRequiredExtra(currentAge, lifeExpectancy, totalAssets, retireAge, pensionStartAge,
                      returnRate, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn),
    [currentAge, lifeExpectancy, totalAssets, retireAge, pensionStartAge,
     returnRate, monthlyInvestment, monthlyExpense, pensionMonthly, insuranceReturn])

  const chartData = useMemo(() =>
    simBase.map((d, i) => ({
      age:    d.age,
      base:   Math.max(0, d.assets),
      events: simEvents ? Math.max(0, simEvents[i].assets) : undefined,
    })),
    [simBase, simEvents])

  const retireAssets     = simBase.find(d => d.age === retireAge)?.assets ?? 0
  const zeroAgeBase      = findZeroAge(simBase)
  const zeroAgeEvents    = simEvents ? findZeroAge(simEvents) : null
  const monthlyShortfall = Math.max(0, monthlyExpense - pensionMonthly)

  // ─── レンダリング ────────────────────────────────
  return (
    <div className="sim-tab">

      {/* ヘッダ */}
      <div className="sim-section sim-header">
        <h2 className="sim-main-title">ライフプランシミュレーション</h2>
        {isGasReady() && (
          <div className="sim-load-bar">
            <button className={`load-btn load-btn--${loadStatus}`} onClick={loadData}
              disabled={loadStatus === 'loading'}>
              {loadStatus === 'loading' ? '取得中…' : '🔄 データ再取得'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
          </div>
        )}
      </div>

      {/* パラメータ設定 */}
      <div className="sim-section">
        <h3 className="sim-section-title">パラメータ設定</h3>
        <div className="sim-fields">
          {[
            { label: '現在年齢',     key: 'currentAge',     unit: '歳' },
            { label: '退職予定年齢', key: 'retireAge',       unit: '歳' },
            { label: '平均寿命',     key: 'lifeExpectancy',  unit: '歳' },
            { label: '想定運用利率', key: 'returnRate',      unit: '% / 年' },
          ].map(({ label, key, unit }) => (
            <label key={key} className="sim-field">
              <span className="sim-field-label">{label}</span>
              <div className="sim-field-row">
                <input type="number" className="sim-num-input" value={params[key]} onChange={updP(key)} />
                <span className="sim-field-unit">{unit}</span>
              </div>
            </label>
          ))}
          <label className="sim-field">
            <span className="sim-field-label">年金受給開始年齢</span>
            <div className="sim-field-row">
              {[60, 65, 70].map(age => (
                <button key={age}
                  className={`sim-choice-btn${params.pensionStartAge === age ? ' active' : ''}`}
                  onClick={() => setParams(p => ({ ...p, pensionStartAge: age }))}>
                  {age}歳
                </button>
              ))}
            </div>
          </label>
        </div>
      </div>

      {/* 取得データ */}
      <div className="sim-section">
        <h3 className="sim-section-title">
          取得データ
          <span className="sim-section-note">手動で変更可</span>
        </h3>
        <div className="sim-fields">
          {[
            { label: '現在の総資産',    key: 'totalAssets',       unit: '円',       note: '預金＋投信' },
            { label: '月額積立額',      key: 'monthlyInvestment', unit: '円 / 月',  note: '投信 + DC' },
            { label: '月平均支出',      key: 'monthlyExpense',    unit: '円 / 月',  note: '直近3ヶ月平均' },
            { label: '年金受給見込み',  key: 'pensionMonthly',    unit: '円 / 月',  note: '年金タブより' },
            { label: '保険返戻予定額',  key: 'insuranceReturn',   unit: '円（一括）', note: '外貨保険/退職年度USD換算' },
          ].map(({ label, key, unit, note }) => (
            <label key={key} className="sim-field">
              <span className="sim-field-label">
                {label}
                <span className="sim-field-note">{note}</span>
              </span>
              <div className="sim-field-row">
                <input type="text" className="sim-num-input sim-num-input--wide"
                  value={vals[key] ? vals[key].toLocaleString() : '0'}
                  onChange={updV(key)} />
                <span className="sim-field-unit">{unit}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ライフイベント */}
      <div className="sim-section">
        <h3 className="sim-section-title">ライフイベント</h3>
        <div className="sim-events">
          <ChildEvent label="👶 子供1" state={child1} onChange={setChild1} />
          <ChildEvent label="👶 子供2" state={child2} onChange={setChild2} />

          <div className="sim-event">
            <button
              className={`sim-event-toggle${car.enabled ? ' active' : ''}`}
              onClick={() => setCar(p => ({ ...p, enabled: !p.enabled }))}>
              🚗 車
            </button>
            {car.enabled && (
              <div className="sim-event-body">
                <label className="sim-ef">
                  <span className="sim-ef-label">購入まで</span>
                  <div className="sim-ef-row">
                    <input type="number" className="sim-mini-input" value={car.yearsFromNow}
                      onChange={e => setCar(p => ({ ...p, yearsFromNow: Number(e.target.value) || 0 }))} />
                    <span className="sim-ef-unit">年後</span>
                  </div>
                </label>
                <label className="sim-ef">
                  <span className="sim-ef-label">購入価格</span>
                  <div className="sim-ef-row">
                    <input type="number" className="sim-mini-input sim-mini-input--wide" value={car.price}
                      onChange={e => setCar(p => ({ ...p, price: Number(e.target.value) || 0 }))} />
                    <span className="sim-ef-unit">円</span>
                  </div>
                </label>
                <label className="sim-ef">
                  <span className="sim-ef-label">月額維持費</span>
                  <div className="sim-ef-row">
                    <input type="number" className="sim-mini-input" value={car.monthlyFee}
                      onChange={e => setCar(p => ({ ...p, monthlyFee: Number(e.target.value) || 0 }))} />
                    <span className="sim-ef-unit">円 / 月</span>
                  </div>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 資産推移グラフ */}
      <div className="sim-section">
        <h3 className="sim-section-title">資産推移グラフ</h3>
        <div className="sim-chart-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ebebeb" />
              <XAxis dataKey="age" tickFormatter={v => `${v}歳`} tick={{ fontSize: 11 }}
                interval="preserveStartEnd" />
              <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11 }} width={52} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }}
                formatter={n => n === 'base' ? 'ベース（イベントなし）' : 'ライフイベントあり'} />
              <ReferenceLine x={retireAge} stroke="#003087" strokeDasharray="5 3"
                label={{ value: `退職 ${retireAge}歳`, position: 'insideTopRight', fontSize: 10, fill: '#003087' }} />
              {pensionStartAge !== retireAge && (
                <ReferenceLine x={pensionStartAge} stroke="#F47920" strokeDasharray="4 4"
                  label={{ value: `年金開始 ${pensionStartAge}歳`, position: 'insideTopRight', fontSize: 10, fill: '#F47920' }} />
              )}
              {zeroAgeBase && (
                <ReferenceLine x={zeroAgeBase} stroke="#e74c3c" strokeDasharray="5 3"
                  label={{ value: `枯渇 ${zeroAgeBase}歳`, position: 'top', fontSize: 10, fill: '#e74c3c' }} />
              )}
              <Line type="monotone" dataKey="base"   stroke="#F47920" strokeWidth={2.5} dot={false} name="base" />
              {hasEvents && (
                <Line type="monotone" dataKey="events" stroke="#003087" strokeWidth={2}
                  dot={false} strokeDasharray="6 3" name="events" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 老後資金チェック */}
      <div className="sim-section">
        <h3 className="sim-section-title">老後資金チェック</h3>
        <div className="sim-check-grid">
          <SumCard
            label="退職時の総資産予測"
            value={fmtSign(retireAssets)}
            sub={`${retireAge}歳時点`}
            pos={retireAssets > 0} neg={retireAssets <= 0} />
          <SumCard
            label="月の生活費"
            value={fmt(monthlyExpense)}
            sub="現在の月平均支出" />
          <SumCard
            label="年金受給額（月額）"
            value={pensionMonthly > 0 ? fmt(pensionMonthly) : '未入力'}
            sub={`${pensionStartAge}歳〜`}
            pos={pensionMonthly > 0} />
          <SumCard
            label="月の不足額"
            value={monthlyShortfall > 0 ? fmt(monthlyShortfall) : '不足なし ✓'}
            sub="生活費 − 年金"
            pos={monthlyShortfall === 0} neg={monthlyShortfall > 0} />
          <SumCard
            label="資産が尽きる年齢"
            value={zeroAgeBase ? `${zeroAgeBase}歳` : `${lifeExpectancy}歳以降 ✓`}
            sub={hasEvents && zeroAgeEvents
              ? `イベントあり: ${zeroAgeEvents}歳`
              : 'ベースシナリオ'}
            pos={!zeroAgeBase} neg={!!zeroAgeBase} />
          {requiredExtra > 0 ? (
            <SumCard
              label={`追加必要月積立額`}
              value={fmt(requiredExtra)}
              sub={`${lifeExpectancy}歳まで持たせるために必要`}
              neg />
          ) : (
            <SumCard
              label="資産寿命"
              value={`${lifeExpectancy}歳まで充足 ✓`}
              sub="追加積立不要"
              pos />
          )}
        </div>
      </div>

      {/* AI診断 */}
      <AIDiag
        simParams={params}
        simVals={vals}
        simResults={{
          retireAssets,
          zeroAge:          zeroAgeBase,
          monthlyShortfall,
          requiredExtra,
        }}
      />

    </div>
  )
}
