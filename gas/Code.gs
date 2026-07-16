// =============================================================
//  お金ちゃん管理 — Google Apps Script API
// =============================================================

const SPREADSHEET_ID    = '1hgCGT4A8UcYQvQIkThXK6RbVvTLVFgoDthj8z-SUEUA'
const TX_SHEET_NAME     = '取引データ'
const ASSET_SHEET_NAME  = '資産データ'
const ASSET_HDR         = ['区分', '種別', '口座名', '月', '金額']
const PLAN_SHEET_NAME   = '年間計画'
const PLAN_HDR          = ['年', '区分', '項目名', '1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
const PJ_SHEET_NAME     = 'PJデータ'
const RULE_SHEET_NAME   = 'カテゴリルール'
const RULE_HDR          = ['キーワード', 'カテゴリ']
const HDR = [
  '取引日', '出金金額（円）', '入金金額（円）', '海外出金金額', '通貨',
  '変換レート（円）', '利用国', '取引内容', '取引先', '取引方法',
  '支払い区分', '利用者', '取引番号', 'カテゴリ', '区分',
]

// ─────────────────────────────────────────
//  ルーティング
// ─────────────────────────────────────────

function isAuthorized(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN')
  return Boolean(expected) && token === expected
}

function doGet(e) {
  const action = e.parameter.action || ''
  const month  = e.parameter.month  || ''
  if (!isAuthorized(e.parameter.token)) return err('Unauthorized')
  try {
    switch (action) {
      case 'getTransactions':   return ok(getTransactions(month))
      case 'getMonths':         return ok(getMonths())
      case 'getAssets':         return ok(getAssets())
      case 'getAnnualPlan':     return ok(getAnnualPlan(e.parameter.year || ''))
      case 'getPJData':         return ok(getPJData(e.parameter.type || ''))
      case 'getCategoryRules':  return ok(getCategoryRules())
      case 'getInsurances':        return ok(getInsurances())
      case 'getInvestmentFunds':   return ok(getInvestmentFunds())
      case 'getDCAccounts':        return ok(getDCAccounts())
      case 'getPensionData':       return ok(getPensionData())
      default:                     return err('Unknown action: ' + action)
    }
  } catch (ex) {
    return err(ex.message)
  }
}

function doPost(e) {
  try {
    const raw  = e.parameter.data || e.postData.contents
    const body = JSON.parse(raw)
    if (!isAuthorized(body.token)) return err('Unauthorized')
    switch (body.action) {
      case 'saveTransactions':   return ok(saveTransactions(body.transactions))
      case 'clearMonth':         return ok(clearMonth(body.month))
      case 'saveAssets':         return ok(saveAssets(body.assets))
      case 'saveAnnualPlan':     return ok(saveAnnualPlan(body.year, body.plan))
      case 'savePJData':         return ok(savePJData(body.type, body.data))
      case 'saveCategoryRules':  return ok(saveCategoryRules(body.rules))
      case 'saveInsurances':       return ok(saveInsurances(body.masters, body.surrenderValues, body.payments))
      case 'saveInvestmentFunds':  return ok(saveInvestmentFunds(body.masters, body.records))
      case 'saveDCAccounts':       return ok(saveDCAccounts(body.masters, body.records))
      case 'savePensionData':      return ok(savePensionData(body.records))
      case 'diagnose':             return ok(callClaudeAPI(body.diagData))
      default:                     return err('Unknown action: ' + body.action)
    }
  } catch (ex) {
    return err(ex.message)
  }
}

// ─────────────────────────────────────────
//  レスポンスヘルパー
// ─────────────────────────────────────────

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON)
}

function err(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON)
}

