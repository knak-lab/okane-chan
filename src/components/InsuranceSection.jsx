import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import { fromGas, toGas } from '../utils/insuranceUtils'
import './InsuranceSection.css'

let _uid = Date.now()
const newId = () => String(_uid++)

function newInsurance() {
  return { id: newId(), name: '', startMonth: '', annualPremiumUSD: '', currency: 'USD', surrenderValues: [], payments: [] }
}
function newSurrenderRow() {
  return { id: newId(), year: '', lumpSumUSD: '', installmentYears: '', installmentAmtUSD: '' }
}
function newPaymentRow() {
  return { id: newId(), yearMonth: '', amtUSD: '', rate: '', amtJPY: '' }
}

function calcJPY(usd, rate) {
  const u = parseFloat(usd)
  const r = parseFloat(rate)
  return u > 0 && r > 0 ? String(Math.round(u * r)) : ''
}

// ── 契約情報 ──
function InfoSection({ ins, onChange }) {
  const upd = (f, v) => onChange({ ...ins, [f]: v })
  return (
    <div className="ins-info">
      <label className="ins-field">
        <span className="ins-field-label">保険名</span>
        <input className="ins-input" value={ins.name} onChange={e => upd('name', e.target.value)} placeholder="例: メットライフ終身" />
      </label>
      <label className="ins-field">
        <span className="ins-field-label">開始年月</span>
        <input className="ins-input" value={ins.startMonth} onChange={e => upd('startMonth', e.target.value)} placeholder="2020-04" />
      </label>
      <label className="ins-field">
        <span className="ins-field-label">年払い額 (USD)</span>
        <input className="ins-input ins-input--num" type="number" value={ins.annualPremiumUSD} onChange={e => upd('annualPremiumUSD', e.target.value)} placeholder="1000" />
      </label>
      <div className="ins-field">
        <span className="ins-field-label">通貨</span>
        <span className="ins-currency-badge">USD</span>
      </div>
    </div>
  )
}

