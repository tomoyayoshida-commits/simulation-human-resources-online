// 機能14 What-if分析（docs/whatif-plan.md §4/§5 Phase2）。純粋関数のみ・DOMに触らない。

import type { AllocationCounts, AssignmentDiff, Employee, SimParams, SimulationResult, TaskId, UnitId, ValidationError } from './types.ts'
import { UNIT_IDS } from './constants.ts'
import { computeSimulationResult } from './calcEngine.ts'

/** What-if パネル(#p6)の状態（docs/whatif-plan.md §4.1）。assignment が唯一の真実で、人数配分は毎回導出する。 */
export interface WhatIfState {
  task: TaskId
  roster: Employee[]
  params: SimParams
  assignment: Record<string, UnitId>
}

export interface WhatIfEvaluation {
  result: SimulationResult
  /** params.minHeadcount を下回っている事業部（§4.5）。result.feasible は売上下限しか見ないため別途判定する。 */
  minHeadcountViolations: UnitId[]
  /** 基準の割当と所属が異なる社員数 */
  movedFromBaseline: number
}

/** assignment から各事業部の人数配分を集計する。 */
export function headcountOf(assignment: Record<string, UnitId>, roster: Employee[]): AllocationCounts {
  const counts: AllocationCounts = { A: 0, B: 0, C: 0 }
  for (const e of roster) {
    const u = assignment[e.id]
    if (u) counts[u]++
  }
  return counts
}

/**
 * 現在の assignment を評価する（§4.5）。手動モードでは最低人数割れを禁止せず警告にとどめる。
 * baselineAssignment との差分から movedFromBaseline を求める。
 */
export function evaluateAssignment(
  state: WhatIfState,
  baselineAssignment: Record<string, UnitId>,
): WhatIfEvaluation {
  const result = computeSimulationResult(state.assignment, state.roster, state.params)
  const minHeadcountViolations = UNIT_IDS.filter(
    (u) => result.headcount[u] < state.params.minHeadcount[u],
  )
  let movedFromBaseline = 0
  for (const e of state.roster) {
    if (state.assignment[e.id] !== baselineAssignment[e.id]) movedFromBaseline++
  }
  return { result, minHeadcountViolations, movedFromBaseline }
}

/** Σ weights の許容誤差。入力欄の刻み(0.01)由来の丸め誤差を弾かないための猶予。 */
const WEIGHT_SUM_TOLERANCE = 0.001

/**
 * SimParams の入力検証（docs/whatif-plan.md §4.6）。ここで返すのは「再最適化」ボタンを
 * disabled にするべき違反のみ。Σ minHeadcount ≤ roster数は§4.6の通り弾かず警告のみと
 * する方針のため、ここには含めない（呼び出し側が params と roster.length から別途警告表示する）。
 * Σ weights ≈ 1.0 は2026-09-02の合意によりブロック対象に変更（重みが1にならない配分は
 * 貢献度の意味が崩れるため）。
 */
export function validateParams(params: SimParams): ValidationError[] {
  const errors: ValidationError[] = []
  const WEIGHT_FIELDS: { key: keyof SimParams['weights']['A']; label: string }[] = [
    { key: 'sales', label: '営業' },
    { key: 'mgmt', label: '管理' },
    { key: 'dev', label: '開拓' },
    { key: 'training', label: '育成' },
  ]
  for (const u of UNIT_IDS) {
    const oh = params.optimalHeadcount[u]
    if (!Number.isInteger(oh) || oh < 1) {
      errors.push({ row: 0, column: `適正人数(${u})`, actual: oh, expected: '1以上の整数' })
    }
    const mh = params.minHeadcount[u]
    if (!Number.isInteger(mh) || mh < 0) {
      errors.push({ row: 0, column: `最低人数(${u})`, actual: mh, expected: '0以上の整数' })
    }
    const br = params.baseRevenue[u]
    if (!(br >= 0)) {
      errors.push({ row: 0, column: `基準売上(${u})`, actual: br, expected: '0以上' })
    }
    const g = params.growth[u]
    if (!(g >= 0)) {
      errors.push({ row: 0, column: `成長係数(${u})`, actual: g, expected: '0以上' })
    }
    for (const { key, label } of WEIGHT_FIELDS) {
      const v = params.weights[u][key]
      if (!(v >= 0)) {
        errors.push({ row: 0, column: `重み(${u}・${label})`, actual: v, expected: '0以上' })
      }
    }
    const weightSum = WEIGHT_FIELDS.reduce((sum, { key }) => sum + params.weights[u][key], 0)
    if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
      errors.push({ row: 0, column: `重み合計(${u})`, actual: Math.round(weightSum * 100) / 100, expected: '1.00' })
    }
  }
  if (!(params.prevYearRevenue >= 0)) {
    errors.push({ row: 0, column: '全社売上下限', actual: params.prevYearRevenue, expected: '0以上' })
  }
  if (!(params.costMultiplier >= 0)) {
    errors.push({ row: 0, column: 'コスト係数', actual: params.costMultiplier, expected: '0以上' })
  }
  return errors
}

/** 基準の割当から現在の割当への異動を (from, to, count) に集計する。 */
export function diffAssignment(
  baseline: Record<string, UnitId>,
  current: Record<string, UnitId>,
): AssignmentDiff[] {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const id of Object.keys(baseline)) {
    const from = baseline[id]
    const to = current[id]
    if (to === undefined || to === from) continue
    const key = `${from}->${to}`
    if (!counts.has(key)) order.push(key)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return order.map((key) => {
    const [from, to] = key.split('->') as [UnitId, UnitId]
    return { from, to, count: counts.get(key)! }
  })
}
