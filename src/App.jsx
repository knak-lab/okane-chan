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
import { isGasReady } from './utils/gasApi'
import { syncRulesWithGas } from './utils/customRules'
import { onGoTo } from './utils/nav'
import OutboxBadge from './components/OutboxBadge'
import { LockButton } from './auth/AuthGate'
import './App.css'

// 使う頻度で5つに分ける：毎日見る「今月」／月1回の「入力」「資産」／面談前後の「将来」／年初の「設定」
const TABS = [
  { id: 'month',    label: '今月' },
  { id: 'input',    label: '入力' },
  { id: 'assets',   label: '資産' },
  { id: 'future',   label: '将来' },
  { id: 'settings', label: '設定' },
]
const SUB_TABS = {
  input: [
    { id: 'csv',    label: 'CSV取込' },
    { id: 'osaifu', label: '財布' },
    { id: 'rules',  label: 'カテゴリルール' },
  ],
  future: [
    { id: 'lp',   label: 'ライフプラン' },
    { id: 'ins',  label: '保険の損益' },
    { id: 'home', label: '家' },
  ],
}

function SubTabs({ tab, active, onChange, badges = {} }) {
  return (
    <nav className="subtab-nav">
      {SUB_TABS[tab].map(s => (
        <button key={s.id} className={`subtab-btn ${active === s.id ? 'active' : ''}`} onClick={() => onChange(s.id)}>
          {s.label}
          {badges[s.id] > 0 && <span className="tab-badge">{badges[s.id]}</span>}
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('month')
  const [subTab, setSubTab] = useState({ input: 'csv', future: 'lp' })
  const [showPayDetail, setShowPayDetail] = useState(false)
  const [dashTransactions, setDashTransactions] = useState([])
  const [csvTransactions, setCsvTransactions]   = useState([])

  useEffect(() => {
    if (!isGasReady()) return
    syncRulesWithGas().catch((e) => console.warn('[rules] sync failed', e))
  }, [])

  // 他の画面からのタブ移動（LPチェックの「〇〇で直す」など）
  useEffect(() => onGoTo(({ tab, sub }) => {
    if (!TABS.some(t => t.id === tab)) return
    setActiveTab(tab)
    if (sub) setSubTab(s => ({ ...s, [tab]: sub }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }), [])

  const setSub = (tab) => (id) => setSubTab(s => ({ ...s, [tab]: id }))
  const csvCount = csvTransactions.length

  return (
    <div className="app">
      <header className="header">
        <span className="header-icon">💰</span>
        <h1>お金ちゃん管理</h1>
        <LockButton style={{ marginLeft: 'auto', position: 'absolute', right: 16, background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }} />
      </header>
      <OutboxBadge />

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'input' && csvCount > 0 && <span className="tab-badge">{csvCount}</span>}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'month' && (
          <>
            <AccView />
            {/* 予算と実績・内訳の詳細。開いたときだけ読み込む */}
            <details className="pay-detail" open={showPayDetail}
              onToggle={e => setShowPayDetail(e.currentTarget.open)}>
              <summary>📋 支払の詳細（予算と実績・内訳・カテゴリ別一覧）</summary>
              {showPayDetail && <Dashboard transactions={dashTransactions} onLoad={setDashTransactions} />}
            </details>
          </>
        )}

        {activeTab === 'input' && (
          <>
            <SubTabs tab="input" active={subTab.input} onChange={setSub('input')} badges={{ csv: csvCount }} />
            {subTab.input === 'csv' && <PayPayImport transactions={csvTransactions} onLoad={setCsvTransactions} />}
            {subTab.input === 'osaifu' && <OsaifuInput />}
            {subTab.input === 'rules' && <CategoryRules />}
          </>
        )}

        {activeTab === 'assets' && <AssetSummary />}

        {activeTab === 'future' && (
          <>
            <SubTabs tab="future" active={subTab.future} onChange={setSub('future')} />
            {subTab.future === 'lp' && <SimTab />}
            {subTab.future === 'ins' && <InsuranceSimulator />}
            {subTab.future === 'home' && <PJTab />}
          </>
        )}

        {activeTab === 'settings' && <AnnualPlan />}
      </main>
    </div>
  )
}
