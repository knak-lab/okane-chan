import { useEffect, useRef, useState } from 'react'
import {
  AUTH_MESSAGES,
  GOOGLE_CLIENT_ID,
  getAuthState,
  persistTokenToVault,
  renderSignInButton,
  requireIdToken,
  signOut,
  subscribeAuth,
  switchAccount,
} from './googleAuth'
import {
  getVaultState,
  initVault,
  lock,
  openWithoutPasskey,
  registerPasskey,
  subscribeVault,
  unlockWithPasskey,
  webauthnAvailable,
  wipeVault,
} from './vault'
import { migrateLegacyStorage } from './migrateLegacy'
import { gasApi } from '../utils/gasApi'

const APP_NAME = (typeof document !== 'undefined' && document.title) || 'knak-lab'
const ICON_SRC = `${import.meta.env.BASE_URL}icon-192.png`
const SKIP_PASSKEY_KEY = 'okane-chan:vault:skipPasskey'

const skippedPasskey = () => {
  try { return localStorage.getItem(SKIP_PASSKEY_KEY) === '1' } catch { return false }
}
const setSkippedPasskey = (v) => {
  try { v ? localStorage.setItem(SKIP_PASSKEY_KEY, '1') : localStorage.removeItem(SKIP_PASSKEY_KEY) } catch { /* noop */ }
}

// アプリ全体を包むゲート。
//  ・初回：Googleでログイン → 登録メールか確認 → 指紋・顔認証（パスキー）を登録 → 開く
//  ・2回目以降：指紋・顔認証で開く。最後の操作から1時間以内なら認証なしで開く
//  ・無操作1時間で鍵をかける（vault.js）。鍵がかかるとアプリ本体を画面から外す
//  ・開いている間にGoogleのログインが切れたら、画面の上にログイン画面を重ねる
export default function AuthGate({ children }) {
  const [auth, setAuth] = useState(getAuthState())
  const [vault, setVault] = useState(getVaultState())

  useEffect(() => subscribeAuth(setAuth), [])
  useEffect(() => subscribeVault(setVault), [])
  useEffect(() => { initVault() }, [])

  // 開いたら：古い平文データを金庫へ移し、初回ログインのトークンも金庫へ
  useEffect(() => {
    if (vault.status !== 'unlocked') return
    migrateLegacyStorage()
    persistTokenToVault()
  }, [vault.status])

  if (!GOOGLE_CLIENT_ID) {
    return (
      <Screen>
        <p style={s.title}>準備中です</p>
        <p style={s.lead}>.env に VITE_GOOGLE_CLIENT_ID を設定してからビルドしてください。</p>
      </Screen>
    )
  }

  if (vault.status === 'checking') return <Screen><p style={s.lead}>読み込み中…</p></Screen>
  if (vault.status === 'setup') return <SetupScreen auth={auth} />
  if (vault.status === 'locked') return <LockScreen vault={vault} />

  return (
    <>
      {children}
      {auth.needLogin && <GoogleLogin auth={auth} overlay={auth.error !== 'not_allowed'} />}
    </>
  )
}

// Googleのログイン画面（初回・ログイン切れ）
function GoogleLogin({ auth, overlay = false }) {
  const buttonRef = useRef(null)
  useEffect(() => {
    if (buttonRef.current) renderSignInButton(buttonRef.current).catch(() => {})
  }, [auth.error])
  const notice = auth.error ? AUTH_MESSAGES[auth.error] : null
  const isNotAllowed = auth.error === 'not_allowed'
  return (
    <Screen overlay={overlay}>
      <p style={s.title}>{isNotAllowed ? 'ログイン' : overlay ? 'もう一度ログイン' : 'ようこそ'}</p>
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
  )
}

