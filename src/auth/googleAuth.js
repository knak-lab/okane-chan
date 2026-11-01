// =============================================================
//  Googleログイン（Google Identity Services）
//
//  ・ログインすると Google が「IDトークン」（約1時間有効）を発行する
//  ・GAS へのリクエストには必ずこの IDトークンを付ける
//  ・GAS 側で「本物のトークンか」「許可されたメールか」を確認する
//    → サイトのJSを読まれても、データにはアクセスできない
//
//  knak-lab.github.io 配下のアプリは localStorage を共有するので、
//  1つのアプリでログインすれば他のアプリでもそのまま使える。
// =============================================================

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const STORAGE_KEY = 'knak_google_id_token'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const EXPIRY_MARGIN_SEC = 120

let gisPromise = null
let initialized = false
let pending = []
const listeners = new Set()
let state = { signedIn: false, needLogin: false, email: '', error: '' }

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn(state))
}

export function getAuthState() {
  return state
}

export function subscribeAuth(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function decodePayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(part)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function readStoredToken() {
  let token = ''
  try {
    token = localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return null
  }
  if (!token) return null
  const payload = decodePayload(token)
  if (!payload || !payload.exp) return null
  if (payload.exp - EXPIRY_MARGIN_SEC <= Date.now() / 1000) return null
  return { token, email: payload.email || '' }
}

function storeToken(token) {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    /* プライベートモード等では保存できない（このタブの間だけ有効） */
  }
}

function clearStoredToken() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

function loadGis() {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google)
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve(window.google)
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Googleログインの読み込みに失敗しました。通信状況をご確認ください。'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

function handleCredential(response) {
  const token = response?.credential
  const payload = token ? decodePayload(token) : null
  if (!payload) {
    setState({ error: 'ログインに失敗しました。もう一度お試しください。' })
    return
  }
  storeToken(token)
  setState({ signedIn: true, needLogin: false, email: payload.email || '', error: '' })
  const waiters = pending
  pending = []
  waiters.forEach((resolve) => resolve(token))
}

async function ensureInitialized() {
  const google = await loadGis()
  if (!initialized) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
    })
    initialized = true
  }
  return google
}

// ボタンを描画する（AuthGate から呼ばれる）
export async function renderSignInButton(el) {
  const google = await ensureInitialized()
  el.innerHTML = ''
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja' })
}

// 有効なIDトークンを返す。なければログインを促し、ログイン完了まで待つ。
export async function requireIdToken() {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID が設定されていません（.env.local を確認してください）')
  const stored = readStoredToken()
  if (stored) {
    if (!state.signedIn || state.email !== stored.email) setState({ signedIn: true, email: stored.email })
    return stored.token
  }
  const promise = new Promise((resolve) => pending.push(resolve))
  if (state.needLogin && pending.length > 1) return promise // すでにログイン待ち
  setState({ needLogin: true })
  try {
    const google = await ensureInitialized()
    // 以前ログインした端末なら、ボタンを押さなくても自動でログインできることが多い
    google.accounts.id.prompt()
  } catch (e) {
    setState({ error: e.message })
  }
  return promise
}

export function hasValidToken() {
  return Boolean(readStoredToken())
}

// サーバーに拒否されたとき（期限切れ・許可されていないアカウント）
export function invalidateToken(message) {
  clearStoredToken()
  setState({ signedIn: false, email: '', error: message || '' })
}

export async function signOut() {
  clearStoredToken()
  try {
    const google = await loadGis()
    google.accounts.id.disableAutoSelect()
  } catch {
    /* noop */
  }
  setState({ signedIn: false, email: '', needLogin: true, error: '' })
}

function isUnauthorized(json) {
  return json && json.ok === false && /unauthorized/i.test(String(json.error || ''))
}

// IDトークンを付けてリクエストする。サーバーに拒否されたら1回だけログインし直して再実行する。
//   fn: (idToken) => Promise<パース済みJSON>
export async function withIdToken(fn) {
  const token = await requireIdToken()
  const json = await fn(token)
  if (!isUnauthorized(json)) return json
  const reason = String(json.error || '').replace(/^unauthorized:?\s*/i, '')
  invalidateToken('ログインできませんでした。' + (reason ? '（理由：' + reason + '）' : 'もう一度ログインしてください。'))
  const retryToken = await requireIdToken()
  return fn(retryToken)
}
