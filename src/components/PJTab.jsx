import { useEffect, useRef, useState } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import { HOMEST_EMBED_URL, HOMEST_ORIGIN, fromHomest } from '../utils/homest'
import './PJTab.css'

// 旧「家」タブの保存先。homest にまだ予算がないときの初期値として渡す
const PJ_TYPE = 'house'
const toNum = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0

// 「家」タブは homest の予算画面をそのまま表示する。どちらで編集しても同じデータ（homest の Supabase）を見る
export default function PJTab() {
  const frameRef = useRef(null)
  const [height, setHeight] = useState(480)

  useEffect(() => {
    const onMsg = async (e) => {
      if (fromHomest(e, 'homest:height')) setHeight(Math.max(240, Number(e.data.height) || 0))
      if (fromHomest(e, 'homest:need-seed') && isGasReady()) {
        try {
          const r = await gasApi.getPJData(PJ_TYPE)
          const d = r.data || {}
          frameRef.current?.contentWindow?.postMessage({
            type: 'homest:seed',
            data: {
              land_price: toNum(d.landPrice), land_area: toNum(d.landArea), coverage_ratio: toNum(d.coverageRatio),
              tsubo_price: toNum(d.unitPrice), down_payment: toNum(d.downPayment),
            },
          }, HOMEST_ORIGIN)
        } catch { /* 旧データが読めなくても homest 側は空のまま使える */ }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div className="pj-tab">
      <iframe ref={frameRef} className="pj-frame" title="homest 予算" src={HOMEST_EMBED_URL} style={{ height }} />
      <a className="pj-open-link" href={HOMEST_EMBED_URL.replace(/\?.*$/, '')} target="_blank" rel="noreferrer">homestで開く ↗</a>
    </div>
  )
}
