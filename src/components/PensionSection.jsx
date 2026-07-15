import { useState, useEffect } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './InvestmentSection.css'
import './PensionSection.css'

let _uid = Date.now() + 4000000
const newId = () => String(_uid++)

// 現行法（2022年4月〜）
const EARLY_AGE  = 60
const NORMAL_AGE = 65
const DEFER_AGE  = 70
const EARLY_RATE_PER_MONTH = 0.004  // 0.4%/月
const DEFER_RATE_PER_MONTH = 0.007  // 0.7%/月

const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const fmt = (v) => v == null ? '—' : `¥${Math.round(v).toLocaleString()}`

function calcPension(baseMonthly) {
  const base = parseAmt(baseMonthly)
  if (!base) return null

  const earlyMonthsCount = (NORMAL_AGE - EARLY_AGE) * 12   // 60
  const earlyReduction   = earlyMonthsCount * EARLY_RATE_PER_MONTH  // 0.24
  const earlyRate        = 1 - earlyReduction                        // 0.76
  const earlyAmt         = Math.round(base * earlyRate)

  const deferMonthsCount = (DEFER_AGE - NORMAL_AGE) * 12   // 60
  const deferIncrease    = deferMonthsCount * DEFER_RATE_PER_MONTH  // 0.42
  const deferRate        = 1 + deferIncrease                        // 1.42
  const deferAmt         = Math.round(base * deferRate)

  // 損益分岐点（月齢で算出 → 年+月に変換）
  // 繰り上げvs通常: earlyRate*(n - EARLY*12) = 1*(n - NORMAL*12)
  const beEarlyN = (NORMAL_AGE * 12 - earlyRate * EARLY_AGE * 12) / (1 - earlyRate)
  // 通常vs繰り下げ: 1*(n - NORMAL*12) = deferRate*(n - DEFER*12)
  const beDeferN = (NORMAL_AGE * 12 - deferRate * DEFER_AGE * 12) / (1 - deferRate)

  const toAgeStr = (n) => {
    const y = Math.floor(n / 12)
    const m = Math.round(n % 12)
    return m === 0 ? `${y}歳` : `${y}歳${m}ヶ月`
  }

  // 累計受取テーブル（70〜90歳）
  const CUM_AGES = [70, 75, 80, 85, 90]
  const cumRows = CUM_AGES.map(age => {
    const n        = age * 12
    const early    = n >= EARLY_AGE  * 12 ? Math.round(earlyAmt * (n - EARLY_AGE  * 12)) : null
    const normal   = n >= NORMAL_AGE * 12 ? Math.round(base     * (n - NORMAL_AGE * 12)) : null
    const deferred = n >= DEFER_AGE  * 12 ? Math.round(deferAmt * (n - DEFER_AGE  * 12)) : null
    return { age, early, normal, deferred }
  })

  return {
    base, earlyAmt, deferAmt,
    earlyPct: earlyReduction * 100,
    deferPct: deferIncrease * 100,
    beEarlyStr: toAgeStr(beEarlyN),
    beDeferStr: toAgeStr(beDeferN),
    cumRows,
  }
}

