// =============================================================
//  Googleログイン認証（全アプリ共通）
//
//  フロントから送られてくる Google の IDトークンを検証し、
//  許可されたメールアドレスのときだけ処理を通す。
//
//  スクリプトプロパティ（プロジェクトの設定 → スクリプトプロパティ）
//    GOOGLE_CLIENT_ID : Google Cloud で作った OAuth クライアントID（全アプリ共通で同じ値）
//    ALLOWED_EMAILS   : 使ってよい Google アカウント（カンマ区切り）
//                       例) aaa@gmail.com,bbb@gmail.com
//  どちらかが未設定なら、すべて拒否する（安全側に倒す）。
// =============================================================

const AUTH_CACHE_MAX_SEC_ = 600

function allowedEmails_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(',')
    .map(function (s) { return s.trim().toLowerCase() })
    .filter(Boolean)
}

// 正しいIDトークンなら メールアドレス、だめなら null を返す
function verifyIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) return null
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')
  const allowed = allowedEmails_()
  if (!clientId || allowed.length === 0) return null

  const cache = CacheService.getScriptCache()
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8))
  const cached = cache.get(key)
  if (cached) return allowed.indexOf(cached) >= 0 ? cached : null

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true })
  if (res.getResponseCode() !== 200) return null
  let info
  try { info = JSON.parse(res.getContentText()) } catch (_) { return null }

  if (info.aud !== clientId) return null
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return null
  if (String(info.email_verified) !== 'true') return null
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(info.exp)
  if (!exp || exp <= now) return null
  const email = String(info.email || '').toLowerCase()
  if (allowed.indexOf(email) < 0) return null

  cache.put(key, email, Math.max(1, Math.min(exp - now, AUTH_CACHE_MAX_SEC_)))
  return email
}

// 初回だけGASエディタで実行して、外部通信（UrlFetchApp）の許可を出すための関数
function authSelfCheck() {
  const props = PropertiesService.getScriptProperties()
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=x', { muteHttpExceptions: true })
  Logger.log('GOOGLE_CLIENT_ID: ' + (props.getProperty('GOOGLE_CLIENT_ID') ? '設定済み' : '★未設定'))
  Logger.log('ALLOWED_EMAILS : ' + (allowedEmails_().length ? allowedEmails_().join(', ') : '★未設定'))
  Logger.log('API_TOKEN(旧)  : ' + (props.getProperty('API_TOKEN') ? '残っています（使っていなければ削除してOK）' : 'なし'))
}
