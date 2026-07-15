import { useState } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './AIDiag.css'

// ─── マークダウン簡易レンダラー ───────────────────────
function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

function sectionClass(title) {
  if (title.includes('支出'))                       return 'sec-spend'
  if (title.includes('資産') || title.includes('健康')) return 'sec-asset'
  if (title.includes('老後') || title.includes('リスク') || title.includes('⚠')) return 'sec-risk'
  return 'sec-advice'
}

function MarkdownView({ text }) {
  const lines   = text.split('\n')
  const out     = []
  let listBuf   = []
  let key       = 0

  const flushList = () => {
    if (!listBuf.length) return
    out.push(
      <ul key={key++} className="md-ul">
        {listBuf.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>
    )
    listBuf = []
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushList()
      const t = line.slice(3)
      out.push(<h3 key={key++} className={`md-h2 ${sectionClass(t)}`}>{t}</h3>)
    } else if (/^[-*] /.test(line)) {
      listBuf.push(line.slice(2))
    } else if (/^\d+\. /.test(line)) {
      listBuf.push(line.replace(/^\d+\. /, ''))
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      out.push(<p key={key++} className="md-p">{renderInline(line)}</p>)
    }
  }
  flushList()

  return <div className="md-body">{out}</div>
}

// ─── メイン ──────────────────────────────────────────
export default function AIDiag({ simParams, simVals, simResults }) {
  const [status,   setStatus]   = useState('idle') // idle | loading | done | error
  const [diagText, setDiagText] = useState('')

  const run = async () => {
    if (!isGasReady()) {
      setStatus('error')
      setDiagText('GAS URLが設定されていません')
      return
    }
    setStatus('loading')
    setDiagText('')

    try {
      // 詳細データを並列取得
      const [assetsRes, fundsRes, dcRes, monthsRes, pensionRes, insRes] = await Promise.all([
        gasApi.getAssets(),
        gasApi.getInvestmentFunds(),
        gasApi.getDCAccounts(),
        gasApi.getMonths(),
        gasApi.getPensionData(),
        gasApi.getInsurances(),
      ])

      // 口座別最新残高
      const accLatest = {}
      for (const r of assetsRes.assets || []) {
        const key = `${r['区分']}__${r['種別']}__${r['口座名']}`
        if (!accLatest[key] || r['月'] > accLatest[key]['月']) accLatest[key] = r
      }
      const assets = Object.values(accLatest).map(r => ({
        kubun: r['区分'], type: r['種別'], name: r['口座名'],
        amount: Number(r['金額']) || 0,
      }))

      // 今月のカテゴリ別支出
      const recentMonths = (monthsRes.months || []).slice(0, 1)
      let spending    = {}
      let latestMonth = recentMonths[0] || ''
      if (latestMonth) {
        const txRes = await gasApi.getTransactions(latestMonth)
        for (const t of txRes.transactions || []) {
          if (t.amount > 0 && t.category !== 'ポイント' && t.category !== '収入・相殺') {
            spending[t.category] = (spending[t.category] || 0) + t.amount
          }
        }
      }

      // 投資信託（最新評価額）
      const fundLatest = {}
      for (const r of fundsRes.records || []) {
        const k = r['ファンド名']
        if (!fundLatest[k] || r['年月'] > fundLatest[k]['年月']) fundLatest[k] = r
      }
      const funds = (fundsRes.masters || []).map(m => ({
        name:       m['ファンド名'],
        broker:     m['証券会社'],
        monthlyAmt: Number(m['積立額(円/月)']) || 0,
        eval:       Number(fundLatest[m['ファンド名']]?.['評価額']) || 0,
        pnl:        Number(fundLatest[m['ファンド名']]?.['損益']) || 0,
      }))

      // DC（最新評価額）
      const dcLatest = {}
      for (const r of dcRes.records || []) {
        const k = r['運用機関']
        if (!dcLatest[k] || r['年月'] > dcLatest[k]['年月']) dcLatest[k] = r
      }
      const dc = (dcRes.masters || []).map(m => ({
        institution: m['運用機関'],
        companyAmt:  Number(m['会社掛金(円/月)']) || 0,
        selfAmt:     Number(m['自己掛金(円/月)']) || 0,
        eval:        Number(dcLatest[m['運用機関']]?.['評価額']) || 0,
        pnl:         Number(dcLatest[m['運用機関']]?.['損益']) || 0,
      }))

      // 年金（最新）
      const pension = (pensionRes.records || [])
        .sort((a, b) => b['確認年月'].localeCompare(a['確認年月']))
        .slice(0, 1)
        .map(r => ({
          yearMonth:  r['確認年月'],
          monthlyAmt: Number(r['受給見込み額(月額)']) || 0,
          months:     r['加入月数'] || '',
        }))

      // GAS に送信
      const json = await gasApi.diagnose({
        simParams, simVals, simResults,
        assets, funds, dc, pension, spending, latestMonth,
        insurancePolicies: (insRes.masters || []).length,
      })

      setDiagText(json.text)
      setStatus('done')
    } catch (e) {
      setDiagText(e.message)
      setStatus('error')
    }
  }

  return (
    <div className="ai-diag">
      <div className="ai-diag-head">
        <div>
          <h3 className="ai-diag-title">🤖 AI 診断</h3>
          <p className="ai-diag-desc">
            家計データと老後シミュレーションをもとに、AIが総合診断します。
          </p>
        </div>
        <button
          className={`ai-btn${status === 'loading' ? ' loading' : ''}`}
          onClick={run}
          disabled={status === 'loading'}
        >
          {status === 'loading'
            ? <><span className="ai-spinner" />診断中…（10〜20秒）</>
            : '🤖 AI診断を受ける'}
        </button>
      </div>

      {status === 'done' && (
        <div className="ai-result">
          <MarkdownView text={diagText} />
          <button className="ai-redo-btn" onClick={run}>🔄 再診断</button>
        </div>
      )}

      {status === 'error' && (
        <div className="ai-error">
          <strong>エラー:</strong> {diagText}
          {diagText.includes('CLAUDE_API_KEY') && (
            <p className="ai-error-hint">
              GAS のスクリプトプロパティに <code>CLAUDE_API_KEY</code> を設定してください。<br />
              （GASエディタ → プロジェクトの設定 → スクリプトプロパティ → 追加）
            </p>
          )}
          <button className="ai-redo-btn" onClick={run}>再試行</button>
        </div>
      )}
    </div>
  )
}
