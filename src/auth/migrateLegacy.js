// 以前のバージョンが平文で localStorage に置いていたデータを、金庫（暗号化）へ移して消す
import { vaultSet } from './vault'

const LEGACY_CACHE_PREFIX = 'okane-chan:v1:'
const LEGACY_RULE_KEYS = ['okane_custom_cat_rules', 'okane_custom_cat_rules_pending_add', 'okane_custom_cat_rules_pending_del']

export function migrateLegacyStorage() {
  let keys = []
  try { keys = Object.keys(localStorage) } catch { return }
  for (const k of keys) {
    const isCache = k.startsWith(LEGACY_CACHE_PREFIX)
    if (!isCache && !LEGACY_RULE_KEYS.includes(k)) continue
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null')
      if (v != null) vaultSet(isCache ? 'cache:' + k.slice(LEGACY_CACHE_PREFIX.length) : k, v)
    } catch { /* 壊れていたら移さずに消す */ }
    try { localStorage.removeItem(k) } catch { /* noop */ }
  }
}
