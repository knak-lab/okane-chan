// =============================================================
//  LPチェック：AIを使わずに、LPタブの入力と計算結果から決まったルールで判定する
//  ① データの過不足  ② プランのリスク判定  ③ もしも比較（条件を変えて計算し直す）
// =============================================================

export const yen = (n) => `¥${Math.round(Math.abs(Number(n) || 0)).toLocaleString()}`
const man = (n) => `${Math.round((Number(n) || 0) / 10_000).toLocaleString()}万円`

// "2026-06" / "2026/06/01" / "2026/6" → "2026-06"
export const toYM = (s) => {
  const m = String(s || '').match(/(\d{4})[/-](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : ''
}
// 今月から何か月前か（不明なら null）
export const monthsAgo = (ym) => {
  const m = toYM(ym).match(/(\d{4})-(\d{2})/)
  if (!m) return null
  const now = new Date()
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]))
}

export const STALE_MONTHS = 3          // 残高・評価額がこれ以上前なら「古い」
export const OPTIMISTIC_RETURN = 4     // 想定利回りがこれを超えたら「楽観的」
export const EMERGENCY_MONTHS = 6      // 預金が生活費のこの月数を下回ったら注意

// ─── ① データの過不足 ───────────────────────────────
// lp: { params, vals, wife, events, dataMeta }
export function dataChecks(lp) {
  const { params: p, vals: v, wife, events: ev, dataMeta: dm = {} } = lp
  const out = []
  const add = (level, text) => out.push({ level, text })

  if (dm.failedFetches?.length) add('ng', `取得に失敗したデータ: ${dm.failedFetches.join('・')}`)

  // 資産
  if (!v.cashAssets)   add('ng', '預金が0円（資産タブ未入力、または取得失敗）')
  if (!v.dcAssets) add('warn', 'DC（退職金）の評価額が0円（DCの記録が未入力？）')
  for (const a of dm.assets || []) {
    const ago = monthsAgo(a.month)
    if (ago != null && ago >= STALE_MONTHS) add('warn', `口座「${a.name}」の残高が${ago}か月前（${toYM(a.month)}）のまま`)
  }
  for (const f of [
    ...(dm.funds || []).map(x => ({ ...x, label: `投信「${x.name}」` })),
    ...(dm.dc || []).map(x => ({ ...x, label: `DC「${x.name}」` })),
  ]) {
    const ago = monthsAgo(f.month)
    if (!f.month) add('warn', `${f.label}の評価額の記録がない`)
    else if (ago >= STALE_MONTHS) add('warn', `${f.label}の評価額が${ago}か月前（${toYM(f.month)}）のまま`)
  }

  // 収入・支出
  if (!v.myIncome) add('ng', dm.hasAnnualPlan === false
    ? 'あなたの手取り年収が0円（年間タブに今年の給与・ボーナス計画がない）'
    : 'あなたの手取り年収が0円')
  if (!v.monthlyExpense) add('ng', '生活費（安心＋彩り）が0円（取引データなし？）')
  else if (dm.expenseMonthsUsed != null && dm.expenseMonthsUsed < 12)
    add('warn', `生活費の平均が${dm.expenseMonthsUsed}か月分しかない（季節の変動を拾いきれない）`)
  if (!v.yutoriAnnual) add('warn', 'ときめき＋冒険（年額）が0円（年間タブ未入力？）')
  if (!p.monthlyRent && !(ev.home?.enabled && ev.home?.stopRent)) add('warn', '家賃が0円で、マイホームもオフ')

  // 年金・退職金
  if (!v.pensionMonthly) add('ng', 'あなたの年金見込み額が0円（年金タブ未入力）')
  else {
    const ago = monthsAgo(dm.pensionYearMonth)
    if (ago != null && ago >= 12) add('warn', `年金見込み額の確認が${Math.floor(ago / 12)}年以上前（${dm.pensionYearMonth}）`)
  }
  if (!p.wifePensionMonthly) add('warn', '妻の年金が0円（ねんきん定期便の見込み額が未入力）')

  // 妻の収入
  const stagesAdd = (wife.stages || []).reduce((s, st) => s + (Number(st.add) || 0), 0)
  if (!Number(wife.base) && !stagesAdd) add('warn', '妻の手取り年収が基本・段階ともに0円')

  // 保険
  if (dm.insurancePolicies && !v.insuranceReturn) add('warn', '保険はあるが返戻予定額が0円（解約返戻金テーブル未入力？）')
  for (const d of dm.insurance || []) {
    if (d.method === 'none') add('warn', `保険「${d.name}」の解約返戻金表がない（サマリタブの外貨保険で入力）`)
    else if (d.method === 'nostart') add('warn', `保険「${d.name}」は開始年月が未入力で、解約年度（何年目）を西暦に直せない（開始年月を入れるか、解約年度を西暦で入力）`)
    else if (d.method === 'interp') add('info', `保険「${d.name}」は払込をやめる${d.endYear}年の返戻金が表になく、${d.from[0]}年と${d.from[1]}年から推計`)
    else if (d.method === 'nearest') add('warn', `保険「${d.name}」は払込をやめる${d.endYear}年が表の範囲外のため、${d.from[0]}年の値で代用`)
  }
  if (dm.usdJpyFallback && v.insuranceReturn) add('warn', '為替レートが取得できず USD/JPY=150 の仮値で換算')

  // ライフイベント
  if (ev.home?.enabled && !ev.homestLinked) add('info', 'マイホームの価格・頭金は「家」タブと連携しておらず手入力値')
  for (const [k, label] of [['child1', '第1子'], ['child2', '第2子']]) {
    const c = ev[k]
    if (c?.enabled && Number(c.currentAge) >= 22) add('info', `${label}は${c.currentAge}歳で教育費の計算対象外`)
  }
  if (!['child1', 'child2', 'car', 'dog', 'home'].some(k => ev[k]?.enabled))
    add('info', 'ライフイベントがすべてオフ')

  return out
}

