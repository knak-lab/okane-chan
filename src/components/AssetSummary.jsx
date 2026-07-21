import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { gasApi, isGasReady } from '../utils/gasApi'
import { fromGas } from '../utils/insuranceUtils'
import InsuranceSection from './InsuranceSection'
import InvestmentSection from './InvestmentSection'
import DCSection from './DCSection'
import PensionSection from './PensionSection'
import './AssetSummary.css'

const KUBUN = ['kkr', 'acc', '共通']
const TYPES = ['普通預金', '定期預金', '外貨預金']

// 預金系種別（GASの旧データ '預金' も後方互換で含む）
const CAT_DEPOSIT = ['普通預金', '定期預金', '外貨預金', '預金']

const PIE_COLORS = {
  '預金':    '#003087',
  '外貨保険': '#22c55e',
  '投資信託': '#F47920',
  'DC':      '#8b5cf6',
}
const BAR_COLORS = {
  '預金':    '#003087',
  '投資信託': '#F47920',
  'DC':      '#8b5cf6',
}

let _uid = 1
const uid = () => _uid++

const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt      = (v) => v === '' || v == null ? '—' : `¥${parseAmt(v).toLocaleString()}`
const fmtMonth = (m) => m?.replace('-', '/') ?? ''

// ── アコーディオンセクション ──
function SectionAccordion({ title, badge, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="asset-accordion">
      <button
        className={`asset-accordion-hd${open ? ' asset-accordion-hd--open' : ''}`}
        onClick={() => setOpen(p => !p)}
      >
        <span className="asset-accordion-arrow">{open ? '▾' : '▸'}</span>
        <span className="asset-accordion-title">{title}</span>
        {badge && <span className="asset-accordion-badge">{badge}</span>}
      </button>
      {open && <div className="asset-accordion-body">{children}</div>}
    </div>
  )
}