// 初回（またはパスキーなしで鍵がかかった後）：Googleログイン → 登録メールか確認 → 指紋・顔認証の登録
function SetupScreen({ auth }) {
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { requireIdToken().catch(() => {}) }, [])

  // 登録されたアカウントかをサーバーで確認してから先へ進む
  useEffect(() => {
    if (!auth.signedIn || verified) return
    let alive = true
    gasApi.getLastImportedAt()
      .then(() => {
        if (!alive) return
        if (skippedPasskey() || !webauthnAvailable()) openWithoutPasskey(auth.email)
        else setVerified(true)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [auth.signedIn, auth.email, verified])

  if (!auth.signedIn || !verified) {
    if (auth.signedIn && !auth.needLogin) return <Screen><p style={s.lead}>確認中…</p></Screen>
    return <GoogleLogin auth={auth} />
  }

  const register = async () => {
    setBusy(true)
    setMsg('')
    try {
      setSkippedPasskey(false)
      await registerPasskey(auth.email)
    } catch (e) {
      setMsg(e?.name === 'NotAllowedError' ? '登録をキャンセルしました' : `登録できませんでした（${e?.message || e}）`)
    } finally {
      setBusy(false)
    }
  }
  const skip = () => {
    setSkippedPasskey(true)
    openWithoutPasskey(auth.email)
  }

  return (
    <Screen>
      <p style={s.title}>指紋・顔認証で開く</p>
      <p style={s.lead}>
        次回から指紋・顔認証だけで開けるようにします。家計のデータは、この認証でしか開けない鍵で暗号化して端末に保存するので、開くのも速くなります。最後の操作から1時間たつと鍵がかかります。
      </p>
      <button type="button" style={s.primary} disabled={busy} onClick={register}>
        {busy ? '登録中…' : '指紋・顔認証を登録する'}
      </button>
      {msg && <p style={s.error}>{msg}</p>}
      <button type="button" style={s.linkButton} onClick={skip}>
        今回は登録しない（毎回Googleでログイン）
      </button>
    </Screen>
  )
}

// 鍵がかかっているとき
function LockScreen({ vault }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const tried = useRef(false)

  const unlock = async () => {
    setBusy(true)
    setMsg('')
    try {
      await unlockWithPasskey()
    } catch (e) {
      setMsg(e?.name === 'NotAllowedError' ? '' : `開けませんでした（${e?.message || e}）`)
    } finally {
      setBusy(false)
    }
  }

  // 表示したらすぐ認証を出す（端末によってはボタンを押す必要がある）
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    unlock()
  }, [])

  const reset = async () => {
    if (!window.confirm('この端末に保存しているデータ（未送信の保存を含む）を消して、Googleでログインし直します。よろしいですか？')) return
    await wipeVault()
    setSkippedPasskey(false)
    switchAccount()
  }

  return (
    <Screen>
      <p style={s.title}>🔒 ロック中</p>
      <p style={s.lead}>
        {vault.email ? <>{vault.email}<br /></> : null}
        指紋・顔認証で開いてください。
      </p>
      <button type="button" style={s.primary} disabled={busy} onClick={unlock}>
        {busy ? '認証中…' : '指紋・顔認証で開く'}
      </button>
      {msg && <p style={s.error}>{msg}</p>}
      <button type="button" style={s.linkButton} onClick={reset}>
        別のアカウントでログイン／この端末のデータを消す
      </button>
    </Screen>
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

// 今すぐ鍵をかけるボタン
export function LockButton({ style, label = '🔒' }) {
  const [vault, setVault] = useState(getVaultState())
  useEffect(() => subscribeVault(setVault), [])
  if (vault.status !== 'unlocked') return null
  return (
    <button type="button" onClick={() => lock()} style={style} title="ロックする" aria-label="ロックする">
      {label}
    </button>
  )
}

// ログアウト：この端末のデータをすべて消す
export async function signOutAndWipe() {
  await wipeVault()
  setSkippedPasskey(false)
  await signOut()
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
  primary: {
    width: '100%',
    minHeight: 48,
    border: 'none',
    borderRadius: 999,
    background: '#003087',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: font,
  },
  error: { fontSize: 13, color: '#c0392b', margin: '12px 0 0' },
}
