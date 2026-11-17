import { useEffect, useState } from 'react'
import './UpdateBanner.css'

// 新しい版が公開されたら画面の上に知らせる。勝手には再読み込みしない（入力途中を消さないため）。
// 確認するのは、開いたとき・アプリに戻ってきたとき・開きっぱなしなら30分ごと
const CHECK_EVERY = 30 * 60 * 1000
const VERSION_URL = `${import.meta.env.BASE_URL}version.json`

export default function UpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const r = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const { build } = await r.json()
        if (build && build !== __BUILD_ID__) setHasUpdate(build)
      } catch { /* 通信できないときは次の機会に */ }
    }
    check()
    const timer = setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  if (!hasUpdate) return null
  return (
    <div className="update-banner" role="status">
      <span>🔄 新しいバージョンがあります</span>
      {/* 普通の再読み込みだと、端末に残った古い画面（最大10分）を読んで真っ白になることがあるので、URLを変えて必ず新しい版を取りに行く */}
      <button type="button" onClick={() => window.location.replace(`${import.meta.env.BASE_URL}?v=${hasUpdate}${window.location.hash}`)}>更新</button>
    </div>
  )
}