// ── 円グラフ内ラベル ──
const RADIAN = Math.PI / 180
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.06) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight="700">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function AssetSummary() {
  const [accounts,   setAccounts]   = useState([])
  const [invRecords, setInvRecords] = useState([])
  const [dcRecords,  setDcRecords]  = useState([])
  const [insTotal,   setInsTotal]   = useState(0)
  const [expanded,   setExpanded]   = useState(new Set())
  const [addForm,    setAddForm]    = useState(null)
  const [yearAdd,    setYearAdd]    = useState(null)
  const [editId,     setEditId]     = useState(null)
  const [editForm,   setEditForm]   = useState(null)
  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg,    setSaveMsg]    = useState('')
  const [showTotal,  setShowTotal]  = useState(false)

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  // ── GAS 読み込み ──
  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const [aRes, iRes, dRes, insRes, fxRes] = await Promise.allSettled([
        gasApi.getAssets(),
        gasApi.getInvestmentFunds(),
        gasApi.getDCAccounts(),
        gasApi.getInsurances(),
        fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY').then(r => r.json()),
      ])

      // 口座データ（'預金' → '普通預金' マイグレーション）
      const assets = aRes.status === 'fulfilled' ? aRes.value.assets || [] : []
      const grouped = {}
      assets.forEach(r => {
        const type = r['種別'] === '預金' ? '普通預金' : r['種別']
        const key = `${r['区分']}__${type}__${r['口座名']}`
        if (!grouped[key]) grouped[key] = { _id: uid(), 区分: r['区分'], 種別: type, 口座名: r['口座名'], records: [] }
        if (r['月']) grouped[key].records.push({ month: r['月'], amount: r['金額'] ?? '' })
      })
      const accs = Object.values(grouped).map(a => ({
        ...a,
        records: a.records.sort((x, y) => x.month.localeCompare(y.month)),
      }))
      setAccounts(accs)

      // 投資・DC 評価額記録
      setInvRecords(iRes.status === 'fulfilled' ? iRes.value.records || [] : [])
      setDcRecords(dRes.status === 'fulfilled'  ? dRes.value.records  || [] : [])

      // 外貨保険：InsuranceSimulator と同じ fromGas() で変換し現在解約年度の資産額を計算
      // FX API が失敗しても 150円/USD のフォールバック
      let insMasterCount = 0
      if (insRes.status === 'fulfilled') {
        const usdJpy      = fxRes.status === 'fulfilled' ? (fxRes.value?.rates?.JPY || 150) : 150
        const insurances  = fromGas(insRes.value)
        insMasterCount    = insurances.length
        const currentYear = new Date().getFullYear()

        let total = 0
        insurances.forEach(ins => {
          const svs = ins.surrenderValues
            .map(s => ({
              year:   Number(s.year)                  || 0,
              lump:   parseFloat(s.lumpSumUSD)        || 0,
              annual: parseFloat(s.installmentAmtUSD) || 0,
            }))
            .filter(s => s.lump > 0 || s.annual > 0)
            .sort((a, b) => a.year - b.year)

          if (!svs.length) return

          // 解約年度（西暦）が現在年以下で最大の行、なければ最初の行
          const eligible = svs.filter(s => s.year <= currentYear)
          const sv = eligible.length > 0 ? eligible[eligible.length - 1] : svs[0]
          total += (sv.annual > 0 ? sv.annual : sv.lump) * usdJpy
        })
        setInsTotal(Math.round(total))
      }

      setLoadStatus('done')
      setLoadMsg(`${accs.length}口座 / 外貨保険${insMasterCount}件`)
      setSaveStatus('idle')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveMsg('')
    try {
      const rows = accounts.flatMap(a =>
        a.records.map(r => ({ 区分: a.区分, 種別: a.種別, 口座名: a.口座名, 月: r.month, 金額: String(r.amount ?? '') }))
      )
      const result = await gasApi.saveAssets(rows)
      setSaveStatus('saved'); setSaveMsg(`${result.saved}件保存`)
    } catch (e) {
      setSaveStatus('error'); setSaveMsg(e.message)
    }
  }

  // ── 口座操作 ──
  const latestAmount = (a) => {
    const sorted = [...a.records].sort((x, y) => y.month.localeCompare(x.month))
    return sorted.find(r => r.amount !== '' && r.amount != null)?.amount ?? null
  }

  const toggleExpand = (id) =>
    setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const removeAccount = (id) => {
    setAccounts(p => p.filter(a => a._id !== id))
    setExpanded(p => { const n = new Set(p); n.delete(id); return n })
    if (editId === id) setEditId(null)
    setSaveStatus('idle')
  }

  const startEdit = (a, e) => {
    e.stopPropagation()
    setEditId(a._id); setEditForm({ 区分: a.区分, 種別: a.種別, 口座名: a.口座名 })
  }
  const confirmEdit = (e) => {
    e.stopPropagation()
    if (!editForm?.口座名.trim()) return
    setAccounts(p => p.map(a => a._id !== editId ? a : { ...a, ...editForm }))
    setEditId(null); setSaveStatus('idle')
  }
  const cancelEdit = (e) => { e.stopPropagation(); setEditId(null) }

  const confirmAddAccount = () => {
    if (!addForm || !addForm.口座名.trim()) return
    const a = { _id: uid(), ...addForm, records: [] }
    setAccounts(p => [...p, a])
    setExpanded(p => new Set([...p, a._id]))
    setAddForm(null); setSaveStatus('idle')
  }

  const confirmAddYear = () => {
    if (!yearAdd?.year) return
    const year = parseInt(yearAdd.year)
    if (isNaN(year) || year < 2000 || year > 2099) return
    setAccounts(p => p.map(a => {
      if (a._id !== yearAdd.accountId) return a
      const existing = new Set(a.records.map(r => r.month))
      const toAdd = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
        .filter(m => !existing.has(m)).map(m => ({ month: m, amount: '' }))
      return { ...a, records: [...a.records, ...toAdd].sort((x, y) => x.month.localeCompare(y.month)) }
    }))
    setYearAdd(null); setSaveStatus('idle')
  }

  const updateAmount = (accountId, month, value) => {
    setAccounts(p => p.map(a =>
      a._id !== accountId ? a :
      { ...a, records: a.records.map(r => r.month === month ? { ...r, amount: value } : r) }
    ))
    setSaveStatus('idle')
  }

  const removeRecord = (accountId, month) => {
    setAccounts(p => p.map(a =>
      a._id !== accountId ? a : { ...a, records: a.records.filter(r => r.month !== month) }
    ))
    setSaveStatus('idle')
  }

  // ── KPI 計算 ──
  // 資産シートは預金のみのため種別フィルター不要
  const depositTotal = accounts
    .reduce((s, a) => s + parseAmt(latestAmount(a)), 0)

  const invLatest = {}
  invRecords.forEach(r => {
    const k = r['ファンド名']
    if (!invLatest[k] || r['年月'] > invLatest[k]['年月']) invLatest[k] = r
  })
  const invTotal = Object.values(invLatest).reduce((s, r) => s + parseAmt(r['評価額']), 0)

  const dcLatest = {}
  dcRecords.forEach(r => {
    const k = r['運用機関']
    if (!dcLatest[k] || r['年月'] > dcLatest[k]['年月']) dcLatest[k] = r
  })
  const dcTotal = Object.values(dcLatest).reduce((s, r) => s + parseAmt(r['評価額']), 0)

  const grandTotal = depositTotal + insTotal + invTotal + dcTotal

  // ── グラフデータ ──
  const { barData, pieData } = useMemo(() => {
    // GASはDate型セルを "YYYY/MM/DD" で返すため "YYYY-MM" に正規化する
    // （未保存の新規追加分は "YYYY-MM" のまま渡ってくることもある）
    const toYM = (s) => {
      const m = String(s || '').match(/(\d{4})[/-](\d{1,2})/)
      return m ? `${m[1]}-${m[2].padStart(2, '0')}` : ''
    }

    // 口座/ファンド/機関ごとに月昇順の記録列を作る（forward-fill用）
    const depSeries = accounts
      .filter(a => CAT_DEPOSIT.includes(a.種別))
      .map(a => a.records
        .filter(r => r.amount !== '' && r.amount != null && toYM(r.month))
        .map(r => ({ month: toYM(r.month), value: parseAmt(r.amount) }))
        .sort((x, y) => x.month.localeCompare(y.month))
      )

    const groupByKey = (records, keyField, monthField, valField) => {
      const grouped = {}
      records.forEach(r => {
        if (!r[valField] || !toYM(r[monthField])) return
        const k = r[keyField]
        if (!grouped[k]) grouped[k] = []
        grouped[k].push({ month: toYM(r[monthField]), value: parseAmt(r[valField]) })
      })
      return Object.values(grouped).map(recs => recs.sort((x, y) => x.month.localeCompare(y.month)))
    }
    const invSeries = groupByKey(invRecords, 'ファンド名', '年月', '評価額')
    const dcSeries  = groupByKey(dcRecords,  '運用機関',   '年月', '評価額')

    // 全シリーズに登場する月から連続した月レンジを作る
    const allMonths = [...depSeries, ...invSeries, ...dcSeries]
      .flatMap(recs => recs.map(r => r.month))
    let months = []
    if (allMonths.length > 0) {
      const sortedMonths = [...allMonths].sort()
      let [y, m] = sortedMonths[0].split('-').map(Number)
      const [ey, em] = sortedMonths[sortedMonths.length - 1].split('-').map(Number)
      while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`)
        m++
        if (m > 12) { m = 1; y++ }
      }
    }

    // 月末断面（forward-fill）で各シリーズの合計を月ごとに積み上げる
    const monthEndTotal = (series) => {
      const totals = Object.fromEntries(months.map(m => [m, 0]))
      series.forEach(recs => {
        let idx = 0
        let current = null
        months.forEach(m => {
          while (idx < recs.length && recs[idx].month <= m) {
            current = recs[idx].value
            idx++
          }
          if (current != null) totals[m] += current
        })
      })
      return totals
    }
    const depM = monthEndTotal(depSeries)
    const invM = monthEndTotal(invSeries)
    const dcM  = monthEndTotal(dcSeries)

    const bar = months.map(m => ({
      month:    m.replace('-', '/'),
      預金:     Math.round((depM[m] || 0) / 10000),
      投資信託: Math.round((invM[m] || 0) / 10000),
      DC:       Math.round((dcM[m]  || 0) / 10000),
    }))

    // 円グラフ（外貨保険は API 取得値を使用）
    const pie = [
      { name: '預金',    value: depositTotal, color: PIE_COLORS['預金'] },
      { name: '外貨保険', value: insTotal,    color: PIE_COLORS['外貨保険'] },
      { name: '投資信託', value: invTotal,    color: PIE_COLORS['投資信託'] },
      { name: 'DC',      value: dcTotal,     color: PIE_COLORS['DC'] },
    ].filter(d => d.value > 0)

    return { barData: bar, pieData: pie }
  }, [accounts, invRecords, dcRecords, depositTotal, insTotal, invTotal, dcTotal])

  const fmt3 = (v) => v > 0 ? `¥${v.toLocaleString()}` : '—'

  return (
    <div className="asset-summary">

      {/* ── 総資産合計 KPI ── */}
      {grandTotal > 0 && (
        <div className="asset-grand-card">
          <div className="asset-grand-top">
            <span className="asset-grand-label">総資産合計</span>
            <span className="asset-grand-value-row">
              <span className="asset-grand-value">
                {showTotal ? `¥${grandTotal.toLocaleString()}` : '¥ ••••••••'}
              </span>
              <button
                className="asset-grand-eye"
                onClick={() => setShowTotal(p => !p)}
                aria-label={showTotal ? '金額を隠す' : '金額を表示'}
                title={showTotal ? '金額を隠す' : '金額を表示'}
              >
                {showTotal ? '🙈' : '👁'}
              </button>
            </span>
          </div>
          <div className="asset-grand-breakdown">
            {[
              { name: '預金',    val: depositTotal },
              { name: '外貨保険', val: insTotal },
              { name: '投資信託', val: invTotal },
              { name: 'DC',      val: dcTotal },
            ].map(({ name, val }) => (
              <div key={name} className="asset-grand-item">
                <span className="asset-grand-dot" style={{ background: PIE_COLORS[name] }} />
                <span className="asset-grand-name">{name}</span>
                <span className="asset-grand-amt">{showTotal ? fmt3(val) : '••••'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ローダー ── */}
      {isGasReady() && (
        <div className="asset-loader">
          <span className="asset-loader-label">スプレッドシート</span>
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

      {/* ── グラフ ── */}
      {barData.length > 0 && (
        <div className="asset-charts">
          <div className="asset-chart-card asset-chart-card--bar">
            <h4 className="asset-chart-title">総資産推移（預金・投信・DC）</h4>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={barData} margin={{ top: 8, right: 12, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: '#94A3B8' }}
                  angle={-45}
                  textAnchor="end"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94A3B8' }}
                  tickFormatter={v => `${v}万`}
                  width={50}
                />
                <Tooltip
                  formatter={(v, name) => [`¥${(v * 10000).toLocaleString()}`, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
                />
                <Legend iconType="rect" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {Object.entries(BAR_COLORS).map(([key, color]) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {pieData.length > 0 && (
            <div className="asset-chart-card asset-chart-card--pie">
              <h4 className="asset-chart-title">資産割合</h4>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="48%"
                    outerRadius={82}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [`¥${v.toLocaleString()}`, name]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── 預金セクション ── */}
      <SectionAccordion title="預金" badge={depositTotal > 0 ? `¥${depositTotal.toLocaleString()}` : null}>
        <div className="account-list">
          {accounts.map(a => {
            const isOpen = expanded.has(a._id)
            const latest = latestAmount(a)
            return (
              <div key={a._id} className="account-card">
                {editId === a._id ? (
                  <div className="account-summary account-summary--editing" onClick={e => e.stopPropagation()}>
                    <div className="kubun-toggle">
                      {KUBUN.map(k => (
                        <button key={k} className={`kubun-btn${editForm.区分 === k ? ' kubun-btn--active' : ''}`}
                          onClick={() => setEditForm(p => ({ ...p, 区分: k }))}>{k}</button>
                      ))}
                    </div>
                    <select className="type-select" value={editForm.種別}
                      onChange={e => setEditForm(p => ({ ...p, 種別: e.target.value }))}>
                      {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="name-input" value={editForm.口座名}
                      onChange={e => setEditForm(p => ({ ...p, 口座名: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && confirmEdit(e)} autoFocus />
                    <button className="add-confirm-btn" onClick={confirmEdit}>✓</button>
                    <button className="add-cancel-btn" onClick={cancelEdit}>キャンセル</button>
                  </div>
                ) : (
                  <div className={`account-summary${isOpen ? ' account-summary--open' : ''}`}
                    onClick={() => toggleExpand(a._id)}>
                    <span className="expand-icon">{isOpen ? '▾' : '▸'}</span>
                    <span className={`kubun-tag kubun-tag--${a.区分}`}>{a.区分}</span>
                    <span className="acc-type">{a.種別}</span>
                    <span className="acc-name">{a.口座名 || <em className="acc-name--empty">口座名未設定</em>}</span>
                    <span className="acc-amount">{fmt(latest)}</span>
                    <button className="edit-btn" onClick={e => startEdit(a, e)}>✏</button>
                    <button className="remove-btn" onClick={e => { e.stopPropagation(); removeAccount(a._id) }}>×</button>
                  </div>
                )}

                {isOpen && (
                  <div className="history-panel">
                    <div className="history-toolbar">
                      {yearAdd?.accountId === a._id ? (
                        <div className="year-add-form">
                          <span className="year-add-label">追加する年</span>
                          <input type="number" className="year-input" value={yearAdd.year}
                            min="2000" max="2099" placeholder="2026"
                            onChange={e => setYearAdd(p => ({ ...p, year: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && confirmAddYear()} autoFocus />
                          <button className="year-add-ok" onClick={confirmAddYear}>1〜12月を追加</button>
                          <button className="year-add-cancel" onClick={() => setYearAdd(null)}>キャンセル</button>
                        </div>
                      ) : (
                        <button className="add-year-btn"
                          onClick={() => setYearAdd({ accountId: a._id, year: String(new Date().getFullYear()) })}>
                          ＋ 年月を追加
                        </button>
                      )}
                    </div>
                    {a.records.length > 0 ? (
                      <table className="history-table">
                        <thead><tr><th>年月</th><th className="r">金額</th><th></th></tr></thead>
                        <tbody>
                          {a.records.map(r => (
                            <tr key={r.month}>
                              <td className="history-month">{fmtMonth(r.month)}</td>
                              <td className="history-amount-cell">
                                <input type="text" className="history-amount-input"
                                  value={r.amount === '' || r.amount == null ? '' : parseAmt(r.amount).toLocaleString()}
                                  placeholder="—"
                                  onChange={e => updateAmount(a._id, r.month, e.target.value.replace(/,/g, ''))} />
                              </td>
                              <td>
                                <button className="remove-record-btn" onClick={() => removeRecord(a._id, r.month)}>×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="history-empty">「＋ 年月を追加」で履歴を入力してください</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {accounts.length === 0 && !addForm && (
            <div className="list-empty">「＋ 口座を追加」ボタンで口座を登録してください</div>
          )}
        </div>

        {addForm ? (
          <div className="add-account-form">
            <span className="add-form-title">新しい口座</span>
            <div className="kubun-toggle">
              {KUBUN.map(k => (
                <button key={k} className={`kubun-btn${addForm.区分 === k ? ' kubun-btn--active' : ''}`}
                  onClick={() => setAddForm(p => ({ ...p, 区分: k }))}>{k}</button>
              ))}
            </div>
            <select className="type-select" value={addForm.種別}
              onChange={e => setAddForm(p => ({ ...p, 種別: e.target.value }))}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="name-input" placeholder="口座名（例：みずほ）"
              value={addForm.口座名}
              onChange={e => setAddForm(p => ({ ...p, 口座名: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && confirmAddAccount()} autoFocus />
            <button className="add-confirm-btn" onClick={confirmAddAccount}>追加</button>
            <button className="add-cancel-btn" onClick={() => setAddForm(null)}>キャンセル</button>
          </div>
        ) : (
          <button className="add-account-btn" onClick={() => setAddForm({ 区分: 'kkr', 種別: '普通預金', 口座名: '' })}>
            ＋ 口座を追加
          </button>
        )}
      </SectionAccordion>

      <SectionAccordion title="外貨保険" badge={insTotal > 0 ? `¥${insTotal.toLocaleString()}` : null}>
        <InsuranceSection />
      </SectionAccordion>

      <SectionAccordion title="投資信託" badge={invTotal > 0 ? `¥${invTotal.toLocaleString()}` : null}>
        <InvestmentSection />
      </SectionAccordion>

      <SectionAccordion title="企業型DC" badge={dcTotal > 0 ? `¥${dcTotal.toLocaleString()}` : null}>
        <DCSection />
      </SectionAccordion>

      <SectionAccordion title="公的年金">
        <PensionSection />
      </SectionAccordion>

    </div>
  )
}
