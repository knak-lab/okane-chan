import { useState } from 'react'
import Dashboard from './components/Dashboard'
import PayPayImport from './components/PayPayImport'
import './App.css'

const TABS = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'paypay', label: 'PayPay CSV' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [transactions, setTransactions] = useState([])

  return (
    <div className="app">
      <header className="header">
        <span className="header-icon">💰</span>
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
            {tab.id === 'paypay' && transactions.length > 0 && (
              <span className="tab-badge">{transactions.length}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'dashboard' && (
          <Dashboard transactions={transactions} />
        )}
        {activeTab === 'paypay' && (
          <PayPayImport transactions={transactions} onLoad={setTransactions} />
        )}
      </main>
    </div>
  )
}
