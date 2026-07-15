import { useState, useCallback } from 'react'
import { ALL_CATEGORIES } from '../utils/categorize'
import { loadCustomRules, saveCustomRule, deleteCustomRule } from '../utils/customRules'
import { gasApi, isGasReady } from '../utils/gasApi'
import './CategoryRules.css'

function RuleSetSection() {
  const [keyword, setKeyword]       = useState('')
  const [results, setResults]       = useState(null)
  const [changes, setChanges]       = useState({})
  const [loading, setLoading]       = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg, setSaveMsg]       = useState('')
  const [error, setError]           = useState('')
  const [rules, setRules]           = useState(() => loadCustomRules())
  const [syncError, setSyncError]   = useState('')

  const reloadRules = useCallback(() => setRules(loadCustomRules()), [])

  const handleSearch = async () => {
    const kw = keyword.trim()
    if (!kw) { setError('キーワードを入力してください'); return }
    setError('')
    setLoading(true)
    setResults(null)
    setChanges({})
    setSaveStatus('idle')
    setSaveMsg('')
    try {
      const { months } = await gasApi.getMonths()
      const all = await Promise.all(months.map((m) => gasApi.getTransactions(m)))
      const txs = all.flatMap((r) => r.transactions || [])
      const lower = kw.toLowerCase()
      const matched = txs.filter((t) =>
        (t['取引先'] || '').toLowerCase().includes(lower) ||
        (t['取引内容'] || '').toLowerCase().includes(lower)
      )
      matched.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      setResults(matched)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCatChange = (id, cat) => {
    setChanges((p) => ({ ...p, [id]: cat }))
    setSaveStatus('idle')
    setSaveMsg('')
  }

  const handleSave = async () => {
    const modified = (results || [])
      .filter((t) => changes[t.id] !== undefined)
      .map((t) => ({ ...t, category: changes[t.id], 'カテゴリ': changes[t.id] }))
    if (modified.length === 0) return
    setSaveStatus('saving')
    setSaveMsg('')
    try {
      // GASに過去データ保存
      const result = await gasApi.saveTransactions(modified)

      // 取引先ごとにカスタムルール保存（次回CSV取込から自動適用）
      const ruleMap = {}
      modified.forEach((t) => {
        const payee = (t['取引先'] || '').trim()
        if (payee && payee !== '-') ruleMap[payee] = t.category
      })
      Object.entries(ruleMap).forEach(([kw, cat]) => saveCustomRule(kw, cat))
      reloadRules()
      setSyncError('')
      if (isGasReady()) await gasApi.saveCategoryRules(loadCustomRules())

      setResults((prev) => prev.map((t) =>
        changes[t.id] !== undefined ? { ...t, category: changes[t.id] } : t
      ))
      setChanges({})
      setSaveStatus('saved')
      const ruleCount = Object.keys(ruleMap).length
      const txCount = result.inserted != null
        ? result.inserted + result.updated
        : result.saved
      setSaveMsg(`${txCount}件更新・ルール${ruleCount}件保存`)
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  const changedCount = Object.keys(changes).length
  const ruleEntries  = Object.entries(rules)

  return (
    <>
      <div className="catrules-form">
        <p className="catrules-hint">
          決裁先で検索し、カテゴリを変更して保存すると過去データの更新と同時に次回以降のCSV取込ルールが自動登録されます。
        </p>
        <div className="catrules-row">
          <input
            type="text"
            className="catrules-input"
            placeholder="決裁先キーワード（例：ユニクロ）"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="catrules-add-btn" onClick={handleSearch} disabled={loading}>
            {loading ? '検索中…' : '検索'}
          </button>
        </div>
        {error && <div className="catrules-error">{error}</div>}
      </div>

      {results !== null && (
        results.length === 0 ? (
          <div className="catrules-empty">該当する取引がありません</div>
        ) : (
          <>
            <div className="catrules-search-header">
              <span className="catrules-count">{results.length}件</span>
              <div className="catrules-save-area">
                {changedCount > 0 && (
                  <span className="catrules-changed">{changedCount}件変更中</span>
                )}
                <button
                  className={`catrules-save-btn catrules-save-btn--${saveStatus}`}
                  onClick={handleSave}
                  disabled={saveStatus === 'saving' || changedCount === 0}
                >
                  {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '保存'}
                </button>
              </div>
            </div>
            {saveMsg && (
              <div className={`catrules-save-msg catrules-save-msg--${saveStatus}`}>{saveMsg}</div>
            )}
            <div className="catrules-table-wrap">
              <table className="catrules-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>取引先</th>
                    <th>取引内容</th>
                    <th className="r">金額</th>
                    <th>カテゴリ</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((t) => {
                    const currentCat = changes[t.id] !== undefined ? changes[t.id] : t.category
                    const isChanged  = changes[t.id] !== undefined
                    return (
                      <tr key={t.id} className={isChanged ? 'catrules-row-changed' : ''}>
                        <td className="catrules-date">{t.date}</td>
                        <td className="catrules-payee">{t['取引先'] || '-'}</td>
                        <td className="catrules-desc">{t['取引内容'] || ''}</td>
                        <td className="catrules-amount r">¥{(t.amount || 0).toLocaleString()}</td>
                        <td>
                          <select
                            className="catrules-select catrules-select--inline"
                            value={currentCat}
                            onChange={(e) => handleCatChange(t.id, e.target.value)}
                          >
                            {ALL_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {ruleEntries.length > 0 && (
        <>
          <div className="catrules-divider">登録済みルール</div>
          {syncError && <div className="catrules-error">{syncError}</div>}
          <div className="catrules-table-wrap">
            <table className="catrules-table">
              <thead>
                <tr>
                  <th>取引先キーワード</th>
                  <th>カテゴリ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ruleEntries.map(([kw, cat]) => (
                  <tr key={kw}>
                    <td className="catrules-kw">{kw}</td>
                    <td className="catrules-cat">{cat}</td>
                    <td>
                      <button className="remove-btn" onClick={async () => {
                        deleteCustomRule(kw)
                        reloadRules()
                        setSyncError('')
                        if (isGasReady()) {
                          try { await gasApi.saveCategoryRules(loadCustomRules()) }
                          catch (e) { setSyncError('スプシ同期エラー: ' + e.message) }
                        }
                      }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function TxSearchSection() {
  const [keyword, setKeyword]       = useState('')
  const [results, setResults]       = useState(null)
  const [changes, setChanges]       = useState({})
  const [loading, setLoading]       = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMsg, setSaveMsg]       = useState('')
  const [error, setError]           = useState('')

  const handleSearch = async () => {
    const kw = keyword.trim()
    if (!kw) { setError('キーワードを入力してください'); return }
    setError('')
    setLoading(true)
    setResults(null)
    setChanges({})
    setSaveStatus('idle')
    setSaveMsg('')
    try {
      const { months } = await gasApi.getMonths()
      const all = await Promise.all(months.map((m) => gasApi.getTransactions(m)))
      const txs = all.flatMap((r) => r.transactions || [])
      const lower = kw.toLowerCase()
      const matched = txs.filter((t) =>
        (t['取引先'] || '').toLowerCase().includes(lower) ||
        (t['取引内容'] || '').toLowerCase().includes(lower)
      )
      matched.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      setResults(matched)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCatChange = (id, cat) => {
    setChanges((p) => ({ ...p, [id]: cat }))
    setSaveStatus('idle')
    setSaveMsg('')
  }

  const handleSave = async () => {
    const modified = (results || [])
      .filter((t) => changes[t.id] !== undefined)
      .map((t) => ({ ...t, category: changes[t.id], 'カテゴリ': changes[t.id] }))
    if (modified.length === 0) return
    setSaveStatus('saving')
    setSaveMsg('')
    try {
      const result = await gasApi.saveTransactions(modified)
      setResults((prev) => prev.map((t) =>
        changes[t.id] !== undefined ? { ...t, category: changes[t.id] } : t
      ))
      setChanges({})
      setSaveStatus('saved')
      const detail = result.inserted != null
        ? `${result.inserted}件追加・${result.updated}件更新`
        : `${result.saved}件保存`
      setSaveMsg(detail)
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  const changedCount = Object.keys(changes).length

  return (
    <>
      <div className="catrules-divider">過去データのカテゴリ修正（個別）</div>
      <div className="catrules-form">
        <p className="catrules-hint">ルールを作らず、過去の特定取引だけカテゴリを変更します。</p>
        <div className="catrules-row">
          <input
            type="text"
            className="catrules-input"
            placeholder="取引先キーワード（例：ユニクロ）"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="catrules-add-btn" onClick={handleSearch} disabled={loading}>
            {loading ? '検索中…' : '検索'}
          </button>
        </div>
        {error && <div className="catrules-error">{error}</div>}
      </div>

      {results !== null && (
        results.length === 0 ? (
          <div className="catrules-empty">該当する取引がありません</div>
        ) : (
          <>
            <div className="catrules-search-header">
              <span className="catrules-count">{results.length}件</span>
              <div className="catrules-save-area">
                {changedCount > 0 && (
                  <span className="catrules-changed">{changedCount}件変更中</span>
                )}
                <button
                  className={`catrules-save-btn catrules-save-btn--${saveStatus}`}
                  onClick={handleSave}
                  disabled={saveStatus === 'saving' || changedCount === 0}
                >
                  {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : '保存'}
                </button>
              </div>
            </div>
            {saveMsg && (
              <div className={`catrules-save-msg catrules-save-msg--${saveStatus}`}>{saveMsg}</div>
            )}
            <div className="catrules-table-wrap">
              <table className="catrules-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>取引先</th>
                    <th>取引内容</th>
                    <th className="r">金額</th>
                    <th>カテゴリ</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((t) => {
                    const currentCat = changes[t.id] !== undefined ? changes[t.id] : t.category
                    const isChanged  = changes[t.id] !== undefined
                    return (
                      <tr key={t.id} className={isChanged ? 'catrules-row-changed' : ''}>
                        <td className="catrules-date">{t.date}</td>
                        <td className="catrules-payee">{t['取引先'] || '-'}</td>
                        <td className="catrules-desc">{t['取引内容'] || ''}</td>
                        <td className="catrules-amount r">¥{(t.amount || 0).toLocaleString()}</td>
                        <td>
                          <select
                            className="catrules-select catrules-select--inline"
                            value={currentCat}
                            onChange={(e) => handleCatChange(t.id, e.target.value)}
                          >
                            {ALL_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </>
  )
}

export default function CategoryRules() {
  return (
    <div className="catrules">
      <RuleSetSection />
      {isGasReady() && <TxSearchSection />}
    </div>
  )
}
