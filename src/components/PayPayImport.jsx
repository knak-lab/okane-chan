import { useState, useCallback, useRef } from 'react'
import { parsePayPayCSV } from '../utils/parsePayPay'
import { categorize, ALL_CATEGORIES } from '../utils/categorize'
import './PayPayImport.css'

const CATEGORY_PREFIX_COLOR = {
  '消': '#3498db',
  '浪': '#e74c3c',
  '投': '#27ae60',
  '他': '#95a5a6',
}

function getCategoryColor(cat) {
  const prefix = cat[0]
  return CATEGORY_PREFIX_COLOR[prefix] || '#95a5a6'
}

export default function PayPayImport() {
  const [rows, setRows] = useState([])
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
        const withCategory = parsed.map((row) => ({
          ...row,
          category: categorize(row.description),
        }))
        setRows(withCategory)
      } catch (err) {
        setError('CSVの読み込みに失敗しました: ' + err.message)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }, [])

  const handleFileChange = (e) => {
    processFile(e.target.files[0])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    processFile(e.dataTransfer.files[0])
  }

  const handleCategoryChange = (id, newCategory) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, category: newCategory } : r))
    )
  }

  const handleClearData = () => {
    setRows([])
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const summary = ALL_CATEGORIES.map((cat) => {
    const total = rows
      .filter((r) => r.category === cat)
      .reduce((sum, r) => sum + r.amount, 0)
    return { cat, total }
  }).filter((s) => s.total > 0)

  const grandTotal = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <div className="paypay-import">
      {rows.length === 0 ? (
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {error && <p className="error-msg">{error}</p>}
        </div>
      ) : (
        <>
          <div className="import-header">
            <div className="import-header-left">
              <span className="import-count">{rows.length}件のデータを読み込みました</span>
              <span className="import-total">合計: ¥{grandTotal.toLocaleString()}</span>
            </div>
            <button className="clear-btn" onClick={handleClearData}>
              クリア
            </button>
          </div>

          <div className="summary-section">
            <h3>カテゴリ別集計</h3>
            <div className="summary-grid">
              {summary.map(({ cat, total }) => (
                <div
                  key={cat}
                  className="summary-chip"
                  style={{ borderLeftColor: getCategoryColor(cat) }}
                >
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
                {rows.map((row) => (
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