// ─────────────────────────────────────────
//  シート取得（列構造が変わっていたら作り直す）
// ─────────────────────────────────────────

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(TX_SHEET_NAME)

  const COL_WIDTHS = [130, 100, 100, 80, 60, 80, 60, 150, 200, 150, 100, 60, 180, 130, 60]

  function applyHeaderStyle(range) {
    range.setBackground('#E8F0FE')
    range.setFontColor('#003087')
    range.setFontWeight('bold')
  }

  if (sheet) {
    const existingHdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]

    // 既存の先頭列がHDRと一致しているか（プレフィックス互換チェック）
    const isCompatible = existingHdr.every((h, i) => h === HDR[i])

    if (!isCompatible) {
      // 列順が壊れている場合のみバックアップして再作成
      sheet.setName(TX_SHEET_NAME + '_bak_' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMddHHmm'))
      sheet = null
    } else if (existingHdr.length < HDR.length) {
      // 不足列だけ末尾に追加（データはそのまま）
      const startCol = existingHdr.length + 1
      const newCols = HDR.slice(existingHdr.length)
      newCols.forEach((col, i) => {
        const colIdx = startCol + i
        const cell = sheet.getRange(1, colIdx)
        cell.setValue(col)
        applyHeaderStyle(cell)
        if (COL_WIDTHS[colIdx - 1]) sheet.setColumnWidth(colIdx, COL_WIDTHS[colIdx - 1])
      })
    }
  }

  if (!sheet) {
    sheet = ss.insertSheet(TX_SHEET_NAME)
    sheet.appendRow(HDR)
    sheet.setFrozenRows(1)
    applyHeaderStyle(sheet.getRange(1, 1, 1, HDR.length))
    COL_WIDTHS.forEach((w, i) => sheet.setColumnWidth(i + 1, w))
  }

  return sheet
}

// ─────────────────────────────────────────
//  月一覧取得
// ─────────────────────────────────────────

function getMonths() {
  const sheet = getSheet()
  const data  = sheet.getDataRange().getValues()
  if (data.length <= 1) return { months: [] }

  const dateIdx = data[0].indexOf('取引日')
  const months  = [...new Set(
    data.slice(1)
      .map(r => extractMonth(cellToStr(r[dateIdx])))
      .filter(Boolean)
  )].sort().reverse()

  return { months }
}

// ─────────────────────────────────────────
//  取引データ取得
// ─────────────────────────────────────────

function getTransactions(month) {
  const sheet   = getSheet()
  const data    = sheet.getDataRange().getValues()
  if (data.length <= 1) return { transactions: [], month }

  const headers = data[0]
  const dateIdx = headers.indexOf('取引日')

  const transactions = data.slice(1)
    .filter(r => !month || extractMonth(cellToStr(r[dateIdx])) === month)
    .map(r => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = cellToStr(r[i]) })
      return obj
    })

  return { transactions, month }
}

// ─────────────────────────────────────────
//  取引データ保存（取引番号でupsert）
// ─────────────────────────────────────────

function saveTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    return { error: 'transactions is empty' }
  }

  const sheet    = getSheet()
  const data     = sheet.getDataRange().getValues()
  const txIdIdx  = data[0].indexOf('取引番号')  // = 12

  // 既存の取引番号 → 行番号（1-based）マップ
  const existingMap = {}
  for (let i = 1; i < data.length; i++) {
    const txId = String(data[i][txIdIdx] || '')
    if (txId) existingMap[txId] = i + 1
  }

  let updated = 0
  const toInsert = []

  for (const t of transactions) {
    const txId = t['取引番号'] || ''
    const row  = HDR.map(col => (t[col] !== undefined && t[col] !== null) ? t[col] : '')
    if (txId && existingMap[txId]) {
      sheet.getRange(existingMap[txId], 1, 1, HDR.length).setValues([row])
      updated++
    } else {
      toInsert.push(row)
    }
  }

  if (toInsert.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toInsert.length, HDR.length).setValues(toInsert)
  }

  const months = [...new Set(
    transactions.map(t => extractMonth(String(t['取引日'] || ''))).filter(Boolean)
  )]
  return { saved: transactions.length, inserted: toInsert.length, updated, months }
}

// ─────────────────────────────────────────
//  月データ削除
// ─────────────────────────────────────────

