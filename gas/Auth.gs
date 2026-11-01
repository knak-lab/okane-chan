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
let AUTH_FAIL_CODE_ = ''

// 直前の verifyIdToken_ が拒否した理由コード（外部に返すのはこの3種類だけ）
//   login_required : ログインしていない／ログインの期限切れ
//   not_allowed    : ALLOWED_EMAILS に登録されていないアカウント
//   unavailable    : GAS側の設定不備など（詳細は返さない）
// 詳しい理由は GAS の「実行数」画面のログにだけ残す（攻撃者にヒントを与えないため）
function authFailReason_() {
  return AUTH_FAIL_CODE_ || 'login_required'
}

function authFail_(code, detail) {
  AUTH_FAIL_CODE_ = code
  if (detail) console.warn('[auth] ' + code + ': ' + detail)
  return null
}

function allowedEmails_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(/[,、\s]+/)
    .map(function (s) { return s.trim().toLowerCase() })
    .filter(Boolean)
}

// 正しいIDトークンなら メールアドレス、だめなら null を返す
function verifyIdToken_(idToken) {
  AUTH_FAIL_CODE_ = ''
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) return authFail_('login_required')
  const clientId = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim()
  const allowed = allowedEmails_()
  if (!clientId) return authFail_('unavailable', 'GOOGLE_CLIENT_ID が未設定')
  if (allowed.length === 0) return authFail_('unavailable', 'ALLOWED_EMAILS が未設定')

  const cache = CacheService.getScriptCache()
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8))
  const cached = cache.get(key)
  if (cached) return allowed.indexOf(cached) >= 0 ? cached : authFail_('not_allowed', '許可リスト外: ' + cached)

  let res
  try {
    res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true })
  } catch (e) {
    return authFail_('unavailable', '外部通信が未許可。authSelfCheck を実行して許可すること')
  }
  if (res.getResponseCode() !== 200) return authFail_('login_required', 'tokeninfo HTTP ' + res.getResponseCode())
  let info
  try { info = JSON.parse(res.getContentText()) } catch (_) { return authFail_('unavailable', 'tokeninfo の応答を解析できない') }

  if (info.aud !== clientId) return authFail_('unavailable', 'GOOGLE_CLIENT_ID と VITE_GOOGLE_CLIENT_ID が不一致')
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return authFail_('login_required', 'iss 不正: ' + info.iss)
  if (String(info.email_verified) !== 'true') return authFail_('not_allowed', 'email 未確認')
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(info.exp)
  if (!exp || exp <= now) return authFail_('login_required', '期限切れ')
  const email = String(info.email || '').toLowerCase()
  if (allowed.indexOf(email) < 0) return authFail_('not_allowed', '許可リスト外: ' + email)

  cache.put(key, email, Math.max(1, Math.min(exp - now, AUTH_CACHE_MAX_SEC_)))
  return email
}

// 初回だけGASエディタで実行して、外部通信（UrlFetchApp）の許可を出すための関数
function authSelfCheck() {
  const props = PropertiesService.getScriptProperties()
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=x', { muteHttpExceptions: true })
  const cid = String(props.getProperty('GOOGLE_CLIENT_ID') || '')
  Logger.log('GOOGLE_CLIENT_ID: ' + (cid ? '設定済み → ' + cid : '★未設定'))
  if (cid && cid !== cid.trim()) Logger.log('★GOOGLE_CLIENT_ID の前後に空白があります（自動で無視しますが、消しておくと安心です）')
  if (cid && !/\.apps\.googleusercontent\.com$/.test(cid.trim())) Logger.log('★GOOGLE_CLIENT_ID の形が変です（…apps.googleusercontent.com で終わるはず）')
  Logger.log('ALLOWED_EMAILS : ' + (allowedEmails_().length ? allowedEmails_().join(', ') : '★未設定'))
  Logger.log('API_TOKEN(旧)  : ' + (props.getProperty('API_TOKEN') ? '残っています（使っていなければ削除してOK）' : 'なし'))
}
