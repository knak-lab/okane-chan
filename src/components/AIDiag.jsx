import { useState } from 'react'
import { gasApi, isGasReady } from '../utils/gasApi'
import './AIDiag.css'

// ─── 数値・日付ユーティリティ ─────────────────────────
// "1,234,567" / "¥1,000" / 空欄 を数値に（LPタブと同じ読み方）
const parseAmt = (v) => Number(String(v ?? '').replace(/[,¥\s]/g, '')) || 0
const isBlank  = (v) => v === '' || v == null
const yen      = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`
// "2026-06" / "2026/06/01" / "2026/6" → "2026-06"
const toYM = (s) => {
  const m = String(s || '').match(/(\d{4})[/-](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : ''
}
// 今月から何か月前か（不明なら null）
const monthsAgo = (ym) => {
  const m = toYM(ym).match(/(\d{4})-(\d{2})/)
  if (!m) return null
  const now = new Date()
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]))
}

// 投信マスタの今の積立額（新: 積立スケジュール(JSON) / 旧: 積立額(円/月)）
function currentFundMonthly(m) {
  const json = m['積立スケジュール(JSON)']
  if (json) {
    try {
      const sched = JSON.parse(json)
      const cur = sched.find(p => !p.endMonth) || sched[sched.length - 1]
      return parseAmt(cur?.amount)
    } catch { /* 旧スキーマへ */ }
  }
  return parseAmt(m['積立額(円/月)'])
}

// 種別ごとに「最新の非空レコード」を取る
function latestBy(records, keyOf, monthKey, valueKey) {
  const out = {}
  for (const r of records || []) {
    if (valueKey && isBlank(r[valueKey])) continue
    const k = keyOf(r)
    if (!out[k] || toYM(r[monthKey]) > toYM(out[k][monthKey])) out[k] = r
  }
  return out
}

// ─── データの過不足チェック（AIに渡す前に機械的に洗い出す） ───────
function buildChecks({ lp, assets, funds, dc }) {
  const { params: p, vals: v, wife, events: ev, dataMeta: dm = {} } = lp
  const checks = []
  const add = (level, text) => checks.push({ level, text })

  if (dm.failedFetches?.length) add('ng', `取得に失敗したデータ: ${dm.failedFetches.join('・')}`)

  // 資産
  if (!v.cashAssets)   add('ng', '預金が0円（資産タブ未入力、または取得失敗）')
  if (!v.investAssets) add('warn', '投資資産（投信＋DC評価額）が0円')
  for (const a of assets) {
    const ago = monthsAgo(a.month)
    if (ago != null && ago >= 3) add('warn', `口座「${a.name}」の残高が${ago}か月前（${toYM(a.month)}）のまま`)
  }
  for (const f of [...funds.map(x => ({ ...x, label: `投信「${x.name}」` })), ...dc.map(x => ({ ...x, label: `DC「${x.institution}」` }))]) {
    const ago = monthsAgo(f.month)
    if (!f.month) add('warn', `${f.label}の評価額の記録がない`)
    else if (ago >= 3) add('warn', `${f.label}の評価額が${ago}か月前（${toYM(f.month)}）のまま`)
  }

  // 収入・支出
  if (!v.myIncome) add('ng', dm.hasAnnualPlan === false
    ? 'あなたの手取り年収が0円（年間タブに今年の給与・ボーナス計画がない）'
    : 'あなたの手取り年収が0円')
  if (!v.monthlyExpense) add('ng', '生活費（安心＋彩り）が0円（取引データなし？）')
  else if (dm.expenseMonthsUsed != null && dm.expenseMonthsUsed < 12)
    add('warn', `生活費の平均が${dm.expenseMonthsUsed}か月分しかない（季節変動を拾いきれない）`)
  if (!v.yutoriAnnual) add('warn', 'ときめき＋冒険（年額）が0円（年間タブ未入力？）')
  if (!p.monthlyRent && !(ev.home?.enabled && ev.home?.stopRent)) add('warn', '家賃が0円で、マイホームもオフ')

  // 年金
  if (!v.pensionMonthly) add('ng', 'あなたの年金見込み額が0円（年金タブ未入力）')
  else {
    const ago = monthsAgo(dm.pensionYearMonth)
    if (ago != null && ago >= 12) add('warn', `年金見込み額の確認が${Math.floor(ago / 12)}年以上前（${dm.pensionYearMonth}）`)
  }
  if (!p.wifePensionMonthly) add('warn', '妻の年金が0円（ねんきん定期便の見込み額が未入力）')

  // 妻の収入
  const stagesAdd = (wife.stages || []).reduce((s, st) => s + (Number(st.add) || 0), 0)
  if (!Number(wife.base) && !stagesAdd) add('warn', '妻の手取り年収が基本・段階ともに0円')

  // 保険
  if (dm.insurancePolicies && !v.insuranceReturn) add('warn', '保険はあるが返戻予定額が0円（解約返戻金テーブル未入力？）')
  if (dm.usdJpyFallback && v.insuranceReturn) add('warn', '為替レートが取得できず USD/JPY=150 の仮値で換算')

  // ライフイベント
  if (ev.home?.enabled && !ev.homestLinked) add('info', 'マイホームの価格・頭金は「家」タブと連携しておらず手入力値')
  for (const [k, label] of [['child1', '第1子'], ['child2', '第2子']]) {
    const c = ev[k]
    if (c?.enabled && Number(c.currentAge) >= 22) add('info', `${label}は${c.currentAge}歳で教育費の計算対象外`)
  }
  if (!Object.values(ev).some(e => e && typeof e === 'object' && e.enabled))
    add('info', 'ライフイベントがすべてオフ')

  return checks
}

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
  if (title.includes('過不足'))                       return 'sec-spend'
  if (title.includes('診断') || title.includes('資産')) return 'sec-asset'
  if (title.includes('精度') || title.includes('リスク') || title.includes('⚠')) return 'sec-risk'
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
    if (line.startsWith('## ') || line.startsWith('### ')) {
      flushList()
      const t = line.replace(/^#+ /, '')
      out.push(<h3 key={key++} className={`md-h2 ${sectionClass(t)}`}>{t}</h3>)
    } else if (/^\s*[-*] /.test(line)) {
      listBuf.push(line.replace(/^\s*[-*] /, ''))
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

const CHECK_ICON = { ng: '❌', warn: '⚠️', info: 'ℹ️' }

// ─── メイン ──────────────────────────────────────────
export default function AIDiag({ lp }) {
  const [status,   setStatus]   = useState('idle') // idle | loading | done | error
  const [diagText, setDiagText] = useState('')
  const [basis,    setBasis]    = useState(null) // AIに渡した数字（根拠表示用）

  const run = async () => {
    if (!isGasReady()) {
      setStatus('error')
      setDiagText('GAS URLが設定されていません')
      return
    }
    setStatus('loading')
    setDiagText('')

    try {
      // 鮮度チェック用の明細（LPタブは合計しか持っていないため）
      const [assetsRes, fundsRes, dcRes] = await Promise.all([
        gasApi.getAssets(),
        gasApi.getInvestmentFunds(),
        gasApi.getDCAccounts(),
      ])

      const accLatest = latestBy(assetsRes.assets,
        r => `${r['区分']}__${r['種別']}__${r['口座名']}`, '月', '金額')
      const assets = Object.values(accLatest).map(r => ({
        kubun: r['区分'], type: r['種別'], name: r['口座名'], month: toYM(r['月']),
        amount: parseAmt(r['金額']),
      }))

      const fundLatest = latestBy(fundsRes.records, r => r['ファンド名'], '年月', '評価額')
      const funds = (fundsRes.masters || []).map(m => {
        const r = fundLatest[m['ファンド名']]
        return {
          name: m['ファンド名'], broker: m['証券会社'], monthlyAmt: currentFundMonthly(m),
          eval: parseAmt(r?.['評価額']), pnl: parseAmt(r?.['損益']), month: toYM(r?.['年月']),
        }
      })

      const dcLatest = latestBy(dcRes.records, r => r['運用機関'], '年月', '評価額')
      const dc = (dcRes.masters || []).map(m => {
        const r = dcLatest[m['運用機関']]
        return {
          institution: m['運用機関'],
          companyAmt: parseAmt(m['会社掛金(円/月)']), selfAmt: parseAmt(m['自己掛金(円/月)']),
          eval: parseAmt(r?.['評価額']), pnl: parseAmt(r?.['損益']), month: toYM(r?.['年月']),
        }
      })

      const checks = buildChecks({ lp, assets, funds, dc })
      const payload = { lp, assets, funds, dc, checks, today: toYM(new Date().toISOString()) }
      setBasis(payload)

      const json = await gasApi.diagnose(payload)
      setDiagText(String(json.text || ''))
      setStatus('done')
    } catch (e) {
      setDiagText(String(e?.message || e))
      setStatus('error')
    }
  }

  const v = basis?.lp?.vals
  return (
    <div className="ai-diag">
      <div className="ai-diag-head">
        <div>
          <h3 className="ai-diag-title">🤖 AI 診断</h3>
          <p className="ai-diag-desc">
            このLPタブの入力と結果をもとに、診断・データの過不足・精度を上げるために追加すべきデータをAIがまとめます。
          </p>
        </div>
        <button
          className={`ai-btn${status === 'loading' ? ' loading' : ''}`}
          onClick={run}
          disabled={status === 'loading'}
        >
          {status === 'loading'
            ? <><span className="ai-spinner" />診断中…（10〜30秒）</>
            : '🤖 AI診断を受ける'}
        </button>
      </div>

      {status === 'done' && (
        <div className="ai-result">
          <MarkdownView text={diagText} />
          {basis && (
            <details className="ai-basis">
              <summary>📋 この診断に使った数字</summary>
              <ul className="md-ul">
                <li>資産: 預金 {yen(v.cashAssets)} ＋ 投資 {yen(v.investAssets)} ＝ <strong>{yen(v.cashAssets + v.investAssets)}</strong></li>
                <li>手取り年収: あなた {yen(v.myIncome)} ／ 妻（今年） {yen(basis.lp.results.wifeIncomeNow)}</li>
                <li>積立: 投信 {yen(v.monthlyFundInvest)}/月 ＋ DC {yen(v.monthlyDCInvest)}/月</li>
                <li>生活費: {yen(basis.lp.results.monthlyLiving)}/月（安心＋彩り {yen(v.monthlyExpense)}・家賃 {yen(basis.lp.params.monthlyRent)}・ときめき＋冒険 {yen(v.yutoriAnnual)}/年）</li>
                <li>年金: あなた {yen(v.pensionMonthly)}/月 ＋ 妻 {yen(basis.lp.params.wifePensionMonthly)}/月</li>
                <li>退職時資産 {yen(basis.lp.results.retireAssets)} ／ 資産が尽きる年齢 {basis.lp.results.zeroAge ? `${basis.lp.results.zeroAge}歳` : 'なし'}</li>
              </ul>
              <p className="md-p">自動チェック</p>
              <ul className="md-ul ai-checks">
                {basis.checks.length === 0 && <li>✅ 気になる点なし</li>}
                {basis.checks.map((c, i) => <li key={i}>{CHECK_ICON[c.level]} {c.text}</li>)}
              </ul>
              <p className="md-p">口座別（金額が入っている最新の月）</p>
              <ul className="md-ul">
                {basis.assets.length === 0 && <li>データなし</li>}
                {basis.assets.map((a, i) => (
                  <li key={i}>[{a.kubun}] {a.name}: {yen(a.amount)}（{a.month || '月不明'}）</li>
                ))}
              </ul>
            </details>
          )}
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
