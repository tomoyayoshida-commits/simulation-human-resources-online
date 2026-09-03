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
import { barRow, oku, oku1, signed } from './format.ts'
import { $, setHtml } from './dom.ts'
import { taskPrimaryValue, totalHeadcount } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'
import { generateReasonText } from './reasonText.ts'

const BADGE_COLOR: Record<TaskId, string> = { 1: 'var(--company)', 2: 'var(--a)', 3: 'var(--b)', 4: 'var(--c)' }

/**
 * 見出し・事業部別バーに**表示する**指標。最適化に使った指標（TaskMetrics）とは独立で、
 * 「利益重視で選んだ配置を売上で評価する」といった読み方ができるように分けてある。
 */
export type BarMode = TaskMetric
const BAR_LABEL: Record<BarMode, string> = { revenue: '事業部別売上', profit: '事業部別利益' }
const METRIC_LABEL: Record<BarMode, string> = { revenue: '売上', profit: '利益' }

/**
 * **最適化に使う**指標を課題ごとに保持する。
 *
 * 課題原文は指標が混在している（課題1=売上／課題2=利益／課題3・4=売上）ため、
 * 4枚のカードを横に並べても「どの事業部を優遇するか」の対照になっていない
 * （対象事業部と指標の2軸が同時に動く）。以前は全課題を一括で揃える3値の方針
 * （原文どおり／すべて売上／すべて利益）だったが、「課題2だけ売上に揃える」のような
 * 部分的な対照が作れなかったので、カード内のボタンで1課題ずつ選べるようにしてある。
 * 既定は課題原文どおり（＝提出物の正）。
 */
export type TaskMetrics = Record<TaskId, TaskMetric>