function clearMonth(month) {
  if (!month) return { error: 'month is required' }

  const sheet = getSheet()
  const data  = sheet.getDataRange().getValues()
  if (data.length <= 1) return { deleted: 0 }

  const dateIdx = data[0].indexOf('取引日')
  let deleted = 0

  for (let i = data.length - 1; i >= 1; i--) {
    if (extractMonth(cellToStr(data[i][dateIdx])) === month) {
      sheet.deleteRow(i + 1)
      deleted++
    }
  }

  return { deleted, month }
}

// ─────────────────────────────────────────
//  資産データ
// ─────────────────────────────────────────

function getAssetSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(ASSET_SHEET_NAME)

  if (sheet) {
    const existingHdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    const matches = ASSET_HDR.length === existingHdr.length && ASSET_HDR.every((h, i) => h === existingHdr[i])
    if (!matches) {
      sheet.setName(ASSET_SHEET_NAME + '_bak_' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMddHHmm'))
      sheet = null
    }
  }

  if (!sheet) {
    sheet = ss.insertSheet(ASSET_SHEET_NAME)
    sheet.appendRow(ASSET_HDR)
    sheet.setFrozenRows(1)
    const hdr = sheet.getRange(1, 1, 1, ASSET_HDR.length)
    hdr.setBackground('#E8F0FE')
    hdr.setFontColor('#003087')
    hdr.setFontWeight('bold')
    sheet.setColumnWidth(1,  70)   // 区分
    sheet.setColumnWidth(2, 110)   // 種別
    sheet.setColumnWidth(3, 160)   // 口座名
    sheet.setColumnWidth(4,  90)   // 月
    sheet.setColumnWidth(5, 130)   // 金額
  }
  return sheet
}

function getAssets() {
  const sheet = getAssetSheet()
  const data  = sheet.getDataRange().getValues()
  if (data.length <= 1) return { assets: [] }
  const headers = data[0]
  const assets = data.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = cellToStr(r[i]) })
    return obj
  })
  return { assets }
}

function saveAssets(assets) {
  if (!assets) return { saved: 0 }
  const sheet = getAssetSheet()
  const lastRow = sheet.getLastRow()
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, ASSET_HDR.length).clearContent()
  if (assets.length > 0) {
    const rows = assets.map(a => ASSET_HDR.map(col => a[col] ?? ''))
    sheet.getRange(2, 1, rows.length, ASSET_HDR.length).setValues(rows)
  }
  return { saved: assets.length }
}

// ─────────────────────────────────────────
//  ユーティリティ
// ─────────────────────────────────────────

// SheetsのDate型や数値を文字列に変換
function cellToStr(val) {
  if (val instanceof Date) {
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    return `${y}/${m}/${d}`
  }
  return String(val ?? '')
}

