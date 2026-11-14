// タブ移動：どの画面からでも goTo('assets') / goTo('future', 'home') で切り替える（App が受け取る）
const EVENT = 'okane:go'

export function goTo(tab, sub) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tab, sub } }))
}

export function onGoTo(handler) {
  const fn = (e) => handler(e.detail || {})
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

// LPチェックなどの「直す場所」ボタンの表示名
export const GO_LABEL = {
  assets: '資産タブで直す',
  settings: '設定タブで直す',
  input: '入力タブで直す',
  'future/home': '家で直す',
}
