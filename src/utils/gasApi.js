import { categorize } from './categorize'
import { withIdToken } from '../auth/googleAuth'
import { enqueue, supersede, setOutboxSender } from './outbox'

export const GAS_URL = import.meta.env.VITE_GAS_URL || ''
export const isGasReady = () => Boolean(GAS_URL)

async function get(action, params = {}) {
  if (!GAS_URL) throw new Error('GAS_URLが設定されていません')
  const json = await withIdToken(async (idToken) => {
    const url = new URL(GAS_URL)
    url.searchParams.set('action', action)
    url.searchParams.set('id_token', idToken)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString())
    return res.json()
  })
  if (!json.ok) throw new Error(json.error || 'API error')
  return json
}

// 通信できなかった・サーバーが落ちていたなど、あとで送り直せば通る失敗
function retryable(message) {
  const e = new Error(message)
  e.retryable = true
  return e
}

async function post(body) {
  if (!GAS_URL) throw new Error('GAS_URLが設定されていません')
  const json = await withIdToken(async (idToken) => {
    let res
    try {
      res = await fetch(GAS_URL, {
        method: 'POST',
        body: new URLSearchParams({ data: JSON.stringify({ ...body, id_token: idToken }) }),
      })
    } catch {
      throw retryable('通信できませんでした')
    }
    try { return await res.json() } catch { throw retryable(`サーバーの応答が不正です（${res.status}）`) }
  })
  if (!json.ok) {
    if (/^unauthorized|unavailable/i.test(String(json.error || ''))) throw retryable(json.error)
    throw new Error(json.error || 'API error')
  }
  return json
}
setOutboxSender(post)

// 送れなかったら未送信の箱に入れて、あとで自動で送り直す保存。
// 同じ内容を2回送っても結果が変わらない保存（上書き保存）だけに使う
async function postOrQueue(body, key, label) {
  try {
    const json = await post(body)
    supersede(key)
    return json
  } catch (e) {
    if (!e.retryable) throw e
    enqueue({ key, label, body, error: e.message })
    return { ok: true, queued: true }
  }
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
  getLastImportedAt: () => get('getLastImportedAt'),

  getTransactions: async (month) => {
    const r = await get('getTransactions', { month })
    return { ...r, transactions: (r.transactions || []).map(addDerived) }
  },

  saveTransactions: (transactions) => {
    // category（英語キー）→ 'カテゴリ'（GAS列名）に変換して送信
    const rows = transactions.map((t) => ({ ...t, 'カテゴリ': t.category || '' }))
    return post({ action: 'saveTransactions', transactions: rows })
  },

  // 同じ取引番号の支払い行とポイント行を区別するため、取引日・金額も送って行を特定する
  updateTransactionCategory: (t, category) =>
    postOrQueue({
      action: 'updateTransactionCategory',
      txId: t.id,
      category,
      match: {
        '取引日':         t['取引日'],
        '出金金額（円）': t['出金金額（円）'],
        '入金金額（円）': t['入金金額（円）'],
      },
    }, `cat:${[t.id, t['取引日'], t['出金金額（円）'], t['入金金額（円）']].join('|')}`, `カテゴリ変更：${t.description || t.id}`),

  clearMonth: (month) => post({ action: 'clearMonth', month }),

  getAssets: () => get('getAssets'),
  saveAssets: (assets) => post({ action: 'saveAssets', assets }),

  getAnnualPlan: (year) => get('getAnnualPlan', { year }),
  saveAnnualPlan: (year, plan) => postOrQueue({ action: 'saveAnnualPlan', year, plan }, `plan:${year}`, `年間計画 ${year}年`),

  getPJData: (type) => get('getPJData', { type }),
  savePJData: (type, data) => postOrQueue({ action: 'savePJData', type, data }, `pj:${type}`, `設定（${type}）`),

  getCategoryRules: () => get('getCategoryRules'),
  saveCategoryRules: (rules) => post({ action: 'saveCategoryRules', rules }),
  addCategoryRule: (keyword, category) => post({ action: 'addCategoryRule', keyword, category }),
  addCategoryRules: (rules) => post({ action: 'addCategoryRules', rules }),
  deleteCategoryRule: (keyword) => post({ action: 'deleteCategoryRule', keyword }),

  getInsurances: () => get('getInsurances'),
  saveInsurances: (data) => postOrQueue({ action: 'saveInsurances', ...data }, 'insurances', '保険'),

  getInvestmentFunds: () => get('getInvestmentFunds'),
  saveInvestmentFunds: (data) => postOrQueue({ action: 'saveInvestmentFunds', ...data }, 'funds', '投資信託'),

  getDCAccounts: () => get('getDCAccounts'),
  saveDCAccounts: (data) => postOrQueue({ action: 'saveDCAccounts', ...data }, 'dc', 'DC'),

  getPensionData: () => get('getPensionData'),
  savePensionData: (records) => postOrQueue({ action: 'savePensionData', records }, 'pension', '年金'),

  aiChat: (chat) => post({ action: 'aiChat', chat }),
}
