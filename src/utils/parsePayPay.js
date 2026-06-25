export function parsePayPayCSV(text) {
  // BOM除去
  const cleaned = text.replace(/^﻿/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())

  // ヘッダー行を探す
  const headerIndex = lines.findIndex((line) =>
    line.includes('日付') || line.includes('利用日') || line.includes('決済日')
  )

  if (headerIndex === -1) {
    // ヘッダーなし: 1行目から試みる
    return parseLines(lines, 0)
  }

  const headers = splitCSVLine(lines[headerIndex]).map((h) => h.trim())
  return parseLines(lines, headerIndex + 1, headers)
}

function parseLines(lines, startIndex, headers) {
  const rows = []

  for (let i = startIndex; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i])
    if (cols.length < 2) continue

    // PayPayのCSVフォーマットを複数パターンで対応
    // パターン1: 日時, 決済先, 金額, 残高, ...
    // パターン2: 利用日, 利用店舗, 利用金額, ...
    let date = ''
    let description = ''
    let amount = 0

    if (headers) {
      const dateKey = headers.findIndex((h) => h.includes('日'))
      const descKey = headers.findIndex((h) =>
        h.includes('店舗') || h.includes('内容') || h.includes('決済先') || h.includes('相手')
      )
      const amountKey = headers.findIndex((h) => h.includes('金額') || h.includes('amount'))

      date = cols[dateKey >= 0 ? dateKey : 0]?.trim() || ''
      description = cols[descKey >= 0 ? descKey : 1]?.trim() || ''
      const rawAmount = cols[amountKey >= 0 ? amountKey : 2]?.trim() || '0'
      amount = parseAmount(rawAmount)
    } else {
      date = cols[0]?.trim() || ''
      description = cols[1]?.trim() || ''
      amount = parseAmount(cols[2]?.trim() || '0')
    }

    // 支払いのみ（マイナスまたは正の支出）を対象
    if (!description) continue

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
  if (!str) return 0
  // ¥、円、カンマ、スペースを除去
  const cleaned = str.replace(/[¥,円\s]/g, '').replace('−', '-').replace('－', '-')
  return Number(cleaned) || 0
}

function formatDate(str) {
  // 様々な日付フォーマットを正規化
  const m = str.match(/(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})/)
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`
  return str
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(current.replace(/^"|"$/g, ''))
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.replace(/^"|"$/g, ''))
  return result
}
