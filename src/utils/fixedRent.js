import { FIXED_RENT } from '../config/budget'

// 家賃は毎月定額。手入力の現金行は抜けや重複があるので、集計では各月 FIXED_RENT の1行に置き換える
// （明細データ自体は変更しない。集計用の配列にだけ使う）
export function withFixedRent(transactions) {
  const months = new Set(transactions.map(t => /^\d{4}\/\d{2}/.exec(t.date || '')?.[0]).filter(Boolean))
  const rentRows = [...months].map(m => ({
    id: `fixed-rent-${m}`,
    date: `${m}/01`,
    description: '家賃（定額）',
    amount: FIXED_RENT,
    rawAmount: FIXED_RENT,
    category: '家賃',
    fixedRent: true,
  }))
  return [...transactions.filter(t => t.category !== '家賃'), ...rentRows]
}
