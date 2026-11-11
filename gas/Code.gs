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

// 認証は Auth.gs（Googleログイン）。IDトークンが正しく、許可されたメールのときだけ通す
function isAuthorized(idToken) {
  return Boolean(verifyIdToken_(idToken))
}

function doGet(e) {
  const action = e.parameter.action || ''
  const month  = e.parameter.month  || ''
  if (!isAuthorized(e.parameter.id_token)) return err('Unauthorized: ' + authFailReason_())
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
      case 'getLastImportedAt':    return ok(getLastImportedAt())
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
    if (!isAuthorized(body.id_token)) return err('Unauthorized: ' + authFailReason_())
    switch (body.action) {
      case 'saveTransactions':   return ok(saveTransactions(body.transactions))
      case 'updateTransactionCategory': return ok(updateTransactionCategory(body.txId, body.category, body.match))
      case 'clearMonth':         return ok(clearMonth(body.month))
      case 'saveAssets':         return ok(saveAssets(body.assets))
      case 'saveAnnualPlan':     return ok(saveAnnualPlan(body.year, body.plan))
      case 'savePJData':         return ok(savePJData(body.type, body.data))
      case 'saveCategoryRules':  return ok(saveCategoryRules(body.rules))
      case 'addCategoryRule':    return ok(addCategoryRules({ [body.keyword]: body.category }))
      case 'addCategoryRules':   return ok(addCategoryRules(body.rules))
      case 'deleteCategoryRule': return ok(deleteCategoryRule(body.keyword))
      case 'saveInsurances':       return ok(saveInsurances(body.masters, body.surrenderValues, body.payments))
      case 'saveInvestmentFunds':  return ok(saveInvestmentFunds(body.masters, body.records))
      case 'saveDCAccounts':       return ok(saveDCAccounts(body.masters, body.records))
      case 'savePensionData':      return ok(savePensionData(body.records))
      case 'aiChat':               return ok(aiChat(body.chat))
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
  recordImportTimestamp()
  return { saved: transactions.length, inserted: toInsert.length, updated, months }
}

// 取引1件のカテゴリ列だけを書き換える（明細からのカテゴリ変更用。取込日時は更新しない）。
// PayPayは支払いと付与ポイントが同じ取引番号になるため、取引日・出金・入金金額も一致する行だけを対象にする
function updateTransactionCategory(txId, category, match) {
  if (!txId) throw new Error('txId is required')
  const sheet  = getSheet()
  const data   = sheet.getDataRange().getValues()
  const catIdx = HDR.indexOf('カテゴリ')
  const cols   = ['取引番号', '取引日', '出金金額（円）', '入金金額（円）']
  const want   = { ...(match || {}), '取引番号': txId }
  let updated  = 0
  for (let i = 1; i < data.length; i++) {
    const hit = cols.every(c => !(c in want) || cellToStr(data[i][HDR.indexOf(c)]) === String(want[c]))
    if (hit) {
      sheet.getRange(i + 1, catIdx + 1).setValue(category || '')
      updated++
    }
  }
  if (updated === 0) throw new Error('取引が見つかりません: ' + txId)
  return { updated }
}

// ─────────────────────────────────────────
//  PayPay取込更新日時
// ─────────────────────────────────────────

function recordImportTimestamp() {
  const formatted = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
  PropertiesService.getScriptProperties().setProperty('lastImportedAt', formatted)
}

function getLastImportedAt() {
  return { lastImportedAt: PropertiesService.getScriptProperties().getProperty('lastImportedAt') || '' }
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

// 行単位で追加/更新（他の行には触れない・他端末分を上書きしない）
function addCategoryRules(rules) {
  const entries = Object.entries(rules || {})
    .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()])
    .filter(([k, v]) => k && v)
  if (entries.length === 0) return { error: 'rules is required' }
  return withRuleLock(() => {
    const sheet = getRuleSheet()
    const lastRow = sheet.getLastRow()
    const keys = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0] || '').trim())
      : []
    let updated = 0
    const appends = []
    for (const [kw, cat] of entries) {
      const idx = keys.indexOf(kw)
      if (idx !== -1) {
        sheet.getRange(idx + 2, 2).setValue(cat)
        updated++
      } else {
        appends.push([kw, cat])
        keys.push(kw)
      }
    }
    if (appends.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, RULE_HDR.length).setValues(appends)
    }
    return { saved: entries.length, updated, inserted: appends.length }
  })
}

// 該当キーワードの行だけ削除
function deleteCategoryRule(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return { error: 'keyword is required' }
  return withRuleLock(() => {
    const sheet = getRuleSheet()
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return { deleted: 0 }
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    let deleted = 0
    for (let i = keys.length - 1; i >= 0; i--) {
      if (String(keys[i][0] || '').trim() === kw) {
        sheet.deleteRow(i + 2)
        deleted++
      }
    }
    return { deleted }
  })
}