// ── 解約返戻金テーブル ──
function SurrenderSection({ ins, onChange }) {
  const addRow    = () => onChange({ ...ins, surrenderValues: [...ins.surrenderValues, newSurrenderRow()] })
  const removeRow = (id) => onChange({ ...ins, surrenderValues: ins.surrenderValues.filter(s => s.id !== id) })
  const updRow    = (id, f, v) => onChange({ ...ins, surrenderValues: ins.surrenderValues.map(s => s.id !== id ? s : { ...s, [f]: v }) })

  return (
    <div className="ins-surrender">
      <div className="ins-table-wrap">
        <table className="ins-table">
          <thead>
            <tr>
              <th>解約年度</th>
              <th>一括額 (USD)</th>
              <th>分割年数</th>
              <th>分割額 (USD/年)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ins.surrenderValues.map(s => (
              <tr key={s.id}>
                <td><input className="ins-cell-input" type="number" value={s.year}              onChange={e => updRow(s.id, 'year',              e.target.value)} placeholder="1" /></td>
                <td><input className="ins-cell-input" type="number" value={s.lumpSumUSD}        onChange={e => updRow(s.id, 'lumpSumUSD',        e.target.value)} placeholder="0" /></td>
                <td><input className="ins-cell-input" type="number" value={s.installmentYears}  onChange={e => updRow(s.id, 'installmentYears',  e.target.value)} placeholder="10" /></td>
                <td><input className="ins-cell-input" type="number" value={s.installmentAmtUSD} onChange={e => updRow(s.id, 'installmentAmtUSD', e.target.value)} placeholder="0" /></td>
                <td><button className="ins-rm-row" onClick={() => removeRow(s.id)}>×</button></td>
              </tr>
            ))}
            {ins.surrenderValues.length === 0 && (
              <tr><td colSpan={5} className="ins-table-empty">証券の表を入力してください</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button className="ins-add-row-btn" onClick={addRow}>＋ 行を追加</button>
    </div>
  )
}

// ── 年払い記録 ──
function PaymentSection({ ins, onChange }) {
  const addRow    = () => onChange({ ...ins, payments: [...ins.payments, newPaymentRow()] })
  const removeRow = (id) => onChange({ ...ins, payments: ins.payments.filter(p => p.id !== id) })
  const updRow    = (id, f, v) => {
    onChange({
      ...ins,
      payments: ins.payments.map(p => {
        if (p.id !== id) return p
        const next = { ...p, [f]: v }
        if (f === 'amtUSD' || f === 'rate') next.amtJPY = calcJPY(next.amtUSD, next.rate)
        return next
      }),
    })
  }

  return (
    <div className="ins-payments">
      <div className="ins-table-wrap">
        <table className="ins-table">
          <thead>
            <tr>
              <th>年月</th>
              <th>支払額 (USD)</th>
              <th>為替レート</th>
              <th>円換算額</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ins.payments.map(p => (
              <tr key={p.id}>
                <td><input className="ins-cell-input" value={p.yearMonth} onChange={e => updRow(p.id, 'yearMonth', e.target.value)} placeholder="2024-04" /></td>
                <td><input className="ins-cell-input" type="number" value={p.amtUSD} onChange={e => updRow(p.id, 'amtUSD', e.target.value)} placeholder="0" /></td>
                <td><input className="ins-cell-input" type="number" value={p.rate}   onChange={e => updRow(p.id, 'rate',   e.target.value)} placeholder="155.0" /></td>
                <td><input className="ins-cell-input" type="number" value={p.amtJPY} onChange={e => updRow(p.id, 'amtJPY', e.target.value)} placeholder="自動計算" /></td>
                <td><button className="ins-rm-row" onClick={() => removeRow(p.id)}>×</button></td>
              </tr>
            ))}
            {ins.payments.length === 0 && (
              <tr><td colSpan={5} className="ins-table-empty">年払い月を追加してください</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button className="ins-add-row-btn" onClick={addRow}>＋ 年払いを追加</button>
    </div>
  )
}

// ── 保険カード ──
function InsuranceCard({ ins, onUpdate, onRemove }) {
  const [isOpen, setIsOpen]   = useState(false)
  const [section, setSection] = useState('info')
  const SECTIONS = [
    { id: 'info',     label: '契約情報' },
    { id: 'surrender', label: '解約返戻金' },
    { id: 'payments', label: '年払い記録' },
  ]

  return (
    <div className="ins-card">
      <div className={`ins-header${isOpen ? ' ins-header--open' : ''}`} onClick={() => setIsOpen(p => !p)}>
        <span className="ins-expand">{isOpen ? '▾' : '▸'}</span>
        <span className="ins-card-name">{ins.name || '保険名未設定'}</span>
        <span className="ins-card-meta">開始: {ins.startMonth || '—'}</span>
        <span className="ins-card-meta">USD {ins.annualPremiumUSD || '—'} /年</span>
        <button className="ins-remove-card-btn" onClick={e => { e.stopPropagation(); onRemove(ins.id) }}>×</button>
      </div>

      {isOpen && (
        <div className="ins-body">
          <div className="ins-tab-bar">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`ins-tab-btn${section === s.id ? ' ins-tab-btn--active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {section === 'info'      && <InfoSection     ins={ins} onChange={onUpdate} />}
          {section === 'surrender' && <SurrenderSection ins={ins} onChange={onUpdate} />}
          {section === 'payments'  && <PaymentSection   ins={ins} onChange={onUpdate} />}
        </div>
      )}
    </div>
  )
}

// ── メイン ──
export default function InsuranceSection() {
  const [insurances, setInsurances] = useState([])
  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg,    setSaveMsg]    = useState('')

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const data = await gasApi.getInsurances()
      setInsurances(fromGas(data))
      setLoadStatus('done')
      setLoadMsg(`${(data.masters || []).length}件の保険を読み込みました`)
      setSaveStatus('idle')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveMsg('')
    try {
      await gasApi.saveInsurances(toGas(insurances))
      setSaveStatus('saved'); setSaveMsg('保存しました')
    } catch (e) {
      setSaveStatus('error'); setSaveMsg(e.message)
    }
  }

  const addInsurance = () => {
    setInsurances(p => [...p, newInsurance()])
    setSaveStatus('idle')
  }

  const updateInsurance = (updated) => {
    setInsurances(p => p.map(ins => ins.id !== updated.id ? ins : updated))
    setSaveStatus('idle')
  }

  const removeInsurance = (id) => {
    setInsurances(p => p.filter(ins => ins.id !== id))
    setSaveStatus('idle')
  }

  return (
    <div className="insurance-section">
      <div className="ins-section-head">
        <h3 className="ins-section-title">外貨保険</h3>
        {isGasReady() && (
          <div className="ins-toolbar">
            <button className={`load-btn load-btn--${loadStatus}`} onClick={handleLoad} disabled={loadStatus === 'loading'}>
              {loadStatus === 'loading' ? '読込中…' : '読み込む'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
            {insurances.length > 0 && (
              <button className={`save-btn-dash save-btn-dash--${saveStatus}`} onClick={handleSave} disabled={saveStatus === 'saving'}>
                {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '変更を保存'}
              </button>
            )}
            {saveMsg && <span className={`load-msg load-msg--${saveStatus}`}>{saveMsg}</span>}
          </div>
        )}
      </div>

      <div className="ins-list">
        {insurances.map(ins => (
          <InsuranceCard key={ins.id} ins={ins} onUpdate={updateInsurance} onRemove={removeInsurance} />
        ))}
        {insurances.length === 0 && (
          <p className="ins-empty">「＋ 保険を追加」で外貨保険を登録してください</p>
        )}
      </div>

      <button className="ins-add-btn" onClick={addInsurance}>＋ 保険を追加</button>
    </div>
  )
}
