import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import { fromGas, calcCumulativeJPY } from '../utils/insuranceUtils'
import './InsuranceSimulator.css'

const fmt    = (v) => v === 0 ? '¥0' : `¥${Math.round(v).toLocaleString()}`
const fmtUSD = (v) => { const n = parseFloat(v); return isNaN(n) ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` }

function SimCard({ ins, rate }) {
  const cumJPY      = calcCumulativeJPY(ins.payments, rate)
  const annualJPY   = parseFloat(ins.annualPremiumUSD) * rate
  const sorted      = [...ins.surrenderValues].sort((a, b) => Number(a.year) - Number(b.year))

  return (
    <div className="sim-card">
      <div className="sim-card-head">
        <span className="sim-card-name">{ins.name || '—'}</span>
        <span className="sim-card-meta">開始: {ins.startMonth || '—'}</span>
        <span className="sim-card-meta">年払い: {fmtUSD(ins.annualPremiumUSD)} = {rate ? fmt(annualJPY) : '—'}</span>
      </div>

      <div className="sim-cumulative">
        <span className="sim-cum-label">累計支払額（円）</span>
        <strong className="sim-cum-value">{cumJPY > 0 ? fmt(cumJPY) : '記録なし'}</strong>
        <span className="sim-cum-note">{ins.payments.length}件の支払い記録</span>
      </div>

      {sorted.length > 0 ? (
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead>
              <tr>
                <th>解約年度</th>
                <th className="r">一括返戻 (USD)</th>
                <th className="r">一括返戻 (円)</th>
                <th className="r">損益 (一括)</th>
                <th className="r">分割総受取 (USD)</th>
                <th className="r">分割総受取 (円)</th>
                <th className="r">損益 (分割)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const lumpUSD    = parseFloat(s.lumpSumUSD) || 0
                const lumpJPY    = lumpUSD * rate
                const instAmt    = parseFloat(s.installmentAmtUSD) || 0
                const instYrs    = parseFloat(s.installmentYears) || 0
                const instTotal  = instAmt * instYrs
                const instJPY    = instTotal * rate
                const plLump     = lumpJPY - cumJPY
                const plInst     = instJPY - cumJPY
                const hasInst    = instAmt > 0 && instYrs > 0
                return (
                  <tr key={s.id}>
                    <td className="sim-year">{s.year ? `${s.year}年目` : '—'}</td>
                    <td className="r sim-usd">{fmtUSD(lumpUSD)}</td>
                    <td className="r sim-jpy">{rate ? fmt(lumpJPY) : '—'}</td>
                    <td className={`r sim-pl ${plLump >= 0 ? 'sim-pl--pos' : 'sim-pl--neg'}`}>
                      {rate && cumJPY > 0 ? (plLump >= 0 ? '▲' : '▼') + fmt(Math.abs(plLump)) : '—'}
                    </td>
                    <td className="r sim-usd">{hasInst ? fmtUSD(instTotal) : '—'}</td>
                    <td className="r sim-jpy">{hasInst && rate ? fmt(instJPY) : '—'}</td>
                    <td className={`r sim-pl ${plInst >= 0 ? 'sim-pl--pos' : 'sim-pl--neg'}`}>
                      {hasInst && rate && cumJPY > 0 ? (plInst >= 0 ? '▲' : '▼') + fmt(Math.abs(plInst)) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sim-no-data">解約返戻金データなし（「資産」タブで入力してください）</p>
      )}
    </div>
  )
}

export default function InsuranceSimulator() {
  const [insurances,   setInsurances]   = useState([])
  const [rate,         setRate]         = useState('')
  const [fetchingRate, setFetchingRate] = useState(false)
  const [rateMsg,      setRateMsg]      = useState('')
  const [loadStatus,   setLoadStatus]   = useState('idle')
  const [loadMsg,      setLoadMsg]      = useState('')

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const data = await gasApi.getInsurances()
      setInsurances(fromGas(data))
      setLoadStatus('done')
      setLoadMsg(`${(data.masters || []).length}件`)
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const fetchRate = async () => {
    setFetchingRate(true); setRateMsg('')
    try {
      const res  = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const jpy  = data.rates?.JPY
      if (!jpy) throw new Error('JPYレートが取得できませんでした')
      setRate(jpy.toFixed(2))
      setRateMsg(`取得: 1 USD = ${jpy.toFixed(2)} JPY`)
    } catch (e) {
      setRateMsg(`取得失敗: ${e.message}`)
    }
    setFetchingRate(false)
  }

  const currentRate  = parseFloat(rate) || 0
  const totalCumJPY  = insurances.reduce((s, ins) => s + calcCumulativeJPY(ins.payments, currentRate), 0)

  return (
    <div className="ins-sim">

      {/* ── レート入力 ── */}
      <div className="sim-rate-bar">
        <span className="sim-rate-label">為替レート (USD/JPY)</span>
        <input
          className="sim-rate-input"
          type="number"
          value={rate}
          onChange={e => { setRate(e.target.value); setRateMsg('') }}
          placeholder="155.00"
        />
        <button className="sim-fetch-btn" onClick={fetchRate} disabled={fetchingRate}>
          {fetchingRate ? '取得中…' : '最新為替取得'}
        </button>
        {rateMsg && <span className="sim-rate-msg">{rateMsg}</span>}
        {isGasReady() && (
          <>
            <button className={`load-btn load-btn--${loadStatus} sim-reload-btn`} onClick={handleLoad} disabled={loadStatus === 'loading'}>
              {loadStatus === 'loading' ? '読込中…' : 'データ再読込'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
          </>
        )}
      </div>

      {/* ── 全保険合計サマリ ── */}
      {insurances.length > 0 && currentRate > 0 && (
        <div className="sim-summary-card">
          <div className="sim-summary-row">
            <span className="sim-summary-label">為替レート</span>
            <strong className="sim-summary-val sim-summary-val--rate">1 USD = ¥{parseFloat(rate).toFixed(2)}</strong>
          </div>
          <div className="sim-summary-row">
            <span className="sim-summary-label">全保険 累計支払合計</span>
            <strong className="sim-summary-val">{fmt(totalCumJPY)}</strong>
          </div>
          <div className="sim-summary-row">
            <span className="sim-summary-label">登録保険数</span>
            <strong className="sim-summary-val">{insurances.length}件</strong>
          </div>
        </div>
      )}

      {/* ── 保険別シミュレーション ── */}
      {!currentRate && insurances.length > 0 && (
        <p className="sim-hint">為替レートを入力するとシミュレーションが表示されます</p>
      )}

      {insurances.length > 0 && currentRate > 0 && (
        <div className="sim-cards">
          {insurances.map(ins => (
            <SimCard key={ins.id} ins={ins} rate={currentRate} />
          ))}
        </div>
      )}

      {loadStatus === 'done' && insurances.length === 0 && (
        <div className="sim-empty-state">
          <p>外貨保険データがありません</p>
          <p className="sim-empty-hint">「資産」タブの「外貨保険」セクションで保険を登録してください</p>
        </div>
      )}

      {!isGasReady() && (
        <p className="sim-hint">GAS URLが設定されていません</p>
      )}
    </div>
  )
}
