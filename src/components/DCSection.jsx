import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './InvestmentSection.css'

let _uid = Date.now() + 2000000
const newId = () => String(_uid++)

const today = new Date()
const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const thisMonthNum = today.getMonth() + 1
const isInputSeason = thisMonthNum === 6 || thisMonthNum === 12

const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt = (v) => v == null ? '—' : `¥${Math.round(v).toLocaleString()}`
const fmtSigned = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}¥${Math.abs(Math.round(v)).toLocaleString()}`
const fmtRate = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

function calcCumulative(companyAmt, selfAmt, startMonth, targetMonth) {
  if (!startMonth || !targetMonth) return 0
  const [sy, sm] = startMonth.split('-').map(Number)
  const [ty, tm] = targetMonth.split('-').map(Number)
  const months = (ty - sy) * 12 + (tm - sm) + 1
  if (months <= 0) return 0
  return (parseAmt(companyAmt) + parseAmt(selfAmt)) * months
}

function simulateFV(currentEval, monthlyTotal, annualRatePct, yearsArr) {
  const pv  = parseAmt(currentEval)
  const pmt = parseAmt(monthlyTotal)
  const r   = (parseFloat(annualRatePct) || 0) / 100 / 12
  return yearsArr.map(years => {
    const n = years * 12
    if (r === 0) return pv + pmt * n
    const factor = Math.pow(1 + r, n)
    return pv * factor + pmt * (factor - 1) / r
  })
}

const SIM_YEARS = [1, 3, 5, 10, 20, 30]

// ── 評価額セクション ──
function EvalSection({ account, onUpdate }) {
  const [form, setForm] = useState({ yearMonth: thisMonth, evalAmt: '' })

  const sorted = [...(account.records || [])].sort((a, b) =>
    b.yearMonth.localeCompare(a.yearMonth)
  )

  const addRecord = () => {
    if (!form.yearMonth || !form.evalAmt) return
    const rec = { id: newId(), yearMonth: form.yearMonth, evalAmt: form.evalAmt }
    const next = [...account.records.filter(r => r.yearMonth !== form.yearMonth), rec]
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    onUpdate({ ...account, records: next })
    setForm(p => ({ ...p, evalAmt: '' }))
  }

  const removeRecord = (id) => {
    onUpdate({ ...account, records: account.records.filter(r => r.id !== id) })
  }

  return (
    <div className="inv-eval-section">
      {isInputSeason && !account.records.some(r => r.yearMonth === thisMonth) && (
        <div className="inv-input-prompt">
          📊 {thisMonthNum}月は評価額入力のタイミングです
        </div>
      )}

      <div className="inv-new-eval">
        <input
          className="inv-cell-input"
          type="month"
          value={form.yearMonth}
          onChange={e => setForm(p => ({ ...p, yearMonth: e.target.value }))}
        />
        <input
          className="inv-cell-input inv-cell-input--wide"
          type="number"
          placeholder="評価額（円）"
          value={form.evalAmt}
          onChange={e => setForm(p => ({ ...p, evalAmt: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && addRecord()}
        />
        <button className="inv-record-btn" onClick={addRecord}>記録</button>
      </div>

      {sorted.length > 0 ? (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>年月</th>
                <th className="r">評価額</th>
                <th className="r">累計拠出額</th>
                <th className="r">損益</th>
                <th className="r">損益率</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const cum  = calcCumulative(account.companyAmt, account.selfAmt, account.startMonth, r.yearMonth)
                const ev   = parseAmt(r.evalAmt)
                const pnl  = ev - cum
                const pnlR = cum ? pnl / cum * 100 : null
                return (
                  <tr key={r.id}>
                    <td className="inv-month-cell">{r.yearMonth}</td>
                    <td className="r">{fmt(ev)}</td>
                    <td className="r inv-muted">{fmt(cum)}</td>
                    <td className={`r ${pnl >= 0 ? 'inv-pos' : 'inv-neg'}`}>{fmtSigned(pnl)}</td>
                    <td className={`r ${pnlR >= 0 ? 'inv-pos' : 'inv-neg'}`}>{fmtRate(pnlR)}</td>
                    <td>
                      <button className="inv-rm-row" onClick={() => removeRecord(r.id)}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="inv-empty-row">評価額を記録してください</p>
      )}
    </div>
  )
}

// ── アカウント情報セクション ──
function AccountInfoSection({ account, onUpdate }) {
  const upd = (f, v) => onUpdate({ ...account, [f]: v })
  const totalMonthly = parseAmt(account.companyAmt) + parseAmt(account.selfAmt)
  return (
    <div className="inv-master-section">
      <label className="inv-field">
        <span className="inv-field-label">運用機関</span>
        <input className="inv-input" value={account.institution} onChange={e => upd('institution', e.target.value)} placeholder="大和証券" />
      </label>
      <label className="inv-field">
        <span className="inv-field-label">開始年月</span>
        <input className="inv-input" type="month" value={account.startMonth} onChange={e => upd('startMonth', e.target.value)} />
      </label>
      <label className="inv-field">
        <span className="inv-field-label">会社掛金（円/月）</span>
        <input className="inv-input inv-input--num" type="number" value={account.companyAmt} onChange={e => upd('companyAmt', e.target.value)} placeholder="16000" />
      </label>
      <label className="inv-field">
        <span className="inv-field-label">自己掛金（円/月）</span>
        <input className="inv-input inv-input--num" type="number" value={account.selfAmt} onChange={e => upd('selfAmt', e.target.value)} placeholder="0" />
      </label>
      {totalMonthly > 0 && (
        <div className="inv-field">
          <span className="inv-field-label">合計掛金</span>
          <span className="inv-muted" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
            {fmt(totalMonthly)} / 月
          </span>
        </div>
      )}
      <label className="inv-field">
        <span className="inv-field-label">想定利率（%/年）</span>
        <input className="inv-input inv-input--num" type="number" step="0.1" value={account.expectedRate} onChange={e => upd('expectedRate', e.target.value)} placeholder="3.0" />
      </label>
    </div>
  )
}

// ── シミュレーションセクション ──
function SimSection({ account }) {
  const sorted = [...(account.records || [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  const latest = sorted[0]
  if (!latest) {
    return <p className="inv-empty-row">評価額を記録すると将来シミュレーションが表示されます</p>
  }

  const latestEv    = parseAmt(latest.evalAmt)
  const latestCum   = calcCumulative(account.companyAmt, account.selfAmt, account.startMonth, latest.yearMonth)
  const monthlyTotal = parseAmt(account.companyAmt) + parseAmt(account.selfAmt)
  const fvArr       = simulateFV(latestEv, monthlyTotal, account.expectedRate, SIM_YEARS)

  return (
    <div className="inv-sim-section">
      <p className="inv-sim-note">
        基準: {latest.yearMonth} 評価額 {fmt(latestEv)} ／ 掛金 {fmt(monthlyTotal)}/月（会社 {fmt(parseAmt(account.companyAmt))} + 自己 {fmt(parseAmt(account.selfAmt))}）／ 想定 {account.expectedRate || '0'}%/年
      </p>
      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>期間</th>
              <th className="r">想定評価額</th>
              <th className="r">追加拠出</th>
              <th className="r">累計拠出総額</th>
              <th className="r">想定損益</th>
            </tr>
          </thead>
          <tbody>
            {SIM_YEARS.map((years, i) => {
              const fv       = fvArr[i]
              const addl     = monthlyTotal * years * 12
              const totalInv = latestCum + addl
              const pnl      = fv - totalInv
              return (
                <tr key={years}>
                  <td className="inv-month-cell">{years}年後</td>
                  <td className="r inv-strong">{fmt(fv)}</td>
                  <td className="r inv-muted">+{fmt(addl)}</td>
                  <td className="r inv-muted">{fmt(totalInv)}</td>
                  <td className={`r ${pnl >= 0 ? 'inv-pos' : 'inv-neg'}`}>{fmtSigned(pnl)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── DCアカウントカード ──
function DCCard({ account, onUpdate, onRemove }) {
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab]       = useState('eval')

  const sorted = [...(account.records || [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  const latest = sorted[0]

  const latestEv   = latest ? parseAmt(latest.evalAmt) : null
  const latestCum  = latest ? calcCumulative(account.companyAmt, account.selfAmt, account.startMonth, latest.yearMonth) : null
  const latestPnL  = latest ? latestEv - latestCum : null
  const latestPnLR = latestCum ? latestPnL / latestCum * 100 : null

  const needsBadge = isInputSeason && !account.records.some(r => r.yearMonth === thisMonth)

  const TABS = [
    { id: 'eval', label: '評価額入力' },
    { id: 'info', label: 'アカウント情報' },
    { id: 'sim',  label: '将来シミュ' },
  ]

  return (
    <div className="inv-card">
      <div
        className={`inv-header${isOpen ? ' inv-header--open' : ''}`}
        onClick={() => setIsOpen(p => !p)}
      >
        <span className="inv-expand">{isOpen ? '▾' : '▸'}</span>
        <span className="inv-name">{account.institution || '運用機関未設定'}</span>
        {needsBadge && <span className="inv-badge">{thisMonthNum}月入力</span>}
        <span className="inv-meta">企業型DC</span>
        {latest && (
          <span className={`inv-pnl ${latestPnL >= 0 ? 'inv-pnl--pos' : 'inv-pnl--neg'}`}>
            {fmtSigned(latestPnL)} ({fmtRate(latestPnLR)})
          </span>
        )}
        <button className="inv-remove-card-btn" onClick={e => { e.stopPropagation(); onRemove(account.id) }}>×</button>
      </div>

      {isOpen && (
        <div className="inv-body">
          {latest && (
            <div className="inv-kpi-row">
              <div className="inv-kpi">
                <span className="inv-kpi-label">評価額</span>
                <span className="inv-kpi-value">{fmt(latestEv)}</span>
              </div>
              <div className="inv-kpi">
                <span className="inv-kpi-label">累計拠出</span>
                <span className="inv-kpi-value inv-muted">{fmt(latestCum)}</span>
              </div>
              <div className="inv-kpi">
                <span className="inv-kpi-label">損益</span>
                <span className={`inv-kpi-value ${latestPnL >= 0 ? 'inv-pos' : 'inv-neg'}`}>
                  {fmtSigned(latestPnL)}
                </span>
              </div>
              <div className="inv-kpi">
                <span className="inv-kpi-label">損益率</span>
                <span className={`inv-kpi-value ${latestPnLR >= 0 ? 'inv-pos' : 'inv-neg'}`}>
                  {fmtRate(latestPnLR)}
                </span>
              </div>
            </div>
          )}

          <div className="inv-tab-bar">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`inv-tab-btn${tab === t.id ? ' inv-tab-btn--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'eval' && <EvalSection        account={account} onUpdate={onUpdate} />}
          {tab === 'info' && <AccountInfoSection  account={account} onUpdate={onUpdate} />}
          {tab === 'sim'  && <SimSection          account={account} />}
        </div>
      )}
    </div>
  )
}

