import { useState } from 'react'
import { ALL_CATEGORIES } from '../utils/categorize'
import { gasApi, isGasReady } from '../utils/gasApi'
import './OsaifuInput.css'

const KUBUN = ['kkr', 'acc']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(isoDate) {
  return isoDate.replace(/-/g, '/')
}

export default function OsaifuInput() {
  const [form, setForm] = useState({
    date: todayStr(),
    amount: '',
    description: '',
    category: '他・特別費',
    kubun: 'kkr',
    direction: '出金',
  })
  const [entries, setEntries]     = useState([])
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg, setSaveMsg]     = useState('')
  const [formError, setFormError] = useState('')

  const setField = (key, val) => {
    setForm((p) => ({ ...p, [key]: val }))
    if (formError) setFormError('')
  }

  const handleAdd = () => {
    const rawAmount = Number(form.amount)
    if (!form.amount || isNaN(rawAmount) || rawAmount <= 0) { setFormError('金額を正の数で入力してください'); return }
    if (!form.description) { setFormError('内容を入力してください'); return }
    const amount = form.direction === '入金' ? -rawAmount : rawAmount
    const dateStr = fmtDate(form.date)
    const txId = `現金_${dateStr}_${amount}_${form.description.slice(0, 8)}_${Date.now()}`
    const entry = {
      id: txId,
      date: dateStr,
      description: form.description,
      amount,
      category: form.category,
      '取引日': dateStr,
      '出金金額（円）': form.direction === '出金' ? String(rawAmount) : '',
      '入金金額（円）': form.direction === '入金' ? String(rawAmount) : '',
      '海外出金金額': '',
      '通貨': '',
      '変換レート（円）': '',
      '利用国': '',
      '取引内容': form.description,
      '取引先': '',
      '取引方法': '現金',
      '支払い区分': '',
      '利用者': form.kubun,
      '取引番号': txId,
      'カテゴリ': form.category,
      '区分': form.kubun,
    }
    setEntries((p) => [entry, ...p])
    setForm((p) => ({ ...p, amount: '', description: '' }))
    setFormError('')
    setSaveStatus('idle')
  }

  const handleRemove = (id) => setEntries((p) => p.filter((e) => e.id !== id))

  const handleSave = async () => {
    if (entries.length === 0) return
    setSaveStatus('saving')
    setSaveMsg('')
    try {
      const result = await gasApi.saveTransactions(entries)
      setSaveStatus('saved')
      const detail = result.inserted != null
        ? `${result.inserted}件追加・${result.updated}件更新`
        : `${result.saved}件保存`
      setSaveMsg(detail)
      setEntries([])
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  const total = entries.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="osaifu">
      <div className="osaifu-form">
        <div className="osaifu-row osaifu-row--top">
          <input
            type="date"
            className="osaifu-date"
            value={form.date}
            onChange={(e) => setField('date', e.target.value)}
          />
          <div className="kubun-toggle">
            {KUBUN.map((k) => (
              <button
                key={k}
                className={`kubun-btn ${form.kubun === k ? 'kubun-btn--active' : ''}`}
                onClick={() => setField('kubun', k)}
              >
                {k}
              </button>
            ))}
          </div>
          <button className="osaifu-add-btn" onClick={handleAdd}>追加</button>
        </div>
        <div className="osaifu-row osaifu-row--main">
          <div className="direction-toggle">
            {['出金', '入金'].map(d => (
              <button
                key={d}
                className={`direction-btn ${form.direction === d ? `direction-btn--active direction-btn--${d === '出金' ? 'out' : 'in'}` : ''}`}
                onClick={() => setField('direction', d)}
              >{d}</button>
            ))}
          </div>
          <input
            type="number"
            className="osaifu-amount"
            placeholder="金額"
            value={form.amount}
            onChange={(e) => setField('amount', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <select
            className="osaifu-cat"
            value={form.category}
            onChange={(e) => setField('category', e.target.value)}
          >
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="osaifu-row osaifu-row--desc">
          <input
            type="text"
            className="osaifu-desc"
            placeholder="内容"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
        </div>
        {formError && <div className="osaifu-form-error">{formError}</div>}
      </div>

      {entries.length > 0 && (
        <>
          <div className="osaifu-header">
            <div className="osaifu-summary">
              <span className="osaifu-count">{entries.length}件</span>
              <span className="osaifu-total">合計 ¥{total.toLocaleString()}</span>
            </div>
            <div className="osaifu-actions">
              {isGasReady() && (
                <button
                  className={`save-btn save-btn--${saveStatus}`}
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? '保存中…'
                    : saveStatus === 'saved' ? '✓ 保存済み'
                    : 'スプレッドシートに保存'}
                </button>
              )}
            </div>
          </div>
          {saveMsg && (
            <div className={`save-msg save-msg--${saveStatus}`}>{saveMsg}</div>
          )}
          <div className="osaifu-table-wrap">
            <table className="osaifu-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>区分</th>
                  <th>内容</th>
                  <th className="r">金額</th>
                  <th>カテゴリ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="col-date">{e.date}</td>
                    <td><span className={`kubun-tag kubun-tag--${e['区分']}`}>{e['区分']}</span></td>
                    <td className="col-desc">{e.description}</td>
                    <td className={`col-amount r ${e.amount < 0 ? 'text-income' : ''}`}>
                      ¥{e.amount.toLocaleString()}
                    </td>
                    <td className="col-cat">{e.category}</td>
                    <td>
                      <button className="remove-btn" onClick={() => handleRemove(e.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {entries.length === 0 && (
        <div className="osaifu-empty">現金の取引を入力して追加してください</div>
      )}
    </div>
  )
}
