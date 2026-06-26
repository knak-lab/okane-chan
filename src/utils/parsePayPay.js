export function parsePayPayCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())
  const delimiter = lines[0]?.includes('\t') ? '\t' : ','

  // ヘッダー行をスキップ（1行目がヘッダー）
  const startIndex = 1

  return parseLines(lines, startIndex, delimiter)
}

function parseLines(lines, startIndex, delimiter) {
  const rows = []
  for (let i = startIndex; i < lines.length; i++) {
    const cols = lines[i].split(delimiter)
    if (cols.length < 9) continue

    // PayPay CSV列定義（固定）:
    // 0: 取引日, 1: 出金金額, 2: 入金金額, 3: 海外出金,
    // 4: 通貨, 5: レート, 6: 利用国, 7: 取引内容, 8: 取引先
    const date        = cols[0]?.trim() || ''
    const rawAmount   = cols[1]?.trim() || '0'
    const description = cols[8]?.trim() || cols[7]?.trim() || ''
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
  const m = str.match(/(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/)
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`
  return str
}