// 複数端末からの同時書き込みで行が消えたり重複したりしないよう直列化
function withRuleLock(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    return fn()
  } finally {
    SpreadsheetApp.flush()
    lock.releaseLock()
  }
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
const FUND_RECORD_HDR   = ['年月', 'ファンド名', '評価額', '累計投資額', '損益', '調整額', '取得総額']

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
//  AI相談（Claude API）
//  事前設定: GASエディタ → プロジェクトの設定 → スクリプトプロパティ
//            キー: CLAUDE_API_KEY  値: sk-ant-...
//
//  会話はフロント（端末）が持ち、毎回まるごと送ってくる:
//    chat.lp       … 相談を始めたときのLPタブの中身（会話の間は変えない＝プロンプトキャッシュと思考ブロックを保つため）
//    chat.messages … { role:'user', content:'…' }
//                    { role:'assistant', content:[…前回APIが返したブロックそのまま…] }
//                    { role:'system', lpUpdate:{…} }  ← 会話の途中でLPの数字が変わったときの差し込み
// ─────────────────────────────────────────
const AI_MODEL = 'claude-sonnet-5-5'

function aiChat(chat) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY')
  if (!apiKey) {
    throw new Error('GASのスクリプトプロパティに CLAUDE_API_KEY を設定してください（プロジェクトの設定 → スクリプトプロパティ）')
  }
  if (!chat || !chat.lp || !Array.isArray(chat.messages) || !chat.messages.length) {
    throw new Error('相談の内容が空です')
  }

  const messages = chat.messages.map(function(m) {
    if (m.role === 'system') {
      return { role: 'system', content: 'LPタブの数字が更新されました。ここからは次の内容を前提に答えてください。\n\n' + buildLPContext(m.lpUpdate || {}) }
    }
    return { role: m.role, content: m.content }
  })

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 安全側で断られたときに別モデルで答え直す / 履歴の思考ブロックが合わなくなっても止めずに続ける
      'anthropic-beta': 'server-side-fallback-2026-07-01,thinking-binding-controls-2026-08-01',
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 16000,
      system: AI_CHAT_RULES + '\n\n' + buildLPContext(chat.lp),
      messages: messages,
      cache_control: { type: 'ephemeral' },  // 2回目以降の質問で、同じ前半部分を割引で読む
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
    }),
    muteHttpExceptions: true,
  })

  const code = response.getResponseCode()
  const body = response.getContentText()
  var result
  try { result = JSON.parse(body) } catch (e) { throw new Error('Claude API の応答が読めません(' + code + ')') }
  if (code !== 200) {
    throw new Error('Claude API エラー(' + code + '): ' + (result.error && result.error.message ? result.error.message : body))
  }
  if (result.stop_reason === 'refusal') {
    throw new Error('AIが回答を断りました。聞き方を変えてもう一度お試しください')
  }
  const text = (result.content || [])
    .filter(function(b) { return b.type === 'text' })
    .map(function(b) { return b.text })
    .join('')
  if (!text) throw new Error('AIの応答が空でした（' + result.stop_reason + '）')
  return { content: result.content, text: text, usage: result.usage || {}, stopReason: result.stop_reason, model: result.model }
}

var AI_CHAT_RULES =
  'あなたは日本の家計・ライフプランに詳しいファイナンシャルプランナーで、家計アプリ「お金ちゃん」の利用者（本人）の相談相手です。\n' +
  '下にあるのは、ライフプラン（LP）タブに今入っている内容と、アプリが計算・判定した結果です。\n\n' +
  '答え方:\n' +
  '- 日本語で、まず結論を1〜2文。そのあと必要な分だけ箇条書き。長くても400字程度。聞かれていないことを並べない\n' +
  '- 選択肢があるときは、どれを選ぶと何がどう変わるかを数字で比べ、判断の材料を渡す。最後に決めるのは本人\n' +
  '- 数字はここに書かれたものだけを根拠にする。0円や未入力の項目は「ない」と決めつけず、入力漏れの可能性として扱う\n' +
  '- アプリの計算に入っていないもの（下の「前提」）が答えに効くときは、そう言う\n' +
  '- 条件を変えたらどうなるかは、アプリの「もしも比較」で正確に計算できる。試すとよい条件があれば「もしも〈項目名〉が〈値〉なら」の形で書く。項目名は次から選ぶ: ' +
  '退職金（手取り）・退職後の生活費・退職年齢・年金受給開始年齢・あなたの年金・妻の年金・投資の想定利回り・物価上昇率・収入の伸び率・あなたの手取り年収・生活費（安心＋彩り）・ときめき＋冒険・家賃・投信積立・追加の積立・想定寿命・ローン期間・ローン金利・頭金・家の購入時期\n' +
  '- 調べ方を聞かれたら、具体的な書類や窓口（ねんきん定期便、就業規則、源泉徴収票など）を挙げる\n' +
  '- 見出しは使わない（チャットなので）。強調は **太字** だけ'

