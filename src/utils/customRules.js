const KEY = 'okane_custom_cat_rules'

export function loadCustomRules() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') }
  catch { return {} }
}

export function saveCustomRule(keyword, category) {
  const rules = loadCustomRules()
  rules[keyword] = category
  localStorage.setItem(KEY, JSON.stringify(rules))
}

export function deleteCustomRule(keyword) {
  const rules = loadCustomRules()
  delete rules[keyword]
  localStorage.setItem(KEY, JSON.stringify(rules))
}

// GASから取得したルールをlocalStorageに一括反映（起動時同期用）
export function applyRulesFromGas(gasRules) {
  if (gasRules && typeof gasRules === 'object') {
    localStorage.setItem(KEY, JSON.stringify(gasRules))
  }
}