// ── シミュレーションカード ──
function SimCard({ record }) {
  const [showCum, setShowCum] = useState(false)
  const sim = calcPension(record?.monthlyAmt)
  if (!sim) return null

  return (
    <div className="pension-sim">
      <div className="pension-sim-meta">
        ねんきん定期便 {record.yearMonth} 時点 ／ 加入{record.months}ヶ月
      </div>

      {/* 3シナリオ */}
      <div className="pension-scenarios">
        <div className="pension-scenario pension-scenario--early">
          <span className="pension-scenario-label">60歳 繰り上げ</span>
          <span className="pension-scenario-amt">{fmt(sim.earlyAmt)}<span className="pension-unit">/月</span></span>
          <span className="pension-scenario-pct inv-neg">−{sim.earlyPct.toFixed(0)}%</span>
        </div>
        <div className="pension-scenario pension-scenario--normal">
          <span className="pension-scenario-label">65歳 通常</span>
          <span className="pension-scenario-amt pension-scenario-amt--base">{fmt(sim.base)}<span className="pension-unit">/月</span></span>
          <span className="pension-scenario-pct pension-neutral">基準</span>
        </div>
        <div className="pension-scenario pension-scenario--defer">
          <span className="pension-scenario-label">70歳 繰り下げ</span>
          <span className="pension-scenario-amt">{fmt(sim.deferAmt)}<span className="pension-unit">/月</span></span>
          <span className="pension-scenario-pct inv-pos">+{sim.deferPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* 損益分岐点 */}
      <div className="pension-breakeven">
        <span className="pension-be-title">損益分岐点</span>
        <div className="pension-be-rows">
          <div className="pension-be-row">
            <span className="pension-be-label">繰り上げ → 通常</span>
            <span className="pension-be-age">{sim.beEarlyStr}</span>
            <span className="pension-be-note">以降は65歳受給の方が累計で有利</span>
          </div>
          <div className="pension-be-row">
            <span className="pension-be-label">通常 → 繰り下げ</span>
            <span className="pension-be-age">{sim.beDeferStr}</span>
            <span className="pension-be-note">以降は70歳受給の方が累計で有利</span>
          </div>
        </div>
      </div>

      {/* 累計受取テーブル（トグル） */}
      <button className="pension-cum-toggle" onClick={() => setShowCum(p => !p)}>
        {showCum ? '▴ 累計受取額を閉じる' : '▾ 年齢別 累計受取額を見る'}
      </button>
      {showCum && (
        <div className="inv-table-wrap pension-cum-table">
          <table className="inv-table">
            <thead>
              <tr>
                <th>年齢</th>
                <th className="r">60歳繰り上げ</th>
                <th className="r">65歳通常</th>
                <th className="r">70歳繰り下げ</th>
              </tr>
            </thead>
            <tbody>
              {sim.cumRows.map(row => (
                <tr key={row.age}>
                  <td className="inv-month-cell">{row.age}歳</td>
                  <td className="r">{row.early   != null ? fmt(row.early)    : <span className="inv-muted">—</span>}</td>
                  <td className="r">{row.normal   != null ? fmt(row.normal)   : <span className="inv-muted">—</span>}</td>
                  <td className="r">{row.deferred != null ? fmt(row.deferred) : <span className="inv-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── メイン ──
export default function PensionSection() {
  const [records,    setRecords]    = useState([])
  const [form,       setForm]       = useState({ yearMonth: '', monthlyAmt: '', months: '' })
  const [showAll,    setShowAll]    = useState(false)
  const [loadStatus, setLoadStatus] = useState('idle')
  const [loadMsg,    setLoadMsg]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg,    setSaveMsg]    = useState('')

  useEffect(() => { if (isGasReady()) handleLoad() }, [])

  const sorted = [...records].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  const latest = sorted[0] ?? null

  const handleLoad = async () => {
    setLoadStatus('loading'); setLoadMsg('')
    try {
      const data = await gasApi.getPensionData()
      const rows = (data.records || []).map(r => ({
        id:         newId(),
        yearMonth:  r['確認年月']         || '',
        monthlyAmt: r['受給見込み額(月額)'] || '',
        months:     r['加入月数']          || '',
      }))
      setRecords(rows)
      setLoadStatus('done')
      setLoadMsg(`${rows.length}件を読み込みました`)
      setSaveStatus('idle')
    } catch (e) {
      setLoadStatus('error'); setLoadMsg(e.message)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving'); setSaveMsg('')
    try {
      const rows = sorted.map(r => ({
        '確認年月':         r.yearMonth,
        '受給見込み額(月額)': r.monthlyAmt,
        '加入月数':          r.months,
      }))
      await gasApi.savePensionData(rows)
      setSaveStatus('saved'); setSaveMsg('保存しました')
    } catch (e) {
      setSaveStatus('error'); setSaveMsg(e.message)
    }
  }

  const addRecord = () => {
    if (!form.yearMonth || !form.monthlyAmt) return
    const rec = { id: newId(), ...form }
    setRecords(p => [...p.filter(r => r.yearMonth !== form.yearMonth), rec])
    setForm({ yearMonth: '', monthlyAmt: '', months: '' })
    setSaveStatus('idle')
  }

  const removeRecord = (id) => {
    setRecords(p => p.filter(r => r.id !== id))
    setSaveStatus('idle')
  }

  const displayRecords = showAll ? sorted : sorted.slice(0, 3)

  return (
    <div className="investment-section">
      <div className="inv-section-head">
        <h3 className="inv-section-title">公的年金</h3>
        {isGasReady() && (
          <div className="inv-toolbar">
            <button className={`load-btn load-btn--${loadStatus}`} onClick={handleLoad} disabled={loadStatus === 'loading'}>
              {loadStatus === 'loading' ? '読込中…' : '読み込む'}
            </button>
            {loadMsg && <span className={`load-msg load-msg--${loadStatus}`}>{loadMsg}</span>}
            {records.length > 0 && (
              <button className={`save-btn-dash save-btn-dash--${saveStatus}`} onClick={handleSave} disabled={saveStatus === 'saving'}>
                {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '変更を保存'}
              </button>
            )}
            {saveMsg && <span className={`load-msg load-msg--${saveStatus}`}>{saveMsg}</span>}
          </div>
        )}
      </div>

      {/* 入力フォーム */}
      <div className="pension-form">
        <span className="pension-form-title">ねんきん定期便を入力</span>
        <div className="pension-form-fields">
          <label className="pension-form-field">
            <span className="pension-form-label">確認年月</span>
            <input
              className="inv-cell-input"
              type="month"
              value={form.yearMonth}
              onChange={e => setForm(p => ({ ...p, yearMonth: e.target.value }))}
            />
          </label>
          <label className="pension-form-field">
            <span className="pension-form-label">受給見込み額（月額）</span>
            <input
              className="inv-cell-input inv-cell-input--wide"
              type="number"
              placeholder="180000"
              value={form.monthlyAmt}
              onChange={e => setForm(p => ({ ...p, monthlyAmt: e.target.value }))}
            />
          </label>
          <label className="pension-form-field">
            <span className="pension-form-label">加入月数</span>
            <input
              className="inv-cell-input"
              type="number"
              placeholder="240"
              value={form.months}
              onChange={e => setForm(p => ({ ...p, months: e.target.value }))}
              style={{ width: 80 }}
            />
          </label>
          <button className="inv-record-btn" onClick={addRecord}>記録</button>
        </div>
      </div>

      {/* 記録一覧 */}
      {sorted.length > 0 && (
        <div className="pension-records">
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>確認年月</th>
                  <th className="r">受給見込み額（月額）</th>
                  <th className="r">加入月数</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayRecords.map((r, i) => (
                  <tr key={r.id}>
                    <td className="inv-month-cell">
                      {r.yearMonth}
                      {i === 0 && <span className="pension-latest-badge">最新</span>}
                    </td>
                    <td className="r inv-strong">{fmt(parseAmt(r.monthlyAmt))}</td>
                    <td className="r inv-muted">{r.months ? `${r.months}ヶ月` : '—'}</td>
                    <td>
                      <button className="inv-rm-row" onClick={() => removeRecord(r.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 3 && (
            <button className="pension-cum-toggle" onClick={() => setShowAll(p => !p)}>
              {showAll ? `▴ 折りたたむ` : `▾ 全${sorted.length}件を見る`}
            </button>
          )}
        </div>
      )}

      {/* シミュレーション */}
      {latest && <SimCard record={latest} />}

      {sorted.length === 0 && (
        <p className="inv-empty">ねんきん定期便の情報を入力してください（毎年9月頃に届きます）</p>
      )}
    </div>
  )
}
