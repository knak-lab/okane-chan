import { useState, useCallback, useRef } from 'react'
import { parsePayPayCSV } from '../utils/parsePayPay'
import { categorize, ALL_CATEGORIES } from '../utils/categorize'
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
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.csv')) {
      setError('CSVファイルを選択してください')
      return
    }
    setError('')

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = parsePayPayCSV(e.target.result)
        if (parsed.length === 0) {
          setError('データが見つかりませんでした。PayPayの利用明細CSVを確認してください。')
          return
        }
        onLoad(parsed.map((row) => ({ ...row, category: categorize(row.description) })))
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
  }

  const handleClear = () => {
    onLoad([])
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const summary = ALL_CATEGORIES.map((cat) => ({
    cat,
    total: transactions.filter((r) => r.category === cat).reduce((s, r) => s + r.amount, 0),
  })).filter((s) => s.total > 0)

  const grandTotal = transactions.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="paypay-import">
      {transactions.length === 0 ? (
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-zone-icon">📂</div>
          <p className="drop-zone-text">PayPay利用明細CSVをドラッグ&ドロップ</p>
          <p className="drop-zone-sub">またはクリックしてファイルを選択</p>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
          {error && <p className="error-msg">{error}</p>}
        </div>
      ) : (
        <>
          <div className="import-header">
            <div className="import-header-left">
              <span className="import-count">{transactions.length}件を読み込みました</span>
              <span className="import-total">合計: ¥{grandTotal.toLocaleString()}</span>
            </div>
            <button className="clear-btn" onClick={handleClear}>クリア</button>
          </div>

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
