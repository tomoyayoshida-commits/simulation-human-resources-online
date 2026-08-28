// 設計書§10: 結果ダッシュボード（③ #p3）のDOM更新

import type { Employee, InfeasibleResult, SimParams, SimulationResult, TaskId } from './types.ts'
import {
  DEFAULT_PARAMS,
  round2,
  TASK_LABELS,
  UNIT_IDS,
  UNIT_LABEL,
  UNIT_NAME,
  UNIT_VAR,
} from './constants.ts'
import { escapeHtml, oku, pill, signed } from './format.ts'
import { $ } from './dom.ts'
import { renderGaugesHtml } from './gauge.ts'
import { contribution, classifyType, membersByUnit, typeBreakdown } from './calcEngine.ts'
import { generateReasonText } from './reasonText.ts'

/** 実行不能時の表示（機能12/B-3）。参考配置があればその内容を但し書き付きで表示する。 */
function renderInfeasible(
  res: InfeasibleResult,
  task: TaskId,
  employees: Employee[],
  params: SimParams = DEFAULT_PARAMS,
): void {
  const subtitle = $('dashboard-subtitle')
  if (subtitle) subtitle.innerHTML = `選択課題：<b>${TASK_LABELS[task]}</b> — <span style="color:var(--critical);font-weight:600;">実行不能</span>`

  const reasonText =
    res.reason === 'min_headcount'
      ? '各事業部の最低人数を満たす人数配分が存在しません（最低人数制約がボトルネック）。'
      : '全社売上が前年度売上（58億円）を上回る配置が存在しません（全社売上下限がボトルネック）。'
  const closest = res.closestCandidate

  const summary = $('company-summary')
  if (summary) {
    summary.innerHTML = `
      <div class="stat" style="grid-column:1 / -1;">
        <div class="k">判定</div>
        <div class="v">${pill('crit', '● 実行不能')}</div>
        <div class="d">${reasonText}</div>
        ${
          closest
            ? `<div class="d">以下は制約を満たさないが、その中で最も条件に近い参考配置（全社売上 ${oku(closest.companyRevenue)}）を表示している。</div>`
            : ''
        }
      </div>`
  }

  if (!closest) {
    // 参考にできる候補すら存在しないため、前回実行結果を引き継がず全て空表示にする
    const emptyNote = '<p class="note">制約を満たす配置が存在しないため、この項目は表示できません。</p>'
    const bars = $('headcount-bars')
    if (bars) bars.innerHTML = emptyNote
    const typeTable = $('type-breakdown')
    if (typeTable) typeTable.innerHTML = ''
    const revProfit = $('unit-revenue-profit')
    if (revProfit) revProfit.innerHTML = emptyNote
    const constraint = $('constraint-check')
    if (constraint) constraint.innerHTML = ''
    const gauges = $('fulfillment-gauges')
    if (gauges) gauges.innerHTML = emptyNote
    const preview = $('assignment-preview')
    if (preview) preview.innerHTML = ''

    const reasonBox = $('reason-box')
    if (reasonBox) reasonBox.innerHTML = '<ul><li>制約を満たす配置が見つからなかったため、配置方針は生成されません。</li></ul>'
    return
  }

  // 参考配置（制約未達）の内訳をそのまま表示する。制約チェック表は closest.feasible により自動的に未達が示される。
  renderResultBody(closest, employees, params)

  const reasonBox = $('reason-box')
  if (reasonBox) {
    reasonBox.innerHTML =
      `<p class="note" style="color:var(--critical);">※ この配置は制約（${res.reason === 'min_headcount' ? '各事業部の最低人数' : '全社売上58億円超'}）を満たしていない参考配置です。</p>` +
      generateReasonText(closest, task, params)
  }
}

/** ダッシュボード全体を更新（設計書§10） */
export function renderDashboard(
  result: SimulationResult | InfeasibleResult,
  task: TaskId,
  employees: Employee[],
  params: SimParams = DEFAULT_PARAMS,
): void {
  if ('infeasible' in result) {
    renderInfeasible(result, task, employees, params)
    return
  }

  const { units } = result

  // サブタイトル
  const subtitle = $('dashboard-subtitle')
  if (subtitle)
    subtitle.innerHTML = `選択課題：<b>${TASK_LABELS[task]}</b>の結果を、配置〜方針まで1画面で確認する`

  // 全社サマリー
  const summary = $('company-summary')
  if (summary) {
    const diff = round2(result.companyRevenue - params.prevYearRevenue)
    const costTotal = round2(units.A.costTotal + units.B.costTotal + units.C.costTotal)
    const feasible = result.feasible
    summary.innerHTML = `
      <div class="stat"><div class="k">全社売上</div><div class="v">${oku(result.companyRevenue)}</div><div class="d ${diff >= 0 ? 'good' : ''}">前年度比 ${signed(diff)}億円</div></div>
      <div class="stat"><div class="k">全社利益</div><div class="v">${oku(result.companyProfit)}</div><div class="d">コスト計 ${oku(costTotal)}</div></div>
      <div class="stat"><div class="k">制約判定</div><div class="v">${feasible ? pill('good', '● すべて満たす') : pill('crit', '● 未達あり')}</div></div>`
  }

  renderResultBody(result, employees, params)

  // 配置方針・理由
  const reasonBox = $('reason-box')
  if (reasonBox) reasonBox.innerHTML = generateReasonText(result, task, params)
}

