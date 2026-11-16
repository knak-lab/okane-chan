import { useEffect, useRef, useState } from 'react'

// 全画面表示。使えるブラウザでは本当の全画面＋横向き固定を試し、
// 使えなければ（iPhone など）画面いっぱいの重ね表示にする
export default function useFullscreen() {
  const [full, setFull] = useState(false)
  const ref = useRef(null)

  const open = async () => {
    setFull(true)
    try {
      await ref.current?.requestFullscreen?.()
      await screen.orientation?.lock?.('landscape')
    } catch { /* 重ね表示のまま、端末を横にして見る */ }
  }
  const close = async () => {
    setFull(false)
    try { screen.orientation?.unlock?.() } catch { /* なし */ }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  // 重ね表示の間は後ろの画面をスクロールさせない
  useEffect(() => {
    if (!full) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [full])

  return { full, ref, open, close }
}