// "2026/6/25 20:00" や "2026/06/25" → "2026-06"
function extractMonth(dateStr) {
  const m = String(dateStr).match(/(\d{4})[\/\-](\d{1,2})/)
  if (!m) return ''
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`
}

// ─────────────────────────────────────────
//  年間収支計画
// ─────────────────────────────────────────

function getPlanSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(PLAN_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(PLAN_SHEET_NAME)
    sheet.appendRow(PLAN_HDR)
    sheet.setFrozenRows(1)
    const hdr = sheet.getRange(1, 1, 1, PLAN_HDR.length)
    hdr.setBackground('#E8F0FE')
    hdr.setFontColor('#003087')
    hdr.setFontWeight('bold')
  }
  return sheet
}

function getAnnualPlan(year) {
  const sheet = getPlanSheet()
  const data  = sheet.getDataRange().getValues()
  if (data.length <= 1) return { plan: null }

  const plan = {}
  for (let i = 1; i < data.length; i++) {
    const row = data[i]
    if (String(row[0]) !== String(year)) continue
    const kubun = String(row[1])
    const name  = String(row[2])
    const key   = kubun + '_' + name
    plan[key]   = row.slice(3, 15).map(v => Number(v) || 0)
  }

  return { plan: Object.keys(plan).length > 0 ? plan : null }
}

function saveAnnualPlan(year, plan) {
  if (!year || !plan) return { error: 'year and plan are required' }

  const sheet = getPlanSheet()
  const data  = sheet.getDataRange().getValues()

  // 対象年の既存行を後ろから削除
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(year)) sheet.deleteRow(i + 1)
  }

  // 新しい行を追加
  const rows = Object.entries(plan).map(([key, values]) => {
    const sep   = key.indexOf('_')
    const kubun = key.slice(0, sep)
    const name  = key.slice(sep + 1)
    return [year, kubun, name, ...values.slice(0, 12)]
  })
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PLAN_HDR.length).setValues(rows)
  }

  return { saved: rows.length, year }
}

// ─────────────────────────────────────────
//  PJデータ（いえプロジェクト・長期休暇など）
// ─────────────────────────────────────────

function getPJSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(PJ_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(PJ_SHEET_NAME)
    sheet.appendRow(['種別', 'データ'])
    sheet.setFrozenRows(1)
    const hdr = sheet.getRange(1, 1, 1, 2)
    hdr.setBackground('#E8F0FE')
    hdr.setFontColor('#003087')
    hdr.setFontWeight('bold')
  }
  return sheet
}

function getPJData(type) {
  const sheet = getPJSheet()
  const rows  = sheet.getDataRange().getValues()
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(type)) {
      try { return { data: JSON.parse(rows[i][1]) } }
      catch { return { data: null } }
    }
  }
  return { data: null }
}

function savePJData(type, data) {
  if (!type) return { error: 'type is required' }
  const sheet = getPJSheet()
  const rows  = sheet.getDataRange().getValues()
  const json  = JSON.stringify(data)
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(type)) {
      sheet.getRange(i + 1, 2).setValue(json)
      return { saved: true, type }
    }
  }
  sheet.appendRow([type, json])
  return { saved: true, type }
}

// ─────────────────────────────────────────
//  カテゴリルール
// ─────────────────────────────────────────

function getRuleSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(RULE_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(RULE_SHEET_NAME)
    sheet.appendRow(RULE_HDR)
    sheet.setFrozenRows(1)
    const hdr = sheet.getRange(1, 1, 1, RULE_HDR.length)
    hdr.setBackground('#E8F0FE')
    hdr.setFontColor('#003087')
    hdr.setFontWeight('bold')
    sheet.setColumnWidth(1, 200)
    sheet.setColumnWidth(2, 150)
  }
  return sheet
}

function getCategoryRules() {
  const sheet = getRuleSheet()
  const data  = sheet.getDataRange().getValues()
  const rules = {}
  for (let i = 1; i < data.length; i++) {
    const kw  = String(data[i][0] || '').trim()
    const cat = String(data[i][1] || '').trim()
    if (kw && cat) rules[kw] = cat
  }
  return { rules }
}

function saveCategoryRules(rules) {
  if (!rules) return { error: 'rules is required' }
  const sheet   = getRuleSheet()
  const lastRow = sheet.getLastRow()
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, RULE_HDR.length).clearContent()
  const entries = Object.entries(rules).filter(([k, v]) => k && v)
  if (entries.length > 0) {
    sheet.getRange(2, 1, entries.length, RULE_HDR.length).setValues(entries.map(([k, v]) => [k, v]))
  }
  return { saved: entries.length }
}

// ─────────────────────────────────────────
//  外貨保険
// ─────────────────────────────────────────

// ─────────────────────────────────────────
//  投資信託
// ─────────────────────────────────────────

// ─────────────────────────────────────────
//  公的年金
// ─────────────────────────────────────────

const PENSION_SHEET = '年金データ'
const PENSION_HDR   = ['確認年月', '受給見込み額(月額)', '加入月数']

function getPensionData() {
  return { records: sheetToObjs_(openOrCreateSheet_(PENSION_SHEET, PENSION_HDR)) }
}

function savePensionData(records) {
  writeSheetRows_(openOrCreateSheet_(PENSION_SHEET, PENSION_HDR), records || [])
  return { saved: (records || []).length }
}

// ─────────────────────────────────────────
//  企業型DC
// ─────────────────────────────────────────

const DC_MASTER_SHEET = 'DCマスタ'
const DC_MASTER_HDR   = ['運用機関', '開始年月', '会社掛金(円/月)', '自己掛金(円/月)', '想定利率(%)']
const DC_RECORD_SHEET = 'DC評価額記録'
const DC_RECORD_HDR   = ['年月', '運用機関', '評価額', '累計拠出額', '損益']

function getDCAccounts() {
  return {
    masters: sheetToObjs_(openOrCreateSheet_(DC_MASTER_SHEET, DC_MASTER_HDR)),
    records: sheetToObjs_(openOrCreateSheet_(DC_RECORD_SHEET, DC_RECORD_HDR)),
  }
}

function saveDCAccounts(masters, records) {
  writeSheetRows_(openOrCreateSheet_(DC_MASTER_SHEET, DC_MASTER_HDR), masters || [])
  writeSheetRows_(openOrCreateSheet_(DC_RECORD_SHEET, DC_RECORD_HDR), records || [])
  return { saved: true }
}

const FUND_MASTER_SHEET = '投資信託マスタ'
const FUND_MASTER_HDR   = ['ファンド名', '証券会社', '積立スケジュール(JSON)', '開始年月', '想定利率(%)']
const FUND_RECORD_SHEET = '評価額記録'
const FUND_RECORD_HDR   = ['年月', 'ファンド名', '評価額', '累計投資額', '損益', '調整額']

function getInvestmentFunds() {
  return {
    masters: sheetToObjs_(openOrCreateSheet_(FUND_MASTER_SHEET, FUND_MASTER_HDR)),
    records: sheetToObjs_(openOrCreateSheet_(FUND_RECORD_SHEET, FUND_RECORD_HDR)),
  }
}

function saveInvestmentFunds(masters, records) {
  // ヘッダーを強制更新（旧スキーマからのマイグレーション対応）
  const masterSheet = openOrCreateSheet_(FUND_MASTER_SHEET, FUND_MASTER_HDR)
  masterSheet.getRange(1, 1, 1, FUND_MASTER_HDR.length).setValues([FUND_MASTER_HDR])
  writeSheetRows_(masterSheet, masters || [])

  const recordSheet = openOrCreateSheet_(FUND_RECORD_SHEET, FUND_RECORD_HDR)
  recordSheet.getRange(1, 1, 1, FUND_RECORD_HDR.length).setValues([FUND_RECORD_HDR])
  writeSheetRows_(recordSheet, records || [])
  return { saved: true }
}

const INS_MASTER_SHEET    = '保険マスタ'
const INS_MASTER_HDR      = ['保険名', '開始年月', '年払い額(USD)', '通貨']
const INS_SURRENDER_SHEET = '解約返戻金テーブル'
const INS_SURRENDER_HDR   = ['保険名', '解約年度', '一括額(USD)', '分割年数', '分割額(USD/年)']
const INS_PAYMENT_SHEET   = '年払い記録'
const INS_PAYMENT_HDR     = ['年月', '保険名', '支払額(USD)', '為替レート', '円換算額']

function openOrCreateSheet_(name, hdr) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name)
    sheet.appendRow(hdr)
    sheet.setFrozenRows(1)
    const r = sheet.getRange(1, 1, 1, hdr.length)
    r.setBackground('#E8F0FE')
    r.setFontColor('#003087')
    r.setFontWeight('bold')
  }
  return sheet
}

function sheetToObjs_(sheet) {
  const data = sheet.getDataRange().getValues()
  if (data.length <= 1) return []
  const hdrs = data[0]
  return data.slice(1)
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => { const o = {}; hdrs.forEach((h, i) => { o[h] = cellToStr(r[i]) }); return o })
}

function writeSheetRows_(sheet, rows) {
  const hdr  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  const last = sheet.getLastRow()
  if (last > 1) sheet.getRange(2, 1, last - 1, hdr.length).clearContent()
  if ((rows || []).length > 0) {
    const vals = rows.map(r => hdr.map(col => r[col] !== undefined ? r[col] : ''))
    sheet.getRange(2, 1, vals.length, hdr.length).setValues(vals)
  }
}

function getInsurances() {
  return {
    masters:         sheetToObjs_(openOrCreateSheet_(INS_MASTER_SHEET,    INS_MASTER_HDR)),
    surrenderValues: sheetToObjs_(openOrCreateSheet_(INS_SURRENDER_SHEET, INS_SURRENDER_HDR)),
    payments:        sheetToObjs_(openOrCreateSheet_(INS_PAYMENT_SHEET,   INS_PAYMENT_HDR)),
  }
}

function saveInsurances(masters, surrenderValues, payments) {
  writeSheetRows_(openOrCreateSheet_(INS_MASTER_SHEET,    INS_MASTER_HDR),    masters         || [])
  writeSheetRows_(openOrCreateSheet_(INS_SURRENDER_SHEET, INS_SURRENDER_HDR), surrenderValues || [])
  writeSheetRows_(openOrCreateSheet_(INS_PAYMENT_SHEET,   INS_PAYMENT_HDR),   payments        || [])
  return { saved: true }
}

// ─────────────────────────────────────────
//  動作テスト（GASエディタから直接実行可）
// ─────────────────────────────────────────

function testSave() {
  const result = saveTransactions([
    { '取引日': '2026/6/1 10:00', '出金金額（円）': '850', '入金金額（円）': '', '海外出金金額': '', '通貨': '', '変換レート（円）': '', '利用国': '', '取引内容': '支払い', '取引先': 'マクドナルド', '取引方法': 'PayPay残高', '支払い区分': '', '利用者': '', '取引番号': 'TEST001' },
    { '取引日': '2026/6/2 12:00', '出金金額（円）': '620', '入金金額（円）': '', '海外出金金額': '', '通貨': '', '変換レート（円）': '', '利用国': '', '取引内容': '支払い', '取引先': 'セブンイレブン', '取引方法': 'PayPay残高', '支払い区分': '', '利用者': '', '取引番号': 'TEST002' },
  ])
  Logger.log(JSON.stringify(result))
}

function testGet() {
  const result = getTransactions('2026-06')
  Logger.log(JSON.stringify(result))
}

function testMonths() {
  const result = getMonths()
  Logger.log(JSON.stringify(result))
}

function testSaveCategoryRules() {
  const result = saveCategoryRules({ 'テスト店': '消・食費', 'テストB': '消・交通' })
  Logger.log(JSON.stringify(result))
}

// ─────────────────────────────────────────
//  AI診断（Claude API）
//  事前設定: GASエディタ → プロジェクトの設定 → スクリプトプロパティ
//            キー: CLAUDE_API_KEY  値: sk-ant-...
// ─────────────────────────────────────────

function callClaudeAPI(diagData) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY')
  if (!apiKey) {
    throw new Error('GASのスクリプトプロパティに CLAUDE_API_KEY を設定してください（プロジェクトの設定 → スクリプトプロパティ）')
  }

  const prompt = buildDiagPrompt(diagData)

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  })

  const code = response.getResponseCode()
  const body = response.getContentText()
  const result = JSON.parse(body)

  if (code !== 200) {
    throw new Error('Claude API エラー(' + code + '): ' + (result.error && result.error.message ? result.error.message : body))
  }

  return { text: result.content[0].text }
}

function buildDiagPrompt(d) {
  const p = d.simParams  || {}
  const v = d.simVals    || {}
  const r = d.simResults || {}

  function yen(n) {
    var num = Number(n) || 0
    return '¥' + Math.round(num).toLocaleString()
  }

  // カテゴリ別支出（金額降順）
  var spendLines = Object.entries(d.spending || {})
    .sort(function(a, b) { return b[1] - a[1] })
    .map(function(e) { return '  ' + e[0] + ': ' + yen(e[1]) })
    .join('\n') || '  データなし'

  // 口座別残高（金額降順）
  var assetLines = (d.assets || [])
    .sort(function(a, b) { return b.amount - a.amount })
    .map(function(a) { return '  [' + a.kubun + '] ' + a.name + ': ' + yen(a.amount) })
    .join('\n') || '  データなし'

  // 投資信託
  var fundLines = (d.funds || [])
    .map(function(f) {
      return '  ' + f.name + ': 評価額' + yen(f.eval) +
        ', 損益' + (f.pnl >= 0 ? '+' : '') + yen(f.pnl) +
        ', 積立' + yen(f.monthlyAmt) + '/月'
    })
    .join('\n') || '  データなし'

  // DC
  var dcLines = (d.dc || [])
    .map(function(a) {
      return '  ' + a.institution + ': 評価額' + yen(a.eval) +
        ', 損益' + (a.pnl >= 0 ? '+' : '') + yen(a.pnl) +
        ', 掛金' + yen(a.companyAmt + a.selfAmt) + '/月'
    })
    .join('\n') || '  データなし'

  // 年金
  var pensionLine = (d.pension && d.pension.length > 0)
    ? yen(d.pension[0].monthlyAmt) + '/月（' + (p.pensionStartAge || 65) + '歳〜、加入' + d.pension[0].months + 'ヶ月）'
    : 'データなし'

  return 'あなたは日本の家計・資産管理に詳しいファイナンシャルプランナーです。以下の家計データを分析し、日本語で診断レポートを作成してください。\n\n' +
    '## 基本情報\n' +
    '- 現在年齢: ' + (p.currentAge || '不明') + '歳 / 退職予定: ' + (p.retireAge || 65) + '歳 / 想定寿命: ' + (p.lifeExpectancy || 90) + '歳\n' +
    '- 想定運用利率: ' + (p.returnRate || 5) + '%/年 / 年金受給開始: ' + (p.pensionStartAge || 65) + '歳\n\n' +
    '## 今月（' + (d.latestMonth || '直近') + '）カテゴリ別支出\n' + spendLines + '\n\n' +
    '## 資産状況（口座別・最新月）\n' +
    '- 合計: ' + yen(v.totalAssets) + '\n' + assetLines + '\n\n' +
    '## 投資信託\n' + fundLines + '\n\n' +
    '## 企業型DC\n' + dcLines + '\n\n' +
    '## 月次収支\n' +
    '- 月額積立: ' + yen(v.monthlyInvestment) + ' / 月平均支出: ' + yen(v.monthlyExpense) + '\n' +
    '- 外貨保険: ' + (d.insurancePolicies || 0) + '件（返戻予定: ' + yen(v.insuranceReturn) + '）\n\n' +
    '## 公的年金\n' + pensionLine + '\n\n' +
    '## 老後シミュレーション結果\n' +
    '- 退職時資産予測: ' + yen(r.retireAssets) + '\n' +
    '- 月の不足額（生活費−年金）: ' + yen(r.monthlyShortfall) + '\n' +
    '- 資産が尽きる年齢: ' + (r.zeroAge ? r.zeroAge + '歳' : (p.lifeExpectancy || 90) + '歳以降') + '\n' +
    '- 必要追加月積立額: ' + (r.requiredExtra > 0 ? yen(r.requiredExtra) : '追加不要') + '\n\n' +
    '---\n\n' +
    '以下の4セクションで診断レポートを作成してください。各セクションは具体的な数字を引用し、200〜300字で簡潔にまとめてください。\n\n' +
    '## 📊 今月の支出分析\n\n' +
    '## 🏦 資産状況の健康度\n\n' +
    '## ⚠️ 老後資金リスク\n\n' +
    '## 💡 総合アドバイス（今すぐやるべきこと3つを番号付きで）'
}
