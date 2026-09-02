// 設計書§6/§10: 4課題横断比較（A-1 #p4）

import type { Employee, InfeasibleResult, SimParams, SimulationResult, TaskId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import {
  DEFAULT_PARAMS,
  PROFIT_SCALE,
  round2,
  TASK_IDS,
  taskLabel,
  TASK_SPEC,
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

/**
 * 見出し・事業部別バーに**表示する**指標。最適化に使った指標（OptimizePolicy）とは独立で、
 * 「利益重視で選んだ配置を売上で評価する」といった読み方ができるように分けてある。
 */
export type BarMode = TaskMetric
const BAR_LABEL: Record<BarMode, string> = { revenue: '事業部別売上', profit: '事業部別利益' }
const METRIC_LABEL: Record<BarMode, string> = { revenue: '売上', profit: '利益' }

/**
 * **最適化に使う**指標の方針。
 *
 * 課題原文は指標が混在している（課題1=売上／課題2=利益／課題3・4=売上）ため、
 * 4枚のカードを横に並べても「どの事業部を優遇するか」の対照になっていない
 * （対象事業部と指標の2軸が同時に動く）。指標を揃えた対照を見られるようにしつつ、
 * 提出物の正としての原文どおりは既定で必ず取れるようにするため、3値にしてある。
 */
export type OptimizePolicy = 'original' | 'revenue' | 'profit'

/** 方針と課題から、その課題を最適化するときの指標を決める。 */
export function metricFor(task: TaskId, policy: OptimizePolicy): TaskMetric {
  return policy === 'original' ? TASK_SPEC[task].metric : policy
}

/**
 * (課題 × 指標) 全8通りの最適化結果。
 *
 * 方針の切替はこの表からの選択にすぎず、再最適化は起きない。3方針ぶんを別々に持たないのは、
 * 方針間で組み合わせがほとんど重複するため（相異なるのは7通り。実測で945ms→1566ms、
 * 8通り全部でも約1.6秒）。取込直後の1回でまとめて計算しておけば切替は再描画だけで済む。
 */
export type AllTaskResults = Record<TaskId, Record<TaskMetric, SimulationResult | InfeasibleResult>>

/** 1方針ぶんの4課題の結果（表示側が実際に読むのはこの形）。 */
export type TaskResults = Record<TaskId, SimulationResult | InfeasibleResult>

/** 全8通りの表から、指定方針の4課題ぶんを取り出す。 */
export function selectResults(all: AllTaskResults, policy: OptimizePolicy): TaskResults {
  return {
    1: all[1][metricFor(1, policy)],
    2: all[2][metricFor(2, policy)],
    3: all[3][metricFor(3, policy)],
    4: all[4][metricFor(4, policy)],
  }
}

/**
 * カード見出しの指標名。対象範囲（全社／対象事業部）は課題固定、指標だけが表示モードに従う。
 * 何を最大化した結果かはカード上部の課題名が示すので、ここでは注記を付けない。
 */
function primaryLabel(task: TaskId, mode: BarMode): string {
  const { targetUnit } = TASK_SPEC[task]
  const scope = targetUnit === null ? '全社' : `${targetUnit}事業部`
  return `${scope}${METRIC_LABEL[mode]}`
}

/**
 * #p4 のビュー状態。
 * モード切替のたびに runOptimization を回さないよう結果をキャッシュする。
 * 可変な状態はこの1オブジェクトに閉じ、HTML生成は buildCompareGridHtml（純粋関数）に出してある。
 */
const view: { barMode: BarMode; policy: OptimizePolicy; all: AllTaskResults | null; params: SimParams } = {
  barMode: 'profit',
  policy: 'original',
  all: null,
  params: DEFAULT_PARAMS,
}

/** 事業部別売上バーの共通スケール（4課題×3事業部の最大値）。利益は既存の固定スケールを維持。 */
function revenueScale(results: TaskResults): number {
  let max = 1
  for (const t of TASK_IDS) {
    const r = results[t]
    if ('infeasible' in r) continue
    for (const u of UNIT_IDS) max = Math.max(max, r.units[u].finalRevenue)
  }
  return max
}

/** カード生成が共通で読む文脈。引数が増えすぎないようまとめてある。 */
interface CardContext {
  mode: BarMode
  policy: OptimizePolicy
  scale: number
  params: SimParams
  /** 「課題1比」の基準。同じ方針で解いた課題1の結果 */
  baseline: SimulationResult | null
}

function infeasibleCard(task: TaskId, ctx: CardContext): string {
  const metric = metricFor(task, ctx.policy)
  return `
    <div class="compare-card" style="border-color:var(--critical);">
      <div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};">課題${task}</span><h4>${taskLabel(task, metric)}</h4></div>
      <div class="compare-primary"><div class="k">${primaryLabel(task, ctx.mode)}</div><div class="v" style="color:var(--critical);">—</div><div class="d">制約を満たす配置なし</div></div>
      <div class="compare-status"><span class="pill crit">● 実行不能</span></div>
      <div class="bars-label">概要</div>
      <p class="compare-summary">この目的では全社売上${ctx.params.prevYearRevenue}億円超を満たす配置が存在しない。</p>
    </div>`
}

function card(task: TaskId, r: SimulationResult, ctx: CardContext): string {
  const { mode, scale, params, baseline } = ctx
  const metric = metricFor(task, ctx.policy)
  const total = r.headcount.A + r.headcount.B + r.headcount.C
  const primary = taskPrimaryValue(r, task, mode)

  // primary の差分表示。基準は課題1（＝baseline）だが、課題1自身は比較先がないので前年度実績と比べる。
  // 前年度実績として持っているのは売上だけなので、利益表示のときは差分を出さない。
  let deltaHtml: string
  if (task === 1) {
    if (mode === 'revenue') {
      const d = round2(r.companyRevenue - params.prevYearRevenue)
      deltaHtml = `<div class="d ${d >= 0 ? 'good' : ''}">前年度比 ${signed(d)}億円</div>`
    } else {
      deltaHtml = ''
    }
  } else if (baseline) {
    const d = round2(primary - taskPrimaryValue(baseline, task, mode))
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
  const revMargin = round2(r.companyRevenue - params.prevYearRevenue)
  const tight = revMargin <= 1
  const subRows =
    `<div><span class="cs-k">全社売上</span><span class="cs-v"${tight ? ' style="color:var(--warning);font-weight:600;"' : ''}>${oku(r.companyRevenue)}${tight ? ' ⚠' : ''}</span></div>` +
    `<div><span class="cs-k">全社利益</span><span class="cs-v">${oku(r.companyProfit)}</span></div>`

  const statusPill = tight
    ? `<span class="pill warn">● 余裕+${revMargin.toFixed(2)}億円のみ</span>`
    : `<span class="pill good">● 制約を満たす</span>`

  const borderColor = task === 1 ? UNIT_VAR.A : tight ? 'var(--warning)' : ''
  const summary = buildSummary(task, r, baseline, metric)
  const reasonHtml = `<details class="compare-reason"><summary>配置理由</summary>${generateReasonText(r, task, params, metric)}</details>`

  return `
    <div class="compare-card"${borderColor ? ` style="border-color:${borderColor};"` : ''}>
      <div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};">課題${task}</span><h4>${taskLabel(task, metric)}</h4></div>
      <div class="compare-primary">
        <div class="k">${primaryLabel(task, mode)}</div>
        <div class="v" style="color:${BADGE_COLOR[task]};">${primary.toFixed(2)}<span class="unit">億円</span></div>
        ${deltaHtml}
      </div>
      <div class="bars-label">配置人数（A/B/C・合計${total}名）</div>
      <div class="compare-bars">${hcBars}</div>
      <div class="bars-label">${BAR_LABEL[mode]}（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${unitBars}</div>
      <div class="compare-sub">${subRows}</div>
      <div class="compare-status">${statusPill}</div>
      <div class="bars-label">概要</div>
      <p class="compare-summary">${summary}</p>
      ${reasonHtml}
    </div>`
}

function buildSummary(
  task: TaskId,
  r: SimulationResult,
  baseline: SimulationResult | null,
  metric: TaskMetric,
): string {
  const hc = r.headcount
  const maxUnit = UNIT_IDS.reduce((a, b) => (hc[b] > hc[a] ? b : a))
  if (task === 1) {
    // 全社コスト＝Σ人件費×3÷100 は「全員がどこかに配属される」以上、配置によらず一定。
    // よって全社利益＝全社売上−定数となり、利益で最大化しても解は売上最大化と一致する
    // （タイブレークまで含めて一致することは test/optimizer.test.ts で担保）。
    const note =
      metric === 'profit'
        ? '全社コストは配置によらず一定のため、利益で最大化しても売上最大化と同じ配置になる。'
        : ''
    return `人員を最適配分し${taskTargetLabel(1, metric)}を最大化。特定事業部に偏らないバランス型で、全社利益は${oku(r.companyProfit)}。${note}`
  }
  const baseProfit = baseline ? baseline.companyProfit : r.companyProfit
  const dProfit = round2(r.companyProfit - baseProfit)
  return `最も人員が厚いのは${maxUnit}事業部（${hc[maxUnit]}名）。${taskTargetLabel(task, metric)}を最優先で最大化する一方、全社利益は課題1比 ${signed(dProfit)}億円。`
}

/**
 * 4課題分のカードHTMLを組み立てる（純粋関数・DOM非依存）。
 * ビュー状態から切り離してあるので、最適化結果を渡すだけで単体テストできる。
 */
export function buildCompareGridHtml(
  all: AllTaskResults,
  mode: BarMode,
  policy: OptimizePolicy,
  params: SimParams = DEFAULT_PARAMS,
): string {
  const results = selectResults(all, policy)
  const first = results[1]
  const ctx: CardContext = {
    mode,
    policy,
    scale: mode === 'profit' ? PROFIT_SCALE : revenueScale(results),
    params,
    baseline: 'infeasible' in first ? null : first,
  }
  return TASK_IDS.map((t) => {
    const res = results[t]
    return 'infeasible' in res ? infeasibleCard(t, ctx) : card(t, res, ctx)
  }).join('')
}

/** キャッシュ済みの結果から #p4 のカードを再描画する（最適化の再実行はしない）。 */
function renderCards(): void {
  if (!view.all) return
  setHtml('compare-tasks-grid', buildCompareGridHtml(view.all, view.barMode, view.policy, view.params))
}

/**
 * 4課題を (課題 × 指標) の8通りぶん実行して #p4 のカードを更新（設計書§6）。
 * 結果はメモリ上にキャッシュしてから描画するので、以後の切替に再計算は要らない。
 * params未指定時は標準の前提パラメータを使う（#p4の「オプション」で前提を変えた場合はその値）。
 */
export function renderCompareTasks(employees: Employee[], params: SimParams = DEFAULT_PARAMS): void {
  const all = {} as AllTaskResults
  for (const t of TASK_IDS) {
    all[t] = {
      revenue: runOptimization(employees, t, params, 'revenue'),
      profit: runOptimization(employees, t, params, 'profit'),
    }
  }
  view.all = all
  view.params = params
  renderCards()
}

/** ボタン群のうち1つだけに active を付ける。 */
function setActive(ids: string[], activeId: string): void {
  for (const id of ids) $(id)?.classList.toggle('active', id === activeId)
}

/**
 * #p4 の2つの切替（表示指標・最適化方針）を初期化する（1回だけ呼ぶ）。
 * ボタンは index.html に静的に配置済みなので、renderCompareTasks による
 * grid.innerHTML の再描画では消えない。どちらもキャッシュ済み結果の再描画だけで、
 * 最適化は走らない（＝読み込み画面が出ない）。
 */
export function initCompareModeToggle(): void {
  const modeButtons: { id: string; mode: BarMode }[] = [
    { id: 'cmp-mode-profit', mode: 'profit' },
    { id: 'cmp-mode-revenue', mode: 'revenue' },
  ]
  for (const { id, mode } of modeButtons) {
    $(id)?.addEventListener('click', () => {
      if (view.barMode === mode) return
      view.barMode = mode
      setActive(modeButtons.map((b) => b.id), id)
      renderCards()
    })
  }

  const policyButtons: { id: string; policy: OptimizePolicy }[] = [
    { id: 'cmp-policy-original', policy: 'original' },
    { id: 'cmp-policy-revenue', policy: 'revenue' },
    { id: 'cmp-policy-profit', policy: 'profit' },
  ]
  for (const { id, policy } of policyButtons) {
    $(id)?.addEventListener('click', () => {
      if (view.policy === policy) return
      view.policy = policy
      setActive(policyButtons.map((b) => b.id), id)
      renderCards()
    })
  }
}
