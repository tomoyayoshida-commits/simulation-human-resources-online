// 設計書§6/§10: 4課題横断比較（A-1 #p4）

import type { Employee, InfeasibleResult, SimulationResult, TaskId } from './types.ts'
import {
  PREV_YEAR_REVENUE,
  PROFIT_SCALE,
  round2,
  TASK_IDS,
  TASK_LABELS,
  taskTargetLabel,
  UNIT_IDS,
  UNIT_VAR,
} from './constants.ts'
import { oku, oku1, signed } from './format.ts'
import { $, setHtml } from './dom.ts'
import { taskPrimaryValue } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'
import { generateReasonText } from './reasonText.ts'

const BADGE_COLOR: Record<TaskId, string> = { 1: 'var(--a)', 2: 'var(--a)', 3: 'var(--b)', 4: 'var(--c)' }
const PRIMARY_LABEL: Record<TaskId, string> = {
  1: '全社売上（最大化対象）',
  2: 'A事業部利益（最大化対象）',
  3: 'B事業部売上（最大化対象）',
  4: 'C事業部売上（最大化対象）',
}
/** 事業部別バーの表示対象（売上と利益の混在を避けるため、切替で単一指標のみ表示する） */
export type BarMode = 'revenue' | 'profit'
const BAR_LABEL: Record<BarMode, string> = { revenue: '事業部別売上', profit: '事業部別利益' }

export type TaskResults = Record<TaskId, SimulationResult | InfeasibleResult>

/**
 * #p4 のビュー状態。
 * モード切替のたびに runOptimization を回さないよう結果をキャッシュする。
 * 可変な状態はこの1オブジェクトに閉じ、HTML生成は buildCompareGridHtml（純粋関数）に出してある。
 */
const view: { barMode: BarMode; results: TaskResults | null; baseline: SimulationResult | null } = {
  barMode: 'profit',
  results: null,
  baseline: null,
}

