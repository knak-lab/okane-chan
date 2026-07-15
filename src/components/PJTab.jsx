import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './PJTab.css'

const PJ_TYPE = 'house'

const DEFAULT = {
  landPrice:     '',
  landArea:      '',
  coverageRatio: '',
  unitPrice:     '',
  downPayment:   '',
}

const toNum = (v) => parseFloat(String(v).replace(/,/g, '')) || 0
const fmtMan = (n) => n !== 0 ? `${(Math.round(n * 10) / 10).toLocaleString()}万円` : '—'

export default function PJTab() {
  const [data, setData]       = useState(DEFAULT)
  const [loadStatus, setLoad] = useState('idle')
  const [saveStatus, setSave] = useState('idle')
  const [msg, setMsg]         = useState('')

  useEffect(() => {
    if (!isGasReady()) return
    setLoad('loading')
    gasApi.getPJData(PJ_TYPE)
      .then(r => {
        if (r.data) setData({ ...DEFAULT, ...r.data })
        setLoad('done')
      })
      .catch(e => { setLoad('error'); setMsg(e.message) })
  }, [])

  const set = (key) => (e) => {
    setData(prev => ({ ...prev, [key]: e.target.value }))
    setSave('idle')
  }

  const handleSave = async () => {
    setSave('saving'); setMsg('')
    try {
      await gasApi.savePJData(PJ_TYPE, data)
      setSave('saved'); setMsg('保存しました')
    } catch (e) { setSave('error'); setMsg(e.message) }
  }

  const landPrice     = toNum(data.landPrice)
  const landArea      = toNum(data.landArea)
  const coverageRatio = toNum(data.coverageRatio)
  const unitPrice     = toNum(data.unitPrice)
  const downPayment   = toNum(data.downPayment)

  const buildingTsubo = landArea > 0 && coverageRatio > 0
    ? Math.round(landArea * coverageRatio / 100 / 3.305785 * 10) / 10
    : 0
  const buildingPrice = buildingTsubo > 0 && unitPrice > 0 ? buildingTsubo * unitPrice : 0
  const totalPrice    = landPrice + buildingPrice
  const loan          = totalPrice - downPayment

  return (
    <div className="pj-tab">

      {/* ツールバー */}
      <div className="pj-toolbar">
        <button
          className={`pj-save-btn pj-save-btn--${saveStatus}`}
          onClick={handleSave}
          disabled={saveStatus === 'saving' || loadStatus === 'loading'}
        >
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '保存'}
        </button>
        {loadStatus === 'loading' && <span className="pj-msg">読込中…</span>}
        {msg && <span className={`pj-msg pj-msg--${saveStatus || loadStatus}`}>{msg}</span>}
      </div>

      {/* 基本情報 */}
      <div className="pj-card">
        <p className="pj-card-title">基本情報</p>

        <div className="pj-kpi-row">
          <div className="pj-kpi">
            <span className="pj-kpi-label">購入総額</span>
            <span className="pj-kpi-value">{fmtMan(totalPrice)}</span>
          </div>
        </div>

        <div className="pj-section-label">土地</div>

        <div className="pj-field">
          <label className="pj-label">土地代</label>
          <div className="pj-input-wrap">
            <input className="pj-input" type="text" value={data.landPrice} onChange={set('landPrice')} placeholder="0" />
            <span className="pj-unit">万円</span>
          </div>
        </div>
        <div className="pj-field pj-field--child">
          <label className="pj-label">面積</label>
          <div className="pj-input-wrap">
            <input className="pj-input" type="text" value={data.landArea} onChange={set('landArea')} placeholder="0" />
            <span className="pj-unit">m²</span>
          </div>
        </div>

        <div className="pj-section-label">建物</div>

        <div className="pj-field">
          <label className="pj-label">建物代</label>
          <span className="pj-derived">{fmtMan(buildingPrice)}</span>
        </div>
        <div className="pj-field pj-field--child">
          <label className="pj-label">建蔽率</label>
          <div className="pj-input-wrap">
            <input className="pj-input" type="text" value={data.coverageRatio} onChange={set('coverageRatio')} placeholder="0" />
            <span className="pj-unit">%</span>
          </div>
        </div>
        <div className="pj-field pj-field--child">
          <label className="pj-label">建坪</label>
          <span className="pj-derived">
            {buildingTsubo > 0 ? `${buildingTsubo}坪` : '—'}
            {buildingTsubo > 0 && (
              <span className="pj-hint">　{landArea}m² × {coverageRatio}% ÷ 3.306</span>
            )}
          </span>
        </div>
        <div className="pj-field pj-field--child">
          <label className="pj-label">建築坪単価</label>
          <div className="pj-input-wrap">
            <input className="pj-input" type="text" value={data.unitPrice} onChange={set('unitPrice')} placeholder="0" />
            <span className="pj-unit">万円/坪</span>
          </div>
        </div>
      </div>

      {/* 周辺準備 */}
      <div className="pj-card">
        <p className="pj-card-title">周辺準備</p>

        <div className="pj-field">
          <label className="pj-label">頭金</label>
          <div className="pj-input-wrap">
            <input className="pj-input" type="text" value={data.downPayment} onChange={set('downPayment')} placeholder="0" />
            <span className="pj-unit">万円</span>
          </div>
        </div>
        <div className="pj-field">
          <label className="pj-label">借入金</label>
          <span className={`pj-derived ${loan < 0 ? 'pj-neg' : ''}`}>
            {totalPrice > 0 ? fmtMan(loan) : '—'}
          </span>
        </div>
      </div>

    </div>
  )
}
