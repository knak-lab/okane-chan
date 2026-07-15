import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import PayPayImport from './components/PayPayImport'
import OsaifuInput from './components/OsaifuInput'
import AssetSummary from './components/AssetSummary'
import AnnualPlan from './components/AnnualPlan'
import PJTab from './components/PJTab'
import AccView from './components/AccView'
import CategoryRules from './components/CategoryRules'
import InsuranceSimulator from './components/InsuranceSimulator'
import SimTab from './components/SimTab'
import { gasApi, isGasReady } from './utils/gasApi'
import { applyRulesFromGas } from './utils/customRules'
import './App.css'

const TABS = [
  { id: 'acc',        label: 'acco' },
  { id: 'assets',     label: 'サマリ' },
  { id: 'dashboard',  label: '支払' },
  { id: '__sep1',     sep: true },
  { id: 'sim',        label: 'LP' },
  { id: 'insurance',  label: '保険simu' },
  { id: '__sep2',     sep: true },
  { id: 'paypay',     label: 'CSV' },
  { id: 'osaifu',     label: '財布' },
  { id: '__sep3',     sep: true },
  { id: 'annual',     label: '年間' },
  { id: 'pj',         label: '家' },
  { id: 'vacation',   label: '休暇' },
  { id: 'catrules',   label: 'カテゴリ' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('acc')
  const [dashTransactions, setDashTransactions] = useState([])
  const [csvTransactions, setCsvTransactions]   = useState([])

  useEffect(() => {
    if (!isGasReady()) return
    gasApi.getCategoryRules()
      .then(({ rules }) => applyRulesFromGas(rules))
      .catch(() => {})
  }, [])

  return (
    <div className="app">
      <header className="header">
        <span className="header-icon">💰</span>
        <h1>お金ちゃん管理</h1>
      </header>

      <nav className="tab-nav">
        {TABS.map((tab) =>
          tab.sep ? (
            <span key={tab.id} className="tab-sep">|</span>
          ) : (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'paypay' && csvTransactions.length > 0 && (
                <span className="tab-badge">{csvTransactions.length}</span>
              )}
            </button>
          )
        )}
      </nav>

      <main className="main-content">
        {activeTab === 'dashboard' && (
          <Dashboard transactions={dashTransactions} onLoad={setDashTransactions} />
        )}
        {activeTab === 'paypay' && (
          <PayPayImport transactions={csvTransactions} onLoad={setCsvTransactions} />
        )}
        {activeTab === 'assets' && (
          <AssetSummary />
        )}
        {activeTab === 'osaifu' && (
          <OsaifuInput />
        )}
        {activeTab === 'acc' && (
          <AccView />
        )}
        {activeTab === 'annual' && (
          <AnnualPlan />
        )}
        {activeTab === 'pj' && (
          <PJTab />
        )}
        {activeTab === 'vacation' && (
          <div className="coming-soon">
            <span className="coming-soon-icon">🏖️</span>
            <p className="coming-soon-text">Coming Soon</p>
          </div>
        )}
        {activeTab === 'catrules' && (
          <CategoryRules />
        )}
        {activeTab === 'insurance' && (
          <InsuranceSimulator />
        )}
        {activeTab === 'sim' && (
          <SimTab />
        )}
      </main>
    </div>
  )
}