// ─── ② プランのリスク判定 ─────────────────────────────
// r: SimTab で計算済みの値（results）
export function planChecks(lp) {
  const { params: p, vals: v, results: r } = lp
  const out = []
  const add = (level, text) => out.push({ level, text })

  if (r.zeroAge) add('ng', `資産が${r.zeroAge}歳で尽きる（想定寿命 ${p.lifeExpectancy}歳）`)

  const incomeBreakdown = `手取り あなた ${yen(v.myIncome)} ＋ 妻 ${yen(r.wifeIncomeNow)} − 生活費 ${yen(r.monthlyLiving * 12)}`
  const wifeNote = r.wifeBeforeBirth ? '。妻の手取りは子どもが生まれる前なので0円で計算' : ''
  if (r.householdNow < 0) {
    add('warn', `今年の家計が赤字（▲${yen(r.householdNow)}/年：${incomeBreakdown}）${wifeNote}`)
  } else if (r.annualSurplusNow < 0) {
    add('info', `家計は黒字（+${yen(r.householdNow)}/年）だが、投信積立 ${yen(r.fundInvestAnnual)}/年 の方が多く、預金は年 ▲${yen(r.annualSurplusNow)} 減る（積立分は投資に移るだけで、資産全体は減らない）${wifeNote}`)
  }

  if (r.monthlyShortfall > 0) {
    const parts = [['生活費', r.retireLivingBase], ['住居費', r.retireHousing]].sort((a, b) => b[1] - a[1])
    add('warn', `退職後は毎月 ${yen(r.monthlyShortfall)} の赤字（生活費 ${yen(r.retireLivingBase)} ＋ 住居費 ${yen(r.retireHousing)} − 年金 ${yen(r.totalPension)}）。一番大きいのは${parts[0][0]}`)
  }

  if (r.homeLoanEndAge && r.homeLoanEndAge > p.retireAge) {
    const years = Math.min(r.homeLoanEndAge, p.lifeExpectancy) - p.retireAge
    add('warn', `住宅ローンが${r.homeLoanEndAge}歳まで続き、退職後に約${man(r.homeLoanMonthly * 12 * years)}（月 ${yen(r.homeLoanMonthly)} × ${years}年）を払う`)
  }

  if (Number(p.retireExpenseRate) === 100) add('info', '退職後の生活費が現役時の100%のまま（初期値）。下がる想定なら割合を見直す')

  if (Number(p.returnRate) > OPTIMISTIC_RETURN) add('warn', `投資の想定利回り ${p.returnRate}% はやや楽観的（${OPTIMISTIC_RETURN}%以下だとどうなるか、もしも比較で確認）`)

  if (p.retireAge < p.pensionStartAge) add('warn', `${p.retireAge}〜${p.pensionStartAge}歳の${p.pensionStartAge - p.retireAge}年間はあなたの年金がない`)

  // 合格ライン（手元のお金・最後に残る額）と、崩しても足りない額
  if (r.plan?.lowYears?.length) add('warn', `手元のお金（預金＋投信＋外貨保険）が生活費の${r.minMonths}か月分を下回る：${r.plan.lowRanges.join('・')}`)
  if (r.plan && !r.plan.endOk) add('warn', `${r.plan.endAge}歳で使えるお金が ${yen(r.plan.endAssets)}（残したい額 ${yen(r.targetAtEnd)} に届かない）`)
  if (r.plan?.maxShort < 0) add('ng', `預金・投信・外貨保険を崩しても、最大で ${yen(r.plan.maxShort)} 足りない（グラフの赤）`)

  const premiumLeft = (lp.dataMeta?.premiums || []).filter(x => x.times > 0)
  if (premiumLeft.length) {
    const total = premiumLeft.reduce((s, x) => s + x.total, 0)
    const last = Math.max(...premiumLeft.map(x => x.lastYear))
    add('info', `外貨保険の保険料が、${last}年までにあと合計 約${man(total)}（${premiumLeft.map(x => `${x.name} 年${yen(x.annual)}`).join('・')}）。今の為替で計算`)
  }
  const insBeforeRetire = (lp.dataMeta?.insurance || []).filter(x => x.receiveAge < p.retireAge).reduce((s, x) => s + (x.jpy || 0), 0)
  if (insBeforeRetire && r.retireAssets > 0 && insBeforeRetire / r.retireAssets >= 0.3)
    add('info', `退職直前の資産の${Math.round(insBeforeRetire / r.retireAssets * 100)}%が、定年までに受け取る保険返戻金（${yen(insBeforeRetire)}）。為替で大きく動く`)

  return out
}

