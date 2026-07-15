export function parsePayPayCSV(text) {
  const cleaned = text.replace(/^﻿/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  const delimiter = lines[0].includes('\t') ? '\t' : ','

  // カンマ区切りCSVで "1,988" のようなクォートフィールドを正しく扱う
  function splitLine(line) {
    if (delimiter === '\t') return line.split('\t').map((s) => s.trim())
    const result = []
    let field = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++ }
        else if (c === '"') { inQuote = false }
        else { field += c }
      } else if (c === '"') {
        inQuote = true
      } else if (c === ',') {
        result.push(field.trim()); field = ''
      } else {
        field += c
      }
    }
    result.push(field.trim())
    return result
  }

  const headers = splitLine(lines[0])

  const findCol = (...names) => {
    for (const name of names) {
      const idx = headers.findIndex((h) => h.includes(name))
      if (idx !== -1) return idx
    }
    return -1
  }

  const ci = {
    date:    findCol('取引日'),
    out:     findCol('出金金額'),
    in:      findCol('入金金額'),
    foreign: findCol('海外出金金額'),
    curr:    findCol('通貨'),
    rate:    findCol('変換レート'),
    country: findCol('利用国'),
    content: findCol('取引内容'),
    desc:    findCol('取引先'),
    method:  findCol('取引方法'),
    div:     findCol('支払い区分'),
    user:    findCol('利用者'),
    txId:    findCol('取引番号'),
  }

  console.log('[parsePayPay] delimiter:', delimiter === '\t' ? 'TAB' : 'COMMA')
  console.log('[parsePayPay] col indices:', ci)

  const col = (cols, idx) => idx !== -1 ? (cols[idx]?.trim() ?? '') : ''

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])

    const rawDate = col(cols, ci.date)
    const dateMatch = rawDate.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    if (!dateMatch) {
      console.log(`[parsePayPay] skip row ${i} (no date): rawDate="${rawDate}"`)
      continue
    }

    const date    = `${dateMatch[1]}/${dateMatch[2].padStart(2,'0')}/${dateMatch[3].padStart(2,'0')}`
    const rawOut  = col(cols, ci.out)  || '-'
    const rawIn   = col(cols, ci.in)   || '-'
    const content = col(cols, ci.content)
    const desc    = col(cols, ci.desc)
    const txId    = col(cols, ci.txId)

    const outAmount = rawOut !== '-' ? Number(rawOut.replace(/[,¥\s]/g, '')) || 0 : 0
    const inAmount  = rawIn  !== '-' ? Number(rawIn.replace(/[,¥\s]/g, ''))  || 0 : 0

    const isIncome = inAmount > 0
    const isPoint  = content.includes('ポイント')
    const noDesc   = !desc || desc === '-'
    const displayDesc = (isIncome || isPoint || noDesc) ? content : desc

    let defaultCategory = '他・特別費'
    if (isIncome) defaultCategory = '収入・相殺'
    if (isPoint)  defaultCategory = 'ポイント'

    const id = txId || `${date}_${outAmount || inAmount}_${(content || desc).replace(/[^\w぀-鿿]/g, '').slice(0, 8)}`

    rows.push({
      // Reactアプリ内で使う導出フィールド
      id,
      date,
      description: displayDesc || content || desc,
      amount:    isIncome ? -inAmount : outAmount,
      rawAmount: isIncome ? -inAmount : outAmount,
      defaultCategory,
      // PayPay CSV列（そのままスプレッドシートに保存する）
      // 入金がある場合は出金金額（円）にマイナスで転記
      '取引日':         rawDate,
      '出金金額（円）': inAmount > 0 ? String(-inAmount) : (rawOut !== '-' ? rawOut : ''),
      '入金金額（円）': rawIn  !== '-' ? rawIn  : '',
      '海外出金金額':   col(cols, ci.foreign),
      '通貨':           col(cols, ci.curr),
      '変換レート（円）': col(cols, ci.rate),
      '利用国':         col(cols, ci.country),
      '取引内容':       content,
      '取引先':         desc,
      '取引方法':       col(cols, ci.method),
      '支払い区分':     col(cols, ci.div),
      '利用者':         col(cols, ci.user),
      '取引番号':       txId,
    })
  }
  return rows
}
