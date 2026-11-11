import { useState, useEffect, useMemo, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { gasApi, isGasReady } from '../utils/gasApi'
import { surrenderAtAge } from '../utils/insuranceUtils'
import { HOMEST_EMBED_URL, fromHomest } from '../utils/homest'
import { BUCKET_CONFIG } from '../config/budget'
import AIChat from './AIChat'
import LPCheck from './LPCheck'
import {
  DEFAULT_WHATIFS, toYM, dataChecks, planChecks, runWhatIfs, whatIfField,
} from '../utils/lpChecks'
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
const SETTINGS_TYPE = 'LP設定'  // PJデータシートの種別名
const SETTINGS_STATUS_LABEL = {
  loading: '設定を読込中…',
  saving:  '保存中…',
  saved:   '保存済み（パラメータ・ライフイベント）',
  error:   '設定の読込/保存に失敗しました',
}

// ─── ユーティリティ ─────────────────────────────
const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt      = (v) => `¥${Math.round(Math.abs(v)).toLocaleString()}`
const fmtSign  = (v) => (v < 0 ? '▲' : '') + fmt(v)

const formatYAxis = (v) => {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(0)}億`
  if (v >= 10_000)       return `${Math.round(v / 10_000)}万`
  return v === 0 ? '0' : `${v}`
}

// ─── 月平均支出 ──────────────────────────────────
const EXPENSE_LOOKBACK_MONTHS = 24
// 生活費＝安心ライフ費＋暮らしの彩り費のカテゴリの実績。
// 家賃はPayPay外の振込が多いのでパラメータ、ときめき＋冒険は年間タブの年額を別に足す。妊活は一時的な支出なので含めない
const LIVING_BUCKETS = ['安心ライフ費', '暮らしの彩り費']
const YUTORI_BUCKETS = ['ときめきチョイス費', '冒険予算']
const LIVING_CATEGORIES = BUCKET_CONFIG.filter(b => LIVING_BUCKETS.includes(b.name)).flatMap(b => b.categories)

// 過去24か月（当月＝途中月は除く）の月別支出から、外れ値（四分位範囲の1.5倍の外側）を除いて平均する。
function calcMonthlyExpense(transactions, now = new Date()) {
  const currentMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  const totals = {}
  for (const t of transactions) {
    const month = (t.date || '').slice(0, 7)
    if (!/^\d{4}\/\d{2}$/.test(month) || month >= currentMonth) continue
    if (t.amount <= 0 || !LIVING_CATEGORIES.includes(t.category)) continue
    totals[month] = (totals[month] || 0) + t.amount
  }
  const months = Object.keys(totals).sort().reverse().slice(0, EXPENSE_LOOKBACK_MONTHS)
  if (months.length === 0) return { monthlyExpense: 0, used: 0, excluded: [] }

  let kept = months
  if (months.length >= 4) {
    const sorted = months.map(m => totals[m]).sort((a, b) => a - b)
    const q = (p) => {
      const i = (sorted.length - 1) * p
      return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1)
    }
    const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1
    kept = months.filter(m => totals[m] >= q1 - 1.5 * iqr && totals[m] <= q3 + 1.5 * iqr)
  }
  const avg = (vals) => Math.round(vals.reduce((s, v) => s + v, 0) / kept.length)
  return {
    monthlyExpense: avg(kept.map(m => totals[m])),
    used:           kept.length,
    excluded:       months.filter(m => !kept.includes(m)),
  }
}

// ─── シミュレーション計算 ─────────────────────────
// 犬：年間費用はアニコム「ペットにかける年間支出調査」（2020〜2021年）、飼う年数はペットフード協会の平均寿命（2021年）が目安
const DOG_SIZES = {
  large: { label: '大型犬',       defaults: { annualCost: 520_000, years: 13 } },
  small: { label: '中型・小型犬', defaults: { annualCost: 350_000, years: 15 } },
}

const homePrice = (home) => Number(home.landPrice) + Number(home.buildingPrice)

// 元利均等返済の年間返済額
function annualLoanPayment(principal, ratePercent, years) {
  if (principal <= 0 || years <= 0) return 0
  const i = (ratePercent || 0) / 100 / 12
  const n = years * 12
  const monthly = i === 0 ? principal / n : principal * i / (1 - (1 + i) ** -n)
  return monthly * 12
}

// 妻の手取り年収。末っ子の年齢が各段階に達するごとに上乗せする。
// 子どもがいない／まだ生まれていない場合は、全段階を上乗せした額（フルで働ける）とする
function wifeIncomeAt(wife, children, t) {
  const ages = children.filter(c => c.enabled).map(c => Number(c.currentAge) + t)
  // 子どもなし → ベースのみ。出産前（最年長の子が0歳未満）→ 働いていないので0
  if (ages.length === 0) return Number(wife.base)
  if (Math.max(...ages) < 0) return 0
  const youngest = Math.min(...ages)
  return (wife.stages || []).reduce(
    (s, st) => s + (youngest >= Number(st.fromAge) ? Number(st.add) : 0),
    Number(wife.base)
  )
}

// 資産は「預金」と「投資（投信＋DC）」に分けて別の利回りで増やす。
// 退職前：手取り（本人＋妻）から生活費（月平均支出＋家賃）と投信積立を引いた残りが預金に入る。
//         DC掛金は給与天引き・会社拠出なので手取りからは引かず、投資に直接入る。
// 退職後：生活費を預金から払い、年金を受け取る。預金が尽きたら投資を取り崩す。
// 支出・年金・イベント費用は物価上昇率、収入は収入の伸び率で毎年増やす（ローン返済額は固定）。
// AI診断に渡す「このシミュレーションが計算に入れていないもの・単純化している前提」
// runSim を変えたらここも合わせて直す
const MODEL_ASSUMPTIONS = [
  '退職金はパラメータの「退職金（手取り）」を退職年に一括加算（企業年金の年金払いは入っていない）。外貨保険は「保険の受け取り年齢」で解約して一括で受け取る（保険simuの解約返戻金表、今の為替レートで円換算。税金は考慮していない）',
  '収入は手取りベース。税・社会保険料の変化（退職後の住民税・国保など）は個別に計算していない',
  '公的年金は物価上昇率でそのまま増える（マクロ経済スライドによる目減りは考慮していない）',
  '投資は投信・DCとも同じ想定利回りで毎年一定に増える（暴落・順序リスクなし）。DCも退職前に取り崩せる扱い',
  '妻の収入はあなたの退職と同時にゼロになる',
  '教育費は子が6〜22歳の16年間に均等割り。児童手当・高校/大学無償化・奨学金などの収入側は入っていない',
  '医療費・介護費・老人ホームなど高齢期の特別支出は入っていない（生活費×退職後割合のみ）',
  '住宅ローン控除・固定資産税（月額維持費に含めていなければ）・団信・繰上げ返済は入っていない',
  '相続・贈与・親の援助や介護、iDeCo/NISAの税制差は入っていない',
  '家賃は購入しない限り老後もずっと同額（物価上昇分は上がる）',
]

function runSim(p, events) {
  const { startAge, endAge, cashAssets, investAssets, retireAge, pensionStartAge,
          returnRate, cashRate, inflationRate, incomeGrowth, myIncome, wife,
          monthlyFundInvest, monthlyDCInvest, extraSaving = 0, monthlyExpense, monthlyRent,
          yutoriAnnual, pensionMonthly, wifeAge, wifePensionMonthly, wifePensionStartAge,
          insuranceReturn, insuranceAge = retireAge, retirementBonus = 0, retireExpenseRate = 100 } = p
  if (endAge < startAge) return []
  const rInvest = (returnRate || 0) / 100
  const rCash   = (cashRate || 0) / 100
  let cash   = cashAssets
  let invest = investAssets
  const data = []

  const home = events?.home
  const homeLoan = home?.enabled
    ? annualLoanPayment(homePrice(home) - Number(home.downPayment), home.loanRate, Number(home.loanYears))
    : 0

  for (let age = startAge; age <= endAge; age++) {
    data.push({ age, assets: Math.round(cash + invest), cash: Math.round(cash), invest: Math.round(invest) })

    const t          = age - startAge
    const infl       = (1 + (inflationRate || 0) / 100) ** t
    const retired    = age >= retireAge
    const hasPension = age >= pensionStartAge

    const growth        = (1 + (incomeGrowth || 0) / 100) ** t
    const children      = events ? [events.child1, events.child2] : []
    const annualIncome  = retired ? 0 : (myIncome + wifeIncomeAt(wife, children, t)) * growth
    const fundInvest    = retired ? 0 : monthlyFundInvest * 12
    const dcInvest      = retired ? 0 : monthlyDCInvest * 12
    const extra         = retired ? 0 : extraSaving * 12  // 追加必要積立額の逆算用
    // 退職後は生活費（安心＋彩り）とときめき＋冒険を割合で調整。家賃は対象外
    const livingRate    = retired ? retireExpenseRate / 100 : 1
    const annualExpense = ((monthlyExpense * livingRate + monthlyRent) * 12 + yutoriAnnual * livingRate) * infl
    // 妻の年金は妻の年齢で受給開始（あなたの退職前に始まる場合も含む）
    const wifePension   = wifeAge + t >= wifePensionStartAge ? wifePensionMonthly * 12 * infl : 0
    const annualPension = (retired && hasPension ? pensionMonthly * 12 * infl : 0) + wifePension

    // ライフイベントコスト
    let eventCost = 0
    if (events) {
      for (const child of [events.child1, events.child2]) {
        if (!child.enabled) continue
        const childAge = child.currentAge + t
        if (childAge >= 6 && childAge < 22) {
          eventCost += EDU_COST[child.edu] / 16 * infl
        }
      }
      const c = events.car
      // 手放す年齢（0なら手放さない）以降は買い替えも維持費もかからない
      const sellAge = Number(c.sellAge)
      if (c.enabled && !(sellAge > 0 && age >= sellAge)) {
        const first = Number(c.yearsFromNow)
        const cycle = Number(c.replaceEvery)
        const isPurchase = t === first || (cycle > 0 && t > first && (t - first) % cycle === 0)
        if (isPurchase) eventCost += Number(c.price) * infl
        if (t >= first) eventCost += Number(c.monthlyFee) * 12 * infl
      }
      const dog = events.dog
      if (dog?.enabled) {
        const from = Number(dog.yearsFromNow)
        if (t === from) eventCost += Number(dog.initialCost) * infl
        if (t >= from && t < from + Number(dog.years)) eventCost += Number(dog.annualCost) * infl
      }
      if (home?.enabled) {
        const bought = Number(home.yearsFromNow)
        // 購入時に頭金と諸経費（物件価格×諸経費率。登記・仲介手数料・税など）を現金で払う
        if (t === bought) eventCost += Number(home.downPayment) + homePrice(home) * Number(home.feeRate) / 100
        if (t >= bought && t < bought + Number(home.loanYears)) eventCost += homeLoan
        if (t >= bought) {
          eventCost += Number(home.monthlyCost) * 12 * infl
          // 購入後は家賃が不要になる分、手元に残る
          if (home.stopRent) eventCost -= monthlyRent * 12 * infl
        }
        // 外壁・屋根・水回りなどの大規模修繕を購入から一定年数ごとに計上
        const repairEvery = Number(home.repairEvery)
        if (repairEvery > 0 && t > bought && (t - bought) % repairEvery === 0) eventCost += Number(home.repairCost) * infl
      }
    }

    // 保険返戻金は受け取り年齢で、退職金は退職時に一括加算
    const lump = (age === Number(insuranceAge) && insuranceReturn > 0 ? insuranceReturn : 0)
      + (age === retireAge ? Number(retirementBonus) || 0 : 0)

    invest += Math.max(0, invest) * rInvest + fundInvest + dcInvest + extra
    cash   += Math.max(0, cash) * rCash + annualIncome - fundInvest - annualExpense + annualPension - eventCost + lump
    if (cash < 0 && invest > 0) {
      const draw = Math.min(invest, -cash)
      invest -= draw
      cash   += draw
    }
  }
  return data
}

function findZeroAge(data) {
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].assets > 0 && data[i].assets <= 0) return data[i].age
  }
  return null
}

function calcRequiredExtra(simParams, events) {
  const sim = (extra) => {
    const d = runSim({ ...simParams, extraSaving: extra }, events)
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
              <input type="number" className="sim-mini-input" max="21"
                value={state.currentAge}
                onChange={e => onChange(p => ({ ...p, currentAge: Number(e.target.value) || 0 }))} />
              <span className="sim-ef-unit">歳（生まれる前は −2 など）</span>
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

// 3桁区切りで表示する数値入力。入力途中の「1.」「-」などはそのまま保持する
const toNum = (s) => Number(String(s).replace(/[,，¥\s]/g, ''))
const fmtInput = (v) => (Number(v) || 0).toLocaleString('ja-JP', { maximumFractionDigits: 2 })
function NumInput({ value, onChange, className }) {
  const [draft, setDraft] = useState(null)
  return (
    <input type="text" inputMode="decimal" className={className}
      value={draft ?? fmtInput(value)}
      onChange={e => {
        const raw = e.target.value
        const n = toNum(raw)
        if (raw.trim() === '' || raw === '-') { setDraft(raw); onChange(0); return }
        if (Number.isNaN(n)) return
        setDraft(/^-?[\d,]+$/.test(raw.trim()) ? fmtInput(n) : raw)
        onChange(n)
      }}
      onBlur={() => setDraft(null)} />
  )
}

function EventNumField({ label, unit, value, onChange, wide }) {
  return (
    <label className="sim-ef">
      <span className="sim-ef-label">{label}</span>
      <div className="sim-ef-row">
        <NumInput className={`sim-mini-input${wide ? ' sim-mini-input--wide' : ''}`}
          value={value} onChange={onChange} />
        <span className="sim-ef-unit">{unit}</span>
      </div>
    </label>
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
          <span>資産</span>
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
    returnRate:      5,    // 投資（投信＋DC）の想定利回り
    cashRate:        0.2,  // 預金金利
    inflationRate:   2,    // 物価上昇率（日銀の物価目標）
    monthlyRent:     95_000, // 家賃（PayPay外の振込が多いので手入力）
    incomeGrowth:    1,    // 手取り収入の伸び率（昇給）
    wifeAge:             40, // 妻の現在年齢
    wifePensionMonthly:  0,  // 妻の年金（月額）
    wifePensionStartAge: 65, // 妻の年金受給開始年齢
    pensionStartAge: 65,
    retireExpenseRate: 100, // 退職後の生活費（現役時に対する割合）
    retirementBonus: 0,     // 退職金（手取り・退職年に一括）
    insuranceAge:    60,    // 外貨保険を解約して受け取る年齢
  })

  const [vals, setVals] = useState({
    cashAssets:        0,
    investAssets:      0,
    myIncome:          0,  // 本人の手取り年収（年間タブの給与＋ボーナス）
    monthlyFundInvest: 0,  // 投信積立（手取りから払う）
    monthlyDCInvest:   0,  // DC掛金（給与天引き・会社拠出）
    monthlyExpense:    0,
    yutoriAnnual:      0,  // ときめき＋冒険の年額（年間タブ）
    pensionMonthly:    0,
    insuranceReturn:   0,
  })
  const [expenseNote, setExpenseNote] = useState('過去24か月平均')
  const [incomeNote, setIncomeNote]   = useState('年間タブの給与＋ボーナス')
  const [yutoriNote, setYutoriNote]   = useState('年間タブの年額')

  const [loadStatus, setLoadStatus] = useState('idle')
  // AI診断で「データの過不足」を判断するための取得状況
  const [dataMeta,   setDataMeta]   = useState({})
  // 外貨保険の解約返戻金表と為替（取得データ）。受け取り年齢が変わるたびに返戻予定額を計算し直す
  const [insData,    setInsData]    = useState(null)
  const [insDetail,  setInsDetail]  = useState([])
  useEffect(() => {
    if (!insData) return
    const detail = surrenderAtAge(insData, Number(params.insuranceAge), params.currentAge)
    const usd = detail.reduce((t, d) => t + d.usd, 0)
    setInsDetail(detail.map(d => ({ ...d, jpy: Math.round(d.usd * insData.usdJpy) })))
    setVals(v => ({ ...v, insuranceReturn: Math.round(usd * insData.usdJpy) }))
  }, [insData, params.insuranceAge, params.currentAge])
  const [loadMsg,    setLoadMsg]    = useState('')

  // 妻の手取り年収：基本額＋末っ子が各年齢に達したら上乗せ
  const [wife, setWife] = useState({
    base: 0,
    stages: [{ fromAge: 3, add: 0 }, { fromAge: 6, add: 0 }, { fromAge: 12, add: 0 }],
  })
  const [child1, setChild1] = useState({ enabled: false, currentAge: 3,  edu: 'オール公立' })
  const [child2, setChild2] = useState({ enabled: false, currentAge: 0,  edu: 'オール公立' })
  const [dog,    setDog]    = useState({ enabled: false, size: 'small', yearsFromNow: 1, initialCost: 300_000, ...DOG_SIZES.small.defaults })
  const [car,    setCar]    = useState({ enabled: false, yearsFromNow: 3, price: 3_000_000, monthlyFee: 30_000, replaceEvery: 10, sellAge: 75 })
  const [whatIfs, setWhatIfs] = useState(DEFAULT_WHATIFS)  // もしも比較の条件
  const [home,   setHome]   = useState({
    enabled: false, yearsFromNow: 5, landPrice: 25_000_000, buildingPrice: 25_000_000, downPayment: 5_000_000, feeRate: 10,
    loanYears: 35, loanRate: 1.0, monthlyCost: 30_000, stopRent: true, repairEvery: 15, repairCost: 2_000_000,
  })

  useEffect(() => { if (isGasReady()) loadData() }, [])

  // ─── パラメータ・ライフイベントの保存（スプシのPJデータシートに「LP設定」として1行） ───
  // 現在年齢は生年から自動計算、取得データは毎回最新を取るので保存しない
  const [settingsStatus, setSettingsStatus] = useState('idle') // idle | loading | saving | saved | error
  // 読み込みに成功するまで自動保存しない（失敗時に初期値で上書きしないため）
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const lastSavedJson = useRef(null)

  const { currentAge: _age, ...savedParams } = params
  const settingsJson = JSON.stringify({ params: savedParams, wife, child1, child2, car, home, dog, whatIfs })

  useEffect(() => {
    if (!isGasReady()) return
    setSettingsStatus('loading')
    gasApi.getPJData(SETTINGS_TYPE)
      .then(r => {
        const s = r.data
        if (s) {
          if (s.params) setParams(p => ({ ...p, ...s.params }))
          if (s.child1) setChild1(c => ({ ...c, ...s.child1 }))
          if (s.child2) setChild2(c => ({ ...c, ...s.child2 }))
          if (s.car)    setCar(c => ({ ...c, ...s.car }))
          if (s.dog)    setDog(d => ({ ...d, ...s.dog }))
          if (s.home)   setHome(h => ({ ...h, ...s.home }))
          if (s.wife)   setWife(w => ({ ...w, ...s.wife }))
          if (Array.isArray(s.whatIfs)) setWhatIfs(s.whatIfs)
        }
        setSettingsStatus('idle')
        setSettingsLoaded(true)
      })
      .catch(() => setSettingsStatus('error'))
  }, [])

  // 変更が止まって1.5秒後に自動保存。読み込み直後の内容を基準にし、同じなら送らない
  useEffect(() => {
    if (!settingsLoaded) return
    if (lastSavedJson.current === null) { lastSavedJson.current = settingsJson; return }
    if (settingsJson === lastSavedJson.current) return
    const timer = setTimeout(() => {
      setSettingsStatus('saving')
      gasApi.savePJData(SETTINGS_TYPE, JSON.parse(settingsJson))
        .then(() => { lastSavedJson.current = settingsJson; setSettingsStatus('saved') })
        .catch(() => setSettingsStatus('error'))
    }, 1500)
    return () => clearTimeout(timer)
  }, [settingsJson, settingsLoaded])

  const loadData = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const settled = await Promise.allSettled([
        gasApi.getAssets(),
        gasApi.getInvestmentFunds(),
        gasApi.getDCAccounts(),
        gasApi.getTransactions(''),
        gasApi.getPensionData(),
        gasApi.getInsurances(),
        fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY').then(r => r.json()).catch(() => null),
        gasApi.getAnnualPlan(new Date().getFullYear()),
      ])
      const [assetsRes, fundsRes, dcRes, txRes, pensionRes, insRes, rateRes, planRes] =
        settled.map(r => r.status === 'fulfilled' ? r.value : null)
      const fetchNames = ['資産', '投資信託', 'DC', '取引', '年金', '保険', '為替', '年間計画']
      const failedFetches = fetchNames.filter((_, i) => settled[i].status !== 'fulfilled' || !settled[i].value)

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
      // DC: 運用機関ごとに最新評価額を合計
      const dcLatest = {}
      ;(dcRes?.records || []).forEach(r => {
        const key = r['運用機関']
        if (!dcLatest[key] || r['年月'] > dcLatest[key]['年月']) dcLatest[key] = r
      })
      const totalDC = Object.values(dcLatest).reduce((s, r) => s + parseAmt(r['評価額']), 0)

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

      // 月平均支出: 過去24か月（途中月・外れ値・対象外を除く）
      const { monthlyExpense, used, excluded } = calcMonthlyExpense(txRes?.transactions || [])
      setExpenseNote(
        `安心＋彩りの過去${used}か月平均` + (excluded.length ? `（外れ値 ${excluded.map(m => m.replace('/', '-')).join('・')} を除外）` : '')
      )

      // 本人の手取り年収: 今年の年間計画の給与＋ボーナス（12か月分）
      const plan = planRes?.plan
      const myIncome = ['収入_給与', '収入_ボーナス']
        .reduce((s, k) => s + (plan?.[k] || []).reduce((a, v) => a + (Number(v) || 0), 0), 0)
      setIncomeNote(plan ? `年間タブ ${new Date().getFullYear()}年の給与＋ボーナス` : '年間タブに今年の計画がありません')
      // ときめき＋冒険: 年間タブの年額（4月列に総額が入っている）
      const yutoriAnnual = YUTORI_BUCKETS.reduce((s, name) => s + (Number(plan?.[`支出_${name}`]?.[3]) || 0), 0)
      setYutoriNote(plan ? `年間タブ ${new Date().getFullYear()}年の年額` : '年間タブに今年の計画がありません')

      // 年金: 最新レコード
      const pRecs = (pensionRes?.records || [])
        .sort((a, b) => b['確認年月'].localeCompare(a['確認年月']))
      const pensionMonthly = parseAmt(pRecs[0]?.['受給見込み額(月額)'])

      // 外貨保険: 解約返戻金表と為替を取っておき、返戻予定額は「保険の受け取り年齢」から下の useEffect で計算する
      const usdJpy = rateRes?.rates?.JPY || 150
      const currentAgeNow = new Date().getFullYear() - BIRTH_YEAR
      const { masters: insMasters = [], surrenderValues: svRows = [] } = insRes || {}
      setInsData({ masters: insMasters, surrenderValues: svRows, usdJpy })

      // 鮮度チェック用の明細（口座・投信・DCごとに、金額が入っている最新の月）
      const latestNonBlank = (recs, monthKey, valueKey) => [...recs]
        .filter(r => r[valueKey] !== '' && r[valueKey] != null)
        .sort((a, b) => toYM(b[monthKey]).localeCompare(toYM(a[monthKey])))[0]
      const assetDetail = Object.values(accMap).map(recs => {
        const r = latestNonBlank(recs, '月', '金額')
        return r ? { kubun: r['区分'], name: r['口座名'], month: toYM(r['月']), amount: parseAmt(r['金額']) } : null
      }).filter(Boolean)
      const fundDetail = (fundsRes?.masters || []).map(m => ({
        name: m['ファンド名'], month: toYM(fundLatest[m['ファンド名']]?.['年月']), amount: parseAmt(fundLatest[m['ファンド名']]?.['評価額']),
      }))
      const dcDetail = (dcRes?.masters || []).map(m => ({
        name: m['運用機関'], month: toYM(dcLatest[m['運用機関']]?.['年月']), amount: parseAmt(dcLatest[m['運用機関']]?.['評価額']),
      }))

      setDataMeta({
        assets: assetDetail, funds: fundDetail, dc: dcDetail,
        failedFetches,
        expenseMonthsUsed: used,
        expenseMonthsExcluded: excluded,
        hasAnnualPlan: Boolean(plan),
        pensionYearMonth: pRecs[0]?.['確認年月'] || '',
        insurancePolicies: insMasters.length,
        usdJpy,
        usdJpyFallback: !rateRes?.rates?.JPY,
      })
      setParams(p => ({ ...p, currentAge: currentAgeNow }))
      setVals(v => ({
        ...v,
        cashAssets: depositAssets,
        investAssets: totalFunds + totalDC,
        myIncome,
        monthlyFundInvest: monthlyFunds,
        monthlyDCInvest: monthlyDC,
        monthlyExpense, yutoriAnnual, pensionMonthly,
      }))
      setLoadStatus('done')
      setLoadMsg('データを取得しました（各項目は手動で上書き可能です）')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }


  const { retireAge, lifeExpectancy, pensionStartAge } = params
  const { monthlyExpense, pensionMonthly } = vals

  // ─── シミュレーション ────────────────────────────
  const simParams = useMemo(() => ({
    startAge:        params.currentAge,
    endAge:          params.lifeExpectancy,
    retireAge:       params.retireAge,
    pensionStartAge: params.pensionStartAge,
    returnRate:      params.returnRate,
    cashRate:        params.cashRate,
    inflationRate:   params.inflationRate,
    cashAssets:      vals.cashAssets,
    investAssets:    vals.investAssets,
    incomeGrowth:    params.incomeGrowth,
    myIncome:        vals.myIncome,
    wife,
    monthlyFundInvest: vals.monthlyFundInvest,
    monthlyDCInvest: vals.monthlyDCInvest,
    monthlyExpense:  vals.monthlyExpense,
    yutoriAnnual:    vals.yutoriAnnual,
    wifeAge:             params.wifeAge,
    wifePensionMonthly:  params.wifePensionMonthly,
    wifePensionStartAge: params.wifePensionStartAge,
    monthlyRent:     params.monthlyRent,
    pensionMonthly:  vals.pensionMonthly,
    insuranceReturn: vals.insuranceReturn,
    insuranceAge:    params.insuranceAge,
    retireExpenseRate: params.retireExpenseRate,
    retirementBonus: params.retirementBonus,
  }), [params, vals, wife])

  // ライフイベント（オンにしたものだけ）込みの1本で計算する
  // マイホームの土地・建物・頭金は homest の予算（お金ちゃんの「家」タブと同じ画面）から受け取る
  const [homestPlan, setHomestPlan] = useState(null)
  useEffect(() => {
    const onMsg = (e) => { if (fromHomest(e, 'homest:plan')) setHomestPlan(e.data.plan) }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const homestLinked = Boolean(homestPlan?.total > 0)
  const homeEff = useMemo(() => (homestLinked
    ? { ...home, landPrice: homestPlan.landPrice * 10_000, buildingPrice: homestPlan.buildingPrice * 10_000, downPayment: homestPlan.downPayment * 10_000 }
    : home), [home, homestPlan, homestLinked])

  const events = useMemo(() => ({ child1, child2, car, dog, home: homeEff }), [child1, child2, car, dog, homeEff])
  const sim = useMemo(() => runSim(simParams, events), [simParams, events])

  const requiredExtra = useMemo(() => calcRequiredExtra(simParams, events), [simParams, events])

  const chartData = useMemo(() =>
    sim.map(d => ({ age: d.age, assets: Math.max(0, d.assets) })),
    [sim])

  const retireAssets     = sim.find(d => d.age === retireAge)?.assets ?? 0
  const zeroAge          = findZeroAge(sim)
  // 月の生活費＝安心＋彩り＋家賃＋ときめき＋冒険の月割り
  const monthlyLiving    = monthlyExpense + params.monthlyRent + vals.yutoriAnnual / 12
  const wifeIncomeNow    = wifeIncomeAt(wife, [child1, child2], 0)
  // 家計の収支（積立は使ったお金ではないので引かない）と、預金の増減（投信積立の分だけ預金から投資へ移る）
  const householdNow     = vals.myIncome + wifeIncomeNow - monthlyLiving * 12
  const fundInvestAnnual = vals.monthlyFundInvest * 12
  const annualSurplusNow = householdNow - fundInvestAnnual
  // 子どもが生まれる前は、妻の手取りを0円として計算している
  const wifeBeforeBirth  = [child1, child2].some(c => c.enabled) &&
    Math.max(...[child1, child2].filter(c => c.enabled).map(c => Number(c.currentAge))) < 0
  const totalPension     = pensionMonthly + params.wifePensionMonthly
  // 退職後の住居費（今の物価・月額）。シミュレーションと同じく、マイホーム購入後は家賃を止めて維持費とローン返済を入れる
  const retireT          = retireAge - params.currentAge
  const homeOn           = homeEff.enabled && Number(homeEff.yearsFromNow) <= retireT
  const homeLoanEndAge   = homeOn ? params.currentAge + Number(homeEff.yearsFromNow) + Number(homeEff.loanYears) : null
  const homeLoanMonthly  = homeOn
    ? annualLoanPayment(homePrice(homeEff) - Number(homeEff.downPayment), homeEff.loanRate, Number(homeEff.loanYears)) / 12
    : 0
  const retireRent       = homeOn && homeEff.stopRent ? 0 : params.monthlyRent
  const retireHomeCost   = homeOn ? Number(homeEff.monthlyCost) : 0
  const retireLoan       = homeOn && homeLoanEndAge > retireAge ? homeLoanMonthly : 0
  const retireLivingBase = (monthlyExpense + vals.yutoriAnnual / 12) * params.retireExpenseRate / 100
  const retireHousing    = retireRent + retireHomeCost + retireLoan
  const retireLiving     = retireLivingBase + retireHousing
  const monthlyShortfall = Math.max(0, retireLiving - totalPension)
  // ローンが退職後に残る場合、完済後の不足額
  const shortfallAfterLoan = retireLoan > 0 ? Math.max(0, retireLiving - retireLoan - totalPension) : null

  // LPチェック・AIに渡すLPタブの中身
  const lp = {
    params, vals, wife, assumptions: MODEL_ASSUMPTIONS,
    dataMeta: { ...dataMeta, insurance: insDetail },
    notes: { expense: expenseNote, income: incomeNote, yutori: yutoriNote },
    events: { child1, child2, car, dog, home: homeEff, homestLinked },
    results: {
      retireAssets, zeroAge, monthlyShortfall, requiredExtra,
      retireLivingBase, retireHousing, retireRent, retireHomeCost, retireLoan, homeLoanEndAge, shortfallAfterLoan,
      annualSurplusNow, householdNow, fundInvestAnnual, wifeBeforeBirth,
      totalPension, retireLiving, monthlyLiving, wifeIncomeNow,
      // 5歳刻み＋退職・年金開始・最終年の資産推移
      milestones: sim.filter(d =>
        d.age % 5 === 0 || d.age === retireAge || d.age === pensionStartAge || d.age === lifeExpectancy),
      series: sim,  // 毎年の預金・投資（LPチェックの判定用）
      homeLoanMonthly,
    },
  }

  const checks = { data: dataChecks(lp), plan: planChecks(lp) }
  const whatIfResults = useMemo(
    () => runWhatIfs(simParams, events, runSim, whatIfs),
    [simParams, events, whatIfs])

  // AI相談に渡す内容（毎年の推移は大きいので外す）
  const { series: _series, ...resultsForAI } = lp.results
  const aiContext = {
    today: toYM(new Date().toISOString()),
    lp: { ...lp, results: resultsForAI },
    dataChecks: checks.data,
    planChecks: checks.plan,
    whatIfs: {
      rows: whatIfs.map((w, i) => {
        const f = whatIfField(w.key)
        const r = whatIfResults.rows[i]
        return { label: f?.label || w.key, unit: f?.unit || '', value: w.value, endAge: r.endAge, ...r.s }
      }),
      all: whatIfResults.all ? { endAge: whatIfResults.all.endAge, ...whatIfResults.all.s } : null,
    },
  }

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
        <h3 className="sim-section-title">
          パラメータ設定
          {settingsStatus !== 'idle' && (
            <span className="sim-section-note">{SETTINGS_STATUS_LABEL[settingsStatus]}</span>
          )}
        </h3>
        <div className="sim-fields">
          {[
            { label: '現在年齢',     key: 'currentAge',     unit: '歳' },
            { label: '退職予定年齢', key: 'retireAge',       unit: '歳' },
            { label: '平均寿命',     key: 'lifeExpectancy',  unit: '歳' },
            { label: '投資の想定利回り', key: 'returnRate',    unit: '% / 年', note: '投信＋DC' },
            { label: '預金金利',         key: 'cashRate',      unit: '% / 年' },
            { label: '物価上昇率',       key: 'inflationRate', unit: '% / 年', note: '日銀の物価目標2%' },
            { label: '収入の伸び率',     key: 'incomeGrowth',  unit: '% / 年', note: '昇給。本人と妻の手取りに適用' },
            { label: '妻の現在年齢',     key: 'wifeAge',       unit: '歳' },
            { label: '妻の年金',         key: 'wifePensionMonthly',  unit: '円 / 月', note: 'ねんきん定期便の見込み額' },
            { label: '妻の年金開始年齢', key: 'wifePensionStartAge', unit: '歳（妻の年齢）' },
            { label: '退職後の生活費',   key: 'retireExpenseRate', unit: '%', note: '現役時に対する割合。家賃は対象外' },
            { label: '退職金（手取り）', key: 'retirementBonus',   unit: '円', note: '退職年に一括で入る。就業規則・退職金規程で確認' },
            { label: '保険の受け取り年齢', key: 'insuranceAge',    unit: '歳', note: '外貨保険を解約して一括で受け取る年齢' },
            { label: '家賃',             key: 'monthlyRent',   unit: '円 / 月', note: '老後も払う前提。マイホーム購入後は不要' },
          ].map(({ label, key, unit, note }) => (
            <label key={key} className="sim-field">
              <span className="sim-field-label">
                {label}
                {note && <span className="sim-field-note">{note}</span>}
              </span>
              <div className="sim-field-row">
                <NumInput className="sim-num-input" value={params[key]} onChange={v => setParams(p => ({ ...p, [key]: v }))} />
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

      {/* 妻の収入 */}
      <div className="sim-section">
        <h3 className="sim-section-title">
          妻の手取り年収
          <span className="sim-section-note">末っ子の成長に合わせて上乗せ（子どもがいない・生まれる前は全額）</span>
        </h3>
        <div className="sim-events">
          <div className="sim-event-body">
            <EventNumField label="基本" unit="円 / 年" wide
              value={wife.base} onChange={v => setWife(w => ({ ...w, base: v }))} />
            {wife.stages.map((st, i) => (
              <div key={i} className="sim-ef">
                <span className="sim-ef-label">段階{i + 1}</span>
                <div className="sim-ef-row">
                  <span className="sim-ef-unit">末っ子が</span>
                  <NumInput className="sim-mini-input" value={st.fromAge}
                    onChange={v => setWife(w => ({ ...w, stages: w.stages.map((x, j) => j === i ? { ...x, fromAge: v } : x) }))} />
                  <span className="sim-ef-unit">歳から ＋</span>
                  <NumInput className="sim-mini-input sim-mini-input--wide" value={st.add}
                    onChange={v => setWife(w => ({ ...w, stages: w.stages.map((x, j) => j === i ? { ...x, add: v } : x) }))} />
                  <span className="sim-ef-unit">円 / 年</span>
                </div>
              </div>
            ))}
            <p className="sim-ef-note">
              今年の妻の手取り {fmt(wifeIncomeAt(wife, [child1, child2], 0))}
              （ライフイベントの子どもの年齢で計算。子どもをオフにすると全額。あなたの退職と同時に終わる前提）
            </p>
          </div>
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
            { label: '預金',            key: 'cashAssets',        unit: '円',       note: '預金金利で増える' },
            { label: '投資資産',        key: 'investAssets',      unit: '円',       note: '投信＋DC評価額' },
            { label: 'あなたの手取り年収', key: 'myIncome',        unit: '円 / 年',  note: incomeNote },
            { label: '投信積立',        key: 'monthlyFundInvest', unit: '円 / 月',  note: '手取りから' },
            { label: 'DC掛金',          key: 'monthlyDCInvest',   unit: '円 / 月',  note: '会社＋自己（給与天引き）' },
            { label: '生活費（安心＋彩り）', key: 'monthlyExpense', unit: '円 / 月',  note: expenseNote },
            { label: 'ときめき＋冒険',  key: 'yutoriAnnual',      unit: '円 / 年',  note: yutoriNote },
            { label: 'あなたの年金',    key: 'pensionMonthly',    unit: '円 / 月',  note: '年金タブより' },
            { label: '保険返戻予定額',  key: 'insuranceReturn',   unit: '円（一括）', note: `外貨保険を${params.insuranceAge}歳で解約（保険simuの解約返戻金表×今の為替）` },
          ].map(({ label, key, unit, note }) => (
            <label key={key} className="sim-field">
              <span className="sim-field-label">
                {label}
                <span className="sim-field-note">{note}</span>
              </span>
              <div className="sim-field-row">
                <NumInput className="sim-num-input sim-num-input--wide"
                  value={vals[key]} onChange={v => setVals(p => ({ ...p, [key]: v }))} />
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
                    <NumInput className="sim-mini-input" value={car.yearsFromNow}
                      onChange={v => setCar(p => ({ ...p, yearsFromNow: v }))} />
                    <span className="sim-ef-unit">年後</span>
                  </div>
                </label>
                <label className="sim-ef">
                  <span className="sim-ef-label">購入価格</span>
                  <div className="sim-ef-row">
                    <NumInput className="sim-mini-input sim-mini-input--wide" value={car.price}
                      onChange={v => setCar(p => ({ ...p, price: v }))} />
                    <span className="sim-ef-unit">円</span>
                  </div>
                </label>
                <label className="sim-ef">
                  <span className="sim-ef-label">月額維持費</span>
                  <div className="sim-ef-row">
                    <NumInput className="sim-mini-input" value={car.monthlyFee}
                      onChange={v => setCar(p => ({ ...p, monthlyFee: v }))} />
                    <span className="sim-ef-unit">円 / 月</span>
                  </div>
                </label>
                <EventNumField label="買い替え" unit="年ごと（0で買い替えなし）"
                  value={car.replaceEvery} onChange={v => setCar(p => ({ ...p, replaceEvery: v }))} />
                <EventNumField label="手放す年齢" unit="歳（0で手放さない）"
                  value={car.sellAge} onChange={v => setCar(p => ({ ...p, sellAge: v }))} />
              </div>
            )}
          </div>

          <div className="sim-event">
            <button
              className={`sim-event-toggle${dog.enabled ? ' active' : ''}`}
              onClick={() => setDog(p => ({ ...p, enabled: !p.enabled }))}>
              🐕 犬
            </button>
            {dog.enabled && (
              <div className="sim-event-body">
                <div className="sim-ef">
                  <span className="sim-ef-label">大きさ</span>
                  <div className="sim-ef-row">
                    {Object.entries(DOG_SIZES).map(([key, d]) => (
                      <button key={key} className={`sim-choice-btn${dog.size === key ? ' active' : ''}`}
                        onClick={() => setDog(p => ({ ...p, size: key, ...d.defaults }))}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <EventNumField label="飼い始め" unit="年後"
                  value={dog.yearsFromNow} onChange={v => setDog(p => ({ ...p, yearsFromNow: v }))} />
                <EventNumField label="お迎え費用" unit="円（生体・用品・ワクチンなど）" wide
                  value={dog.initialCost} onChange={v => setDog(p => ({ ...p, initialCost: v }))} />
                <EventNumField label="年間費用" unit="円 / 年" wide
                  value={dog.annualCost} onChange={v => setDog(p => ({ ...p, annualCost: v }))} />
                <EventNumField label="飼う年数" unit="年"
                  value={dog.years} onChange={v => setDog(p => ({ ...p, years: v }))} />
                <p className="sim-ef-note">
                  生涯費用の目安 {fmt(Number(dog.initialCost) + Number(dog.annualCost) * Number(dog.years))}（今の物価で。シミュレーションでは物価上昇込み）。
                  年間費用はアニコム「ペットにかける年間支出調査」、年数は平均寿命が目安。大きさを切り替えると年間費用と年数が目安値に戻ります
                </p>
              </div>
            )}
          </div>

          <div className="sim-event">
            <button
              className={`sim-event-toggle${home.enabled ? ' active' : ''}`}
              onClick={() => setHome(p => ({ ...p, enabled: !p.enabled }))}>
              🏠 マイホーム
            </button>
            {home.enabled && (
              <div className="sim-event-body">
                <EventNumField label="購入まで" unit="年後"
                  value={home.yearsFromNow} onChange={v => setHome(p => ({ ...p, yearsFromNow: v }))} />
                <iframe hidden title="homest 予算" src={HOMEST_EMBED_URL} />
                {homestLinked ? (
                  <p className="sim-ef-note">
                    🏡 土地 {fmt(homeEff.landPrice)} ／ 建物 {fmt(homeEff.buildingPrice)} ／ 頭金 {fmt(homeEff.downPayment)}
                    （「家」タブ＝homestの予算から。変更は「家」タブで）
                  </p>
                ) : (
                  <>
                    <EventNumField label="土地" unit="円" wide
                      value={home.landPrice} onChange={v => setHome(p => ({ ...p, landPrice: v }))} />
                    <EventNumField label="建物" unit="円" wide
                      value={home.buildingPrice} onChange={v => setHome(p => ({ ...p, buildingPrice: v }))} />
                    <EventNumField label="頭金" unit="円" wide
                      value={home.downPayment} onChange={v => setHome(p => ({ ...p, downPayment: v }))} />
                  </>
                )}
                <EventNumField label="諸経費" unit="% （物件価格に対して）"
                  value={home.feeRate} onChange={v => setHome(p => ({ ...p, feeRate: v }))} />
                <EventNumField label="ローン期間" unit="年"
                  value={home.loanYears} onChange={v => setHome(p => ({ ...p, loanYears: v }))} />
                <EventNumField label="ローン金利" unit="% / 年"
                  value={home.loanRate} onChange={v => setHome(p => ({ ...p, loanRate: v }))} />
                <EventNumField label="固定資産税・保険など" unit="円 / 月"
                  value={home.monthlyCost} onChange={v => setHome(p => ({ ...p, monthlyCost: v }))} />
                <EventNumField label="大規模修繕の間隔" unit="年ごと（0でなし）"
                  value={home.repairEvery} onChange={v => setHome(p => ({ ...p, repairEvery: v }))} />
                <EventNumField label="修繕費用（1回）" unit="円" wide
                  value={home.repairCost} onChange={v => setHome(p => ({ ...p, repairCost: v }))} />
                <label className="sim-ef sim-ef--check">
                  <input type="checkbox" checked={home.stopRent}
                    onChange={e => setHome(p => ({ ...p, stopRent: e.target.checked }))} />
                  <span className="sim-ef-label">購入後は家賃（{fmt(params.monthlyRent)}/月）がなくなる</span>
                </label>
                <p className="sim-ef-note">
                  物件価格 {fmt(homePrice(homeEff))} ／ 諸経費 {fmt(homePrice(homeEff) * homeEff.feeRate / 100)} ／ 月々のローン返済 {fmt(annualLoanPayment(homePrice(homeEff) - homeEff.downPayment, homeEff.loanRate, homeEff.loanYears) / 12)}
                  （価格は購入時の金額。ローン返済額は物価上昇させない。修繕費は物価上昇込み）
                </p>
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
              <ReferenceLine x={retireAge} stroke="#003087" strokeDasharray="5 3"
                label={{ value: `退職 ${retireAge}歳`, position: 'insideTopRight', fontSize: 10, fill: '#003087' }} />
              {pensionStartAge !== retireAge && (
                <ReferenceLine x={pensionStartAge} stroke="#F47920" strokeDasharray="4 4"
                  label={{ value: `年金開始 ${pensionStartAge}歳`, position: 'insideTopRight', fontSize: 10, fill: '#F47920' }} />
              )}
              {zeroAge && (
                <ReferenceLine x={zeroAge} stroke="#e74c3c" strokeDasharray="5 3"
                  label={{ value: `枯渇 ${zeroAge}歳`, position: 'top', fontSize: 10, fill: '#e74c3c' }} />
              )}
              <Line type="monotone" dataKey="assets" stroke="#F47920" strokeWidth={2.5} dot={false} name="資産" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 老後資金チェック */}
      <div className="sim-section">
        <h3 className="sim-section-title">老後資金チェック</h3>
        <div className="sim-check-grid">
          <SumCard
            label="今年の家計の収支（退職前）"
            value={fmtSign(householdNow)}
            sub={`手取り あなた ${fmt(vals.myIncome)} ＋ 妻 ${fmt(wifeIncomeNow)}${wifeBeforeBirth ? '（出産前は0円）' : ''} − 生活費 ${fmt(monthlyLiving * 12)}。` +
              (fundInvestAnnual
                ? `投信積立 ${fmt(fundInvestAnnual)} を引くと、預金は年 ${annualSurplusNow < 0 ? '▲' : '+'}${fmt(annualSurplusNow)}（積立分は投資に移るだけ）`
                : '')}
            pos={householdNow > 0} neg={householdNow <= 0} />
          <SumCard
            label="退職時の総資産予測"
            value={fmtSign(retireAssets)}
            sub={`${retireAge}歳時点`}
            pos={retireAssets > 0} neg={retireAssets <= 0} />
          <SumCard
            label="月の生活費"
            value={fmt(monthlyLiving)}
            sub="安心＋彩り＋家賃＋ときめき冒険の月割り" />
          <SumCard
            label="年金受給額（月額）"
            value={totalPension > 0 ? fmt(totalPension) : '未入力'}
            sub={`あなた ${pensionStartAge}歳〜 ＋ 妻 ${params.wifePensionStartAge}歳〜（妻の年齢）`}
            pos={totalPension > 0} />
          <SumCard
            label="月の不足額"
            value={monthlyShortfall > 0 ? fmt(monthlyShortfall) : '不足なし ✓'}
            sub={
              `生活費 ${fmt(retireLivingBase)}（${params.retireExpenseRate}%）＋ 住居費 ${fmt(retireHousing)}` +
              (homeOn
                ? `（${retireRent ? `家賃 ${fmt(retireRent)}・` : ''}維持費 ${fmt(retireHomeCost)}${retireLoan ? `・ローン ${fmt(retireLoan)}` : ''}）`
                : '（家賃）') +
              ` − 年金 ${fmt(totalPension)}` +
              (shortfallAfterLoan != null
                ? `。ローン完済（${homeLoanEndAge}歳）後は ${shortfallAfterLoan > 0 ? fmt(shortfallAfterLoan) : '不足なし'}`
                : '')
            }
            pos={monthlyShortfall === 0} neg={monthlyShortfall > 0} />
          <SumCard
            label="資産が尽きる年齢"
            value={zeroAge ? `${zeroAge}歳` : `${lifeExpectancy}歳以降 ✓`}
            sub="ライフイベント込み"
            pos={!zeroAge} neg={!!zeroAge} />
          {requiredExtra > 0 ? (
            <SumCard
              label={`追加必要月積立額`}
              value={fmt(requiredExtra)}
              sub={`退職まで毎月あと${fmt(requiredExtra)}貯めれば${lifeExpectancy}歳までもつ`}
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

      {/* LPチェック（AIなし・常に表示） */}
      <LPCheck checks={checks} results={whatIfResults} simParams={simParams} events={events}
        whatIfs={whatIfs} setWhatIfs={setWhatIfs} />

      {/* AI相談 */}
      <AIChat context={aiContext} />

    </div>
  )
}
