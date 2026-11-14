// 外貨保険: GAS flat rows ↔ React nested state 変換

export function fromGas({ masters = [], surrenderValues = [], payments = [] }) {
  let _n = 0
  const nid = () => String(_n++)
  return masters.map(m => ({
    id: nid(),
    name: m['保険名'] || '',
    startMonth: m['開始年月'] || '',
    annualPremiumUSD: m['年払い額(USD)'] || '',
    currency: 'USD',
    surrenderValues: surrenderValues
      .filter(s => s['保険名'] === m['保険名'])
      .map(s => ({
        id: nid(),
        year: s['解約年度'] || '',
        lumpSumUSD: s['一括額(USD)'] || '',
        installmentYears: s['分割年数'] || '',
        installmentAmtUSD: s['分割額(USD/年)'] || '',
      })),
    payments: payments
      .filter(p => p['保険名'] === m['保険名'])
      .map(p => ({
        id: nid(),
        yearMonth: p['年月'] || '',
        amtUSD: p['支払額(USD)'] || '',
        rate: p['為替レート'] || '',
        amtJPY: p['円換算額'] || '',
      })),
  }))
}

export function toGas(insurances) {
  const masters = insurances.map(ins => ({
    '保険名': ins.name,
    '開始年月': ins.startMonth,
    '年払い額(USD)': ins.annualPremiumUSD,
    '通貨': 'USD',
  }))
  const surrenderValues = insurances.flatMap(ins =>
    ins.surrenderValues.map(s => ({
      '保険名': ins.name,
      '解約年度': s.year,
      '一括額(USD)': s.lumpSumUSD,
      '分割年数': s.installmentYears,
      '分割額(USD/年)': s.installmentAmtUSD,
    }))
  )
  const payments = insurances.flatMap(ins =>
    ins.payments.map(p => ({
      '年月': p.yearMonth,
      '保険名': ins.name,
      '支払額(USD)': p.amtUSD,
      '為替レート': p.rate,
      '円換算額': p.amtJPY,
    }))
  )
  return { masters, surrenderValues, payments }
}

// 累計支払額（円）計算: 記録のamtJPY優先、なければrate×USD、なければcurrentRate×USD
export function calcCumulativeJPY(payments, currentRate) {
  return payments.reduce((sum, p) => {
    const jpy = parseFloat(p.amtJPY)
    if (jpy > 0) return sum + jpy
    const usd = parseFloat(p.amtUSD) || 0
    const r   = parseFloat(p.rate) || currentRate || 0
    return sum + usd * r
  }, 0)
}

// 解約年度は「何年目」（1, 2, …）でも「西暦」（2046, 2047, …）でも入力できる。1900以上なら西暦とみなす
export const isCalendarYear = (y) => Number(y) >= 1900
export const surrenderYearLabel = (y) => (isCalendarYear(y) ? `${y}年` : `${y}年目`)

// 指定の年齢で解約したときの一括返戻金（USD）を、保険simuと同じ解約返戻金表（解約年度ごとの一括額）から求める。
// 受け取る年（西暦）にそろえて表を引く。「何年目」の行は 開始年 ＋ 年目 で西暦に直す（開始年月が必要）。
// 表にその年がなければ前後の年から直線で補間し、表の範囲外なら一番近い年の値を使う。
// 戻り値: [{ name, receiveYear, usd, method: 'exact' | 'interp' | 'nearest' | 'none' | 'nostart', from: [西暦…] }]
export function surrenderAtAge(data, age, currentAge, thisYear = new Date().getFullYear()) {
  const receiveYear = thisYear + (age - currentAge)
  return surrenderAtYears(data, () => receiveYear)
}

// 保険ごとに受け取る年（西暦）を決めて引く版。yearOf(保険名) → 受け取る年
export function surrenderAtYears({ masters = [], surrenderValues = [] }, yearOf) {
  return masters.map(m => {
    const name = m['保険名']
    const receiveYear = Number(yearOf(name))
    const startYear = parseInt(String(m['開始年月'] || '').split(/[/-]/)[0]) || null
    const rows = surrenderValues
      .filter(s => s['保険名'] === name)
      .map(s => ({ year: parseFloat(s['解約年度']) || 0, usd: parseFloat(String(s['一括額(USD)']).replace(/[,$\s]/g, '')) || 0 }))
      .filter(s => s.usd > 0 && s.year > 0)
    if (!rows.length) return { name, receiveYear, usd: 0, method: 'none' }
    const svs = rows
      .map(s => ({ cal: isCalendarYear(s.year) ? s.year : (startYear ? startYear + s.year : null), usd: s.usd }))
      .filter(s => s.cal != null)
      .sort((a, b) => a.cal - b.cal)
    if (!svs.length) return { name, receiveYear, usd: 0, method: 'nostart' }
    const exact = svs.find(s => s.cal === receiveYear)
    if (exact) return { name, receiveYear, usd: exact.usd, method: 'exact' }
    const lo = [...svs].reverse().find(s => s.cal < receiveYear)
    const hi = svs.find(s => s.cal > receiveYear)
    if (lo && hi) {
      const usd = lo.usd + (hi.usd - lo.usd) * (receiveYear - lo.cal) / (hi.cal - lo.cal)
      return { name, receiveYear, usd, method: 'interp', from: [lo.cal, hi.cal] }
    }
    const near = lo || hi
    return { name, receiveYear, usd: near.usd, method: 'nearest', from: [near.cal] }
  })
}

// あなたの生年（LPタブと保険simuで共通）
export const BIRTH_YEAR = 1984

// 外貨保険の払込をやめる年の初期値（LP設定に保存した値があればそちらを使う）
// kkr の保険はあなたが60歳になる年まで、acco の保険は5年後まで（2026年11月に聞いた内容）
export function defaultPayEndYear(name, thisYear, currentAge) {
  return /acco/i.test(name) ? thisYear + 5 : thisYear + (60 - currentAge)
}

// LP設定（insPayEnd / insReceive）から、その保険の「実際に払込をやめる年」を返す。
// 受け取る年を払込をやめる年より前にしていれば、受け取る年で払込もやめる
export function effectivePayEndYear(name, lpSettings, thisYear, currentAge) {
  const payEnd = Math.max(thisYear, Number(lpSettings?.insPayEnd?.[name] ?? defaultPayEndYear(name, thisYear, currentAge)) || thisYear)
  const receive = Math.max(thisYear, Number(lpSettings?.insReceive?.[name] ?? payEnd) || payEnd)
  return Math.min(payEnd, receive)
}

// 今年の年払い記録があれば今年分は払い済みとして、次に払う年を返す
export function nextUnpaidYear(name, payments, thisYear) {
  const paid = (payments || []).some(p => (p['保険名'] ?? p.name) === name
    && String(p['年月'] ?? p.yearMonth ?? '').replace('/', '-').startsWith(String(thisYear)))
  return paid ? thisYear + 1 : thisYear
}
