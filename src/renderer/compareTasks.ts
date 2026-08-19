// 設計書§6/§10: 4課題横断比較（A-1 #p4）

import type { Employee, InfeasibleResult, SimulationResult, TaskId, UnitId } from './types.ts'
import { PREV_YEAR_REVENUE, round2, TASK_LABELS, UNIT_IDS } from './constants.ts'
import { runOptimization } from './optimizer.ts'

const UNIT_VAR: Record<UnitId, string> = { A: 'var(--a)', B: 'var(--b)', C: 'var(--c)' }
const BADGE_COLOR: Record<TaskId, string> = { 1: 'var(--a)', 2: 'var(--a)', 3: 'var(--b)', 4: 'var(--c)' }
const PRIMARY_LABEL: Record<TaskId, string> = {
  1: '全社売上（最大化対象）',
  2: 'A事業部利益（最大化対象）',
  3: 'B事業部売上（最大化対象）',
  4: 'C事業部売上（最大化対象）',
}
const PROFIT_SCALE = 30 // 億円（4カード共通スケール）

function oku1(n: number): string {
  return `${n.toFixed(1)}億`
}

function primaryValue(r: SimulationResult, task: TaskId): number {
  switch (task) {
    case 1:
      return r.companyRevenue
    case 2:
      return r.units.A.profit
    case 3:
      return r.units.B.finalRevenue
    case 4:
      return r.units.C.finalRevenue
  }
}

function infeasibleCard(task: TaskId): string {
  return `
    <div class="compare-card" style="border-color:var(--critical);">
      <div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};">課題${task}</span><h4>${TASK_LABELS[task]}</h4></div>
      <div class="compare-primary"><div class="k">${PRIMARY_LABEL[task]}</div><div class="v" style="color:var(--critical);">—</div><div class="d">制約を満たす配置なし</div></div>
      <div class="compare-status"><span class="pill crit">● 実行不能</span></div>
      <p class="compare-summary">この目的では全社売上58億円超を満たす配置が存在しない。</p>
    </div>`
}

function card(task: TaskId, r: SimulationResult, baseline: SimulationResult | null): string {
  const total = r.headcount.A + r.headcount.B + r.headcount.C
  const primary = primaryValue(r, task)

  // primary の差分表示
  let deltaHtml: string
  if (task === 1) {
    const d = round2(r.companyRevenue - PREV_YEAR_REVENUE)
    deltaHtml = `<div class="d ${d >= 0 ? 'good' : ''}">前年度比 ${d >= 0 ? '+' : ''}${d.toFixed(1)}億円</div>`
  } else if (baseline) {
    const d = round2(primary - primaryValue(baseline, task))
    deltaHtml = `<div class="d">課題1比 ${d >= 0 ? '+' : ''}${d.toFixed(1)}億円</div>`
  } else {
    deltaHtml = ''
  }

  const hcBars = UNIT_IDS.map((u) => {
    const w = total > 0 ? (r.headcount[u] / total) * 100 : 0
    return `<div class="cbar-row"><span>${u}</span><div class="cbar-track"><div class="cbar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div><b>${r.headcount[u]}名</b></div>`
  }).join('')

  const profitBars = UNIT_IDS.map((u) => {
    const w = Math.max(0, Math.min(100, (r.units[u].profit / PROFIT_SCALE) * 100))
    return `<div class="cbar-row"><span>${u}</span><div class="cbar-track"><div class="cbar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};opacity:.6;"></div></div><b>${oku1(r.units[u].profit)}</b></div>`
  }).join('')

  const revMargin = round2(r.companyRevenue - PREV_YEAR_REVENUE)
  const tight = revMargin <= 1
  const subRows =
    task === 1
      ? `<div><span class="cs-k">全社利益</span><span class="cs-v">${r.companyProfit.toFixed(1)}億円</span></div>`
      : `<div><span class="cs-k">全社売上</span><span class="cs-v"${tight ? ' style="color:var(--warning);font-weight:600;"' : ''}>${r.companyRevenue.toFixed(1)}億円${tight ? ' ⚠' : ''}</span></div><div><span class="cs-k">全社利益</span><span class="cs-v">${r.companyProfit.toFixed(1)}億円</span></div>`

  const statusPill = tight
    ? `<span class="pill warn">● 余裕+${revMargin.toFixed(1)}億円のみ</span>`
    : `<span class="pill good">● 制約を満たす</span>`

  const borderColor = task === 1 ? UNIT_VAR.A : tight ? 'var(--warning)' : ''
  const summary = buildSummary(task, r, baseline)

  return `
    <div class="compare-card"${borderColor ? ` style="border-color:${borderColor};"` : ''}>
      <div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};">課題${task}</span><h4>${TASK_LABELS[task]}</h4></div>
      <div class="compare-primary">
        <div class="k">${PRIMARY_LABEL[task]}</div>
        <div class="v" style="color:${BADGE_COLOR[task]};">${primary.toFixed(1)}<span class="unit">億円</span></div>
        ${deltaHtml}
      </div>
      <div class="bars-label">配置人数（A/B/C・合計${total}名）</div>
      <div class="compare-bars">${hcBars}</div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars}</div>
      <div class="compare-sub">${subRows}</div>
      <div class="compare-status">${statusPill}</div>
      <p class="compare-summary">${summary}</p>
    </div>`
}

function buildSummary(task: TaskId, r: SimulationResult, baseline: SimulationResult | null): string {
  const hc = r.headcount
  const maxUnit = UNIT_IDS.reduce((a, b) => (hc[b] > hc[a] ? b : a))
  if (task === 1) {
    return `人員を最適配分し全社売上を最大化。特定事業部に偏らないバランス型で、全社利益は${r.companyProfit.toFixed(1)}億円。`
  }
  const baseProfit = baseline ? baseline.companyProfit : r.companyProfit
  const dProfit = round2(r.companyProfit - baseProfit)
  const targetLabel = { 2: 'A事業部の利益', 3: 'B事業部の売上', 4: 'C事業部の売上' }[task]
  return `最も人員が厚いのは${maxUnit}事業部（${hc[maxUnit]}名）。${targetLabel}を最優先で最大化する一方、全社利益は課題1比 ${dProfit >= 0 ? '+' : ''}${dProfit.toFixed(1)}億円。`
}

/**
 * 4課題を実行して #p4 のカードを更新（設計書§6）。
 * 結果はメモリ上にキャッシュしてから描画する。
 */
export function renderCompareTasks(employees: Employee[]): void {
  const results: Record<TaskId, SimulationResult | InfeasibleResult> = {
    1: runOptimization(employees, 1),
    2: runOptimization(employees, 2),
    3: runOptimization(employees, 3),
    4: runOptimization(employees, 4),
  }
  const baseline = 'infeasible' in results[1] ? null : (results[1] as SimulationResult)

  const grid = document.getElementById('compare-tasks-grid')
  if (!grid) return
  grid.innerHTML = ([1, 2, 3, 4] as TaskId[])
    .map((t) => {
      const res = results[t]
      return 'infeasible' in res ? infeasibleCard(t) : card(t, res, baseline)
    })
    .join('')
}
