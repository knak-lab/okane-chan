export function parsePayPayCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())

  // タブ区切りかカンマ区切りか自動判定
  const delimiter = lines[0]?.includes('\t') ? '\t' : ','

  // 1行目はヘッダーなのでスキップ
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter)
    if (cols.length < 9) continue

    // PayPay CSV列定義（固定）:
    // 0:取引日, 1:出金金額, 2:入金金額, 3:海外出金金額
    // 4:通貨, 5:変換レート, 6:利用国, 7:取引内容, 8:取引先
    const rawDate   = cols[0]?.trim() || ''
    const rawAmount = cols[1]?.trim() || '0'
    const description = cols[8]?.trim() || ''

    // 金額：カンマと¥を除去して数値化
    const amount = Number(rawAmount.replace(/[,¥\s]/g, '')) || 0

    // 出金のみ対象（入金や0円はスキップ）
    if (!description || amount === 0) continue

    // 日付：「2026/06/25 20:00:06」→「2026/06/25」
    const dateMatch = rawDate.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    const date = dateMatch
      ? `${dateMatch[1]}/${dateMatch[2].padStart(2,'0')}/${dateMatch[3].padStart(2,'0')}`
      : rawDate

    rows.push({
      id: `row-${i}`,
      date,
      description,
      amount,
      rawAmount: amount,
    })
  }
  return rows
}