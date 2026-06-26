// GASウェブアプリのURLをここに設定
// デプロイ後に発行されるURLを貼り付ける
// 例: 'https://script.google.com/macros/s/AKfycb.../exec'
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
  // URLSearchParams で送信（CORS preflight 回避）
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: JSON.stringify(body) }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'API error')
  return json
}

export const gasApi = {
  // 保存済み月の一覧を取得
  getMonths: () => get('getMonths'),

  // 指定月の取引データを取得
  getTransactions: (month) => get('getTransactions', { month }),

  // 取引データを保存（月は日付から自動抽出・上書き）
  saveTransactions: (transactions) => post({ action: 'saveTransactions', transactions }),

  // 指定月のデータを削除
  clearMonth: (month) => post({ action: 'clearMonth', month }),
}