// LPタブの中身を、AIが読む文章にする（相談開始時のシステムプロンプトと、途中の更新で使う）
function buildLPContext(d) {
  var lp = d.lp || {}
  var p  = lp.params  || {}
  var v  = lp.vals    || {}
  var r  = lp.results || {}
  var ev = lp.events  || {}
  var w  = lp.wife    || {}
  var dm = lp.dataMeta || {}
  var notes = lp.notes || {}

  function yen(n) { return '¥' + Math.round(Number(n) || 0).toLocaleString() }
  function onOff(e) { return e && e.enabled ? 'オン' : 'オフ' }
  function lines(arr, empty) { return arr.length ? arr.join('\n') : (empty || '  データなし') }
  function detail(arr) {
    return lines((arr || []).map(function(a) { return '  ' + a.name + ': ' + yen(a.amount) + '（' + (a.month || '記録なし') + '時点）' }))
  }

  var stageLines = (w.stages || []).map(function(st) { return '末っ子' + st.fromAge + '歳から+' + yen(st.add) + '/年' }).join('、')
  var children = ['child1', 'child2'].map(function(k, i) {
    var c = ev[k] || {}
    return '- 第' + (i + 1) + '子: ' + onOff(c) + (c.enabled ? '（現在' + c.currentAge + '歳、' + c.edu + '）' : '')
  }).join('\n')
  var car = ev.car || {}, dog = ev.dog || {}, home = ev.home || {}
  var eventLines = children + '\n' +
    '- 車: ' + onOff(car) + (car.enabled ? '（' + car.yearsFromNow + '年後に' + yen(car.price) + '、' + car.replaceEvery + '年ごと買替、維持費' + yen(car.monthlyFee) + '/月、' + car.sellAge + '歳で手放す）' : '') + '\n' +
    '- 犬: ' + onOff(dog) + (dog.enabled ? '（' + dog.yearsFromNow + '年後から' + dog.years + '年、初期' + yen(dog.initialCost) + '、年' + yen(dog.annualCost) + '）' : '') + '\n' +
    '- マイホーム: ' + onOff(home) + (home.enabled ? '（' + home.yearsFromNow + '年後、土地' + yen(home.landPrice) + '+建物' + yen(home.buildingPrice) +
      '、頭金' + yen(home.downPayment) + '、諸経費' + home.feeRate + '%、ローン' + home.loanYears + '年' + home.loanRate + '%（月' + yen(r.homeLoanMonthly) + '）、固定資産税・保険など' + yen(home.monthlyCost) +
      '/月、' + home.repairEvery + '年ごと修繕' + yen(home.repairCost) + '、購入後の家賃' + (home.stopRent ? '不要' : '継続') +
      '、' + (ev.homestLinked ? '家タブと連携' : '手入力') + '）' : '')

  var LEVEL = { ng: '【不足】', warn: '【要確認】', info: '【参考】' }
  function checkLines(arr, empty) { return lines((arr || []).map(function(c) { return '- ' + (LEVEL[c.level] || '') + c.text }), empty) }

  function man(n) { return (n < 0 ? '▲' : '') + Math.round(Math.abs(Number(n) || 0) / 10000).toLocaleString() + '万円' }
  function zero(s, endAge) { return s.zeroAge ? s.zeroAge + '歳で資産が尽きる' : endAge + '歳まで持つ' }
  var wi = d.whatIfs || {}
  var whatIfLines = lines((wi.rows || []).map(function(x) {
    return '- もしも' + x.label + 'が' + Number(x.value).toLocaleString() + x.unit + 'なら → ' + zero(x, x.endAge) + '、退職直前' + man(x.retireAssets) + '、' + x.endAge + '歳時点' + man(x.endAssets)
  }), '  （条件なし）') + (wi.all ? '\n- 全部あわせると → ' + zero(wi.all, wi.all.endAge) + '、退職直前' + man(wi.all.retireAssets) + '、' + wi.all.endAge + '歳時点' + man(wi.all.endAssets) : '')

  return '# 今日: ' + (d.today || '') + '\n\n' +
    '# パラメータ\n' +
    '- 本人 ' + p.currentAge + '歳 / 退職 ' + p.retireAge + '歳 / 想定寿命 ' + p.lifeExpectancy + '歳 / 年金開始 ' + p.pensionStartAge + '歳\n' +
    '- 妻 ' + p.wifeAge + '歳 / 妻の年金 ' + yen(p.wifePensionMonthly) + '/月（妻' + p.wifePensionStartAge + '歳から）\n' +
    '- 投資利回り ' + p.returnRate + '% / 預金金利 ' + p.cashRate + '% / 物価上昇率 ' + p.inflationRate + '% / 収入の伸び ' + p.incomeGrowth + '%\n' +
    '- 家賃 ' + yen(p.monthlyRent) + '/月 / 退職後の生活費 現役時の' + p.retireExpenseRate + '% / 退職金（手取り） ' + yen(p.retirementBonus) + '\n\n' +
    '# 取得データ\n' +
    '- 預金 ' + yen(v.cashAssets) + ' / 投資資産（投信＋DC） ' + yen(v.investAssets) + '\n' +
    '- あなたの手取り年収 ' + yen(v.myIncome) + '（' + (notes.income || '') + '）\n' +
    '- 妻の手取り年収: 基本' + yen(w.base) + '/年' + (stageLines ? '、' + stageLines : '') + '（今年 ' + yen(r.wifeIncomeNow) + '）\n' +
    '- 投信積立 ' + yen(v.monthlyFundInvest) + '/月 / DC掛金 ' + yen(v.monthlyDCInvest) + '/月\n' +
    '- 生活費（安心＋彩り） ' + yen(v.monthlyExpense) + '/月（' + (notes.expense || '') + '）\n' +
    '- ときめき＋冒険 ' + yen(v.yutoriAnnual) + '/年（' + (notes.yutori || '') + '）\n' +
    '- あなたの年金 ' + yen(v.pensionMonthly) + '/月（確認 ' + (dm.pensionYearMonth || '不明') + '）\n' +
    '- 外貨保険の返戻予定 ' + yen(v.insuranceReturn) + '（' + (dm.insurancePolicies || 0) + '件、' + p.insuranceAge + '歳で解約して一括。今の為替で円換算）\n' +
    lines((dm.insurance || []).map(function(x) {
      return '  ' + x.name + ': ' + x.receiveYear + '年に受け取り ' + yen(x.jpy) + '（' + ({ exact: '表の値', interp: '前後の年から推計', nearest: '表の範囲外のため近い年の値', none: '表なし', nostart: '開始年月がなく計算できない' }[x.method] || '') + '）'
    }), '') + '\n\n' +
    '# 口座別残高\n' + detail(dm.assets) + '\n\n' +
    '# 投資信託\n' + detail(dm.funds) + '\n\n' +
    '# 企業型DC\n' + detail(dm.dc) + '\n\n' +
    '# ライフイベント\n' + eventLines + '\n\n' +
    '# シミュレーション結果\n' +
    '- 今年の家計の収支（手取り−生活費。積立は含まない） ' + yen(r.householdNow) +
      ' / 投信積立 ' + yen(r.fundInvestAnnual) + '/年 / 預金の増減（家計の収支−投信積立） ' + yen(r.annualSurplusNow) +
      (r.wifeBeforeBirth ? '（妻の手取りは子どもが生まれる前なので0円で計算）' : '') + '\n' +
    '- 月の生活費（家賃・ときめき込み） ' + yen(r.monthlyLiving) + '\n' +
    '- 退職後の月の生活費（今の物価）: 生活費 ' + yen(r.retireLivingBase) + ' ＋ 住居費 ' + yen(r.retireHousing) +
      '（家賃 ' + yen(r.retireRent) + '・維持費 ' + yen(r.retireHomeCost) + '・ローン返済 ' + yen(r.retireLoan) + '）\n' +
    '- 年金合計 ' + yen(r.totalPension) + '/月 / 退職後の月の不足 ' + yen(r.monthlyShortfall) +
      (r.shortfallAfterLoan != null ? '（ローン完済 ' + r.homeLoanEndAge + '歳以降は ' + yen(r.shortfallAfterLoan) + '）' : '') + '\n' +
    '- 退職直前の資産 ' + yen(r.retireAssets) + ' / 資産が尽きる年齢 ' + (r.zeroAge ? r.zeroAge + '歳' : 'なし（寿命まで持つ）') +
    ' / 寿命まで持たせるための追加積立 ' + (r.requiredExtra > 0 ? yen(r.requiredExtra) + '/月' : '不要') + '\n' +
    '- 資産推移:\n' + lines((r.milestones || []).map(function(m) { return '  ' + m.age + '歳: ' + yen(m.assets) })) + '\n\n' +
    '# アプリのチェック結果: データの過不足\n' + checkLines(d.dataChecks, '- 気になる点なし') + '\n\n' +
    '# アプリのチェック結果: プランのリスク\n' + checkLines(d.planChecks, '- 大きなリスクなし') + '\n\n' +
    '# もしも比較（本人が設定した条件と、アプリが計算した結果）\n' + whatIfLines + '\n\n' +
    '# このシミュレーションの計算に入っていないもの・単純化している前提\n' + lines((lp.assumptions || []).map(function(a) { return '- ' + a }), '- （前提の情報なし）')
}
