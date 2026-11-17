import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { gasApi, isGasReady } from '../utils/gasApi'
import { surrenderAtYears, BIRTH_YEAR, defaultPayEndYear } from '../utils/insuranceUtils'
import { HOMEST_EMBED_URL, fromHomest } from '../utils/homest'
import { BUCKET_CONFIG } from '../config/budget'
import AIChat from './AIChat'
import LPCheck from './LPCheck'
import LPYearTable from './LPYearTable'
import useFullscreen from '../utils/useFullscreen'
import {
  DEFAULT_WHATIFS, toYM, dataChecks, planChecks, runWhatIfs, whatIfField, checkPlan, seekAll,
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
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(a % 100_000_000 ? 1 : 0)}億`
  if (a >= 10_000)       return `${sign}${Math.round(a / 10_000)}万`
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

// 犬の年間費用の内訳（目安・万円/年）。「内訳」ボタンのダイアログで見せる
const DOG_BREAKDOWN = {
  large: {
    rows: [
      ['フード・おやつ', '15〜20', '1日400〜600gほど食べる'],
      ['予防・健康診断', '5〜8', 'ワクチン・狂犬病・フィラリア/ノミダニ薬（体重で高くなる）・健診'],
      ['ペット保険', '6〜12', '大型犬は高め。年齢とともに上がる'],
      ['病気・けが（保険で出ない分）', '5〜10', '歳をとると関節・心臓・腫瘍などで増える'],
      ['トリミング・シャンプー', '3〜10', '長毛（ゴールデンなど）は月1回 8千〜1.2万円'],
      ['消耗品', '3〜5', 'シーツ・おもちゃ・首輪・ベッドなど'],
      ['預け先・ペットホテル', '2〜5', '旅行・帰省のとき'],
    ],
    total: '約40〜65',
    notes: [
      'ゴールデン：年55万円・12年が目安。寿命10〜12年、がん・股関節・皮膚や耳の病気が多い。最後の数年は年80万円くらいかかることも',
      'ペット保険は「70%補償・手術の上限が高いもの」がおすすめ',
    ],
  },
  small: {
    rows: [
      ['フード・おやつ', '5〜10', '体の大きさで変わる'],
      ['予防・健康診断', '3〜6', 'ワクチン・狂犬病・フィラリア/ノミダニ薬・健診'],
      ['ペット保険', '4〜8', '年齢とともに上がる'],
      ['病気・けが（保険で出ない分）', '3〜8', '歯・皮膚・関節・心臓など'],
      ['トリミング・シャンプー', '0〜10', 'トイプードルなどは月1回 6千〜1万円、短毛ならほぼ0'],
      ['消耗品', '2〜4', 'シーツ・おもちゃ・服など'],
      ['預け先・ペットホテル', '2〜4', '旅行・帰省のとき'],
    ],
    total: '約20〜50',
    notes: [],
  },
}
const DOG_INITIAL = '子犬代（ブリーダー30〜50万円、保護犬なら数万円）＋ケージ・車用品・最初のワクチン・避妊去勢などで10〜20万円'

function DogBreakdown({ size }) {
  const ref = useRef(null)
  const d = DOG_BREAKDOWN[size] || DOG_BREAKDOWN.small
  return (
    <>
      <button type="button" className="sim-link-btn" onClick={() => ref.current?.showModal()}>ⓘ 内訳</button>
      <dialog ref={ref} className="sim-dialog" onClick={e => { if (e.target === ref.current) ref.current.close() }}>
        <h4>{DOG_SIZES[size]?.label}の年間費用の内訳（目安）</h4>
        <table className="sim-dialog-table">
          <thead><tr><th>項目</th><th>万円/年</th></tr></thead>
          <tbody>
            {d.rows.map(([k, v, note]) => (
              <tr key={k}><td>{k}<small>{note}</small></td><td>{v}</td></tr>
            ))}
            <tr className="sim-dialog-total"><td>合計</td><td>{d.total}</td></tr>
          </tbody>
        </table>
        <p className="sim-dialog-note">お迎え費用：{DOG_INITIAL}</p>
        {d.notes.map(n => <p key={n} className="sim-dialog-note">{n}</p>)}
        <p className="sim-dialog-note">若いうちは少なく、老後は医療費で増えます。年間費用は全期間の平均のつもりで入れてください</p>
        <button type="button" className="sim-dialog-close" onClick={() => ref.current?.close()}>閉じる</button>
      </dialog>
    </>
  )
}

const homePrice = (home) => Number(home.landPrice) + Number(home.buildingPrice)
// 固定資産税＋都市計画税（年額）の目安。k は購入から何年目か（0 が購入の年）
//  土地：評価額＝価格の70%。住宅用地の特例（200m²以下）で固定資産税1.4%は1/6、都市計画税0.3%は1/3
//  建物：評価額＝建築費の60%から毎年3.2%ずつ下がり、20%で止まる（木造の目安）。税率1.4%＋0.3%。
//        新築から3年間は固定資産税が半分（120m²分まで。ここでは全体に当てる）
//  評価額は3年ごとの見直しで大きくは変わらないので、物価上昇は掛けない
function propertyTaxAt(home, k) {
  const land = Number(home.landPrice) * 0.7 * (0.014 / 6 + 0.003 / 3)
  const bldValue = Number(home.buildingPrice) * 0.6 * Math.max(0.2, 1 - 0.032 * k)
  const bld = bldValue * ((k < 3 ? 0.007 : 0.014) + 0.003)
  return land + bld
}
// 諸経費（現金で払う）。「家」タブで金額を入れていればその額、なければ物件価格×諸経費率
const homeFee = (home) => (home.miscCost != null ? Number(home.miscCost) : homePrice(home) * Number(home.feeRate) / 100)
// 借入金＝土地＋建物＋諸経費−頭金（諸経費もローンに入れ、頭金で相殺する）
const loanPrincipal = (home) => homePrice(home) + homeFee(home) - Number(home.downPayment)

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

// 60歳以降の働き方（夫婦それぞれ、本人の年齢で判定）
//   〜昇給が止まる年齢：今の手取り × 収入の伸び率
//   昇給が止まる年齢〜：その時点の額のまま
//   減額の年齢〜      ：その額 × 減額後の割合（再雇用など）
//   シニア期（65〜70歳など）：手取り年収を金額で指定（0なら働かない。物価では増やさない）
//   シニア期の終わり〜：収入なし
const DEFAULT_WORK = {
  me:   { raiseStopAge: 55, reducedFrom: 60, reducedRate: 50,  lateFrom: 65, lateUntil: 70, lateIncome: 0 },
  wife: { raiseStopAge: 55, reducedFrom: 60, reducedRate: 100, lateFrom: 65, lateUntil: 70, lateIncome: 0 },
}
// baseNow: 今の金額での手取り年収（妻は子どもの年齢による段階を反映した額）
function workIncomeAt(baseNow, w, age, ageNow, incomeGrowth) {
  if (age >= Number(w.lateUntil)) return 0
  if (age >= Number(w.lateFrom)) return Number(w.lateIncome) || 0
  const raiseYears = Math.max(0, Math.min(age, Number(w.raiseStopAge)) - ageNow)
  const g = 1 + (incomeGrowth || 0) / 100
  // 昇進などの昇給「◯年後に手取り年◯円になる」。その年からは指定額を元に、伸び率と減額（60歳〜）を掛ける
  const reached = (w.raises || [])
    .filter(r => r.target != null && age >= ageNow + Number(r.years))
    .sort((a, b) => Number(b.years) - Number(a.years))[0]
  let v
  if (reached) {
    const from = ageNow + Number(reached.years)
    v = (Number(reached.target) || 0) * g ** Math.max(0, Math.min(age, Number(w.raiseStopAge)) - from)
  } else {
    // 旧形式（◯歳から＋◯円）の昇給
    const stepUp = (w.raises || []).reduce((s, r) => s + (r.target == null && age >= Number(r.fromAge) ? Number(r.amount) || 0 : 0), 0)
    v = (baseNow + stepUp) * g ** raiseYears
  }
  if (age >= Number(w.reducedFrom)) v *= (Number(w.reducedRate) || 0) / 100
  return v
}

// ─── 年金の自動計算 ─────────────────────────────
// 65歳の年金（年額・今の賃金水準の円）＝ ねんきん定期便の「これまでの加入実績に応じた年金額」＋ これから払う分
//   厚生年金：額面の年収 × 5.481/1000（額面は手取り÷0.77で推計。標準報酬の上限 月65万＋賞与150万×2回）
//   基礎年金：満額 × 払う月数/480（60歳まで。これまでの月数と合わせて480か月で頭打ち）
//   将来の年収は伸び率の分を割り戻して今の賃金水準にする（年金は賃金の伸びで再評価されるため）
//   受給開始より後に働いた分（在職定時改定）は入れない
const KISO_FULL     = 831_696                       // 基礎年金の満額（年額の目安：月69,308円）
const NET_TO_GROSS  = 0.77                          // 手取り ≒ 額面 × 0.77
const GROSS_CAP     = 650_000 * 12 + 1_500_000 * 2  // 年金に反映される額面の上限（年）
function projectPension({ past, months, ageNow, startAge, incomeAt, growth }) {
  let kisoMonths = Number(months) > 0 ? Number(months) : Math.max(0, Math.min(480, (ageNow - 20) * 12))
  const g = 1 + (growth || 0) / 100
  let kosei = 0, kiso = 0
  for (let age = ageNow; age < startAge; age++) {
    const t = age - ageNow
    const net = incomeAt(age, t)
    if (net > 0) kosei += Math.min(net / NET_TO_GROSS / g ** t, GROSS_CAP) * 0.005481
    // 60歳までは働いていなくても国民年金（妻は第3号）で基礎年金が増える
    if (age < 60 && kisoMonths < 480) {
      const m = Math.min(12, 480 - kisoMonths)
      kisoMonths += m
      kiso += KISO_FULL * m / 480
    }
  }
  const pastAmt = Number(past) || 0
  return { past: pastAmt, kosei, kiso, total: pastAmt + kosei + kiso }
}
// 受給開始の年齢による増減（65歳より遅いと1か月0.7%増、早いと0.4%減）
const pensionAdjAt = (startAge) => (startAge >= 65 ? 1 + 0.007 * 12 * (startAge - 65) : 1 - 0.004 * 12 * (65 - startAge))

// 資産は「預金」「投資（投信）」「DC」に分けて増やす（投信とDCは想定利回り、預金は預金金利）。
// 手取り（本人＋妻）から生活費（月平均支出＋家賃）と投信積立を引いた残りが預金に入る。
// DC（企業型確定拠出年金）が退職金。掛金は給与天引き・会社拠出なので手取りからは引かず、定年まで DC に入る。
//   受け取るまでは取り崩せない。受け取り方は一時金（全額を投資へ移す）か年金（何年かに分けて預金へ）。
// お金が足りないときは 預金 → 外貨保険（一部解約）→ 投資 の順に崩す。
// 支出・年金・イベント費用は物価上昇率、収入は収入の伸び率で毎年増やす（ローン返済額は固定）。
// AI診断に渡す「このシミュレーションが計算に入れていないもの・単純化している前提」
// runSim を変えたらここも合わせて直す
const MODEL_ASSUMPTIONS = [
  '退職金はDC（企業型確定拠出年金）だけ。DCは受取年齢まで取り崩せず、「使えるお金」にも受取年齢まで入れない。掛金は定年まで。一時金なら受取年齢で全額を投資へ、年金なら指定の年数で分けて受け取る（税金は考慮していない）',
  '外貨保険は保険ごとに、払込をやめる年まで年払いの保険料を払い、返戻金はその年の解約返戻金表（保険simu）の金額で確定。受け取る年まで増やさずに一括で受け取る（今の為替レートで円換算。税金は考慮していない）。受け取るまでも、その年に解約したらもらえる額を資産に数える',
  '収入は手取りベース。税・社会保険料の変化（退職後の住民税・国保など）は個別に計算していない',
  '公的年金は物価上昇率でそのまま増える（マクロ経済スライドによる目減りは考慮していない）',
  '投資は投信・DCとも同じ想定利回りで毎年一定に増える（暴落・順序リスクなし）',
  '投信は「投信の計画」の積立（月額・年齢の範囲）と取り崩し（年額）どおりに動かす。計画が無ければ資産タブの積立額を退職まで続ける',
  '子どもの生活費（教育費以外）・妊活・固定資産税・臨時の収入/支出はライフイベントで入れた分だけ。臨時の分は物価上昇を掛けない',
  'お金が足りないときは 預金 → 外貨保険（一部解約。返戻金・保険料も同じ割合で減る）→ 投信 の順に崩す。DCは受け取るまで崩せない。それでも足りない分は「足りない額」として累積する（借入の利息は考えない）',
  '家は「土地（値上がり率）＋建物（耐用年数で残存割合まで直線で減る）− ローン残高」を純資産として別に表示。生活費には使えないので、使えるお金・資産が尽きる年齢・合格ラインには入れない',
  '収入は「60歳以降の働き方」どおり（夫婦それぞれの年齢で、昇進などの昇給・昇給停止・減額・65歳以降の年収・引退）。昇給は「◯年後に手取り年◯円になる」で入れ、その年からは指定額に伸び率と減額の割合を掛ける。65歳以降の年収は物価では増やさない',
  '働きながら年金を受け取っても減らさない（在職老齢年金の減額は考えない）。退職金・生活費の切り替えは「退職予定年齢」で行う',
  'あなたの年金は65歳の見込み額を元に、繰下げは1か月0.7%増・繰上げは1か月0.4%減で計算（妻の年金は、見込み額を入れるときは入力した額のまま、自動計算では妻も同じく増減）。自動計算は定期便のこれまでの分＋これからの年収で厚生年金・基礎年金を足す（額面は手取り÷0.77で推計）',
  '教育費は子が6〜22歳の16年間に均等割り。児童手当（0〜2歳 月1.5万・3〜18歳 月1万）は収入に入れる。高校/大学無償化・奨学金は入っていない',
  '医療費・介護費・老人ホームなど高齢期の特別支出は入っていない（生活費×退職後割合のみ）',
  '借入金は 土地＋建物＋諸経費−頭金（諸経費もローンに入れ、頭金で相殺）。購入の年に現金で払うのは頭金だけ',
  '住宅ローン控除は「年末のローン残高（借入限度額まで）× 0.7%」を購入から13年間、税金が戻る収入として入れる（払う税金より多くは戻らない点は考えていない）。固定資産税（月額維持費に含めていなければ）・団信・繰上げ返済は入っていない',
  '相続・贈与・親の援助や介護、iDeCo/NISAの税制差は入っていない',
  '家賃は購入しない限り老後もずっと同額（物価上昇分は上がる）',
]

function runSim(p, events) {
  const { startAge, endAge, cashAssets, retireAge, pensionStartAge,
          returnRate, cashRate, inflationRate, incomeGrowth, myIncome, wife,
          monthlyFundInvest, monthlyDCInvest, extraSaving = 0, monthlyExpense, monthlyRent,
          yutoriAnnual, pensionMonthly, wifeAge, wifePensionMonthly, wifePensionStartAge,
          insuranceLumps = [], retireExpenseRate = 100,
          fundAssets = 0, dcAssets = 0, dcReceiveAge = 60, dcMode = 'lump', dcYears = 10,
          work = DEFAULT_WORK, insurancePremiums = [], insuranceValues = {},
          childAllowance = true, fundPlan = null } = p
  if (endAge < startAge) return []
  const rInvest = (returnRate || 0) / 100
  const rCash   = (cashRate || 0) / 100
  let cash   = cashAssets
  let invest = fundAssets
  let dc     = dcAssets
  // すでに受取年齢を過ぎていれば、今年受け取る扱い
  const dcAge = Math.max(Number(dcReceiveAge) || startAge, startAge)
  let dcPaysLeft = 0
  const data = []
  const thisYear = new Date().getFullYear()
  // 投信の計画（積立・取り崩し）。計画が無ければ、資産タブの積立額を退職まで続ける
  const planRows = (kind, age) => (fundPlan || []).filter(r => r.kind === kind && age >= Number(r.fromAge) && age <= Number(r.toAge))

  const home = events?.home
  const homeLoan = home?.enabled
    ? annualLoanPayment(loanPrincipal(home), home.loanRate, Number(home.loanYears))
    : 0
  // 外貨保険を一部解約したときの残りの割合（足りないときに崩すと減る。返戻金・保険料も同じ割合で減る）
  let insFactor = 1

  for (let age = startAge; age <= endAge; age++) {
    const t          = age - startAge
    // 外貨保険は受け取るまで「今解約したらもらえる額」を資産に数える（いつでも解約できるため）
    const ins = (insuranceValues[age] || 0) * insFactor
    // 家は「土地＋建物の価値 − ローン残高」を資産（純資産）として別に数える。生活費には使えないので「使えるお金」には入れない
    const homeEquity = homeEquityAt(home, t)
    data.push({
      age,
      // 使えるお金の合計（預金はマイナスもありうる）。DCは受け取る年齢までは引き出せないので入れない
      assets: Math.round(cash + invest + ins + (age >= dcAge ? dc : 0)),
      dcLocked: age < dcAge,
      cash: Math.round(cash), invest: Math.round(invest), dc: Math.round(dc), ins: Math.round(ins),
      home: Math.round(homeEquity),
      short: Math.round(Math.min(0, cash)),                   // 崩せるものを崩しても足りない額（累計）
    })

    const infl       = (1 + (inflationRate || 0) / 100) ** t
    const retired    = age >= retireAge
    const hasPension = age >= pensionStartAge

    const children      = events ? [events.child1, events.child2] : []
    // 収入は退職年齢ではなく、夫婦それぞれの働き方（年齢）で決まる
    const incomeMe      = workIncomeAt(myIncome, work.me, age, startAge, incomeGrowth)
    const incomeWife    = workIncomeAt(wifeIncomeAt(wife, children, t), work.wife, wifeAge + t, wifeAge, incomeGrowth)
    const annualIncome  = incomeMe + incomeWife
    const fundInvest    = fundPlan
      ? planRows('invest', age).reduce((s, r) => s + (Number(r.amount) || 0) * 12, 0)
      : (retired ? 0 : monthlyFundInvest * 12)
    const fundWithdraw  = planRows('withdraw', age).reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const dcInvest      = retired ? 0 : monthlyDCInvest * 12
    const extra         = retired ? 0 : extraSaving * 12  // 追加必要積立額の逆算用
    // 退職後は生活費（安心＋彩り）とときめき＋冒険を割合で調整。家賃は対象外
    const livingRate    = retired ? retireExpenseRate / 100 : 1
    const annualExpense = ((monthlyExpense * livingRate + monthlyRent) * 12 + yutoriAnnual * livingRate) * infl
    // 妻の年金は妻の年齢で受給開始（あなたの退職前に始まる場合も含む）
    const wifePension   = wifeAge + t >= wifePensionStartAge ? wifePensionMonthly * 12 * infl : 0
    // あなたの年金は65歳の見込み額。繰下げは1か月0.7%増、繰上げは1か月0.4%減
    const pensionAdj = pensionAdjAt(pensionStartAge)
    const annualPension = (hasPension ? pensionMonthly * pensionAdj * 12 * infl : 0) + wifePension  // 働いていても受け取る（在職老齢年金の減額は考えない）

    // ライフイベントコスト。表に出すため項目ごとにも記録する（b）
    let eventCost = 0
    const b = {}
    const cost = (key, v) => { eventCost += v; b[key] = (b[key] || 0) + v }
    let allowance = 0  // 児童手当・住宅ローン控除（税金が戻る分）など、制度で入ってくるお金
    let extraIncome = 0  // 臨時の収入
    if (events) {
      for (const child of [events.child1, events.child2]) {
        if (!child.enabled) continue
        const childAge = child.currentAge + t
        // 児童手当（2024年10月からの制度。所得制限なし）：0〜2歳 月1.5万、3〜18歳 月1万
        if (childAllowance && childAge >= 0 && childAge <= 18) {
          const a = (childAge < 3 ? 15_000 : 10_000) * 12
          allowance += a
          b.childAllowance = (b.childAllowance || 0) + a
        }
        // 子どもの生活費（食費・衣類・おこづかいなど、教育費以外）。年齢の範囲ごとに月額を足す
        if (childAge >= 0) {
          for (const st of childLivingStages(child)) {
            if (childAge >= Number(st.fromAge) && childAge <= Number(st.toAge)) cost('childLiving', (Number(st.monthly) || 0) * 12 * infl)
          }
        }
        if (childAge >= 6 && childAge < 22) {
          cost('edu', EDU_COST[child.edu] / 16 * infl)
        }
      }
      const c = events.car
      // 手放す年齢（0なら手放さない）以降は買い替えも維持費もかからない
      const sellAge = Number(c.sellAge)
      if (c.enabled && !(sellAge > 0 && age >= sellAge)) {
        const first = Number(c.yearsFromNow)
        const cycle = Number(c.replaceEvery)
        const isPurchase = t === first || (cycle > 0 && t > first && (t - first) % cycle === 0)
        if (isPurchase) cost('car', Number(c.price) * infl)
        if (t >= first) cost('car', Number(c.monthlyFee) * 12 * infl)
      }
      const dog = events.dog
      if (dog?.enabled) {
        const from = Number(dog.yearsFromNow)
        if (t === from) cost('dog', Number(dog.initialCost) * infl)
        if (t >= from && t < from + Number(dog.years)) cost('dog', Number(dog.annualCost) * infl)
      }
      const nk = events.ninkatsu
      if (nk?.enabled) {
        const from = Number(nk.yearsFromNow)
        if (t >= from && t < from + (Number(nk.years) || 0)) cost('ninkatsu', (Number(nk.annual) || 0) * infl)
      }
      // 臨時の収入・支出（その年の金額のまま。物価上昇は掛けない）
      for (const o of events.oneOffs || []) {
        if (Number(o.year) !== thisYear + t) continue
        if (o.kind === 'income') extraIncome += Number(o.amount) || 0
        else cost('oneOff', Number(o.amount) || 0)
      }
      if (home?.enabled) {
        const bought = Number(home.yearsFromNow)
        // 購入時に頭金と諸経費（物件価格×諸経費率。登記・仲介手数料・税など）を現金で払う
        // 購入の年に払うのは頭金だけ。諸経費は借入金に入っている
        if (t === bought) cost('homeDown', Number(home.downPayment))
        if (t >= bought && t < bought + Number(home.loanYears)) cost('loan', homeLoan)
        // 住宅ローン控除：年末のローン残高（借入限度額まで）× 0.7% を、購入から控除期間（初期13年）戻す
        const deductYears = Number(home.deductYears ?? 13)
        if (t >= bought && t < bought + deductYears) {
          // 控除の対象は家（土地・建物）の分だけ。諸経費の分は借入金の割合で除く
          const share = homePrice(home) > 0 ? homePrice(home) / (homePrice(home) + homeFee(home)) : 0
          const balance = loanBalance(loanPrincipal(home), home.loanRate, Number(home.loanYears), t - bought + 1) * share
          const d = Math.min(balance, Number(home.deductLimit ?? 30_000_000)) * 0.007
          allowance += d
          b.loanDeduct = d
        }
        if (t >= bought) {
          cost('homeKeep', Number(home.monthlyCost) * 12 * infl)
          cost('propertyTax', propertyTaxAt(home, t - bought))
          // 購入後は家賃が不要になる分、手元に残る
          if (home.stopRent) cost('rentStop', -monthlyRent * 12 * infl)
        }
        // 外壁・屋根・水回りなどの大規模修繕を購入から一定年数ごとに計上
        const repairEvery = Number(home.repairEvery)
        if (repairEvery > 0 && t > bought && (t - bought) % repairEvery === 0) cost('homeKeep', Number(home.repairCost) * infl)
      }
    }

    // 外貨保険の解約返戻金は、保険ごとの受け取る年（＝払込終了年）に一括加算
    const lump = insuranceLumps.reduce((sum, x) => sum + (age === x.age ? x.amount : 0), 0) * insFactor
    // 外貨保険の年払い（払い終わるまで。今の為替で円換算した額のまま）
    const premium = insurancePremiums.reduce((sum, x) => sum + (age >= x.fromAge && age <= x.toAge ? x.annual : 0), 0) * insFactor

    // DC：受け取るまでは運用と掛金（定年まで）で増える。受け取ったら一時金は投資へ、年金は分けて預金へ
    dc += Math.max(0, dc) * rInvest + (age < dcAge ? dcInvest : 0)
    let dcPay = 0
    if (age === dcAge) {
      if (dcMode === 'annuity') dcPaysLeft = Math.max(1, Number(dcYears) || 1)
      else { invest += dc; dc = 0 }
    }
    if (dcPaysLeft > 0) {
      dcPay = dc / dcPaysLeft
      dc -= dcPay
      dcPaysLeft--
    }

    invest += Math.max(0, invest) * rInvest + fundInvest + extra
    // 計画した取り崩し（投信 → 預金）。投信の残高まで
    const withdrawn = Math.min(fundWithdraw, Math.max(0, invest))
    invest -= withdrawn
    cash   += Math.max(0, cash) * rCash + annualIncome + allowance + extraIncome - fundInvest - annualExpense + annualPension - eventCost - premium + lump + dcPay + withdrawn
    let autoIns = 0
    let autoInvest = 0
    // 足りないときに崩す順番：預金 → 外貨保険（一部解約）→ 投信。DCは受け取るまで崩せない
    // 保険を計画的にやめるなら、LPの外貨保険で保険ごとに「受け取る年」を指定する（ここは預金が尽きたときの備え）
    const insNext = (insuranceValues[age + 1] || 0) * insFactor
    if (cash < 0 && insNext > 0) {
      const draw = Math.min(insNext, -cash)
      insFactor *= 1 - draw / insNext
      cash += draw
      autoIns = draw
    }
    if (cash < 0 && invest > 0) {
      const draw = Math.min(invest, -cash)
      invest -= draw
      cash   += draw
      autoInvest = draw
    }
    // 計画外の取り崩し（預金が足りずに自動で崩した額）。LPチェックで見直しを促す
    Object.assign(data[data.length - 1], { autoIns: Math.round(autoIns), autoInvest: Math.round(autoInvest), fundInvest, withdrawn: Math.round(withdrawn) })
    // 年ごとの表の内訳（収入・支出・投資の移動・年末の残高）
    const R = Math.round
    const rentNet = monthlyRent * 12 * infl + (b.rentStop || 0)
    const flow = {
      incomeMe: R(incomeMe), incomeWife: R(incomeWife), pension: R(annualPension),
      allowance: R(b.childAllowance || 0), loanDeduct: R(b.loanDeduct || 0),
      otherIncome: R(lump + dcPay + extraIncome),
      living: R(monthlyExpense * livingRate * 12 * infl), yutori: R(yutoriAnnual * livingRate * infl),
      housing: R(rentNet + (b.loan || 0)), homeKeep: R((b.homeKeep || 0) + (b.propertyTax || 0)), homeDown: R(b.homeDown || 0),
      childLiving: R(b.childLiving || 0), edu: R(b.edu || 0), car: R(b.car || 0), dog: R(b.dog || 0),
      ninkatsu: R(b.ninkatsu || 0), oneOff: R(b.oneOff || 0), premium: R(premium),
      fundInvest: R(fundInvest), withdrawn: R(withdrawn), autoDraw: R(autoIns + autoInvest),
      endCash: R(cash), endInvest: R(invest), endIns: R((insuranceValues[age + 1] || 0) * insFactor),
      // 年末の時点で受け取り年齢前なら、DCは使えないお金
      endDcFree: age + 1 >= dcAge ? R(dc) : 0, endDcLock: age + 1 >= dcAge ? 0 : R(dc),
      endHome: R(homeEquityAt(home, t + 1)),
    }
    flow.income = flow.incomeMe + flow.incomeWife + flow.pension + flow.allowance + flow.loanDeduct + flow.otherIncome
    flow.expense = flow.living + flow.yutori + flow.housing + flow.homeKeep + flow.homeDown + flow.childLiving + flow.edu
      + flow.car + flow.dog + flow.ninkatsu + flow.oneOff + flow.premium
    flow.balance = flow.income - flow.expense
    flow.endUsable = flow.endCash + flow.endInvest + flow.endIns + flow.endDcFree
    flow.endLocked = flow.endDcLock + flow.endHome
    data[data.length - 1].flow = flow
    data[data.length - 1].expense = Math.round(annualExpense)  // この年の生活費（合格ラインの判定用）
    data[data.length - 1].allowance = Math.round(allowance)
  }
  return data
}

// 家の純資産 ＝ 土地（値上がり率で増減）＋ 建物（耐用年数で残存割合まで直線で減る）− ローン残高
function homeEquityAt(home, t) {
  if (!home?.enabled) return 0
  const k = t - Number(home.yearsFromNow)
  if (k < 0) return 0
  const land = Number(home.landPrice) * (1 + (Number(home.landGrowth) || 0) / 100) ** k
  const life = Math.max(1, Number(home.buildingLife) || 30)
  const residual = Math.min(100, Math.max(0, Number(home.buildingResidual) || 0)) / 100
  const building = Number(home.buildingPrice) * Math.max(residual, 1 - (k / life) * (1 - residual))
  return land + building - loanBalance(loanPrincipal(home), home.loanRate, Number(home.loanYears), k)
}

// 元利均等返済で k 年払ったあとのローン残高
function loanBalance(principal, ratePercent, years, k) {
  if (principal <= 0 || k >= years) return 0
  const i = (ratePercent || 0) / 100 / 12
  const n = years * 12
  const m = k * 12
  if (i === 0) return principal * (1 - m / n)
  const pmt = principal * i / (1 - (1 + i) ** -n)
  return principal * (1 + i) ** m - pmt * ((1 + i) ** m - 1) / i
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

// 子どもの生活費の段階 [{ id, fromAge, toAge, monthly }]。旧形式（月額＋何歳まで）は1行に読み替える
function childLivingStages(child) {
  if (Array.isArray(child.livingStages)) return child.livingStages
  const m = Number(child.livingMonthly) || 0
  return m > 0 ? [{ id: 'old', fromAge: 0, toAge: (Number(child.livingUntil) || 22) - 1, monthly: m }] : []
}

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
          <div className="sim-ef">
            <span className="sim-ef-label">生活費（教育費以外）</span>
            {childLivingStages(state).map(st => {
              const upd = (patch) => onChange(p => ({ ...p, livingStages: childLivingStages(p).map(x => (x.id === st.id ? { ...x, ...patch } : x)) }))
              return (
                <div key={st.id} className="sim-ef-row sim-fundplan-row">
                  <NumInput className="sim-mini-input sim-mini-input--age" value={st.fromAge} onChange={v => upd({ fromAge: v })} />
                  <span className="sim-ef-unit">〜</span>
                  <NumInput className="sim-mini-input sim-mini-input--age" value={st.toAge} onChange={v => upd({ toAge: v })} />
                  <span className="sim-ef-unit">歳</span>
                  <NumInput className="sim-mini-input sim-mini-input--wide" value={st.monthly} onChange={v => upd({ monthly: v })} />
                  <span className="sim-ef-unit">円 / 月</span>
                  <button type="button" className="sim-row-del" aria-label="この行を消す"
                    onClick={() => onChange(p => ({ ...p, livingStages: childLivingStages(p).filter(x => x.id !== st.id) }))}>×</button>
                </div>
              )
            })}
            <button type="button" className="sim-choice-btn" onClick={() => onChange(p => {
              const rows = childLivingStages(p)
              const from = rows.length ? Number(rows.at(-1).toAge) + 1 : 0
              return { ...p, livingStages: [...rows, { id: `c${Date.now()}`, fromAge: from, toAge: Math.max(from, 22), monthly: 0 }] }
            })}>＋ 追加</button>
          </div>
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

// 60歳以降の働き方（1人分）
function WorkFields({ title, w, ageNow, onChange, incomeAt }) {
  const row = (children, key) => <div key={key} className="sim-ef-row sim-work-row">{children}</div>
  const num = (key, wide) => (
    <NumInput className={`sim-mini-input ${wide ? 'sim-mini-input--wide' : 'sim-mini-input--age'}`} value={w[key]}
      onChange={v => onChange({ [key]: v })} />
  )
  const checkpoints = [...new Set([ageNow, ...(w.raises || []).map(r => (r.target != null ? ageNow + Number(r.years) : Number(r.fromAge))), Number(w.raiseStopAge), Number(w.reducedFrom), Number(w.lateFrom), Number(w.lateUntil)])]
    .filter(a => a >= ageNow).sort((a, b) => a - b)
  return (
    <div className="sim-event-body sim-work">
      <div className="sim-ef-label"><strong>{title}</strong>（今 {ageNow}歳）</div>
      <div className="sim-ef">
        {row(<>{num('raiseStopAge')}<span className="sim-ef-unit">歳で昇給（伸び率）が止まる</span></>)}
      </div>
      <div className="sim-ef">
        {(w.raises || []).map(r => {
          const upd = (patch) => onChange({ raises: w.raises.map(x => (x.id === r.id ? { ...x, ...patch } : x)) })
          return row(r.target != null ? <>
            <span className="sim-ef-unit">昇給</span>
            <NumInput className="sim-mini-input sim-mini-input--age" value={r.years} onChange={v => upd({ years: v })} />
            <span className="sim-ef-unit">年後（{ageNow + Number(r.years || 0)}歳）に 手取り年</span>
            <NumInput className="sim-mini-input sim-mini-input--wide" value={r.target} onChange={v => upd({ target: v })} />
            <span className="sim-ef-unit">円になる</span>
            <button type="button" className="sim-row-del" aria-label="この昇給を消す"
              onClick={() => onChange({ raises: w.raises.filter(x => x.id !== r.id) })}>×</button>
          </> : <>
            <span className="sim-ef-unit">昇給</span>
            <NumInput className="sim-mini-input sim-mini-input--age" value={r.fromAge} onChange={v => upd({ fromAge: v })} />
            <span className="sim-ef-unit">歳から 手取り年 ＋</span>
            <NumInput className="sim-mini-input sim-mini-input--wide" value={r.amount} onChange={v => upd({ amount: v })} />
            <span className="sim-ef-unit">円</span>
            <button type="button" className="sim-row-del" aria-label="この昇給を消す"
              onClick={() => onChange({ raises: w.raises.filter(x => x.id !== r.id) })}>×</button>
          </>, r.id)
        })}
        <button type="button" className="sim-choice-btn"
          onClick={() => onChange({ raises: [...(w.raises || []), { id: `r${Date.now()}`, years: 2, target: Math.round(incomeAt(ageNow)) }] })}>
          ＋ 昇給（昇進など）
        </button>
      </div>
      <div className="sim-ef">
        {row(<>{num('reducedFrom')}<span className="sim-ef-unit">歳から給料を</span>{num('reducedRate')}<span className="sim-ef-unit">%に</span></>)}
      </div>
      <div className="sim-ef">
        {row(<>{num('lateFrom')}<span className="sim-ef-unit">〜</span>{num('lateUntil')}<span className="sim-ef-unit">歳は 手取り年</span>{num('lateIncome', true)}<span className="sim-ef-unit">円（0なら働かない）</span></>)}
      </div>
      <p className="sim-ef-note">
        手取り年収：{checkpoints.map(a => `${a}歳 ${fmt(incomeAt(a))}`).join(' → ')}
      </p>
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

// 資産推移グラフの系列（色は dataviz の検証済みカテゴリ色。名前は凡例とツールチップに必ず出す）
// 西暦の入力欄。入力中は自由に消したり打ったりでき、4桁の年（今年〜70年後）になったときだけ反映する。
// 範囲外のまま離れたら元の年に戻す（途中の値で計算が走って固まらないように）
const YEAR_SPAN = 70
function YearInput({ value, onCommit }) {
  const [draft, setDraft] = useState(null)
  const thisYear = new Date().getFullYear()
  const ok = (y) => /^\d{4}$/.test(y) && Number(y) >= thisYear && Number(y) <= thisYear + YEAR_SPAN
  return (
    <input type="text" inputMode="numeric" className="sim-mini-input sim-mini-input--year"
      value={draft ?? String(value)}
      onChange={e => {
        const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
        setDraft(v)
        if (ok(v)) onCommit(Number(v))
      }}
      onBlur={() => setDraft(null)} />
  )
}

// usable: 使えるお金か。使えないお金（受け取り前のDC・家）は薄く塗り、使えるお金の上に積む
const SERIES = [
  { key: 'cash',   name: '預金',       color: '#2a78d6', usable: true },
  { key: 'invest', name: '投資（投信）', color: '#eb6834', usable: true },
  { key: 'ins',    name: '外貨保険',     color: '#eda100', usable: true },
  { key: 'dcFree', name: 'DC（年金で受取中）', color: '#1baf7a', usable: true, optional: true },
  { key: 'dcLock', name: 'DC（受け取るまで使えない）', color: '#1baf7a', usable: false },
  { key: 'home',   name: '家（純資産・使えない）', color: '#b8bec7', usable: false },
]
const SHORT_COLOR = '#e34948'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="sim-tooltip">
      <p className="sim-tt-age">{label}歳</p>
      {[true, false].map(usable => (
        <div key={String(usable)}>
          <p className="sim-tt-row sim-tt-total">
            <span>{usable ? '使えるお金' : '使えないお金'}</span>
            <span>{fmtSign(usable ? d.raw.assets : d.dcLock + d.home)}</span>
          </p>
          {SERIES.filter(sr => sr.usable === usable && (!sr.optional || d[sr.key] > 0)).map(sr => (
            <p key={sr.key} className="sim-tt-row">
              <span><i className="sim-tt-dot" style={{ background: sr.color, opacity: usable ? 1 : 0.4 }} />{sr.name}</span>
              <span>{fmtSign(sr.key === 'cash' || sr.key === 'invest' ? d.raw[sr.key] : d[sr.key])}</span>
            </p>
          ))}
        </div>
      ))}
      {d.raw.short < 0 && (
        <p className="sim-tt-row sim-tt-short">
          <span><i className="sim-tt-dot" style={{ background: SHORT_COLOR }} />足りない額</span>
          <span>{fmtSign(d.raw.short)}</span>
        </p>
      )}
    </div>
  )
}

// 開閉式の欄。閉じていても見出しの右に要点を出す
// 投信の計画：積立（月額）と取り崩し（年額）を年齢の範囲で。毎年夫婦で見直す前提
function FundPlan({ rows, isAuto, onChange, onReset, ageNow, retireAge }) {
  const upd = (id, patch) => onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const add = (kind) => onChange([...rows, kind === 'invest'
    ? { id: `f${Date.now()}`, kind, fromAge: ageNow, toAge: retireAge - 1, amount: 0 }
    : { id: `f${Date.now()}`, kind, fromAge: retireAge, toAge: retireAge + 9, amount: 0 }])
  return (
    <div className="sim-fundplan">
      <div className="sim-subhead">投信の計画 <span className="sim-section-note">
        {isAuto ? '資産タブの積立額を退職まで続ける形。変えるとこの計画で計算' : '毎年見直して書き換える'}</span></div>
      {rows.map(r => (
        <div key={r.id} className="sim-ef-row sim-fundplan-row">
          <select className="sim-mini-select" value={r.kind} onChange={e => upd(r.id, { kind: e.target.value })}>
            <option value="invest">積立</option>
            <option value="withdraw">取り崩し</option>
          </select>
          <NumInput className="sim-mini-input sim-mini-input--age" value={r.fromAge} onChange={v => upd(r.id, { fromAge: v })} />
          <span className="sim-ef-unit">〜</span>
          <NumInput className="sim-mini-input sim-mini-input--age" value={r.toAge} onChange={v => upd(r.id, { toAge: v })} />
          <span className="sim-ef-unit">歳</span>
          <NumInput className="sim-mini-input sim-mini-input--wide" value={r.amount} onChange={v => upd(r.id, { amount: v })} />
          <span className="sim-ef-unit">{r.kind === 'invest' ? '円 / 月' : '円 / 年'}</span>
          <button type="button" className="sim-row-del" onClick={() => onChange(rows.filter(x => x.id !== r.id))} aria-label="この行を消す">×</button>
        </div>
      ))}
      <div className="sim-ef-row">
        <button type="button" className="sim-choice-btn" onClick={() => add('invest')}>＋ 積立</button>
        <button type="button" className="sim-choice-btn" onClick={() => add('withdraw')}>＋ 取り崩し</button>
        {!isAuto && <button type="button" className="sim-choice-btn" onClick={onReset}>資産タブの積立に戻す</button>}
      </div>
      <p className="sim-ef-note">取り崩しは投信から預金へ移す額（投信の残高まで）。預金が足りなくなった年は、計画とは別に 外貨保険 → 投信 の順に自動で崩し、LPチェックに出します</p>
    </div>
  )
}

// 臨時の収入・支出（年は西暦。金額はその年の金額のまま）
const newOneOff = () => ({ id: `o${Date.now()}`, year: new Date().getFullYear() + 1, kind: 'expense', amount: 0, memo: '' })
function OneOffs({ rows, onChange }) {
  const upd = (id, patch) => onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="sim-event-body">
      {rows.map(r => (
        <div key={r.id} className="sim-ef-row sim-fundplan-row">
          <NumInput className="sim-mini-input" value={r.year} onChange={v => upd(r.id, { year: v })} />
          <span className="sim-ef-unit">年</span>
          <select className="sim-mini-select" value={r.kind} onChange={e => upd(r.id, { kind: e.target.value })}>
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
          <NumInput className="sim-mini-input sim-mini-input--wide" value={r.amount} onChange={v => upd(r.id, { amount: v })} />
          <span className="sim-ef-unit">円</span>
          <input className="sim-mini-input sim-oneoff-memo" value={r.memo} placeholder="メモ" onChange={e => upd(r.id, { memo: e.target.value })} />
          <button type="button" className="sim-row-del" onClick={() => onChange(rows.filter(x => x.id !== r.id))} aria-label="この行を消す">×</button>
        </div>
      ))}
      <button type="button" className="sim-choice-btn" onClick={() => onChange([...rows, newOneOff()])}>＋ 追加</button>
      <p className="sim-ef-note">お祝い・家電の買い替え・相続など、他の項目に当てはまらないもの</p>
    </div>
  )
}

function Section({ icon, title, summary, children }) {
  return (
    <details className="sim-section sim-collapse">
      <summary className="sim-section-title">
        {icon} {title}
        {summary && <span className="sim-section-note sim-section-summary">{summary}</span>}
      </summary>
      {children}
    </details>
  )
}

// 1項目の入力。fetched は「データ再取得」で入る値（手で上書きもできる）
function Field({ label, note, unit, value, onChange, fetched, wide }) {
  return (
    <label className="sim-field">
      <span className="sim-field-label">
        {label}
        {fetched && <span className="sim-badge">取得</span>}
        {note && <span className="sim-field-note">{note}</span>}
      </span>
      <div className="sim-field-row">
        <NumInput className={`sim-num-input${wide ? ' sim-num-input--wide' : ''}`} value={value} onChange={onChange} />
        <span className="sim-field-unit">{unit}</span>
      </div>
    </label>
  )
}

// 選択ボタン（年金の開始年齢、DCの受け取り方など）
function Choice({ label, note, options, value, onChange }) {
  return (
    <div className="sim-field">
      <span className="sim-field-label">
        {label}
        {note && <span className="sim-field-note">{note}</span>}
      </span>
      <div className="sim-field-row">
        {options.map(([v, text]) => (
          <button key={v} type="button" className={`sim-choice-btn${value === v ? ' active' : ''}`} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

const man  = (v) => `${Math.round((Number(v) || 0) / 10_000).toLocaleString()}万`
const man1 = (v) => `${((Number(v) || 0) / 10_000).toFixed(1)}万`

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
    pensionMode:     'manual', // 年金：manual（見込み額を入れる）| auto（自動計算）
    pensionPastMe:   0,  // 自動計算：あなたの「これまでの加入実績に応じた年金額」（年額）。0なら資産タブの見込み額×12
    pensionMonthsMe: 0,  // 自動計算：あなたのこれまでの加入月数。0なら20歳から切れ目なく
    pensionPastWife:   0,
    pensionMonthsWife: 0,
    retireExpenseRate: 100, // 退職後の生活費（現役時に対する割合）
    minMonths:       6,     // 合格ライン：手元のお金が生活費の何か月分を割らないか
    childAllowance:  true,  // 児童手当を収入に入れる
    targetAtEnd:     0,     // 合格ライン：想定寿命の年に残したい額（使えるお金）
    dcReceiveAge:    60,    // DC（退職金）を受け取る年齢
    dcMode:          'lump', // DCの受け取り方：lump（一時金）| annuity（年金）
    dcYears:         10,    // 年金で受け取るときの年数
  })

  const [vals, setVals] = useState({
    cashAssets:        0,
    fundAssets:        0,  // 投資信託の評価額
    dcAssets:          0,  // DC（退職金）の評価額
    myIncome:          0,  // 本人の手取り年収（年間タブの給与＋ボーナス）
    monthlyFundInvest: 0,  // 投信積立（手取りから払う）
    monthlyDCInvest:   0,  // DC掛金（給与天引き・会社拠出）
    monthlyExpense:    0,
    yutoriAnnual:      0,  // ときめき＋冒険の年額（年間タブ）
    pensionMonthly:    0,
    insuranceReturn:   0,
  })
  const [expenseNote, setExpenseNote] = useState('過去24か月平均')
  const [incomeNote, setIncomeNote]   = useState('設定タブの給与＋ボーナス')
  const [yutoriNote, setYutoriNote]   = useState('設定タブの年額')

  const [loadStatus, setLoadStatus] = useState('idle')
  // AI診断で「データの過不足」を判断するための取得状況
  const [dataMeta,   setDataMeta]   = useState({})
  // 外貨保険の解約返戻金表・年払い記録と為替（取得データ）。保険ごとの計算は下の insPolicies
  const [insData,    setInsData]    = useState(null)
  const [loadMsg,    setLoadMsg]    = useState('')

  // 妻の手取り年収：基本額＋末っ子が各年齢に達したら上乗せ
  const [wife, setWife] = useState({
    base: 0,
    stages: [{ fromAge: 3, add: 0 }, { fromAge: 6, add: 0 }, { fromAge: 12, add: 0 }],
  })
  const [child1, setChild1] = useState({ enabled: false, currentAge: 3,  edu: 'オール公立', livingStages: [] })
  const [child2, setChild2] = useState({ enabled: false, currentAge: 0,  edu: 'オール公立', livingStages: [] })
  const [ninkatsu, setNinkatsu] = useState({ enabled: false, yearsFromNow: 1, years: 1, annual: 1_500_000 })
  const [oneOffs, setOneOffs] = useState([])     // 臨時の収入・支出 [{ id, year(西暦), kind: income|expense, amount, memo }]
  const [fundPlan, setFundPlan] = useState(null) // 投信の計画 [{ id, kind: invest|withdraw, fromAge, toAge, amount }]。null は資産タブの積立のまま
  const [dog,    setDog]    = useState({ enabled: false, size: 'small', yearsFromNow: 1, initialCost: 300_000, ...DOG_SIZES.small.defaults })
  const [car,    setCar]    = useState({ enabled: false, yearsFromNow: 3, price: 3_000_000, monthlyFee: 30_000, replaceEvery: 10, sellAge: 75 })
  const [whatIfs, setWhatIfs] = useState(DEFAULT_WHATIFS)  // もしも比較の条件
  const chartFull = useFullscreen()  // 資産推移グラフの最大化
  const [work, setWork] = useState(DEFAULT_WORK)           // 60歳以降の働き方
  const [insPayEnd, setInsPayEnd] = useState({})          // 外貨保険ごとの払込をやめる年 { 保険名: 西暦 }
  const [insReceive, setInsReceive] = useState({})        // 外貨保険ごとの受け取る年 { 保険名: 西暦 }（なければ払込をやめる年）
  const [home,   setHome]   = useState({
    enabled: false, yearsFromNow: 5, landPrice: 25_000_000, buildingPrice: 25_000_000, downPayment: 5_000_000, feeRate: 10,
    loanYears: 35, loanRate: 1.0, monthlyCost: 30_000, stopRent: true, repairEvery: 15, repairCost: 2_000_000,
    landGrowth: 0, buildingLife: 30, buildingResidual: 0,  // 家の価値：土地の値上がり率（%/年）、建物の耐用年数・残存割合（%）
    deductLimit: 30_000_000, deductYears: 13,               // 住宅ローン控除：借入限度額（省エネ基準の新築 3,000万）・控除期間
  })

  useEffect(() => { if (isGasReady()) loadData() }, [])

  // ─── パラメータ・ライフイベントの保存（スプシのPJデータシートに「LP設定」として1行） ───
  // 現在年齢は生年から自動計算、取得データは毎回最新を取るので保存しない
  const [settingsStatus, setSettingsStatus] = useState('idle') // idle | loading | saving | saved | error
  // 読み込みに成功するまで自動保存しない（失敗時に初期値で上書きしないため）
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const lastSavedJson = useRef(null)

  const { currentAge: _age, ...savedParams } = params
  const settingsJson = JSON.stringify({ params: savedParams, wife, child1, child2, car, home, dog, whatIfs, work, insPayEnd, insReceive, ninkatsu, oneOffs, fundPlan })

  useEffect(() => {
    if (!isGasReady()) return
    setSettingsStatus('loading')
    gasApi.getPJData(SETTINGS_TYPE)
      .then(r => {
        const s = r.data
        if (s) {
          if (s.params) {
            // 退職金はDCに一本化、保険の受け取り年齢は保険ごとの年に変えたので捨てる
            const { retirementBonus: _old, insuranceAge: _oldIns, ...rest } = s.params
            setParams(p => ({ ...p, ...rest }))
          }
          if (s.child1) setChild1(c => ({ ...c, ...s.child1, livingStages: childLivingStages(s.child1) }))
          if (s.child2) setChild2(c => ({ ...c, ...s.child2, livingStages: childLivingStages(s.child2) }))
          if (s.car)    setCar(c => ({ ...c, ...s.car }))
          if (s.dog)    setDog(d => ({ ...d, ...s.dog }))
          if (s.home)   setHome(h => ({ ...h, ...s.home }))
          if (s.wife)   setWife(w => ({ ...w, ...s.wife }))
          if (Array.isArray(s.whatIfs)) setWhatIfs(s.whatIfs.filter(w => whatIfField(w.key)))
          if (s.work) setWork(w => ({ me: { ...w.me, ...s.work.me }, wife: { ...w.wife, ...s.work.wife } }))
          if (s.insPayEnd) setInsPayEnd(s.insPayEnd)
          if (s.insReceive) setInsReceive(s.insReceive)
          if (s.ninkatsu) setNinkatsu(n => ({ ...n, ...s.ninkatsu }))
          if (Array.isArray(s.oneOffs)) setOneOffs(s.oneOffs)
          if (Array.isArray(s.fundPlan)) setFundPlan(s.fundPlan)
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
      setIncomeNote(plan ? `設定タブ ${new Date().getFullYear()}年の給与＋ボーナス` : '設定タブに今年の計画がありません')
      // ときめき＋冒険: 年間タブの年額（4月列に総額が入っている）
      const yutoriAnnual = YUTORI_BUCKETS.reduce((s, name) => s + (Number(plan?.[`支出_${name}`]?.[3]) || 0), 0)
      setYutoriNote(plan ? `設定タブ ${new Date().getFullYear()}年の年額` : '設定タブに今年の計画がありません')

      // 年金: 最新レコード
      const pRecs = (pensionRes?.records || [])
        .sort((a, b) => b['確認年月'].localeCompare(a['確認年月']))
      const pensionMonthly = parseAmt(pRecs[0]?.['受給見込み額(月額)'])

      // 外貨保険: 解約返戻金表と為替を取っておき、返戻予定額は「保険の受け取り年齢」から下の useEffect で計算する
      const usdJpy = rateRes?.rates?.JPY || 150
      const currentAgeNow = new Date().getFullYear() - BIRTH_YEAR
      const { masters: insMasters = [], surrenderValues: svRows = [], payments: insPayments = [] } = insRes || {}
      setInsData({ masters: insMasters, surrenderValues: svRows, payments: insPayments, usdJpy })

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
        fundAssets: totalFunds,
        dcAssets: totalDC,
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
  const { monthlyExpense } = vals

  // ─── 外貨保険（保険ごと） ─────────────────────────
  // 保険ごとに「払込をやめる年」と「受け取る年」を決める（受け取る年の初期値は払込をやめる年）。
  //  ・保険料：払込をやめる年まで「年払い額(USD) × 今の為替」を毎年。今年の年払い記録があれば今年分は払い済みとして来年から
  //  ・返戻金：払込をやめた年の解約返戻金表の一括額で確定し、受け取る年までは増えない（今の為替で円換算）
  //  ・受け取る年を払込をやめる年より前にした場合は、受け取る年で払込もやめる
  const insPolicies = useMemo(() => {
    if (!insData) return []
    const thisYear = new Date().getFullYear()
    const clampYear = (y, fb) => Math.min(thisYear + YEAR_SPAN, Math.max(thisYear, Number(y) || fb))
    const payEndOf = (name) => clampYear(insPayEnd[name] ?? defaultPayEndYear(name, thisYear, params.currentAge), thisYear)
    const receiveOf = (name) => clampYear(insReceive[name] ?? payEndOf(name), payEndOf(name))
    const yearOf = (name) => Math.min(payEndOf(name), receiveOf(name))
    const surrender = Object.fromEntries(surrenderAtYears(insData, yearOf).map(d => [d.name, d]))
    return (insData.masters || []).map(m => {
      const name = m['保険名']
      const usd = parseFloat(String(m['年払い額(USD)'] || '').replace(/[,$\s]/g, '')) || 0
      const paidThisYear = (insData.payments || []).some(x => x['保険名'] === name && toYM(x['年月']).startsWith(String(thisYear)))
      const startYear = paidThisYear ? thisYear + 1 : thisYear
      const endYear = yearOf(name)
      const receiveYear = receiveOf(name)
      const times = usd > 0 ? Math.max(0, endYear - startYear + 1) : 0
      const annual = Math.round(usd * insData.usdJpy)
      const sv = surrender[name] || { usd: 0, method: 'none' }
      return {
        name, usd, annual, startYear, endYear, lastYear: endYear, times, total: annual * times,
        fromAge: params.currentAge + (startYear - thisYear), toAge: params.currentAge + (endYear - thisYear),
        payEndAge: params.currentAge + (endYear - thisYear),
        receiveYear, receiveAge: params.currentAge + (receiveYear - thisYear), linked: insReceive[name] == null,
        method: sv.method, from: sv.from, returnUsd: sv.usd, jpy: Math.round(sv.usd * insData.usdJpy),
      }
    })
  }, [insData, insPayEnd, insReceive, params.currentAge])
  const insuranceReturnTotal = insPolicies.reduce((t, x) => t + x.jpy, 0)
  // 年齢ごとの外貨保険の資産価値（受け取る年まで）。払込中はその年の表の値、払込をやめたあとは確定した金額
  const insuranceValues = useMemo(() => {
    if (!insData || !insPolicies.length) return {}
    const thisYear = new Date().getFullYear()
    const lastYear = Math.max(...insPolicies.map(x => x.receiveYear))
    const byName = Object.fromEntries(insPolicies.map(x => [x.name, x]))
    const out = {}
    for (let y = thisYear; y <= lastYear; y++) {
      const rows = surrenderAtYears(insData, name => Math.min(y, byName[name]?.endYear ?? y))
      const jpy = rows.reduce((t, d) => {
        const pol = byName[d.name]
        return pol && y <= pol.receiveYear ? t + d.usd * insData.usdJpy : t
      }, 0)
      if (jpy > 0) out[params.currentAge + (y - thisYear)] = Math.round(jpy)
    }
    return out
  }, [insData, insPolicies, params.currentAge])
  const insuranceValueNow = insuranceValues[params.currentAge] || 0
  // 合計は LPチェック・AI相談・資産の要約で使う
  useEffect(() => { setVals(v => (v.insuranceReturn === insuranceReturnTotal ? v : { ...v, insuranceReturn: insuranceReturnTotal })) }, [insuranceReturnTotal])

  // ─── 年金（自動計算なら、これからの働き方から計算した額を使う） ───────
  const pensionAuto = useMemo(() => {
    const growth = params.incomeGrowth
    const me = projectPension({
      past: Number(params.pensionPastMe) || vals.pensionMonthly * 12, months: params.pensionMonthsMe,
      ageNow: params.currentAge, startAge: params.pensionStartAge, growth,
      incomeAt: (age) => workIncomeAt(vals.myIncome, work.me, age, params.currentAge, growth),
    })
    const wifeR = projectPension({
      past: Number(params.pensionPastWife) || (Number(params.wifePensionMonthly) || 0) * 12, months: params.pensionMonthsWife,
      ageNow: Number(params.wifeAge), startAge: Number(params.wifePensionStartAge), growth,
      incomeAt: (age, t) => workIncomeAt(wifeIncomeAt(wife, [child1, child2], t), work.wife, age, Number(params.wifeAge), growth),
    })
    return { me, wife: wifeR }
  }, [params, vals.myIncome, vals.pensionMonthly, wife, work, child1, child2])
  const pensionIsAuto   = params.pensionMode === 'auto'
  // あなたは65歳の額（runSim で受給開始の年齢に合わせて増減）、妻は受給開始の年齢の増減を済ませた額
  const pensionMeMonthly   = pensionIsAuto ? Math.round(pensionAuto.me.total / 12) : vals.pensionMonthly
  const pensionWifeMonthly = pensionIsAuto
    ? Math.round(pensionAuto.wife.total * pensionAdjAt(Number(params.wifePensionStartAge)) / 12)
    : params.wifePensionMonthly

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
    fundAssets:      vals.fundAssets,
    dcAssets:        vals.dcAssets,
    dcReceiveAge:    params.dcReceiveAge,
    dcMode:          params.dcMode,
    dcYears:         params.dcYears,
    incomeGrowth:    params.incomeGrowth,
    myIncome:        vals.myIncome,
    wife,
    monthlyFundInvest: vals.monthlyFundInvest,
    monthlyDCInvest: vals.monthlyDCInvest,
    monthlyExpense:  vals.monthlyExpense,
    yutoriAnnual:    vals.yutoriAnnual,
    wifeAge:             params.wifeAge,
    wifePensionMonthly:  pensionWifeMonthly,
    wifePensionStartAge: params.wifePensionStartAge,
    monthlyRent:     params.monthlyRent,
    pensionMonthly:  pensionMeMonthly,
    insuranceLumps:  insPolicies.filter(x => x.jpy > 0).map(x => ({ age: x.receiveAge, amount: x.jpy })),
    retireExpenseRate: params.retireExpenseRate,
    work,
    insurancePremiums: insPolicies.filter(x => x.times > 0),
    insuranceValues,
    childAllowance:  params.childAllowance,
    fundPlan,
  }), [params, vals, wife, work, insPolicies, insuranceValues, fundPlan, pensionMeMonthly, pensionWifeMonthly])

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
    ? { ...home, landPrice: homestPlan.landPrice * 10_000, buildingPrice: homestPlan.buildingPrice * 10_000, downPayment: homestPlan.downPayment * 10_000,
        miscCost: homestPlan.miscCost != null ? homestPlan.miscCost * 10_000 : null }
    : home), [home, homestPlan, homestLinked])

  const events = useMemo(() => ({ child1, child2, car, dog, home: homeEff, ninkatsu, oneOffs }), [child1, child2, car, dog, homeEff, ninkatsu, oneOffs])
  const sim = useMemo(() => runSim(simParams, events), [simParams, events])

  const requiredExtra = useMemo(() => calcRequiredExtra(simParams, events), [simParams, events])

  // 積み上げは0未満を描かない（預金がマイナスの年は合計の線が積み上げより下に来る）
  const chartData = useMemo(() =>
    sim.map(d => ({
      age: d.age, cash: Math.max(0, d.cash), invest: Math.max(0, d.invest), ins: Math.max(0, d.ins || 0),
      dcFree: d.dcLocked ? 0 : Math.max(0, d.dc), dcLock: d.dcLocked ? Math.max(0, d.dc) : 0,
      home: Math.max(0, d.home || 0), short: Math.min(0, d.short || 0),
      total: Math.max(0, d.assets), raw: d,
    })),
    [sim])

  const retireAssets     = sim.find(d => d.age === retireAge)?.assets ?? 0
  const plan             = checkPlan(sim, Number(params.minMonths) || 0, Number(params.targetAtEnd) || 0)
  const homeAtEnd        = sim.length ? sim[sim.length - 1].home : 0
  const zeroAge          = findZeroAge(sim)
  // 月の生活費＝安心＋彩り＋家賃＋ときめき＋冒険の月割り
  const monthlyLiving    = monthlyExpense + params.monthlyRent + vals.yutoriAnnual / 12
  const wifeIncomeNow    = wifeIncomeAt(wife, [child1, child2], 0)
  // 家計の収支（積立は使ったお金ではないので引かない）と、預金の増減（投信積立の分だけ預金から投資へ移る）
  const householdNow     = vals.myIncome + wifeIncomeNow - monthlyLiving * 12
  const fundInvestAnnual = sim[0]?.fundInvest ?? vals.monthlyFundInvest * 12
  const annualSurplusNow = householdNow - fundInvestAnnual
  // 子どもが生まれる前は、妻の手取りを0円として計算している
  const wifeBeforeBirth  = [child1, child2].some(c => c.enabled) &&
    Math.max(...[child1, child2].filter(c => c.enabled).map(c => Number(c.currentAge))) < 0
  const totalPension     = pensionMeMonthly + pensionWifeMonthly
  // 退職後の住居費（今の物価・月額）。シミュレーションと同じく、マイホーム購入後は家賃を止めて維持費とローン返済を入れる
  const retireT          = retireAge - params.currentAge
  const homeOn           = homeEff.enabled && Number(homeEff.yearsFromNow) <= retireT
  const homeLoanEndAge   = homeOn ? params.currentAge + Number(homeEff.yearsFromNow) + Number(homeEff.loanYears) : null
  const homeLoanMonthly  = homeOn
    ? annualLoanPayment(loanPrincipal(homeEff), homeEff.loanRate, Number(homeEff.loanYears)) / 12
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
    params, vals, wife, work, assumptions: MODEL_ASSUMPTIONS,
    dataMeta: { ...dataMeta, insurance: insPolicies, premiums: insPolicies.filter(x => x.usd > 0) },
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
      plan, homeAtEnd, minMonths: Number(params.minMonths) || 0, targetAtEnd: Number(params.targetAtEnd) || 0,
      homeLoanMonthly,
    },
  }

  const checks = { data: dataChecks(lp), plan: planChecks(lp) }
  const minMonthsN = Number(params.minMonths) || 0
  const targetN = Number(params.targetAtEnd) || 0
  const judge = useMemo(() => (series) => checkPlan(series, minMonthsN, targetN), [minMonthsN, targetN])
  const whatIfResults = useMemo(
    () => runWhatIfs(simParams, events, runSim, whatIfs, judge),
    [simParams, events, whatIfs, judge])
  // ③ 合格するための条件（打ち手ごとに、どこまで変えれば合格するか）
  const seeks = useMemo(
    () => (plan.ok ? [] : seekAll(simParams, events, runSim, judge)),
    [plan.ok, simParams, events, judge])
  const addWhatIf = (key, value) => setWhatIfs(ws => [
    ...ws.filter(w => w.key !== key),
    { id: `w${Date.now()}`, key, value },
  ])

  // AI相談に渡す内容（毎年の推移は大きいので外す）
  const { series: _series, ...resultsForAI } = lp.results
  const aiContext = {
    today: toYM(new Date().toISOString()),
    lp: { ...lp, results: resultsForAI },
    dataChecks: checks.data,
    planChecks: checks.plan,
    seeks: seeks.map(x => ({ label: x.label, unit: x.unit, from: x.from, to: x.to, status: x.status })),
    whatIfs: {
      rows: whatIfs.map((w, i) => {
        const f = whatIfField(w.key)
        const r = whatIfResults.rows[i]
        return { label: f?.label || w.key, unit: f?.unit || '', value: w.value, endAge: r.endAge, ...r.s }
      }),
      all: whatIfResults.all ? { endAge: whatIfResults.all.endAge, ...whatIfResults.all.s } : null,
    },
  }

  const setP = (key) => (v) => setParams(p => ({ ...p, [key]: v }))
  const setV = (key) => (v) => setVals(p => ({ ...p, [key]: v }))
  const dcAtRetire = sim.find(d => d.age === retireAge)?.dc ?? 0
  // 投信の計画（未設定なら資産タブの積立額を退職まで）
  const fundPlanRows = fundPlan ?? [{ id: 'auto', kind: 'invest', fromAge: params.currentAge, toAge: params.retireAge - 1, amount: vals.monthlyFundInvest }]

  const lifeEventSummary = [
    child1.enabled && `子1（${child1.currentAge}歳）`,
    child2.enabled && `子2（${child2.currentAge}歳）`,
    car.enabled && '車',
    dog.enabled && '犬',
    home.enabled && `家（${home.yearsFromNow}年後）`,
    ninkatsu.enabled && '妊活',
    oneOffs.length > 0 && `臨時${oneOffs.length}件`,
  ].filter(Boolean).join('・') || 'なし'

  // ─── レンダリング ────────────────────────────────
  // 結論 → 考える（LPチェック・AI相談）→ 前提（話題ごとの入力）の順
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

      {/* 結論 */}
      <div className="sim-section">
        <div className={`sim-pass ${plan.ok ? 'sim-pass--ok' : 'sim-pass--ng'}`}>
          <p className="sim-pass-title">{plan.ok ? '✅ 合格ラインを満たしています' : '❌ 合格ラインに届いていません'}</p>
          <ul className="sim-pass-list">
            <li>{plan.lowYears.length === 0 ? '✓' : '✗'} 手元のお金（預金＋投信＋外貨保険）が生活費の{params.minMonths}か月分を割らない
              {plan.lowYears.length > 0 && <strong>：{plan.lowRanges.join('・')}で下回る</strong>}</li>
            <li>{plan.endOk ? '✓' : '✗'} {plan.endAge}歳で使えるお金が{fmt(params.targetAtEnd)}以上残る
              <strong>：{fmtSign(plan.endAssets)}</strong></li>
          </ul>
          {!plan.ok && seeks.length > 0 && (
            <details className="sim-seek" open>
              <summary>🎯 合格するには（どれか1つだけ変えるなら）</summary>
              <ul className="sim-seek-list">
                {seeks.map(x => (
                  <li key={x.key} className={x.status === 'ok' ? '' : 'sim-seek-none'}>
                    <span className="sim-seek-label">{x.label}</span>
                    {x.status === 'ok' ? (
                      <>
                        <span className="sim-seek-val">{x.fmt(x.from)} → <strong>{x.fmt(x.to)}</strong></span>
                        <button type="button" className="sim-seek-add" onClick={() => addWhatIf(x.key, x.to)}>もしも比較に追加</button>
                      </>
                    ) : (
                      <span className="sim-seek-val">これだけでは届かない（{x.fmt(x.limit)}まで変えても）</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="sim-pass-note">1つで届かなくても、いくつかを少しずつ変えると合格できることがあります。「もしも比較に追加」で入れて、LPチェックのもしも比較の「全部あわせると」で確かめられます。</p>
            </details>
          )}
          <p className="sim-pass-note">
            {plan.maxShort < 0 ? `崩せるものを全部崩しても、最大で${fmt(-plan.maxShort)}足りません（グラフの赤）。` : ''}
            {homeAtEnd > 0 ? `家の純資産は${plan.endAge}歳で約${man(homeAtEnd)}（使えるお金には入れていません）。` : ''}
            合格ラインは「家族と経済の前提」で変えられます。
          </p>
        </div>
        <div className="sim-check-grid sim-conclusion">
          <SumCard
            label="資産が尽きる年齢"
            value={zeroAge ? `${zeroAge}歳` : `${lifeExpectancy}歳までもつ ✓`}
            sub={requiredExtra > 0 ? `定年まで毎月あと${fmt(requiredExtra)}貯めれば${lifeExpectancy}歳までもつ` : 'ライフイベント込み'}
            pos={!zeroAge} neg={!!zeroAge} />
          <SumCard
            label="退職直前の資産"
            value={fmtSign(retireAssets)}
            sub={`${retireAge}歳時点（${dcAtRetire > 0 ? `うちDC ${man(dcAtRetire)}` : `DCは${params.dcReceiveAge}歳で受け取り済み`}）`}
            pos={retireAssets > 0} neg={retireAssets <= 0} />
          <SumCard
            label="今年の家計の収支"
            value={fmtSign(householdNow)}
            sub={`手取り あなた ${fmt(vals.myIncome)} ＋ 妻 ${fmt(wifeIncomeNow)}${wifeBeforeBirth ? '（出産前は0円）' : ''} − 生活費 ${fmt(monthlyLiving * 12)}。` +
              (fundInvestAnnual
                ? `投信積立 ${fmt(fundInvestAnnual)} を引くと、預金は年 ${annualSurplusNow < 0 ? '▲' : '+'}${fmt(annualSurplusNow)}（積立分は投資に移るだけ）`
                : '')}
            pos={householdNow > 0} neg={householdNow <= 0} />
          <SumCard
            label="退職後の月の不足"
            value={monthlyShortfall > 0 ? `▲${fmt(monthlyShortfall)}` : '不足なし ✓'}
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
        </div>
      </div>

      {/* 資産推移グラフ */}
      <div className="sim-section">
        <div className="sim-chart-head">
          <h3 className="sim-section-title">資産推移</h3>
          <button type="button" className="lpy-btn" onClick={chartFull.open}>⛶ 最大化</button>
        </div>
        <div ref={chartFull.ref} className={chartFull.full ? 'lpy-full' : ''}>
        {chartFull.full && (
          <div className="lpy-toolbar">
            <span className="lpy-unit">資産推移（スマホは横向きにすると見やすくなります）</span>
            <button type="button" className="lpy-btn" onClick={chartFull.close}>✕ 閉じる</button>
          </div>
        )}
        <div className={`sim-chart-wrap${chartFull.full ? ' sim-chart-wrap--full' : ''}`}>
          <ResponsiveContainer width="100%" height={chartFull.full ? '100%' : 300}>
            <ComposedChart data={chartData} margin={{ top: 14, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ebebeb" vertical={false} />
              <XAxis dataKey="age" tickFormatter={v => `${v}歳`} tick={{ fontSize: 11 }}
                interval="preserveStartEnd" />
              <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11 }} width={48} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#888', strokeDasharray: '3 3' }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}
                formatter={v => <span style={{ color: '#57606a' }}>{v}</span>}
                payload={[
                  ...SERIES.filter(sr => !sr.optional || chartData.some(x => x[sr.key] > 0))
                    .map(sr => ({ value: sr.name, type: 'square', color: sr.usable ? sr.color : `${sr.color}66`, id: sr.key })),
                  { value: '足りない額', type: 'square', color: SHORT_COLOR, id: 'short' },
                  { value: '使えるお金の合計', type: 'line', color: '#1f2328', id: 'total' },
                ]} />
              {SERIES.map(sr => (
                <Area key={sr.key} type="monotone" dataKey={sr.key} name={sr.name} stackId="assets"
                  fill={sr.color} fillOpacity={sr.usable ? 0.8 : 0.3} stroke="#fff" strokeWidth={1.5} isAnimationActive={false} />
              ))}
              <Area type="monotone" dataKey="short" name="足りない額" fill={SHORT_COLOR} fillOpacity={0.75} stroke="#fff" strokeWidth={1.5} isAnimationActive={false} />
              <ReferenceLine y={0} stroke="#888" />
              <Line type="monotone" dataKey="total" name="使えるお金の合計" stroke="#1f2328" strokeWidth={2} dot={false} isAnimationActive={false} />
              <ReferenceLine x={retireAge} stroke="#003087" strokeDasharray="5 3"
                label={{ value: `定年 ${retireAge}歳`, position: 'insideTopRight', fontSize: 10, fill: '#003087' }} />
              {zeroAge && (
                <ReferenceLine x={zeroAge} stroke="#e74c3c" strokeDasharray="5 3"
                  label={{ value: `枯渇 ${zeroAge}歳`, position: 'insideBottomLeft', fontSize: 10, fill: '#e74c3c' }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        </div>
      </div>

      {/* 年ごとの表（開閉式・全画面） */}
      <LPYearTable sim={sim} wifeAge={params.wifeAge} kids={[child1, child2]} />

      {/* LPチェック（AIなし） */}
      <LPCheck checks={checks} results={whatIfResults} simParams={simParams} events={events}
        whatIfs={whatIfs} setWhatIfs={setWhatIfs} />

      {/* AI相談 */}
      <AIChat context={aiContext} />

      {/* ─── 前提（入力） ─── */}
      <div className="sim-premise-head">
        前提
        <span className="sim-section-note">
          {settingsStatus !== 'idle' ? SETTINGS_STATUS_LABEL[settingsStatus] : '「取得」の値はデータ再取得で入ります（手で上書きも可）'}
        </span>
      </div>

      <Section icon="👪" title="家族と経済の前提"
        summary={`あなた${params.currentAge}歳・妻${params.wifeAge}歳／寿命${lifeExpectancy}歳／物価${params.inflationRate}%・利回り${params.returnRate}%`}>
        <div className="sim-fields">
          <Field label="あなたの年齢" unit="歳" value={params.currentAge} onChange={setP('currentAge')} />
          <Field label="妻の年齢" unit="歳" value={params.wifeAge} onChange={setP('wifeAge')} />
          <Field label="想定寿命" unit="歳" note="ここまでシミュレーション" value={params.lifeExpectancy} onChange={setP('lifeExpectancy')} />
          <Field label="物価上昇率" unit="% / 年" note="日銀の物価目標2%" value={params.inflationRate} onChange={setP('inflationRate')} />
          <Field label="投資の想定利回り" unit="% / 年" note="投信・DC" value={params.returnRate} onChange={setP('returnRate')} />
          <Field label="預金金利" unit="% / 年" value={params.cashRate} onChange={setP('cashRate')} />
        </div>
        <div className="sim-subhead">合格ライン</div>
        <div className="sim-fields">
          <Field label="手元のお金の下限" unit="か月分" note="預金＋投信＋外貨保険が、その年の生活費の何か月分を割らないか" value={params.minMonths} onChange={setP('minMonths')} />
          <Field label="最後に残したい額" unit="円" note={`想定寿命（${lifeExpectancy}歳）の年の使えるお金`} wide value={params.targetAtEnd} onChange={setP('targetAtEnd')} />
        </div>
      </Section>

      <Section icon="💼" title="収入と働き方"
        summary={`あなた${man(vals.myIncome)}・妻${man(wifeIncomeNow)}／定年${retireAge}歳／${work.me.reducedFrom}歳から${work.me.reducedRate}%`}>
        <div className="sim-fields">
          <Field label="あなたの手取り年収" unit="円 / 年" note={incomeNote} fetched wide value={vals.myIncome} onChange={setV('myIncome')} />
          <Field label="収入の伸び率" unit="% / 年" note="昇給。夫婦の手取りに、昇給が止まる年齢まで" value={params.incomeGrowth} onChange={setP('incomeGrowth')} />
          <Field label="定年（退職予定年齢）" unit="歳" note="積立・DC掛金が止まり、生活費が退職後の割合になる" value={params.retireAge} onChange={setP('retireAge')} />
        </div>
        <div className="sim-subhead">妻の手取り年収 <span className="sim-section-note">末っ子の成長に合わせて上乗せ（子どもがいない・生まれる前は全額）</span></div>
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
              今年の妻の手取り {fmt(wifeIncomeNow)}（ライフイベントの子どもの年齢で計算。子どもをオフにすると全額）
            </p>
          </div>
        </div>
        <div className="sim-subhead">60歳以降の働き方 <span className="sim-section-note">夫婦それぞれの年齢で</span></div>
        <div className="sim-events">
          <WorkFields title="あなた" w={work.me} ageNow={params.currentAge}
            onChange={patch => setWork(x => ({ ...x, me: { ...x.me, ...patch } }))}
            incomeAt={age => workIncomeAt(vals.myIncome, work.me, age, params.currentAge, params.incomeGrowth)} />
          <WorkFields title="妻" w={work.wife} ageNow={params.wifeAge}
            onChange={patch => setWork(x => ({ ...x, wife: { ...x.wife, ...patch } }))}
            incomeAt={age => workIncomeAt(wifeIncomeAt(wife, [child1, child2], age - params.wifeAge), work.wife, age, params.wifeAge, params.incomeGrowth)} />
          <p className="sim-ef-note">
            金額は手取りの年額。65歳以降の年収は物価では増やしません。働きながら年金を受け取っても減らさない前提です（在職老齢年金は考えない）。
          </p>
        </div>
      </Section>

      <Section icon="🛒" title="支出"
        summary={`月${man1(monthlyLiving)}（退職後 月${man1(retireLiving)}）`}>
        <div className="sim-fields">
          <Field label="生活費（安心＋彩り）" unit="円 / 月" note={expenseNote} fetched wide value={vals.monthlyExpense} onChange={setV('monthlyExpense')} />
          <Field label="ときめき＋冒険" unit="円 / 年" note={yutoriNote} fetched wide value={vals.yutoriAnnual} onChange={setV('yutoriAnnual')} />
          <Field label="家賃" unit="円 / 月" note="マイホーム購入後は不要（ライフイベント）" wide value={params.monthlyRent} onChange={setP('monthlyRent')} />
          <Field label="退職後の生活費" unit="%" note="現役時に対する割合。家賃は対象外" value={params.retireExpenseRate} onChange={setP('retireExpenseRate')} />
        </div>
        <p className="sim-ef-note sim-section-foot">
          今の月の生活費 {fmt(monthlyLiving)}（生活費＋家賃＋ときめき冒険の月割り）／ 退職後 {fmt(retireLiving)}（今の物価で）
        </p>
      </Section>

      <Section icon="🏦" title="資産と積立"
        summary={`預金${man(vals.cashAssets)}・投信${man(vals.fundAssets)}・DC${man(vals.dcAssets)}・保険${man(insuranceValueNow)}`}>
        <div className="sim-fields">
          <Field label="預金" unit="円" note="預金金利で増える" fetched wide value={vals.cashAssets} onChange={setV('cashAssets')} />
          <Field label="投資信託" unit="円" note="評価額。預金と保険が尽きたら取り崩す" fetched wide value={vals.fundAssets} onChange={setV('fundAssets')} />
        </div>
        <FundPlan rows={fundPlanRows} isAuto={!fundPlan} onChange={setFundPlan} onReset={() => setFundPlan(null)}
          ageNow={params.currentAge} retireAge={params.retireAge} />
        <div className="sim-subhead">DC（企業型確定拠出年金）＝退職金 <span className="sim-section-note">受け取るまでは取り崩せない</span></div>
        <div className="sim-fields">
          <Field label="DC評価額" unit="円" fetched wide value={vals.dcAssets} onChange={setV('dcAssets')} />
          <Field label="DC掛金" unit="円 / 月" note="会社＋自己（給与天引き）。定年まで" fetched wide value={vals.monthlyDCInvest} onChange={setV('monthlyDCInvest')} />
          <Field label="受け取る年齢" unit="歳" note="60〜75歳" value={params.dcReceiveAge} onChange={setP('dcReceiveAge')} />
          <Choice label="受け取り方" note={params.dcMode === 'annuity' ? '毎年に分けて預金へ' : '全額を投資へ移す'}
            options={[['lump', '一時金'], ['annuity', '年金']]} value={params.dcMode} onChange={setP('dcMode')} />
          {params.dcMode === 'annuity' && (
            <Field label="年金で受け取る年数" unit="年" note="5〜20年" value={params.dcYears} onChange={setP('dcYears')} />
          )}
        </div>
        <div className="sim-subhead">外貨保険 <span className="sim-section-note">保険ごとに、払込をやめる年と受け取る年を決める</span></div>
        {insPolicies.length === 0 ? (
          <p className="sim-ef-note">外貨保険のデータがありません（データ再取得、または資産タブの外貨保険で登録）</p>
        ) : (
          <div className="sim-events">
            <div className="sim-event-body sim-work">
              {insPolicies.map(x => (
                <div key={x.name} className="sim-ef sim-ins">
                  <span className="sim-ef-label"><strong>{x.name}</strong><span className="sim-badge">取得</span></span>
                  <div className="sim-ef-row sim-work-row">
                    <YearInput value={x.endYear} onCommit={y => setInsPayEnd(m => ({ ...m, [x.name]: y }))} />
                    <span className="sim-ef-unit">年（{x.payEndAge}歳）まで払う</span>
                  </div>
                  <div className="sim-ef-row sim-work-row">
                    <YearInput value={x.receiveYear} onCommit={y => setInsReceive(m => ({ ...m, [x.name]: y }))} />
                    <span className="sim-ef-unit">年（{x.receiveAge}歳）に解約して受け取る{x.linked ? '（払込をやめる年と同じ）' : ''}</span>
                    {!x.linked && (
                      <button type="button" className="sim-link-btn"
                        onClick={() => setInsReceive(m => Object.fromEntries(Object.entries(m).filter(([k]) => k !== x.name)))}>払込と同じ年に戻す</button>
                    )}
                  </div>
                  <span className="sim-ef-note">
                    保険料：{x.usd > 0
                      ? (x.times > 0 ? `年 ${fmt(x.annual)}（$${x.usd.toLocaleString()}）× ${x.startYear}〜${x.endYear}年の${x.times}回 ＝ ${fmt(x.total)}` : 'もう払わない')
                      : '年払い額なし'}
                  </span>
                  <span className="sim-ef-note">
                    返戻金：{x.jpy > 0
                      ? `${x.endYear}年の ${fmt(x.jpy)}（$${Math.round(x.returnUsd).toLocaleString()}・${{ exact: '表の値', interp: '前後の年から推計', nearest: '表の範囲外のため近い年の値' }[x.method] || ''}）を${x.receiveYear > x.endYear ? `増やさずに${x.receiveYear}年に` : 'その年に'}受け取る`
                      : '解約返戻金表がない（資産タブの外貨保険で入力）'}
                  </span>
                </div>
              ))}
              <p className="sim-ef-note">
                今解約した場合 {fmt(insuranceValueNow)}／受け取る返戻金の合計 {fmt(insuranceReturnTotal)}。受け取るまでも「今解約したらもらえる額」を資産に数えます（資産推移の黄色）。
                金額は払込をやめた年の解約返戻金表（保険simu）の値で決まり、受け取るまでは増えない前提です。今年の年払い記録がある保険は、今年分を払い済みとして来年から数えます。円換算は今の為替のまま。
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section icon="🧓" title="年金"
        summary={`夫婦で月${man1(totalPension)}（あなた${pensionStartAge}歳〜／妻${params.wifePensionStartAge}歳〜）`}>
        <div className="sim-fields">
          <Choice label="年金の見込み額" note={pensionIsAuto ? '定期便のこれまでの分＋これからの働き方で計算' : 'ねんきん定期便の見込み額を入れる'}
            options={[['auto', '自動計算'], ['manual', '見込み額を入れる']]} value={params.pensionMode || 'manual'} onChange={setP('pensionMode')} />
          {pensionIsAuto ? (<>
            <Field label="あなた：これまでの加入実績の年金額" unit="円 / 年" wide
              note={`ねんきん定期便の額（年額）。0なら資産タブの見込み額×12（${fmt(vals.pensionMonthly * 12)}）`}
              value={params.pensionPastMe} onChange={setP('pensionPastMe')} />
            <Field label="あなた：これまでの加入月数" unit="か月" note="定期便の「加入期間の合計」。0なら20歳から切れ目なく"
              value={params.pensionMonthsMe} onChange={setP('pensionMonthsMe')} />
            <Field label="妻：これまでの加入実績の年金額" unit="円 / 年" wide note="妻のねんきん定期便の額（年額）"
              value={params.pensionPastWife} onChange={setP('pensionPastWife')} />
            <Field label="妻：これまでの加入月数" unit="か月" note="0なら20歳から切れ目なく"
              value={params.pensionMonthsWife} onChange={setP('pensionMonthsWife')} />
          </>) : (<>
            <Field label="あなたの年金" unit="円 / 月" note="資産タブの年金（ねんきん定期便）より" fetched wide value={vals.pensionMonthly} onChange={setV('pensionMonthly')} />
            <Field label="妻の年金" unit="円 / 月" note="ねんきん定期便の見込み額" wide value={params.wifePensionMonthly} onChange={setP('wifePensionMonthly')} />
          </>)}
          <Field label="あなたの受給開始" unit="歳" note="60〜75歳。65歳より遅いと1か月0.7%増、早いと0.4%減"
            value={params.pensionStartAge} onChange={setP('pensionStartAge')} />
          <Field label="妻の受給開始" unit="歳（妻の年齢）" note={pensionIsAuto ? '自動計算では、あなたと同じく早い・遅いで増減' : ''}
            value={params.wifePensionStartAge} onChange={setP('wifePensionStartAge')} />
        </div>
        {pensionIsAuto && (
          <div className="sim-ef-note sim-pension-auto">
            {[['あなた', pensionAuto.me, params.pensionStartAge], ['妻', pensionAuto.wife, params.wifePensionStartAge]].map(([who, r, st]) => (
              <p key={who}>
                <strong>{who}</strong>（受給開始{st}歳まで）：65歳の額 年{fmt(r.total)}（月{fmt(r.total / 12)}）
                ＝ これまで {fmt(r.past)} ＋ これからの厚生年金 {fmt(r.kosei)} ＋ 基礎年金 {fmt(r.kiso)}
              </p>
            ))}
            <p>額面は手取り÷0.77で推計、基礎年金の満額は月69,308円で計算。受給開始より後に働いた分は入れていません。今の賃金水準の金額です</p>
          </div>
        )}
        <p className="sim-ef-note sim-section-foot">
          夫婦の年金 月{fmt(totalPension)}（今の物価で。シミュレーションでは物価上昇率で増やす）
        </p>
      </Section>

      <Section icon="🏠" title="ライフイベント" summary={lifeEventSummary}>
        <div className="sim-events">
          <ChildEvent label="👶 子供1" state={child1} onChange={setChild1} />
          <ChildEvent label="👶 子供2" state={child2} onChange={setChild2} />
          {(child1.enabled || child2.enabled) && (
            <label className="sim-ef sim-ef--check">
              <input type="checkbox" checked={params.childAllowance !== false}
                onChange={e => setParams(p => ({ ...p, childAllowance: e.target.checked }))} />
              <span className="sim-ef-label">児童手当を収入に入れる（0〜2歳 月1.5万・3〜18歳 月1万）</span>
            </label>
          )}

          <div className="sim-event">
            <button
              className={`sim-event-toggle${ninkatsu.enabled ? ' active' : ''}`}
              onClick={() => setNinkatsu(p => ({ ...p, enabled: !p.enabled }))}>
              🍼 妊活
            </button>
            {ninkatsu.enabled && (
              <div className="sim-event-body">
                <EventNumField label="始まり" unit="年後（0で今年）"
                  value={ninkatsu.yearsFromNow} onChange={v => setNinkatsu(p => ({ ...p, yearsFromNow: v }))} />
                <EventNumField label="続ける年数" unit="年"
                  value={ninkatsu.years} onChange={v => setNinkatsu(p => ({ ...p, years: v }))} />
                <EventNumField label="費用" unit="円 / 年" wide
                  value={ninkatsu.annual} onChange={v => setNinkatsu(p => ({ ...p, annual: v }))} />
              </div>
            )}
          </div>

          <div className="sim-event">
            <button
              className={`sim-event-toggle${oneOffs.length ? ' active' : ''}`}
              onClick={() => { if (!oneOffs.length) setOneOffs([newOneOff()]) }}>
              📝 臨時の収入・支出
            </button>
            {oneOffs.length > 0 && <OneOffs rows={oneOffs} onChange={setOneOffs} />}
          </div>

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
                <DogBreakdown size={dog.size} />
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
                {homeEff.miscCost != null
                  ? <p className="sim-ef-note">諸経費 {fmt(homeEff.miscCost)}（「家」タブで入力した額。借入金に入れる）</p>
                  : <EventNumField label="諸経費" unit="% （物件価格に対して。借入金に入れる。「家」タブで金額を入れるとそちらを使う）"
                      value={home.feeRate} onChange={v => setHome(p => ({ ...p, feeRate: v }))} />}
                <EventNumField label="ローン期間" unit="年"
                  value={home.loanYears} onChange={v => setHome(p => ({ ...p, loanYears: v }))} />
                <EventNumField label="ローン金利" unit="% / 年"
                  value={home.loanRate} onChange={v => setHome(p => ({ ...p, loanRate: v }))} />
                <p className="sim-ef-note">
                  固定資産税・都市計画税（自動計算）：1〜3年目 年{fmt(propertyTaxAt(homeEff, 0))} ／ 4年目 年{fmt(propertyTaxAt(homeEff, 3))} ／ 20年目 年{fmt(propertyTaxAt(homeEff, 19))}。
                  土地は価格の70%、建物は建築費の60%（毎年少しずつ下がる）を評価額とし、住宅用地の特例と新築3年間の減額を入れた目安
                </p>
                <EventNumField label="保険・点検など（固定資産税以外）" unit="円 / 月"
                  value={home.monthlyCost} onChange={v => setHome(p => ({ ...p, monthlyCost: v }))} />
                <EventNumField label="大規模修繕の間隔" unit="年ごと（0でなし）"
                  value={home.repairEvery} onChange={v => setHome(p => ({ ...p, repairEvery: v }))} />
                <EventNumField label="修繕費用（1回）" unit="円" wide
                  value={home.repairCost} onChange={v => setHome(p => ({ ...p, repairCost: v }))} />
                <EventNumField label="土地の値上がり率" unit="% / 年（0で価値そのまま）"
                  value={home.landGrowth} onChange={v => setHome(p => ({ ...p, landGrowth: v }))} />
                <EventNumField label="建物の耐用年数" unit="年（この年数で残存割合まで減る）"
                  value={home.buildingLife} onChange={v => setHome(p => ({ ...p, buildingLife: v }))} />
                <EventNumField label="建物の残存割合" unit="%（耐用年数後に残る価値）"
                  value={home.buildingResidual} onChange={v => setHome(p => ({ ...p, buildingResidual: v }))} />
                <EventNumField label="ローン控除の借入限度額" unit="円（省エネ3,000万・ZEH3,500万・長期優良4,500万、子育て世帯は上乗せ。0で控除なし）" wide
                  value={home.deductLimit ?? 30_000_000} onChange={v => setHome(p => ({ ...p, deductLimit: v }))} />
                <EventNumField label="ローン控除の期間" unit="年（新築は13年）"
                  value={home.deductYears ?? 13} onChange={v => setHome(p => ({ ...p, deductYears: v }))} />
                <label className="sim-ef sim-ef--check">
                  <input type="checkbox" checked={home.stopRent}
                    onChange={e => setHome(p => ({ ...p, stopRent: e.target.checked }))} />
                  <span className="sim-ef-label">購入後は家賃（{fmt(params.monthlyRent)}/月）がなくなる</span>
                </label>
                <p className="sim-ef-note">
                  物件価格 {fmt(homePrice(homeEff))} ／ 諸経費 {fmt(homeFee(homeEff))} ／ 借入金 {fmt(loanPrincipal(homeEff))} ／ 月々のローン返済 {fmt(annualLoanPayment(loanPrincipal(homeEff), homeEff.loanRate, homeEff.loanYears) / 12)}
                  （価格は購入時の金額。ローン返済額は物価上昇させない。修繕費は物価上昇込み）
                </p>
              </div>
            )}
          </div>
        </div>
      </Section>

    </div>
  )
}
