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
let AUTH_FAIL_REASON_ = ''

// 直前の verifyIdToken_ が拒否した理由（エラー文に付けて返す。原因調査用）
function authFailReason_() {
  return AUTH_FAIL_REASON_ || 'unknown'
}

function authFail_(reason) {
  AUTH_FAIL_REASON_ = reason
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
  AUTH_FAIL_REASON_ = ''
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) return authFail_('ログイン情報が送られていません')
  const clientId = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim()
  const allowed = allowedEmails_()
  if (!clientId) return authFail_('GASのスクリプトプロパティ GOOGLE_CLIENT_ID が未設定です')
  if (allowed.length === 0) return authFail_('GASのスクリプトプロパティ ALLOWED_EMAILS が未設定です')

  const cache = CacheService.getScriptCache()
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8))
  const cached = cache.get(key)
  if (cached) return allowed.indexOf(cached) >= 0 ? cached : authFail_('このメールアドレスは ALLOWED_EMAILS に入っていません: ' + cached)

  let res
  try {
    res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true })
  } catch (e) {
    return authFail_('GASの外部通信が未許可です。GASエディタで authSelfCheck を実行して許可してください')
  }
  if (res.getResponseCode() !== 200) return authFail_('Googleがログイン情報を無効と判定しました（期限切れの可能性）')
  let info
  try { info = JSON.parse(res.getContentText()) } catch (_) { return authFail_('Googleの応答を読めませんでした') }

  if (info.aud !== clientId) return authFail_('GOOGLE_CLIENT_ID が画面側(VITE_GOOGLE_CLIENT_ID)と一致しません')
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return authFail_('発行元が不正です')
  if (String(info.email_verified) !== 'true') return authFail_('メールアドレスが未確認のアカウントです')
  const now = Math.floor(Date.now() / 1000)
  const exp = Number(info.exp)
  if (!exp || exp <= now) return authFail_('ログインの有効期限が切れています')
  const email = String(info.email || '').toLowerCase()
  if (allowed.indexOf(email) < 0) return authFail_('このメールアドレスは ALLOWED_EMAILS に入っていません: ' + email)

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
