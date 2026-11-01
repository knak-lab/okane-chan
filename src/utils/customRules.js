import { gasApi, isGasReady } from './gasApi'

const KEY = 'okane_custom_cat_rules'
// スプシ未反映の操作（送信失敗・オフライン時）。起動時に再送してから突き合わせる
const PENDING_ADD_KEY = 'okane_custom_cat_rules_pending_add'
const PENDING_DEL_KEY = 'okane_custom_cat_rules_pending_del'

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback }
  catch { return fallback }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadCustomRules() {
  return readJson(KEY, {})
}

function markPendingAdd(keyword, category) {
  const add = readJson(PENDING_ADD_KEY, {})
  add[keyword] = category
  writeJson(PENDING_ADD_KEY, add)
  writeJson(PENDING_DEL_KEY, readJson(PENDING_DEL_KEY, []).filter(k => k !== keyword))
}

function markPendingDelete(keyword) {
  const add = readJson(PENDING_ADD_KEY, {})
  delete add[keyword]
  writeJson(PENDING_ADD_KEY, add)
  const del = readJson(PENDING_DEL_KEY, [])
  if (!del.includes(keyword)) writeJson(PENDING_DEL_KEY, [...del, keyword])
}

function clearPendingAdd(keyword, category) {
  const add = readJson(PENDING_ADD_KEY, {})
  // 送信中に別カテゴリへ上書きされていたら残す
  if (add[keyword] === category) {
    delete add[keyword]
    writeJson(PENDING_ADD_KEY, add)
  }
}

function clearPendingDelete(keyword) {
  writeJson(PENDING_DEL_KEY, readJson(PENDING_DEL_KEY, []).filter(k => k !== keyword))
}

// ローカルに保存し、スプシへは行単位でupsert。失敗時は保留にして次回起動時に再送
export async function saveCustomRule(keyword, category) {
  return saveCustomRules({ [keyword]: category })
}

export async function saveCustomRules(rules) {
  const entries = Object.entries(rules).filter(([k, v]) => k && v)
  if (entries.length === 0) return
  const local = loadCustomRules()
  for (const [k, v] of entries) {
    local[k] = v
    markPendingAdd(k, v)
  }
  writeJson(KEY, local)
  if (!isGasReady()) return
  await gasApi.addCategoryRules(Object.fromEntries(entries))
  for (const [k, v] of entries) clearPendingAdd(k, v)
}

// ローカルから削除し、スプシは該当行だけ削除（他端末で追加された行は消さない）
export async function deleteCustomRule(keyword) {
  const local = loadCustomRules()
  delete local[keyword]
  writeJson(KEY, local)
  markPendingDelete(keyword)
  if (!isGasReady()) return
  await gasApi.deleteCategoryRule(keyword)
  clearPendingDelete(keyword)
}

// 起動時同期: 保留中の追加・削除をスプシへ再送してから、スプシの内容をローカルに反映する。
// 再送に失敗した保留分はローカルに残すので、ルールが黙って消えることはない
export async function syncRulesWithGas() {
  const pendingAdd = readJson(PENDING_ADD_KEY, {})
  const pendingDel = readJson(PENDING_DEL_KEY, [])
  let flushError = null

  if (Object.keys(pendingAdd).length > 0) {
    try {
      await gasApi.addCategoryRules(pendingAdd)
      for (const [k, v] of Object.entries(pendingAdd)) clearPendingAdd(k, v)
    } catch (e) { flushError = e }
  }
  for (const kw of pendingDel) {
    try {
      await gasApi.deleteCategoryRule(kw)
      clearPendingDelete(kw)
    } catch (e) { flushError = e }
  }

  const { rules } = await gasApi.getCategoryRules()
  const merged = { ...(rules || {}), ...readJson(PENDING_ADD_KEY, {}) }
  for (const kw of readJson(PENDING_DEL_KEY, [])) delete merged[kw]
  writeJson(KEY, merged)
  if (flushError) throw flushError
  return merged
}
