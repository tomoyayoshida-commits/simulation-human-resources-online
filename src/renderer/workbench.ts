// 機能15 作業机（docs/workbench-plan.md §4/§5 Phase1）。純粋関数のみ・DOMに触らない。
//
// whatif.ts の4関数（headcountOf/evaluateAssignment/diffAssignment/WhatIfState）は変更しない。
// WorkbenchState は task/roster/params/assignment を持つため WhatIfState を構造的部分型として満たし、
// 呼び出し側は `evaluateAssignment(workbenchState, baselineAssignment)` をそのまま呼べる（§4.2）。

import type { Employee, EmployeeType, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import type { WhatIfEvaluation } from './whatif.ts'
import { UNIT_IDS } from './constants.ts'
import { classifyType, computeSimulationResult, contribution } from './calcEngine.ts'

/** 作業机の状態（docs/workbench-plan.md §4.2）。assignment が唯一の可変状態。 */
export interface WorkbenchState {
  task: TaskId
  metric: TaskMetric
  roster: Employee[]
  params: SimParams
  assignment: Record<string, UnitId>
  /** 遷移元カードの最適解（不変。作業机の操作では上書きしない） */
  baseline: SimulationResult
  /** 元に戻す用の履歴（直前の assignment を積む・上限 MAX_HISTORY） */
  history: Record<string, UnitId>[]
}

/** 履歴の保持上限（§4.7）。 */
export const MAX_HISTORY = 50

/**
 * assignment 上で1名を動かした新しい assignment を返す（元は破壊しない）。
 * roster に存在しない社員IDのときは元の assignment をそのまま返す（状態は変わらない）。
 */
export function moveEmployee(
  assignment: Record<string, UnitId>,
  employeeId: string,
  unit: UnitId,
  roster: Employee[],
): Record<string, UnitId> {
  if (!roster.some((e) => e.id === employeeId)) return assignment
  return { ...assignment, [employeeId]: unit }
}

/**
 * 1名を動かした場合の再評価結果だけを返す（drop確定前のプレビュー用・§4.4）。
 * 実際に確定させたい場合は withMove を使う。
 */
export function previewMove(state: WorkbenchState, employeeId: string, unit: UnitId): SimulationResult {
  const assignment = moveEmployee(state.assignment, employeeId, unit, state.roster)
  return computeSimulationResult(assignment, state.roster, state.params)
}

/**
 * 1名を動かして確定させる（履歴に積む）。unit が現在の所属と同じなら何もしない
 * （無意味な履歴エントリでUndoを汚さないため）。存在しない社員IDでも状態は変わらない。
 */
export function withMove(state: WorkbenchState, employeeId: string, unit: UnitId): WorkbenchState {
  if (!state.roster.some((e) => e.id === employeeId)) return state
  if (state.assignment[employeeId] === unit) return state
  const nextAssignment = { ...state.assignment, [employeeId]: unit }
  const nextHistory = [...state.history, state.assignment]
  if (nextHistory.length > MAX_HISTORY) nextHistory.shift()
  return { ...state, assignment: nextAssignment, history: nextHistory }
}

/** 1手戻す（§4.7「元に戻す」）。履歴が空なら何もしない。 */
export function undo(state: WorkbenchState): WorkbenchState {
  if (state.history.length === 0) return state
  const prevAssignment = state.history[state.history.length - 1]
  return { ...state, assignment: prevAssignment, history: state.history.slice(0, -1) }
}

/** 最適解（baseline）に戻す（§4.7「最適解に戻す」）。履歴も空にする。 */
export function resetToBaseline(state: WorkbenchState): WorkbenchState {
  return { ...state, assignment: { ...state.baseline.assignment }, history: [] }
}

/**
 * assignment を丸ごと差し替えて履歴に積む（§4.7「この人数配分のまま最適に組み直す」用）。
 * withMove と異なり1名分の差分ではなく solveForHeadcount の結果をそのまま受け取る。
 */
export function withAssignment(state: WorkbenchState, nextAssignment: Record<string, UnitId>): WorkbenchState {
  const nextHistory = [...state.history, state.assignment]
  if (nextHistory.length > MAX_HISTORY) nextHistory.shift()
  return { ...state, assignment: nextAssignment, history: nextHistory }
}

/** 制約違反（全社売上下限・最低人数のいずれか）があるか（§4.6・§8-1/§8-2の判定の共通入口）。 */
export function hasViolation(evaluation: WhatIfEvaluation): boolean {
  return !evaluation.result.feasible || evaluation.minHeadcountViolations.length > 0
}

/** カード1枚ぶんの表示用データ（純粋データ・DOM非依存）。 */
export interface WorkbenchCard {
  employee: Employee
  /** 現在の所属事業部（assignment 由来） */
  unit: UnitId
  type: EmployeeType
  /** (社員, 事業部, params) だけで決まる貢献度。所属に依存しないため事業部ごとに1回だけ求めて焼き込む（§4.3）。 */
  contributions: Record<UnitId, number>
}

/**
 * 現在の assignment を元に全社員ぶんのカード表示用データを組み立てる（§4.3）。
 * 100名×3事業部 = 300回の contribution 呼び出しをここで一度に行う（O(1)×300・再計算不要）。
 */
export function buildWorkbenchCards(state: WorkbenchState): WorkbenchCard[] {
  return state.roster.map((e) => {
    const contributions = {} as Record<UnitId, number>
    for (const u of UNIT_IDS) contributions[u] = contribution(e, u, state.params)
    return { employee: e, unit: state.assignment[e.id], type: classifyType(e), contributions }
  })
}

export type WorkbenchSortKey = 'id' | 'type' | 'cost' | 'contribution'

/** 型バッジの並び順（機能6と同じ・§4.1の同点優先順）。 */
const TYPE_ORDER: EmployeeType[] = ['営業型', '管理型', '開拓型', '育成型']

function byId(a: WorkbenchCard, b: WorkbenchCard): number {
  return a.employee.id < b.employee.id ? -1 : a.employee.id > b.employee.id ? 1 : 0
}

/**
 * カードの並び替え（純粋関数・元配列は変更しない）。既定は 'id'＝社員番号順（§8-3）。
 * 'contribution' は「現在の所属事業部での貢献度」の降順（§8-3の対案として選択肢に残す）。
 */
export function sortCards(cards: WorkbenchCard[], key: WorkbenchSortKey): WorkbenchCard[] {
  const sorted = [...cards]
  switch (key) {
    case 'id':
      sorted.sort(byId)
      break
    case 'type':
      sorted.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || byId(a, b))
      break
    case 'cost':
      sorted.sort((a, b) => b.employee.cost - a.employee.cost || byId(a, b))
      break
    case 'contribution':
      sorted.sort((a, b) => b.contributions[b.unit] - a.contributions[a.unit] || byId(a, b))
      break
  }
  return sorted
}

/** v1でCSV出力の代わりに使う保存フォーマット（§8-4）。永続化（Firestore等）自体は実装しない。 */
export interface WorkbenchExport {
  task: TaskId
  metric: TaskMetric
  assignment: Record<string, UnitId>
  updatedAt: string
}

/**
 * 現在の作業机状態をプレーンオブジェクトとして取り出す（§8-4）。
 * 後続フェーズで保存ボタンを足すとき、これを呼ぶだけで済むようにするための拡張点。
 */
export function serializeWorkbenchState(state: WorkbenchState): WorkbenchExport {
  return {
    task: state.task,
    metric: state.metric,
    assignment: { ...state.assignment },
    updatedAt: new Date().toISOString(),
  }
}