/** 既定の指標＝課題原文どおり（課題1=売上／課題2=利益／課題3・4=売上）。 */
export function defaultMetrics(): TaskMetrics {
  return { 1: TASK_SPEC[1].metric, 2: TASK_SPEC[2].metric, 3: TASK_SPEC[3].metric, 4: TASK_SPEC[4].metric }
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

/** 全8通りの表から、課題ごとに選ばれている指標の4枚を取り出す。 */
export function selectResults(all: AllTaskResults, metrics: TaskMetrics): TaskResults {
  return {
    1: all[1][metrics[1]],
    2: all[2][metrics[2]],
    3: all[3][metrics[3]],
    4: all[4][metrics[4]],
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
const view: { barMode: BarMode; metrics: TaskMetrics; all: AllTaskResults | null; params: SimParams } = {
  barMode: 'profit',
  metrics: defaultMetrics(),
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
  metrics: TaskMetrics
  scale: number
  params: SimParams
  /** 「全社売上最大化比」の基準。いま選ばれている指標で解いた課題1の結果 */
  baseline: SimulationResult | null
}

/**
 * カード見出しと、その課題だけの最適化指標ボタン（見出しと見出し数字の間に置く）。
 * ボタンはグリッド再描画のたびに作り直されるため、クリックは #compare-tasks-grid 側の
 * 委譲リスナで拾う（`initCompareModeToggle`）。実行不能カードにも出すのは、
 * 片方の指標で解が無いとき、もう片方へ切り替える手段がカード上に要るため。
 */
function cardHead(task: TaskId, metric: TaskMetric): string {
  const button = (m: TaskMetric): string =>
    `<button type="button" class="card-metric-btn${m === metric ? ' active' : ''}" data-cmp-task="${task}" data-cmp-metric="${m}" aria-pressed="${m === metric}">${METRIC_LABEL[m]}</button>`
  return (
    `<div class="compare-head"><span class="compare-badge" style="background:${BADGE_COLOR[task]};"></span><h4>${taskLabel(task, metric)}</h4></div>` +
    `<div class="card-metric"><span class="card-metric-label">最適化：</span>${button('revenue')}${button('profit')}</div>`
  )
}

function infeasibleCard(task: TaskId, ctx: CardContext): string {
  return `
    <div class="compare-card" style="border-color:var(--critical);">
      ${cardHead(task, ctx.metrics[task])}
      <div class="compare-primary"><div class="k">${primaryLabel(task, ctx.mode)}</div><div class="v" style="color:var(--critical);">—</div><div class="d">制約を満たす配置なし</div></div>
      <div class="compare-status"><span class="pill crit">● 実行不能</span></div>
      <div class="bars-label">概要</div>
      <p class="compare-summary">この目的では全社売上${ctx.params.prevYearRevenue}億円超を満たす配置が存在しない。</p>
    </div>`
}

/**
 * 見出し数字の下に出す差分1行。
 * 基準は課題1（＝baseline）だが、課題1自身は比較先がないので前年度実績と比べる。
 * 前年度実績として持っているのは売上だけなので、課題1の利益表示では差分を出さない。
 */
function primaryDeltaHtml(task: TaskId, r: SimulationResult, primary: number, ctx: CardContext): string {
  const { mode, params, baseline } = ctx
  if (task === 1) {
    if (mode !== 'revenue') return ''
    const d = round2(r.companyRevenue - params.prevYearRevenue)
    return `<div class="d ${d >= 0 ? 'good' : ''}">前年度比 ${signed(d)}億円</div>`
  }
  if (!baseline) return ''
  const d = round2(primary - taskPrimaryValue(baseline, task, mode))
  return `<div class="d">${taskLabel(1, ctx.metrics[1])}比 ${signed(d)}億円</div>`
}

function card(task: TaskId, r: SimulationResult, ctx: CardContext): string {
  const { mode, scale, params, baseline } = ctx
  const metric = ctx.metrics[task]
  const total = totalHeadcount(r)
  const primary = taskPrimaryValue(r, task, mode)
  const deltaHtml = primaryDeltaHtml(task, r, primary, ctx)

  const hcBars = UNIT_IDS.map((u) =>
    barRow(u, total > 0 ? (r.headcount[u] / total) * 100 : 0, UNIT_VAR[u], `${r.headcount[u]}名`),
  ).join('')

  const barField = mode === 'profit' ? 'profit' : 'finalRevenue'
  const unitBars = UNIT_IDS.map((u) => {
    const val = r.units[u][barField]
    return barRow(u, (val / scale) * 100, UNIT_VAR[u], oku1(val), true)
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

  const borderColor = task === 1 ? 'var(--company)' : tight ? 'var(--warning)' : ''
  const summary = buildSummary(task, r, baseline, metric, taskLabel(1, ctx.metrics[1]))
  const reasonHtml = `<details class="compare-reason"><summary>配置理由</summary>${generateReasonText(r, task, params, metric)}</details>`
  // 機能15 作業机（docs/workbench-plan.md §4.1）。実行不能カードには出さない（持ち込む配置が無いため）。
  const workbenchHtml = `<div class="compare-actions"><button type="button" class="btn secondary wb-open-btn" data-wb-open="${task}">この配置を作業机で調整する ▶</button></div>`

  return `
    <div class="compare-card"${borderColor ? ` style="border-color:${borderColor};"` : ''}>
      ${cardHead(task, metric)}
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
      ${workbenchHtml}
    </div>`
}

function buildSummary(
  task: TaskId,
  r: SimulationResult,
  baseline: SimulationResult | null,
  metric: TaskMetric,
  baselineLabel: string,
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
  return `最も人員が厚いのは${maxUnit}事業部（${hc[maxUnit]}名）。${taskTargetLabel(task, metric)}を最優先で最大化する一方、全社利益は${baselineLabel}比 ${signed(dProfit)}億円。`
}

/**
 * 4課題分のカードHTMLを組み立てる（純粋関数・DOM非依存）。
 * ビュー状態から切り離してあるので、最適化結果を渡すだけで単体テストできる。
 */
export function buildCompareGridHtml(
  all: AllTaskResults,
  mode: BarMode,
  metrics: TaskMetrics,
  params: SimParams = DEFAULT_PARAMS,
): string {
  const results = selectResults(all, metrics)
  const first = results[1]
  const ctx: CardContext = {
    mode,
    metrics,
    scale: mode === 'profit' ? PROFIT_SCALE : revenueScale(results),
    params,
    baseline: 'infeasible' in first ? null : first,
  }
  return TASK_IDS.map((t) => {
    const res = results[t]
    return 'infeasible' in res ? infeasibleCard(t, ctx) : card(t, res, ctx)
  }).join('')
}

/**
 * 現在キャッシュされている、指定課題のカードが表示中の結果（機能15 作業机への遷移用・§4.1）。
 * カードが実行不能、または取込前で `renderCompareTasks` 未実行なら null。
 */
export function currentCardResult(
  task: TaskId,
): { metric: TaskMetric; result: SimulationResult; params: SimParams } | null {
  if (!view.all) return null
  const metric = view.metrics[task]
  const r = view.all[task][metric]
  if ('infeasible' in r) return null
  return { metric, result: r, params: view.params }
}

/** キャッシュ済みの結果から #p4 のカードを再描画する（最適化の再実行はしない）。 */
function renderCards(): void {
  if (!view.all) return
  setHtml('compare-tasks-grid', buildCompareGridHtml(view.all, view.barMode, view.metrics, view.params))
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
 * #p4 の切替を初期化する（1回だけ呼ぶ）。
 * 表示指標のボタンは index.html に静的に配置済みなので renderCompareTasks の
 * grid.innerHTML 再描画では消えない。課題ごとの最適化指標ボタンはカード内＝再描画で
 * 作り直されるため、グリッドに委譲リスナを1つ張って拾う。どちらもキャッシュ済み結果の
 * 再描画だけで、最適化は走らない（＝読み込み画面が出ない）。
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

  $('compare-tasks-grid')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.('[data-cmp-metric]')
    if (!(btn instanceof HTMLElement)) return
    const task = Number(btn.dataset.cmpTask) as TaskId
    const metric = btn.dataset.cmpMetric as TaskMetric
    if (view.metrics[task] === metric) return
    view.metrics = { ...view.metrics, [task]: metric }
    renderCards()
  })
}

/**
 * カード下部の「この配置を作業机で調整する」ボタンを配線する（機能15・§4.1）。
 * `#compare-tasks-grid` は再描画のたびに innerHTML が作り直されるため、`initCompareModeToggle` と
 * 同じくグリッドへの委譲リスナで拾う（別リスナとして独立に張る。属性が別なので干渉しない）。
 */
export function initWorkbenchLaunch(onOpen: (task: TaskId) => void): void {
  $('compare-tasks-grid')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.('[data-wb-open]')
    if (!(btn instanceof HTMLElement)) return
    onOpen(Number(btn.dataset.wbOpen) as TaskId)
  })
}
