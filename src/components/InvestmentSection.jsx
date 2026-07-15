import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './InvestmentSection.css'

let _uid = Date.now()
const newId = () => String(_uid++)

const today = new Date()
const thisMonth    = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const thisMonthNum = today.getMonth() + 1
const isInputSeason = thisMonthNum === 6 || thisMonthNum === 12

const parseAmt  = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt       = (v) => v == null ? '—' : `¥${Math.round(v).toLocaleString()}`
const fmtSigned = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}¥${Math.abs(Math.round(v)).toLocaleString()}`
const fmtRate   = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

// 期間スケジュールから targetMonth 時点の累計投資額を計算
function calcCumulative(schedule, targetMonth) {
  if (!targetMonth || !schedule || schedule.length === 0) return 0
  let total = 0
  for (const p of schedule) {
    if (!p.startMonth || !p.amount) continue
    const effectiveEnd = p.endMonth && p.endMonth <= targetMonth ? p.endMonth : targetMonth
    if (effectiveEnd < p.startMonth) continue
    const [sy, sm] = p.startMonth.split('-').map(Number)
    const [ey, em] = effectiveEnd.split('-').map(Number)
    const months   = (ey - sy) * 12 + (em - sm) + 1
    if (months > 0) total += parseAmt(p.amount) * months
  }
  return total
}

// 現在継続中の期間の積立額を返す（シミュ用）
function getCurrentMonthlyAmt(schedule) {
  if (!schedule || schedule.length === 0) return 0
  const ongoing = schedule.find(p => !p.endMonth)
  if (ongoing) return parseAmt(ongoing.amount)
  const sorted = [...schedule].sort((a, b) => b.startMonth.localeCompare(a.startMonth))
  return parseAmt(sorted[0]?.amount || 0)
}

// FV = PV*(1+r)^n + PMT*((1+r)^n-1)/r  (monthly compounding)
function simulateFV(currentEval, monthlyAmt, annualRatePct, yearsArr) {
  const pv = parseAmt(currentEval)
  const r  = (parseFloat(annualRatePct) || 0) / 100 / 12
  return yearsArr.map(years => {
    const n = years * 12
    if (r === 0) return pv + monthlyAmt * n
    const factor = Math.pow(1 + r, n)
    return pv * factor + monthlyAmt * (factor - 1) / r
  })
}

const SIM_YEARS = [1, 3, 5, 10, 20, 30]

// ── 評価額セクション ──
function EvalSection({ fund, onUpdate }) {
  const [form, setForm] = useState({ yearMonth: thisMonth, evalAmt: '', adjustment: '' })

  const sortedRecords = [...(fund.records || [])].sort((a, b) =>
    b.yearMonth.localeCompare(a.yearMonth)
  )

  const addRecord = () => {
    if (!form.yearMonth || !form.evalAmt) return
    const rec = {
      id:         newId(),
      yearMonth:  form.yearMonth,
      evalAmt:    form.evalAmt,
      adjustment: form.adjustment || '0',
    }
    const next = [...fund.records.filter(r => r.yearMonth !== form.yearMonth), rec]
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    onUpdate({ ...fund, records: next })
    setForm(p => ({ ...p, evalAmt: '', adjustment: '' }))
  }

  const removeRecord = (id) => {
    onUpdate({ ...fund, records: fund.records.filter(r => r.id !== id) })
  }

  return (
    <div className="inv-eval-section">
      {isInputSeason && !fund.records.some(r => r.yearMonth === thisMonth) && (
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
        <input
          className="inv-cell-input inv-cell-input--adj"
          type="number"
          placeholder="調整額（任意）"
          value={form.adjustment}
          onChange={e => setForm(p => ({ ...p, adjustment: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && addRecord()}
        />
        <button className="inv-record-btn" onClick={addRecord}>記録</button>
      </div>
      <p className="inv-adj-hint">調整額：一時入金・移管など積立以外の加算分（マイナス可）</p>

      {sortedRecords.length > 0 ? (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>年月</th>
                <th className="r">評価額</th>
                <th className="r">累計投資</th>
                <th className="r">損益</th>
                <th className="r">損益率</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map(r => {
                const autoCum = calcCumulative(fund.schedule, r.yearMonth)
                const adj     = parseAmt(r.adjustment)
                const cum     = autoCum + adj
                const ev      = parseAmt(r.evalAmt)
                const pnl     = ev - cum
                const pnlR    = cum ? pnl / cum * 100 : null
                return (
                  <tr key={r.id}>
                    <td className="inv-month-cell">{r.yearMonth}</td>
                    <td className="r">{fmt(ev)}</td>
                    <td className="r inv-muted">
                      {fmt(cum)}
                      {adj !== 0 && (
                        <span className="inv-adj-tag">{adj > 0 ? '+' : ''}{fmt(adj)}</span>
                      )}
                    </td>
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

// ── マスタ情報セクション ──
function MasterSection({ fund, onUpdate }) {
  const upd = (f, v) => onUpdate({ ...fund, [f]: v })

  const addPeriod = () => {
    const last = fund.schedule[fund.schedule.length - 1]
    let newStart = thisMonth
    if (last?.endMonth) {
      const [y, m] = last.endMonth.split('-').map(Number)
      newStart = m === 12
        ? `${y + 1}-01`
        : `${y}-${String(m + 1).padStart(2, '0')}`
    }
    onUpdate({
      ...fund,
      schedule: [...fund.schedule, { id: newId(), startMonth: newStart, endMonth: '', amount: '' }],
    })
  }

  const removePeriod = (id) => {
    onUpdate({ ...fund, schedule: fund.schedule.filter(p => p.id !== id) })
  }

  const updPeriod = (id, field, val) => {
    onUpdate({
      ...fund,
      schedule: fund.schedule.map(p => p.id !== id ? p : { ...p, [field]: val }),
    })
  }

  return (
    <div className="inv-master-section">
      <label className="inv-field">
        <span className="inv-field-label">ファンド名</span>
        <input
          className="inv-input"
          value={fund.name}
          onChange={e => upd('name', e.target.value)}
          placeholder="eMAXIS Slim 全世界株式"
        />
      </label>
      <label className="inv-field">
        <span className="inv-field-label">証券会社</span>
        <input
          className="inv-input"
          value={fund.company}
          onChange={e => upd('company', e.target.value)}
          placeholder="楽天証券"
        />
      </label>
      <label className="inv-field">
        <span className="inv-field-label">想定利率（%/年）</span>
        <input
          className="inv-input inv-input--num"
          type="number"
          step="0.1"
          value={fund.expectedRate}
          onChange={e => upd('expectedRate', e.target.value)}
          placeholder="5.0"
        />
      </label>

      <div className="inv-field inv-field--col">
        <span className="inv-field-label">積立スケジュール</span>
        <div className="inv-schedule-list">
          {fund.schedule.map(p => (
            <div key={p.id} className="inv-schedule-row">
              <input
                className="inv-cell-input"
                type="month"
                value={p.startMonth}
                onChange={e => updPeriod(p.id, 'startMonth', e.target.value)}
                title="開始年月"
              />
              <span className="inv-schedule-sep">〜</span>
              <input
                className="inv-cell-input"
                type="month"
                value={p.endMonth}
                onChange={e => updPeriod(p.id, 'endMonth', e.target.value)}
                title="終了年月（空白=現在も継続）"
              />
              <input
                className="inv-cell-input inv-cell-input--wide"
                type="number"
                value={p.amount}
                onChange={e => updPeriod(p.id, 'amount', e.target.value)}
                placeholder="積立額（円/月）"
              />
              {fund.schedule.length > 1 && (
                <button className="inv-rm-row" onClick={() => removePeriod(p.id)}>×</button>
              )}
            </div>
          ))}
          <p className="inv-adj-hint">終了年月を空白にすると「現在も継続」として扱われます</p>
          <button className="inv-add-period-btn" onClick={addPeriod}>＋ 期間を追加</button>
        </div>
      </div>
    </div>
  )
}

// ── シミュレーションセクション ──
function SimSection({ fund }) {
  const sorted = [...(fund.records || [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  const latest = sorted[0]
  if (!latest) {
    return <p className="inv-empty-row">評価額を記録すると将来シミュレーションが表示されます</p>
  }

  const currentAmt = getCurrentMonthlyAmt(fund.schedule)
  const autoCum    = calcCumulative(fund.schedule, latest.yearMonth)
  const adj        = parseAmt(latest.adjustment)
  const latestCum  = autoCum + adj
  const latestEv   = parseAmt(latest.evalAmt)
  const fvArr      = simulateFV(latestEv, currentAmt, fund.expectedRate, SIM_YEARS)

  return (
    <div className="inv-sim-section">
      <p className="inv-sim-note">
        基準: {latest.yearMonth} 評価額 {fmt(latestEv)} ／ 現在積立 {fmt(currentAmt)}/月 ／ 想定 {fund.expectedRate || '0'}%/年
      </p>
      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>期間</th>
              <th className="r">想定評価額</th>
              <th className="r">追加投資</th>
              <th className="r">累計投資総額</th>
              <th className="r">想定損益</th>
            </tr>
          </thead>
          <tbody>
            {SIM_YEARS.map((years, i) => {
              const fv       = fvArr[i]
              const addl     = currentAmt * years * 12
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

// ── ファンドカード ──
function FundCard({ fund, onUpdate, onRemove }) {
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab]       = useState('eval')

  const sorted   = [...(fund.records || [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  const latest   = sorted[0]
  const latestEv = latest ? parseAmt(latest.evalAmt) : null
  const autoCum  = latest ? calcCumulative(fund.schedule, latest.yearMonth) : null
  const adj      = latest ? parseAmt(latest.adjustment) : 0
  const latestCum  = autoCum !== null ? autoCum + adj : null
  const latestPnL  = latestCum !== null ? latestEv - latestCum : null
  const latestPnLR = latestCum ? latestPnL / latestCum * 100 : null

  const needsBadge = isInputSeason && !fund.records.some(r => r.yearMonth === thisMonth)

  const TABS = [
    { id: 'eval',   label: '評価額入力' },
    { id: 'master', label: 'ファンド情報' },
    { id: 'sim',    label: '将来シミュ' },
  ]

  return (
    <div className="inv-card">
      <div
        className={`inv-header${isOpen ? ' inv-header--open' : ''}`}
        onClick={() => setIsOpen(p => !p)}
      >
        <span className="inv-expand">{isOpen ? '▾' : '▸'}</span>
        <span className="inv-name">{fund.name || 'ファンド名未設定'}</span>
        {needsBadge && <span className="inv-badge">{thisMonthNum}月入力</span>}
        <span className="inv-meta">{fund.company || ''}</span>
        {latest && (
          <span className={`inv-pnl ${latestPnL >= 0 ? 'inv-pnl--pos' : 'inv-pnl--neg'}`}>
            {fmtSigned(latestPnL)} ({fmtRate(latestPnLR)})
          </span>
        )}
        <button
          className="inv-remove-card-btn"
          onClick={e => { e.stopPropagation(); onRemove(fund.id) }}
        >×</button>
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
                <span className="inv-kpi-label">累計投資</span>
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

          {tab === 'eval'   && <EvalSection  fund={fund} onUpdate={onUpdate} />}
          {tab === 'master' && <MasterSection fund={fund} onUpdate={onUpdate} />}
          {tab === 'sim'    && <SimSection    fund={fund} />}
        </div>
      )}
    </div>
  )
}

// ── メイン ──
export default function InvestmentSection() {
  const [funds,      setFunds]      = useState([])
  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg,    setSaveMsg]    = useState('')

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const data    = await gasApi.getInvestmentFunds()
      const masters = data.masters || []
      const records = data.records || []

      setFunds(masters.map(m => {
        // スキーママイグレーション: 旧「積立額(円/月)」→ 新「積立スケジュール(JSON)」
        let schedule
        const json = m['積立スケジュール(JSON)']
        if (json) {
          try { schedule = JSON.parse(json).map(p => ({ id: newId(), ...p })) }
          catch { schedule = [] }
        } else if (m['積立額(円/月)']) {
          schedule = [{ id: newId(), startMonth: m['開始年月'] || '', endMonth: '', amount: m['積立額(円/月)'] }]
        } else {
          schedule = [{ id: newId(), startMonth: '', endMonth: '', amount: '' }]
        }

        return {
          id:           newId(),
          name:         m['ファンド名']  || '',
          company:      m['証券会社']    || '',
          schedule,
          expectedRate: m['想定利率(%)'] || '',
          records: records
            .filter(r => r['ファンド名'] === m['ファンド名'])
            .map(r => ({
              id:         newId(),
              yearMonth:  r['年月']   || '',
              evalAmt:    r['評価額'] || '',
              adjustment: r['調整額'] || '0',
            }))
            .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)),
        }
      }))

      setLoadStatus('done')
      setLoadMsg(`${masters.length}件のファンドを読み込みました`)
      setSaveStatus('idle')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveMsg('')
    try {
      const masters = funds.map(f => ({
        'ファンド名':            f.name,
        '証券会社':              f.company,
        '積立スケジュール(JSON)': JSON.stringify(
          f.schedule.map(p => ({ startMonth: p.startMonth, endMonth: p.endMonth, amount: p.amount }))
        ),
        '開始年月':              f.schedule[0]?.startMonth || '',
        '想定利率(%)':           f.expectedRate,
      }))
      const records = funds.flatMap(f =>
        f.records.map(r => {
          const autoCum = calcCumulative(f.schedule, r.yearMonth)
          const adj     = parseAmt(r.adjustment)
          const cum     = autoCum + adj
          const ev      = parseAmt(r.evalAmt)
          return {
            '年月':       r.yearMonth,
            'ファンド名': f.name,
            '評価額':     r.evalAmt,
            '累計投資額': String(cum),
            '損益':       String(Math.round(ev - cum)),
            '調整額':     String(adj),
          }
        })
      )
      await gasApi.saveInvestmentFunds({ masters, records })
      setSaveStatus('saved'); setSaveMsg('保存しました')
    } catch (e) {
      setSaveStatus('error'); setSaveMsg(e.message)
    }
  }

  const addFund = () => {
    setFunds(p => [...p, {
      id:           newId(),
      name:         '',
      company:      '',
      schedule:     [{ id: newId(), startMonth: '', endMonth: '', amount: '' }],
      expectedRate: '',
      records:      [],
    }])
    setSaveStatus('idle')
  }

  const updateFund = (updated) => {
    setFunds(p => p.map(f => f.id !== updated.id ? f : updated))
    setSaveStatus('idle')
  }

  const removeFund = (id) => {
    setFunds(p => p.filter(f => f.id !== id))
    setSaveStatus('idle')
  }

  return (
    <div className="investment-section">
      <div className="inv-section-head">
        <h3 className="inv-section-title">投資信託</h3>
        {isGasReady() && (
          <div className="inv-toolbar">
            <button
              className={`load-btn load-btn--${loadStatus}`}
              onClick={handleLoad}
              disabled={loadStatus === 'loading'}
            >
              {loadStatus === 'loading' ? '読込中…' : '読み込む'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
            {funds.length > 0 && (
              <button
                className={`save-btn-dash save-btn-dash--${saveStatus}`}
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '変更を保存'}
              </button>
            )}
            {saveMsg && <span className={`load-msg load-msg--${saveStatus}`}>{saveMsg}</span>}
          </div>
        )}
      </div>

      <div className="inv-list">
        {funds.map(f => (
          <FundCard key={f.id} fund={f} onUpdate={updateFund} onRemove={removeFund} />
        ))}
        {funds.length === 0 && (
          <p className="inv-empty">「＋ ファンドを追加」で投資信託を登録してください</p>
        )}
      </div>

      <button className="inv-add-btn" onClick={addFund}>＋ ファンドを追加</button>
    </div>
  )
}
