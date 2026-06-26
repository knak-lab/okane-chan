export function parsePayPayCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())

  // タブ区切りかカンマ区切りか自動判定
  const delimiter = lines[0]?.includes('\t') ? '\t' : ','

  // ヘッダー行を探す
  const headerIndex = lines.findIndex((line) =>
    line.includes('取引日') || line.includes('利用日') || line.includes('日付')
  )
  if (headerIndex === -1) return []

  const headers = lines[headerIndex].split(delimiter).map((h) => h.trim())
  return parseLines(lines, headerIndex + 1, headers, delimiter)
}

function parseLines(lines, startIndex, headers, delimiter) {
  const rows = []
  for (let i = startIndex; i < lines.length; i++) {
    const cols = lines[i].split(delimiter)
    if (cols.length < 2) continue

    // 列インデックスをヘッダーから検索
    const dateKey   = headers.findIndex((h) => h.includes('取引日') || h.includes('利用日') || h.includes('日付'))
    const descKey   = headers.findIndex((h) => h.includes('取引先') || h.includes('内容') || h.includes('決済先') || h.includes('相手'))
    const amountKey = headers.findIndex((h) => h.includes('出金') || h.includes('金額'))

    const date        = cols[dateKey   >= 0 ? dateKey   : 0]?.trim() || ''
    const description = cols[descKey   >= 0 ? descKey   : 1]?.trim() || ''
    const rawAmount   = cols[amountKey >= 0 ? amountKey : 2]?.trim() || '0'
    const amount      = parseAmount(rawAmount)

    if (!description || amount === 0) continue

    rows.push({
      id: `row-${i}`,
      date: formatDate(date),
      description,
      amount: Math.abs(amount),
      rawAmount: amount,
    })
  }
  return rows
}

function parseAmount(str) {
  if (!str || str === '-') return 0
  const cleaned = str.replace(/[¥,\s]/g, '').replace('▲', '-').replace('－', '-')
  return Number(cleaned) || 0
}

function formatDate(str) {
  const m = str.match(/(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})/)
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`
  return str
}