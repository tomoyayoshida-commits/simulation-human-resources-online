// 機能14 What-if分析(#p6)の状態管理とイベント配線（docs/whatif-plan.md §4）。
//
// 表示は whatifPanel.ts、計算は whatif.ts / optimizer.ts が持つ。本モジュールは
// 「What-ifの状態を保持し、操作を受けて再計算し、描画関数を呼ぶ」役だけを担う。
// ①データ取込の結果（母集団・採用候補・選択課題）は renderer.ts が持っているため、
// 参照だけを getContext 経由で受け取る（状態の所有権は renderer.ts に残す）。

import type { AllocationCounts, Employee, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import { DEFAULT_PARAMS, UNIT_IDS } from './constants.ts'
import { mergeEmployees, buildAssignmentCsv, downloadCsv } from './csv.ts'
import { runOptimization, solveForHeadcount } from './optimizer.ts'
import { computeSimulationResult } from './calcEngine.ts'
import { generateReasonText } from './reasonText.ts'
import { diffAssignment, evaluateAssignment, headcountOf, validateParams, type WhatIfState } from './whatif.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'
import {
  renderBaselineNote,
  renderDiffSummary,
  renderGauges,
  renderHeadcountCard,
  renderParamsCard,
  renderParamsErrors,
  renderReasonBox,
  renderRosterCard,
  renderRosterTable,
  renderSummary,
  renderTaskCards,
  renderUnitTable,
  updateHeadcountValues,
} from './whatifPanel.ts'

/** #p6 が参照する、①データ取込側の状態。renderer.ts の state をそのまま渡せる形にしてある。 */
export interface WhatIfContext {
  employees100: Employee[] | null
  hiringAdd10: Employee[] | null
  selectedTask: TaskId
}

/** #p6 の内部状態。assignment が唯一の真実（docs/whatif-plan.md §4.1）。 */
type ControllerState = WhatIfState & {
  baselineAssignment: Record<string, UnitId>
  selectedCandidateIds: Set<string>
}

let whatIf: ControllerState | null = null
let getContext: () => WhatIfContext = () => ({
  employees100: null,
  hiringAdd10: null,
  selectedTask: 1,
})

// 課題ごとに遅延計算してキャッシュする基準ケース（標準パラメータ・100名・docs/whatif-plan.md §4.2）
const baselineCache: Partial<Record<TaskId, SimulationResult>> = {}

function whatIfBaseline(task: TaskId): SimulationResult | null {
  const { employees100 } = getContext()
  if (!employees100) return null
  const cached = baselineCache[task]
  if (cached) return cached
  const r = runOptimization(employees100, task)
  if ('infeasible' in r) return null
  baselineCache[task] = r
  return r
}

function cloneParams(p: SimParams): SimParams {
  return {
    weights: { A: { ...p.weights.A }, B: { ...p.weights.B }, C: { ...p.weights.C } },
    baseRevenue: { ...p.baseRevenue },
    growth: { ...p.growth },
    optimalHeadcount: { ...p.optimalHeadcount },
    minHeadcount: { ...p.minHeadcount },
    shortageTable: {
      A: p.shortageTable.A.map((r) => ({ ...r })),
      B: p.shortageTable.B.map((r) => ({ ...r })),
      C: p.shortageTable.C.map((r) => ({ ...r })),
    },
    surplusTable: p.surplusTable.map((r) => ({ ...r })),
    prevYearRevenue: p.prevYearRevenue,
    costMultiplier: p.costMultiplier,
  }
}

function paramsEqualDefault(p: SimParams): boolean {
  return JSON.stringify(p) === JSON.stringify(DEFAULT_PARAMS)
}

/** What-ifパネルの状態を初期化する（①データ取込の再取込時にも呼ぶ・基準を作り直す）。 */
export function resetWhatIf(): void {
  for (const k of Object.keys(baselineCache)) delete baselineCache[Number(k) as TaskId]
  const { employees100, selectedTask } = getContext()
  if (!employees100) {
    whatIf = null
    return
  }
  const baseline = whatIfBaseline(selectedTask)
  whatIf = {
    task: selectedTask,
    roster: [...employees100],
    params: cloneParams(DEFAULT_PARAMS),
    assignment: baseline ? { ...baseline.assignment } : {},
    baselineAssignment: baseline ? { ...baseline.assignment } : {},
    selectedCandidateIds: new Set(),
  }
}

/**
 * #p6 へ遷移したときの初期化。
 * 既に状態があるときは作り直さない——利用者が加えた異動・前提の変更を、
 * 他の画面を見て戻ってきただけで捨てないため。作り直すのは①の再取込時（resetWhatIf）だけ。
 */
export function ensureWhatIf(): void {
  if (whatIf === null) resetWhatIf()
}

/**
 * 現在の割当に依存する表示だけを更新する（サマリー・事業部別テーブル・理由・ゲージ・差分・社員一覧）。
 * 人数配分スライダーのドラッグ中は headcount-card を作り直せない（range要素が破棄され
 * ドラッグが中断する）ため、全体再描画とスライダー操作の両方からここだけを呼ぶ。
 */
function renderResults(wi: ControllerState): void {
  const baseline = whatIfBaseline(wi.task)
  const evaluation = evaluateAssignment(wi, wi.baselineAssignment)
  if (baseline) {
    renderSummary({
      result: evaluation.result,
      baseline,
      minHeadcountViolations: evaluation.minHeadcountViolations,
      prevYearRevenue: wi.params.prevYearRevenue,
    })
    renderUnitTable(evaluation.result, baseline)
    renderReasonBox(generateReasonText(evaluation.result, wi.task, wi.params), !paramsEqualDefault(wi.params))
  } else {
    renderSummary(null)
  }
  renderGauges(evaluation.result, wi.params)
  renderDiffSummary(diffAssignment(wi.baselineAssignment, wi.assignment))
  renderRosterTable({ roster: wi.roster, baselineAssignment: wi.baselineAssignment, assignment: wi.assignment })
}

/** #p6 全体を再描画する。 */
export function renderWhatIfAll(): void {
  const wi = whatIf
  const { employees100, hiringAdd10 } = getContext()
  if (!wi || !employees100) return

  renderTaskCards(wi.task)
  renderBaselineNote(whatIfBaseline(wi.task))
  renderResults(wi)

  renderRosterCard({
    hiringAdd10,
    selectedIds: wi.selectedCandidateIds,
    baseCount: employees100.length,
  })
  renderParamsCard({ params: wi.params, standard: DEFAULT_PARAMS })
  renderParamsErrors(validateParams(wi.params))

  renderHeadcountCard({ counts: headcountOf(wi.assignment, wi.roster), rosterSize: wi.roster.length })
}

/**
 * 人数配分スライダーの入力を、合計が常に母集団数になるよう3事業部へ配分し直す。
 * 動かした事業部を newValue に固定し、残りは操作前の比率で按分する（端数は最後の1つへ寄せる）。
 */
function redistribute(unit: UnitId, newValue: number, before: AllocationCounts, rosterSize: number): AllocationCounts {
  const others = UNIT_IDS.filter((u) => u !== unit)
  const otherSum = others.reduce((s, u) => s + before[u], 0) || 1
  const remaining = rosterSize - newValue
  const counts: AllocationCounts = { A: 0, B: 0, C: 0 }
  counts[unit] = newValue
  let assigned = 0
  others.forEach((u, idx) => {
    const v =
      idx === others.length - 1
        ? Math.max(0, remaining - assigned)
        : Math.max(0, Math.round((remaining * before[u]) / otherSum))
    counts[u] = v
    assigned += v
  })
  return counts
}

/** #p6 のイベント配線。main() から1回だけ呼ぶ。 */
export function initWhatIfPanel(context: () => WhatIfContext): void {
  getContext = context

  // 基準ケース：課題の切替
  $('whatif-task-cards')?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-whatif-task]')
    const wi = whatIf
    if (!target || !wi) return
    wi.task = Number(target.dataset.whatifTask) as TaskId
    void withLoading('課題を切り替えて再計算しています…', () => runOptimization(wi.roster, wi.task, wi.params)).then(
      (opt) => {
        if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
        const baseline = whatIfBaseline(wi.task)
        wi.baselineAssignment = baseline ? { ...baseline.assignment } : {}
        renderWhatIfAll()
      },
    )
  })

  // 軸1：人数配分スライダー（同期・range要素は再生成しない §4.7）
  const headcountCard = $('whatif-headcount-card')
  headcountCard?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    const unit = target.dataset.whatifHeadcount as UnitId | undefined
    const wi = whatIf
    if (!unit || !wi) return
    const rosterSize = wi.roster.length
    const newValue = Math.max(0, Math.min(rosterSize, Number(target.value)))
    const counts = redistribute(unit, newValue, headcountOf(wi.assignment, wi.roster), rosterSize)
    wi.assignment = solveForHeadcount(wi.roster, wi.task, counts, wi.params)
    // headcount-card自体は軽量更新にとどめ、他の表示は renderResults で作り直す
    updateHeadcountValues(counts, rosterSize)
    renderResults(wi)
  })
  headcountCard?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id !== 'whatif-auto-optimize') return
    const wi = whatIf
    if (!wi) return
    void withLoading('再最適化しています…', () => runOptimization(wi.roster, wi.task, wi.params)).then((opt) => {
      if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
      renderWhatIfAll()
    })
  })

  // 軸2：個別異動セレクタ（同期）
  $('whatif-roster-table-card')?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement
    const id = target.dataset.whatifMove
    const wi = whatIf
    if (!id || !wi) return
    wi.assignment[id] = target.value as UnitId
    renderWhatIfAll()
  })
  $('whatif-reset-assignment')?.addEventListener('click', () => {
    const wi = whatIf
    if (!wi) return
    for (const e of wi.roster) {
      const base = wi.baselineAssignment[e.id]
      if (base) wi.assignment[e.id] = base
    }
    renderWhatIfAll()
  })

  // 軸3：前提パラメータ（changeで確定・再最適化は明示ボタンのみ §4.4/§4.7）
  $('whatif-params-card')?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    const wi = whatIf
    if (!wi) return
    const unit = target.dataset.whatifUnit as UnitId | undefined
    const field = target.dataset.whatifParam as
      | 'baseRevenue'
      | 'growth'
      | 'optimalHeadcount'
      | 'minHeadcount'
      | undefined
    const weightKey = target.dataset.whatifWeight as 'sales' | 'mgmt' | 'dev' | 'training' | undefined
    const scalar = target.dataset.whatifScalar as 'prevYearRevenue' | 'costMultiplier' | undefined
    const value = Number(target.value)
    if (field && unit) wi.params[field][unit] = value
    else if (weightKey && unit) wi.params.weights[unit][weightKey] = value
    else if (scalar) wi.params[scalar] = value
    else return
    renderParamsCard({ params: wi.params, standard: DEFAULT_PARAMS })
    renderParamsErrors(validateParams(wi.params))
  })
  $('whatif-params-reset')?.addEventListener('click', () => {
    const wi = whatIf
    if (!wi) return
    wi.params = cloneParams(DEFAULT_PARAMS)
    wi.assignment = { ...wi.baselineAssignment }
    renderWhatIfAll()
  })
  $('whatif-params-reoptimize')?.addEventListener('click', () => {
    const wi = whatIf
    if (!wi) return
    if (validateParams(wi.params).length > 0) return
    void withLoading('再最適化しています…', () => runOptimization(wi.roster, wi.task, wi.params)).then((opt) => {
      if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
      renderWhatIfAll()
    })
  })

  // 軸4：採用シナリオ（母集団を変えて再最適化・明示ボタンのみ）
  const rosterCard = $('whatif-roster-card')
  rosterCard?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    const id = target.dataset.whatifCandidate
    const wi = whatIf
    if (!id || !wi) return
    if (target.checked) wi.selectedCandidateIds.add(id)
    else wi.selectedCandidateIds.delete(id)
    renderCandidates(wi)
  })
  rosterCard?.addEventListener('click', (e) => {
    const wi = whatIf
    const { employees100, hiringAdd10 } = getContext()
    if (!wi || !hiringAdd10) return
    const targetId = (e.target as HTMLElement).id
    if (targetId === 'whatif-hire-all') {
      wi.selectedCandidateIds = new Set(hiringAdd10.map((c) => c.id))
      renderCandidates(wi)
    } else if (targetId === 'whatif-hire-none') {
      wi.selectedCandidateIds = new Set()
      renderCandidates(wi)
    } else if (targetId === 'whatif-reoptimize-roster') {
      if (!employees100) return
      const selected = hiringAdd10.filter((c) => wi.selectedCandidateIds.has(c.id))
      const merged = mergeEmployees(employees100, selected)
      if (!merged.employees) {
        alert('採用候補のIDが既存社員と重複しています。')
        return
      }
      const roster = merged.employees
      wi.roster = roster
      void withLoading('採用シナリオで再最適化しています…', () => runOptimization(wi.roster, wi.task, wi.params)).then(
        (opt) => {
          if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
          renderWhatIfAll()
        },
      )
    }
  })

  // 仕上げ：What-if配置のCSV出力（機能14・§5 Phase6）
  $('whatif-export-csv')?.addEventListener('click', () => {
    const wi = whatIf
    if (!wi) {
      alert('先にWhat-if分析でデータを準備してください。')
      return
    }
    const result = computeSimulationResult(wi.assignment, wi.roster, wi.params)
    downloadCsv('whatif_assignment.csv', buildAssignmentCsv(wi.roster, result, wi.params))
  })
}

/** 採用候補カードだけを描き直す（チェック状態と合計人数の更新）。 */
function renderCandidates(wi: ControllerState): void {
  const { employees100, hiringAdd10 } = getContext()
  renderRosterCard({
    hiringAdd10,
    selectedIds: wi.selectedCandidateIds,
    baseCount: employees100?.length ?? 0,
  })
}