// ─── ③ もしも比較 ───────────────────────────────────
// target: 'p' は runSim の引数（simParams）、'home' はライフイベントのマイホーム
export const WHATIF_FIELDS = [
  { key: 'dcReceiveAge',      label: 'DCを受け取る年齢',     unit: '歳',   target: 'p' },
  { key: 'monthlyDCInvest',   label: 'DCの掛金',             unit: '円/月', target: 'p' },
  { key: 'retireExpenseRate', label: '退職後の生活費',       unit: '%',    target: 'p' },
  { key: 'retireAge',         label: '退職年齢',             unit: '歳',   target: 'p' },
  { key: 'pensionStartAge',   label: '年金受給開始年齢',     unit: '歳',   target: 'p' },
  { key: 'pensionMonthly',    label: 'あなたの年金',         unit: '円/月', target: 'p' },
  { key: 'wifePensionMonthly', label: '妻の年金',            unit: '円/月', target: 'p' },
  { key: 'returnRate',        label: '投資の想定利回り',     unit: '%/年', target: 'p' },
  { key: 'inflationRate',     label: '物価上昇率',           unit: '%/年', target: 'p' },
  { key: 'incomeGrowth',      label: '収入の伸び率',         unit: '%/年', target: 'p' },
  { key: 'myIncome',          label: 'あなたの手取り年収',   unit: '円/年', target: 'p' },
  { key: 'monthlyExpense',    label: '生活費（安心＋彩り）', unit: '円/月', target: 'p' },
  { key: 'yutoriAnnual',      label: 'ときめき＋冒険',       unit: '円/年', target: 'p' },
  { key: 'monthlyRent',       label: '家賃',                 unit: '円/月', target: 'p' },
  { key: 'monthlyFundInvest', label: '投信積立',             unit: '円/月', target: 'p' },
  { key: 'extraSaving',       label: '追加の積立',           unit: '円/月', target: 'p' },
  { key: 'lifeExpectancy',    label: '想定寿命',             unit: '歳',   target: 'p', simKey: 'endAge' },
  { key: 'meRaiseStopAge',    label: 'あなたの昇給が止まる年齢', unit: '歳',  target: 'work', who: 'me',   field: 'raiseStopAge' },
  { key: 'meReducedRate',     label: 'あなたの減額後の給料',  unit: '%',    target: 'work', who: 'me',   field: 'reducedRate' },
  { key: 'meLateIncome',      label: 'あなたの65歳以降の年収', unit: '円/年', target: 'work', who: 'me',   field: 'lateIncome' },
  { key: 'meLateUntil',       label: 'あなたが働くのをやめる年齢', unit: '歳', target: 'work', who: 'me',   field: 'lateUntil' },
  { key: 'wifeReducedRate',   label: '妻の減額後の給料',      unit: '%',    target: 'work', who: 'wife', field: 'reducedRate' },
  { key: 'wifeLateIncome',    label: '妻の65歳以降の年収',    unit: '円/年', target: 'work', who: 'wife', field: 'lateIncome' },
  { key: 'wifeLateUntil',     label: '妻が働くのをやめる年齢', unit: '歳',   target: 'work', who: 'wife', field: 'lateUntil' },
  { key: 'homeTotal',         label: '家の予算（土地＋建物）', unit: '円',  target: 'homeTotal' },
  { key: 'loanYears',         label: 'ローン期間',           unit: '年',   target: 'home' },
  { key: 'loanRate',          label: 'ローン金利',           unit: '%/年', target: 'home' },
  { key: 'downPayment',       label: '頭金',                 unit: '円',   target: 'home' },
  { key: 'yearsFromNow',      label: '家の購入時期',         unit: '年後', target: 'home' },
]
export const whatIfField = (key) => WHATIF_FIELDS.find(f => f.key === key)

