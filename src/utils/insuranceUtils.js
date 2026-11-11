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

// 指定の年齢で解約したときの一括返戻金（USD）を、保険simuと同じ解約返戻金表（解約年度ごとの一括額）から求める。
// 解約年度 = 受け取る年 − 開始年（何年目の終わりか）。表にその年度がなければ前後の年度から直線で補間し、
// 表の範囲外なら一番近い年度の値を使う。
// 戻り値: [{ name, policyYear, usd, method: 'exact' | 'interp' | 'nearest' }]
export function surrenderAtAge({ masters = [], surrenderValues = [] }, age, currentAge, thisYear = new Date().getFullYear()) {
  const receiveYear = thisYear + (age - currentAge)
  return masters.map(m => {
    const name = m['保険名']
    const startYear = parseInt(String(m['開始年月'] || '').split('/')[0]) || thisYear
    const policyYear = receiveYear - startYear
    const svs = surrenderValues
      .filter(s => s['保険名'] === name)
      .map(s => ({ year: parseFloat(s['解約年度']) || 0, usd: parseFloat(s['一括額(USD)']) || 0 }))
      .filter(s => s.usd > 0)
      .sort((a, b) => a.year - b.year)
    if (!svs.length) return { name, policyYear, usd: 0, method: 'none' }
    const exact = svs.find(s => s.year === policyYear)
    if (exact) return { name, policyYear, usd: exact.usd, method: 'exact' }
    const lo = [...svs].reverse().find(s => s.year < policyYear)
    const hi = svs.find(s => s.year > policyYear)
    if (lo && hi) {
      const usd = lo.usd + (hi.usd - lo.usd) * (policyYear - lo.year) / (hi.year - lo.year)
      return { name, policyYear, usd, method: 'interp', from: [lo.year, hi.year] }
    }
    const near = lo || hi
    return { name, policyYear, usd: near.usd, method: 'nearest', from: [near.year] }
  })
}
