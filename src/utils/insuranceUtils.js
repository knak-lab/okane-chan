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