/**
 * 配置結果の内訳（配置人数バー〜配置結果プレビュー）を更新する。
 * 実行不能時の参考配置表示（renderInfeasible）と通常表示（renderDashboard）で共有する。
 */
function renderResultBody(
  result: SimulationResult,
  employees: Employee[],
  params: SimParams = DEFAULT_PARAMS,
): void {
  const { units, headcount } = result
  const total = headcount.A + headcount.B + headcount.C

  // 配置人数バー
  const bars = $('headcount-bars')
  if (bars) {
    bars.innerHTML = UNIT_IDS.map((u) => {
      const w = total > 0 ? (headcount[u] / total) * 100 : 0
      return `<div class="bar-row"><span class="label">${UNIT_LABEL[u]}</span><div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div><span class="val">${headcount[u]}名（適正${params.optimalHeadcount[u]}）</span></div>`
    }).join('')
  }

  // タイプ別内訳
  const grouped = membersByUnit(result.assignment, employees)
  const typeTable = $('type-breakdown')
  if (typeTable) {
    let html =
      '<tr><th>事業部</th><th class="num">配置人数</th><th class="num">営業型</th><th class="num">管理型</th><th class="num">開拓型</th><th class="num">育成型</th></tr>'
    for (const u of UNIT_IDS) {
      const b = typeBreakdown(grouped[u])
      html += `<tr><td>${UNIT_LABEL[u]}</td><td class="num">${headcount[u]}</td><td class="num">${b.営業型}</td><td class="num">${b.管理型}</td><td class="num">${b.開拓型}</td><td class="num">${b.育成型}</td></tr>`
    }
    typeTable.innerHTML = html
  }

  // 事業部別 売上・利益
  const revProfit = $('unit-revenue-profit')
  if (revProfit) {
    const revScale = Math.max(units.A.finalRevenue, units.B.finalRevenue, units.C.finalRevenue, 1)
    const profScale = Math.max(units.A.profit, units.B.profit, units.C.profit, 1)
    const revRows = UNIT_IDS.map((u) => {
      const w = (units[u].finalRevenue / revScale) * 100
      return `<div class="bar-row"><span class="label">${u} 売上</span><div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div><span class="val">${oku(units[u].finalRevenue)}</span></div>`
    }).join('')
    const profRows = UNIT_IDS.map((u) => {
      const w = (Math.max(units[u].profit, 0) / profScale) * 100
      return `<div class="bar-row"><span class="label">${u} 利益</span><div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};opacity:.6;"></div></div><span class="val">${oku(units[u].profit)}</span></div>`
    }).join('')
    revProfit.innerHTML = revRows + '<div style="height:10px;"></div>' + profRows
  }

  // 制約条件チェック（B-2 余裕表示）
  const constraint = $('constraint-check')
  if (constraint) {
    const revDiff = round2(result.companyRevenue - params.prevYearRevenue)
    const revOk = result.companyRevenue > params.prevYearRevenue
    let html =
      '<tr><th>制約</th><th>基準</th><th>結果</th><th>余裕</th><th>判定</th></tr>'
    html += `<tr><td>全社売上</td><td>${params.prevYearRevenue}.0億円超</td><td>${oku(result.companyRevenue)}</td><td style="color:${revOk ? '#006300' : 'var(--critical)'};">${signed(revDiff)}億円</td><td>${revOk ? pill('good', '● 満たす') : pill('crit', '● 未達')}</td></tr>`
    for (const u of UNIT_IDS) {
      const margin = headcount[u] - params.minHeadcount[u]
      const ok = margin >= 0
      const warn = ok && margin <= 3
      const color = !ok ? 'var(--critical)' : warn ? 'var(--warning)' : '#006300'
      html += `<tr><td>${UNIT_LABEL[u]} 最低人数</td><td>${params.minHeadcount[u]}名以上</td><td>${headcount[u]}名</td><td style="color:${color};">${margin >= 0 ? '+' : ''}${margin}名${warn ? '（注意）' : ''}</td><td>${ok ? pill('good', '● 満たす') : pill('crit', '● 未達')}</td></tr>`
    }
    constraint.innerHTML =
      html +
      '<p class="note">余裕が小さい制約は注意色で表示。制約に違反する場合は該当行を赤警告にする。</p>'
  }

  // 充足率・ペナルティ帯ゲージ
  const gauges = $('fulfillment-gauges')
  if (gauges) {
    gauges.innerHTML =
      renderGaugesHtml(result, UNIT_NAME, params) +
      '<p class="note">帯の境界付近にある事業部は、1名の増減が売上に与える影響が大きいため注意。</p>'
  }

  // 配置結果プレビュー
  const preview = $('assignment-preview')
  if (preview) {
    let html = '<tr><th>社員ID</th><th>配置先事業部</th><th class="num">貢献度</th><th>タイプ（参考）</th></tr>'
    for (const e of employees) {
      const unit = result.assignment[e.id]
      if (!unit) continue
      // 社員番号はCSVの生の文字列のためエスケープする（他は自前の定数・数値）
      html += `<tr><td>${escapeHtml(e.id)}</td><td>${UNIT_LABEL[unit]}</td><td class="num">${contribution(e, unit).toFixed(1)}</td><td>${classifyType(e)}</td></tr>`
    }
    preview.innerHTML = html
  }
}