// ── メイン ──
export default function DCSection() {
  const [accounts,   setAccounts]   = useState([])
  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg,    setSaveMsg]    = useState('')

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const data    = await gasApi.getDCAccounts()
      const masters = data.masters || []
      const records = data.records || []

      setAccounts(masters.map(m => ({
        id:           newId(),
        institution:  m['運用機関']        || '',
        startMonth:   m['開始年月']        || '',
        companyAmt:   m['会社掛金(円/月)'] || '',
        selfAmt:      m['自己掛金(円/月)'] || '',
        expectedRate: m['想定利率(%)']     || '',
        records: records
          .filter(r => r['運用機関'] === m['運用機関'])
          .map(r => ({ id: newId(), yearMonth: r['年月'] || '', evalAmt: r['評価額'] || '' }))
          .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)),
      })))

      setLoadStatus('done')
      setLoadMsg(`${masters.length}件のDCアカウントを読み込みました`)
      setSaveStatus('idle')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveMsg('')
    try {
      const masters = accounts.map(a => ({
        '運用機関':        a.institution,
        '開始年月':        a.startMonth,
        '会社掛金(円/月)': a.companyAmt,
        '自己掛金(円/月)': a.selfAmt,
        '想定利率(%)':     a.expectedRate,
      }))
      const records = accounts.flatMap(a =>
        a.records.map(r => {
          const cum = calcCumulative(a.companyAmt, a.selfAmt, a.startMonth, r.yearMonth)
          const ev  = parseAmt(r.evalAmt)
          return {
            '年月':     r.yearMonth,
            '運用機関': a.institution,
            '評価額':   r.evalAmt,
            '累計拠出額': String(cum),
            '損益':     String(Math.round(ev - cum)),
          }
        })
      )
      await gasApi.saveDCAccounts({ masters, records })
      setSaveStatus('saved'); setSaveMsg('保存しました')
    } catch (e) {
      setSaveStatus('error'); setSaveMsg(e.message)
    }
  }

  const addAccount = () => {
    setAccounts(p => [...p, {
      id: newId(), institution: '', startMonth: '', companyAmt: '', selfAmt: '', expectedRate: '', records: [],
    }])
    setSaveStatus('idle')
  }

  const updateAccount = (updated) => {
    setAccounts(p => p.map(a => a.id !== updated.id ? a : updated))
    setSaveStatus('idle')
  }

  const removeAccount = (id) => {
    setAccounts(p => p.filter(a => a.id !== id))
    setSaveStatus('idle')
  }

  return (
    <div className="investment-section">
      <div className="inv-section-head">
        <h3 className="inv-section-title">企業型DC</h3>
        {isGasReady() && (
          <div className="inv-toolbar">
            <button className={`load-btn load-btn--${loadStatus}`} onClick={handleLoad} disabled={loadStatus === 'loading'}>
              {loadStatus === 'loading' ? '読込中…' : '読み込む'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
            {accounts.length > 0 && (
              <button className={`save-btn-dash save-btn-dash--${saveStatus}`} onClick={handleSave} disabled={saveStatus === 'saving'}>
                {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '変更を保存'}
              </button>
            )}
            {saveMsg && <span className={`load-msg load-msg--${saveStatus}`}>{saveMsg}</span>}
          </div>
        )}
      </div>

      <div className="inv-list">
        {accounts.map(a => (
          <DCCard key={a.id} account={a} onUpdate={updateAccount} onRemove={removeAccount} />
        ))}
        {accounts.length === 0 && (
          <p className="inv-empty">「＋ DCを追加」でアカウントを登録してください</p>
        )}
      </div>

      <button className="inv-add-btn" onClick={addAccount}>＋ DCを追加</button>
    </div>
  )
}
