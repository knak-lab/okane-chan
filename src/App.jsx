import { useState } from 'react'
import PayPayImport from './components/PayPayImport'
import './App.css'

const TABS = [
  { id: 'paypay', label: 'PayPay CSV取込' },
  { id: 'manual', label: '手動入力' },
]

function ManualInput() {
  const [transactions, setTransactions] = useState([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('expense')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!description || !amount) return
    setTransactions([
      {
        id: Date.now(),
        description,
        amount: Number(amount),
        type,
        date: new Date().toLocaleDateString('ja-JP'),
      },
      ...transactions,
    ])
    setDescription('')
    setAmount('')
  }

  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const balance = totalIncome - totalExpense

  return (
    <div>
      <div className="summary">
        <div className="summary-card">
          <span className="label">残高</span>
          <span className={`amount ${balance >= 0 ? 'positive' : 'negative'}`}>¥{balance.toLocaleString()}</span>
        </div>
        <div className="summary-card">
          <span className="label">収入</span>
          <span className="amount positive">¥{totalIncome.toLocaleString()}</span>
        </div>
        <div className="summary-card">
          <span className="label">支出</span>
          <span className="amount negative">¥{totalExpense.toLocaleString()}</span>
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <h2>取引を追加</h2>
        <div className="form-group">
          <label>種類</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
        </div>
        <div className="form-group">
          <label>内容</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: 食費、給料"
          />
        </div>
        <div className="form-group">
          <label>金額 (円)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例: 1500"
            min="1"
          />
        </div>
        <button type="submit">追加</button>
      </form>

      <div className="transactions">
        <h2>取引履歴</h2>
        {transactions.length === 0 ? (
          <p className="empty">取引がありません</p>
        ) : (
          <ul>
            {transactions.map((t) => (
              <li key={t.id} className="transaction-item">
                <div className="transaction-info">
                  <span className="transaction-desc">{t.description}</span>
                  <span className="transaction-date">{t.date}</span>
                </div>
                <span className={`transaction-amount ${t.type === 'income' ? 'positive' : 'negative'}`}>
                  {t.type === 'income' ? '+' : '-'}¥{t.amount.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('paypay')

  return (
    <div className="app">
      <header className="header">
        <h1>お金ちゃん管理</h1>
      </header>

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'paypay' && <PayPayImport />}
        {activeTab === 'manual' && <ManualInput />}
      </main>
    </div>
  )
}
