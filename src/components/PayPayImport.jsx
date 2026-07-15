import { useState, useCallback, useRef, useMemo } from 'react'
import { parsePayPayCSV } from '../utils/parsePayPay'
import { categorize, ALL_CATEGORIES } from '../utils/categorize'
import { loadCustomRules, saveCustomRule, deleteCustomRule } from '../utils/customRules'
import { gasApi, isGasReady } from '../utils/gasApi'
import './PayPayImport.css'

const CAT_COLOR = {
  '消': '#58a6ff',
  '浪': '#f0883e',
  '投': '#3fb950',
  '他': '#bc8cff',
}

function getCategoryColor(cat) {
  return CAT_COLOR[cat[0]] || '#484f58'
}

export default function PayPayImport({ transactions, onLoad }) {
  const [isDragging, setIsDragging]     = useState(false)
  const [error, setError]               = useState('')
  const [saveStatus, setSaveStatus]     = useState('idle') // idle | saving | saved | error
  const [saveMsg, setSaveMsg]           = useState('')
  const [ruleSelections, setRuleSelections] = useState({}) // { description: category }
  const [savedRules, setSavedRules]     = useState(loadCustomRules)
  const [showRules, setShowRules]       = useState(false)
  const fileInputRef = useRef(null)

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.csv')) {
      setError('CSVファイルを選択してください')
      return
    }
    setError('')
    setSaveStatus('idle')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = parsePayPayCSV(e.target.result)
        if (parsed.length === 0) {
          setError('データが見つかりませんでした。PayPayの利用明細CSVを確認してください。')
          return
        }
        onLoad(parsed.map((row) => ({
          ...row,
          // ポイント・収入はCSV構造から確定、それ以外はキーワード分類
          category: row.defaultCategory !== '他・特別費'
            ? row.defaultCategory
            : categorize(row.description),
        })))
      } catch (err) {
        setError('CSVの読み込みに失敗しました: ' + err.message)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }, [onLoad])

  const handleFileChange = (e) => processFile(e.target.files[0])
  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    processFile(e.dataTransfer.files[0])
  }

  const handleCategoryChange = (id, newCategory) => {
    onLoad(transactions.map((r) => (r.id === id ? { ...r, category: newCategory } : r)))
    setSaveStatus('idle')
  }

  const handleClear = () => {
    onLoad([])
    setError('')
    setSaveStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSave = async () => {
    setSaveStatus('saving')
    setSaveMsg('')
    try {
      const result = await gasApi.saveTransactions(transactions)
      setSaveStatus('saved')
      const detail = result.inserted != null
        ? `${result.inserted}件追加・${result.updated}件更新`
        : `${result.saved}件保存`
      setSaveMsg(`${detail}（${(result.months || []).join(', ')}）`)
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  // カテゴリ未分類（他・特別費のまま）の決裁先グループ
  const unmatchedGroups = useMemo(() => {
    const groups = {}
    for (const row of transactions) {
      if (row.defaultCategory !== '他・特別費') continue
      if (row.category !== '他・特別費') continue
      const k = row.description
      if (!groups[k]) groups[k] = { description: k, count: 0, total: 0 }
      groups[k].count++
      groups[k].total += row.amount
    }
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [transactions])

  const handleAddRule = (description) => {
    const category = ruleSelections[description] ?? ALL_CATEGORIES[0]
    saveCustomRule(description, category)
    setSavedRules(loadCustomRules())
    // カスタムルールを反映して再カテゴリ
    onLoad(transactions.map(row => {
      if (row.defaultCategory !== '他・特別費' || row.category !== '他・特別費') return row
      const newCat = categorize(row.description)
      return newCat !== row.category ? { ...row, category: newCat } : row
    }))
  }

  const handleDeleteRule = (keyword) => {
    deleteCustomRule(keyword)
    setSavedRules(loadCustomRules())
  }

  const summary = ALL_CATEGORIES.map((cat) => ({
    cat,
    total: transactions.filter((r) => r.category === cat).reduce((s, r) => s + r.amount, 0),
  })).filter((s) => s.total > 0)

  const grandTotal = transactions.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="paypay-import">
      {/* アップロードゾーン（常時表示） */}
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${transactions.length > 0 ? 'drop-zone--compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {transactions.length === 0 ? (
          <>
            <div className="drop-zone-icon">📂</div>
            <p className="drop-zone-text">PayPay利用明細CSVをドラッグ&ドロップ</p>
            <p className="drop-zone-sub">またはクリックしてファイルを選択</p>
          </>
        ) : (
          <p className="drop-zone-sub">別のCSVをドラッグ&ドロップ、またはクリックして選択</p>
        )}
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
        {error && <p className="error-msg">{error}</p>}
      </div>

      {transactions.length > 0 && (
        <>
          <div className="import-header">
            <div className="import-header-left">
              <span className="import-count">{transactions.length}件を読み込みました</span>
              <span className="import-total">合計: ¥{grandTotal.toLocaleString()}</span>
            </div>
            <div className="import-actions">
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
              <button className="clear-btn" onClick={handleClear}>クリア</button>
            </div>
          </div>

          {/* 保存ステータスメッセージ */}
          {saveMsg && (
            <div className={`save-msg save-msg--${saveStatus}`}>{saveMsg}</div>
          )}

          <div className="summary-section">
            <h3>カテゴリ別集計</h3>
            <div className="summary-grid">
              {summary.map(({ cat, total }) => (
                <div key={cat} className="summary-chip" style={{ borderLeftColor: getCategoryColor(cat) }}>
                  <span className="summary-chip-name">{cat}</span>
                  <span className="summary-chip-amount">¥{total.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 未分類の決裁先パネル */}
          {unmatchedGroups.length > 0 && (
            <div className="unmatched-section">
              <div className="unmatched-header">
                <span className="unmatched-title">未分類の決裁先</span>
                <span className="unmatched-badge">{unmatchedGroups.length}件</span>
              </div>
              <div className="unmatched-list">
                {unmatchedGroups.map(({ description, count, total }) => (
                  <div key={description} className="unmatched-row">
                    <span className="unmatched-desc">{description}</span>
                    <span className="unmatched-meta">{count}件 ¥{total.toLocaleString()}</span>
                    <select
                      className="unmatched-select"
                      value={ruleSelections[description] ?? ALL_CATEGORIES[0]}
                      onChange={e => setRuleSelections(p => ({ ...p, [description]: e.target.value }))}
                    >
                      {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button
                      className="unmatched-add-btn"
                      onClick={() => handleAddRule(description)}
                    >
                      ルールに追加
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 登録済みカスタムルール */}
          {Object.keys(savedRules).length > 0 && (
            <div className="rules-section">
              <button className="rules-toggle" onClick={() => setShowRules(p => !p)}>
                登録済みルール {Object.keys(savedRules).length}件 {showRules ? '▲' : '▼'}
              </button>
              {showRules && (
                <div className="rules-list">
                  {Object.entries(savedRules).map(([kw, cat]) => (
                    <div key={kw} className="rules-row">
                      <span className="rules-kw">{kw}</span>
                      <span className="rules-arrow">→</span>
                      <span className="rules-cat">{cat}</span>
                      <button className="rules-del-btn" onClick={() => handleDeleteRule(kw)}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="table-wrapper">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>決済先</th>
                  <th>金額</th>
                  <th>カテゴリ</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.id}>
                    <td className="col-date">{row.date}</td>
                    <td className="col-desc">{row.description}</td>
                    <td className="col-amount">¥{row.amount.toLocaleString()}</td>
                    <td className="col-category">
                      <select
                        value={row.category}
                        onChange={(e) => handleCategoryChange(row.id, e.target.value)}
                        style={{ borderLeftColor: getCategoryColor(row.category) }}
                      >
                        {ALL_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

