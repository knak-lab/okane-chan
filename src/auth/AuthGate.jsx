import { useEffect, useRef, useState } from 'react'
import {
  GOOGLE_CLIENT_ID,
  getAuthState,
  hasValidToken,
  renderSignInButton,
  requireIdToken,
  signOut,
  subscribeAuth,
} from './googleAuth'

// アプリ全体を包むログインゲート。
//  ・最初にログインが済むまでアプリ本体は表示しない（最初の読み込みにトークンが要るため）
//  ・使っている途中でログインが切れたら、画面の上にログイン窓を重ねて表示する
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
  }, [showLogin])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div style={styles.backdrop}>
        <div style={styles.card}>
          <p style={styles.title}>設定が足りません</p>
          <p style={styles.text}>.env.local に VITE_GOOGLE_CLIENT_ID を設定してからビルドしてください。</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {ready ? children : null}
      {showLogin && (
        <div style={styles.backdrop}>
          <div style={styles.card}>
            <p style={styles.title}>{ready ? 'もう一度ログインしてください' : 'ログイン'}</p>
            <p style={styles.text}>許可されたGoogleアカウントでログインすると使えます。</p>
            <div ref={buttonRef} style={styles.button} />
            {auth.error && <p style={styles.error}>{auth.error}</p>}
          </div>
        </div>
      )}
    </>
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

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    background: 'rgba(20, 20, 20, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    background: '#fff',
    color: '#222',
    borderRadius: 16,
    padding: '28px 24px',
    width: '100%',
    maxWidth: 360,
    textAlign: 'center',
    boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
    fontFamily: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  },
  title: { fontSize: 18, fontWeight: 700, margin: '0 0 8px' },
  text: { fontSize: 14, lineHeight: 1.6, margin: '0 0 20px', color: '#555' },
  button: { display: 'flex', justifyContent: 'center', minHeight: 44 },
  error: { fontSize: 13, color: '#c0392b', margin: '16px 0 0', lineHeight: 1.5 },
}
