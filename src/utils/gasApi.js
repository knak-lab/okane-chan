import { categorize } from './categorize'

export const GAS_URL = import.meta.env.VITE_GAS_URL || ''
export const isGasReady = () => Boolean(GAS_URL)

async function get(action, params = {}) {
  if (!GAS_URL) throw new Error('GAS_URLが設定されていません')
  const url = new URL(GAS_URL)
  url.searchParams.set('action', action)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'API error')
  return json
}

async function post(body) {
  if (!GAS_URL) throw new Error('GAS_URLが設定されていません')
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: JSON.stringify(body) }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'API error')
  return json
}

function parseAmt(s) {
  if (!s || s === '-') return 0
  return Number(String(s).replace(/[,¥\s]/g, '')) || 0
}

function toDate(s) {
  const m = String(s || '').match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  return m ? `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}` : String(s || '')
}

// GASから返ってきた生PayPay列データにReact用の導出フィールドを付与する
function addDerived(t) {
  const out = parseAmt(t['出金金額（円）'])
  const inn = parseAmt(t['入金金額（円）'])
  const isIncome = inn > 0
  const isPoint  = (t['取引内容'] || '').includes('ポイント')
  const noDesc   = !t['取引先'] || t['取引先'] === '-'
  const desc     = (isIncome || isPoint || noDesc) ? (t['取引内容'] || '') : (t['取引先'] || '')
  // シートに保存済みカテゴリがあればそれを使い、なければ自動分類
  const savedCat = t['カテゴリ'] || ''
  const derivedCat = isPoint ? 'ポイント' : (isIncome ? '収入・相殺' : categorize(desc))
  const cat = savedCat || derivedCat
  return {
    ...t,
    id:              t['取引番号'] || '',
    date:            toDate(t['取引日']),
    description:     desc || t['取引内容'] || t['取引先'] || '',
    amount:          isIncome ? -inn : out,
    rawAmount:       isIncome ? -inn : out,
    category:        cat,
    defaultCategory: derivedCat,
  }
}

export const gasApi = {
  getMonths: () => get('getMonths'),

  getTransactions: async (month) => {
    const r = await get('getTransactions', { month })
    return { ...r, transactions: (r.transactions || []).map(addDerived) }
  },

  saveTransactions: (transactions) => {
    // category（英語キー）→ 'カテゴリ'（GAS列名）に変換して送信
    const rows = transactions.map((t) => ({ ...t, 'カテゴリ': t.category || '' }))
    return post({ action: 'saveTransactions', transactions: rows })
  },

  clearMonth: (month) => post({ action: 'clearMonth', month }),

  getAssets: () => get('getAssets'),
  saveAssets: (assets) => post({ action: 'saveAssets', assets }),

  getAnnualPlan: (year) => get('getAnnualPlan', { year }),
  saveAnnualPlan: (year, plan) => post({ action: 'saveAnnualPlan', year, plan }),

  getPJData: (type) => get('getPJData', { type }),
  savePJData: (type, data) => post({ action: 'savePJData', type, data }),

  getCategoryRules: () => get('getCategoryRules'),
  saveCategoryRules: (rules) => post({ action: 'saveCategoryRules', rules }),

  getInsurances: () => get('getInsurances'),
  saveInsurances: (data) => post({ action: 'saveInsurances', ...data }),

  getInvestmentFunds: () => get('getInvestmentFunds'),
  saveInvestmentFunds: (data) => post({ action: 'saveInvestmentFunds', ...data }),

  getDCAccounts: () => get('getDCAccounts'),
  saveDCAccounts: (data) => post({ action: 'saveDCAccounts', ...data }),

  getPensionData: () => get('getPensionData'),
  savePensionData: (records) => post({ action: 'savePensionData', records }),

  diagnose: (diagData) => post({ action: 'diagnose', diagData }),
}