// 今の値（もしも欄に新しく追加したときの初期値に使う）
export function currentValue(key, simParams, events) {
  const f = whatIfField(key)
  if (!f) return 0
  if (f.target === 'home') return Number(events.home?.[key]) || 0
  if (f.target === 'homeTotal') return (Number(events.home?.landPrice) || 0) + (Number(events.home?.buildingPrice) || 0)
  if (f.target === 'work') return Number(simParams.work?.[f.who]?.[f.field]) || 0
  return Number(simParams[f.simKey || key]) || 0
}

export const DEFAULT_WHATIFS = [
  { id: 'w1', key: 'dcReceiveAge',      value: 65 },
  { id: 'w2', key: 'retireExpenseRate', value: 80 },
  { id: 'w3', key: 'loanYears',         value: 25 },
  { id: 'w4', key: 'returnRate',        value: 3 },
]

// 条件（複数可）を当てはめた simParams / events を返す
export function applyWhatIfs(simParams, events, conds) {
  const p = { ...simParams }
  const ev = { ...events, home: { ...events.home } }
  for (const c of conds) {
    const f = whatIfField(c.key)
    if (!f) continue
    if (f.target === 'home') ev.home[c.key] = Number(c.value) || 0
    else if (f.target === 'homeTotal') {
      // 土地と建物の比率はそのままで、合計を指定した額にする
      const land = Number(ev.home.landPrice) || 0, bld = Number(ev.home.buildingPrice) || 0
      const k = land + bld > 0 ? (Number(c.value) || 0) / (land + bld) : 0
      ev.home.landPrice = land * k
      ev.home.buildingPrice = bld * k
    }
    else if (f.target === 'work') {
      p.work = { ...p.work, [f.who]: { ...p.work?.[f.who], [f.field]: Number(c.value) || 0 } }
    } else p[f.simKey || c.key] = Number(c.value) || 0
  }
  return { simParams: p, events: ev }
}

// シミュレーション結果の要約（もしも比較の表に使う）
export function summarize(series, retireAge, judge) {
  let zeroAge = null
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].assets > 0 && series[i].assets <= 0) { zeroAge = series[i].age; break }
  }
  return {
    zeroAge,
    retireAssets: series.find(d => d.age === retireAge)?.assets ?? 0,
    endAssets: series.length ? series[series.length - 1].assets : 0,
    pass: judge ? judge(series).ok : undefined,
  }
}

// 今のプランと、もしも条件ごと（＋全部あわせて）の結果をまとめて計算する
export function runWhatIfs(simParams, events, simulate, whatIfs, judge) {
  const run = (conds) => {
    const a = applyWhatIfs(simParams, events, conds)
    return { s: summarize(simulate(a.simParams, a.events), a.simParams.retireAge, judge), endAge: a.simParams.endAge }
  }
  return {
    base: run([]),
    rows: whatIfs.map(w => run([w])),
    all: whatIfs.length >= 2 ? run(whatIfs) : null,
  }
}