/** 事業部別売上バーの共通スケール（4課題×3事業部の最大値）。利益は既存の固定スケールを維持。 */
function revenueScale(results: Record<TaskId, SimulationResult | InfeasibleResult>): number {
  let max = 1
  for (const t of TASK_IDS) {
    const r = results[t]
    if ('infeasible' in r) continue
    for (const u of UNIT_IDS) max = Math.max(max, r.units[u].finalRevenue)
  }
  return max
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

function card(task: TaskId, r: SimulationResult, baseline: SimulationResult | null, mode: BarMode, scale: number): string {
  const total = r.headcount.A + r.headcount.B + r.headcount.C
  const primary = taskPrimaryValue(r, task)

  // primary の差分表示
  let deltaHtml: string
  if (task === 1) {
    const d = round2(r.companyRevenue - PREV_YEAR_REVENUE)
    deltaHtml = `<div class="d ${d >= 0 ? 'good' : ''}">前年度比 ${signed(d)}億円</div>`
  } else if (baseline) {
    const d = round2(primary - taskPrimaryValue(baseline, task))
    deltaHtml = `<div class="d">課題1比 ${signed(d)}億円</div>`
  } else {
    deltaHtml = ''
  }

  const hcBars = UNIT_IDS.map((u) => {
    const w = total > 0 ? (r.headcount[u] / total) * 100 : 0
    return `<div class="cbar-row"><span>${u}</span><div class="cbar-track"><div class="cbar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div><b>${r.headcount[u]}名</b></div>`
  }).join('')

  const barField = mode === 'profit' ? 'profit' : 'finalRevenue'
  const unitBars = UNIT_IDS.map((u) => {
    const val = r.units[u][barField]
    const w = Math.max(0, Math.min(100, (val / scale) * 100))
    return `<div class="cbar-row"><span>${u}</span><div class="cbar-track"><div class="cbar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};opacity:.6;"></div></div><b>${oku1(val)}</b></div>`
  }).join('')

  // 全社売上・全社利益は課題によらず常に両方表示する（primary が売上/利益いずれかに偏るため、
  // ここで両指標を揃えて示すことで「事業部別バーは利益、subは売上」のような混在感を減らす）。
  const revMargin = round2(r.companyRevenue - PREV_YEAR_REVENUE)
  const tight = revMargin <= 1
  const subRows =
    `<div><span class="cs-k">全社売上</span><span class="cs-v"${tight ? ' style="color:var(--warning);font-weight:600;"' : ''}>${oku(r.companyRevenue)}${tight ? ' ⚠' : ''}</span></div>` +
    `<div><span class="cs-k">全社利益</span><span class="cs-v">${oku(r.companyProfit)}</span></div>`

  const statusPill = tight
    ? `<span class="pill warn">● 余裕+${revMargin.toFixed(2)}億円のみ</span>`
    : `<span class="pill good">● 制約を満たす</span>`

  const borderColor = task === 1 ? UNIT_VAR.A : tight ? 'var(--warning)' : ''
  const summary = buildSummary(task, r, baseline)
  const reasonHtml = `<details class="compare-reason" open><summary>配置理由</summary>${generateReasonText(r, task)}</details>`

  return `
    <div class="compare-card"${borderColor ? ` style="border-color:${borderColor};"` : ''}>
      <div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};">課題${task}</span><h4>${TASK_LABELS[task]}</h4></div>
      <div class="compare-primary">
        <div class="k">${PRIMARY_LABEL[task]}</div>
        <div class="v" style="color:${BADGE_COLOR[task]};">${primary.toFixed(2)}<span class="unit">億円</span></div>
        ${deltaHtml}
      </div>
      <div class="bars-label">配置人数（A/B/C・合計${total}名）</div>
      <div class="compare-bars">${hcBars}</div>
      <div class="bars-label">${BAR_LABEL[mode]}（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${unitBars}</div>
      <div class="compare-sub">${subRows}</div>
      <div class="compare-status">${statusPill}</div>
      <p class="compare-summary">${summary}</p>
      ${reasonHtml}
    </div>`
}

function buildSummary(task: TaskId, r: SimulationResult, baseline: SimulationResult | null): string {
  const hc = r.headcount
  const maxUnit = UNIT_IDS.reduce((a, b) => (hc[b] > hc[a] ? b : a))
  if (task === 1) {
    return `人員を最適配分し全社売上を最大化。特定事業部に偏らないバランス型で、全社利益は${oku(r.companyProfit)}。`
  }
  const baseProfit = baseline ? baseline.companyProfit : r.companyProfit
  const dProfit = round2(r.companyProfit - baseProfit)
  return `最も人員が厚いのは${maxUnit}事業部（${hc[maxUnit]}名）。${taskTargetLabel(task)}を最優先で最大化する一方、全社利益は課題1比 ${signed(dProfit)}億円。`
}

/**
 * 4課題分のカードHTMLを組み立てる（純粋関数・DOM非依存）。
 * ビュー状態から切り離してあるので、最適化結果を渡すだけで単体テストできる。
 */
export function buildCompareGridHtml(
  results: TaskResults,
  baseline: SimulationResult | null,
  mode: BarMode,
): string {
  const scale = mode === 'profit' ? PROFIT_SCALE : revenueScale(results)
  return TASK_IDS.map((t) => {
    const res = results[t]
    return 'infeasible' in res ? infeasibleCard(t) : card(t, res, baseline, mode, scale)
  }).join('')
}

/** キャッシュ済みの結果とバー表示モードから #p4 のカードを再描画する（最適化の再実行はしない）。 */
function renderCards(): void {
  if (!view.results) return
  setHtml('compare-tasks-grid', buildCompareGridHtml(view.results, view.baseline, view.barMode))
}

/**
 * 4課題を実行して #p4 のカードを更新（設計書§6）。
 * 結果はメモリ上にキャッシュしてから描画する。
 */
export function renderCompareTasks(employees: Employee[]): void {
  const results: TaskResults = {
    1: runOptimization(employees, 1),
    2: runOptimization(employees, 2),
    3: runOptimization(employees, 3),
    4: runOptimization(employees, 4),
  }
  view.results = results
  view.baseline = 'infeasible' in results[1] ? null : results[1]
  renderCards()
}

/**
 * 事業部別バーの「売上で見る／利益で見る」切替を初期化する（1回だけ呼ぶ）。
 * ボタンは index.html に静的に配置済みなので、renderCompareTasks による
 * grid.innerHTML の再描画では消えない。
 */
export function initCompareModeToggle(): void {
  const buttons: { id: string; mode: BarMode }[] = [
    { id: 'cmp-mode-profit', mode: 'profit' },
    { id: 'cmp-mode-revenue', mode: 'revenue' },
  ]
  for (const { id, mode } of buttons) {
    $(id)?.addEventListener('click', () => {
      if (view.barMode === mode) return
      view.barMode = mode
      for (const b of buttons) {
        $(b.id)?.classList.toggle('active', b.mode === mode)
      }
      renderCards()
    })
  }
}
