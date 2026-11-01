import { useEffect, useRef, useState } from 'react'
import {
  AUTH_MESSAGES,
  GOOGLE_CLIENT_ID,
  getAuthState,
  hasValidToken,
  renderSignInButton,
  requireIdToken,
  signOut,
  subscribeAuth,
  switchAccount,
} from './googleAuth'

const APP_NAME = (typeof document !== 'undefined' && document.title) || 'knak-lab'
const ICON_SRC = `${import.meta.env.BASE_URL}icon-192.png`

// アプリ全体を包むログインゲート。
//  ・最初にログインが済むまでアプリ本体は表示しない（最初の読み込みにトークンが要るため）
//  ・使っている途中でログインが切れたら、画面の上にログイン画面を重ねて表示する
export default function AuthGate({ children }) {
  const [auth, setAuth] = useState(getAuthState())
  const [ready, setReady] = useState(hasValidToken())
  const buttonRef = useRef(null)

  useEffect(() => subscribeAuth(setAuth), [])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    requireIdToken()
      .then(() => setReady(true))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (auth.signedIn) setReady(true)
  }, [auth.signedIn])

  const showLogin = !ready || auth.needLogin

  useEffect(() => {
    if (showLogin && buttonRef.current) renderSignInButton(buttonRef.current).catch(() => {})
  }, [showLogin, auth.error])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <Screen>
        <p style={s.title}>準備中です</p>
        <p style={s.lead}>.env に VITE_GOOGLE_CLIENT_ID を設定してからビルドしてください。</p>
      </Screen>
    )
  }

  const notice = auth.error ? AUTH_MESSAGES[auth.error] : null
  const isNotAllowed = auth.error === 'not_allowed'

  return (
    <>
      {ready ? children : null}
      {showLogin && (
        <Screen overlay={ready && !isNotAllowed}>
          <p style={s.title}>{isNotAllowed ? 'ログイン' : ready ? 'もう一度ログイン' : 'ようこそ'}</p>
          {!notice && <p style={s.lead}>登録済みのGoogleアカウントでログインしてください。</p>}

          {notice && (
            <div style={isNotAllowed ? s.alertWarn : s.alertInfo} role="alert">
              <p style={s.alertTitle}>{notice.title}</p>
              <p style={s.alertBody}>{notice.body}</p>
              {isNotAllowed && auth.rejectedEmail && <p style={s.alertEmail}>{auth.rejectedEmail}</p>}
            </div>
          )}

          <div ref={buttonRef} style={s.button} />

          {isNotAllowed && (
            <button type="button" style={s.linkButton} onClick={() => switchAccount()}>
              別のアカウントを選ぶ
            </button>
          )}
        </Screen>
      )}
    </>
  )
}

function Screen({ children, overlay = false }) {
  return (
    <div style={overlay ? s.backdropOverlay : s.backdrop}>
      <div style={s.card}>
        <img
          src={ICON_SRC}
          alt=""
          width={72}
          height={72}
          style={s.icon}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        <p style={s.appName}>{APP_NAME}</p>
        {children}
      </div>
      <p style={s.footer}>knak-lab</p>
    </div>
  )
}

export function SignOutButton({ style, label = 'ログアウト' }) {
  const [auth, setAuth] = useState(getAuthState())
  useEffect(() => subscribeAuth(setAuth), [])
  if (!auth.signedIn) return null
  return (
    <button type="button" onClick={() => signOut()} style={style} title={auth.email}>
      {label}
    </button>
  )
}

const font = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'

const backdropBase = {
  position: 'fixed',
  inset: 0,
  zIndex: 99999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 16px',
  overflowY: 'auto',
  fontFamily: font,
}

const alertBase = {
  textAlign: 'left',
  borderRadius: 12,
  padding: '12px 14px',
  margin: '0 0 20px',
}

const s = {
  backdrop: { ...backdropBase, background: 'linear-gradient(160deg, #f7f4ee 0%, #ece7dd 100%)' },
  backdropOverlay: { ...backdropBase, background: 'rgba(24, 24, 27, 0.55)', backdropFilter: 'blur(4px)' },
  card: {
    background: '#fff',
    color: '#1f2328',
    borderRadius: 20,
    padding: '32px 24px 28px',
    width: '100%',
    maxWidth: 360,
    textAlign: 'center',
    boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
  },
  icon: { borderRadius: 18, display: 'block', margin: '0 auto 12px' },
  appName: { fontSize: 13, fontWeight: 600, color: '#8a8f98', letterSpacing: '0.04em', margin: '0 0 6px' },
  title: { fontSize: 22, fontWeight: 700, margin: '0 0 16px' },
  lead: { fontSize: 14, lineHeight: 1.7, color: '#57606a', margin: '-8px 0 24px' },
  alertWarn: { ...alertBase, background: '#fff6e5', border: '1px solid #f3d29a' },
  alertInfo: { ...alertBase, background: '#eef4ff', border: '1px solid #c9dafc' },
  alertTitle: { fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: '#1f2328' },
  alertBody: { fontSize: 13, lineHeight: 1.6, margin: 0, color: '#57606a' },
  alertEmail: { fontSize: 12, margin: '8px 0 0', color: '#8a8f98', wordBreak: 'break-all' },
  button: { display: 'flex', justifyContent: 'center', minHeight: 44 },
  linkButton: {
    marginTop: 16,
    background: 'none',
    border: 'none',
    color: '#0969da',
    fontSize: 14,
    cursor: 'pointer',
    padding: 8,
    fontFamily: font,
  },
  footer: { marginTop: 16, fontSize: 11, color: '#a0a4ab', letterSpacing: '0.08em' },
}