// 合格ライン：①手元のお金（預金＋投信＋外貨保険。DCと家は除く）が生活費の○か月分を割らない ②最後の年に○円以上残る
export function checkPlan(series, minMonths, target) {
  const lowYears = series.filter(d => {
    const handy = d.cash + d.invest + d.ins
    return handy < (d.expense || 0) / 12 * minMonths
  }).map(d => d.age)
  const last = series[series.length - 1]
  const endOk = last ? last.assets >= target : true
  // 連続した年齢をまとめる（44〜59歳 など）
  const ranges = []
  for (const a of lowYears) {
    const r = ranges[ranges.length - 1]
    if (r && a === r[1] + 1) r[1] = a
    else ranges.push([a, a])
  }
  return {
    ok: lowYears.length === 0 && endOk,
    lowYears, lowRanges: ranges.map(([a, b]) => (a === b ? `${a}歳` : `${a}〜${b}歳`)),
    endAge: last?.age, endAssets: last?.assets ?? 0, endOk,
    maxShort: Math.min(0, ...series.map(d => d.short || 0)),
  }
}

// ─── ③ 合格するための条件（逆算） ─────────────────────
// 打ち手ごとに、今の値から「limit」に向けて動かしたとき、合格する一番近い値を二分探索で探す。
// （その打ち手だけを変えた場合。値が大きいほど良い打ち手は up、小さいほど良い打ち手は down）
const yenFmt = (v) => `¥${Math.round(v).toLocaleString()}`
const manFmt = (v) => `${Math.round(v / 10_000).toLocaleString()}万円`
const LEVERS = [
  { key: 'homeTotal',         label: '家の予算（土地＋建物）',  limit: c => c * 0.5, step: 100_000, fmt: manFmt, needHome: true },
  { key: 'monthlyExpense',    label: '今の生活費（安心＋彩り）', limit: c => c * 0.6, step: 1_000,   fmt: v => `月${yenFmt(v)}` },
  { key: 'retireExpenseRate', label: '退職後の生活費',          limit: () => 50,      step: 1,       fmt: v => `${Math.round(v)}%` },
  { key: 'meReducedRate',     label: 'あなたの60歳からの給料',   limit: () => 100,     step: 1,       fmt: v => `${Math.round(v)}%` },
  { key: 'meLateIncome',      label: 'あなたの65歳以降の年収',   limit: () => 6_000_000, step: 10_000, fmt: v => `年${manFmt(v)}` },
  { key: 'meLateUntil',       label: 'あなたが働くのをやめる年齢', limit: () => 75,    step: 1,       fmt: v => `${Math.round(v)}歳` },
  { key: 'pensionStartAge',   label: 'あなたの年金の受給開始',   limit: () => 75,      step: 1,       fmt: v => `${Math.round(v)}歳` },
  { key: 'extraSaving',       label: '支出を減らして定年まで積み立てる額', limit: () => 500_000, step: 1_000,  fmt: v => `月${yenFmt(v)}` },
]

export function seekAll(simParams, events, simulate, judge) {
  const passWith = (key, value) => {
    const a = applyWhatIfs(simParams, events, [{ key, value }])
    return judge(simulate(a.simParams, a.events)).ok
  }
  const out = []
  for (const lv of LEVERS) {
    if (lv.needHome && !events.home?.enabled) continue
    const from = currentValue(lv.key, simParams, events)
    const limit = lv.limit(from)
    if (Math.abs(limit - from) < lv.step) continue
    const f = whatIfField(lv.key)
    const row = { key: lv.key, label: lv.label, unit: f?.unit || '', from, limit, fmt: lv.fmt }
    if (!passWith(lv.key, limit)) { out.push({ ...row, status: 'none' }); continue }
    let ng = from, ok = limit  // ng 側は不合格、ok 側は合格
    for (let i = 0; i < 40 && Math.abs(ok - ng) > lv.step; i++) {
      const mid = (ng + ok) / 2
      if (passWith(lv.key, mid)) ok = mid
      else ng = mid
    }
    // 刻みに丸める（合格する側へ）
    const up = limit > from
    const to = up ? Math.ceil(ok / lv.step) * lv.step : Math.floor(ok / lv.step) * lv.step
    out.push({ ...row, status: 'ok', to: passWith(lv.key, to) ? to : ok })
  }
  // 届くものを先に、変える割合が小さい順
  return out.sort((a, b) => (a.status === b.status
    ? Math.abs((a.to ?? a.limit) - a.from) / Math.max(1, Math.abs(a.limit - a.from)) - Math.abs((b.to ?? b.limit) - b.from) / Math.max(1, Math.abs(b.limit - b.from))
    : a.status === 'ok' ? -1 : 1))
}
