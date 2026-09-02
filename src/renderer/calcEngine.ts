// 設計書§4: 計算エンジン（貢献度〜利益）

import type { Employee, EmployeeType, SimParams, SimulationResult, TaskId, UnitId, UnitResult } from './types.ts'
import type { TaskMetric } from './constants.ts'
import {
  COST_UNIT_DIVISOR,
  DEFAULT_PARAMS,
  resolveMetric,
  round2,
  TASK_SPEC,
  UNIT_IDS,
} from './constants.ts'

/** 社員貢献度（§4）。算出直後に round2。 */
export function contribution(e: Employee, unit: UnitId, params: SimParams = DEFAULT_PARAMS): number {
  const w = params.weights[unit]
  return round2(e.sales * w.sales + e.mgmt * w.mgmt + e.dev * w.dev + e.training * w.training)
}

/** 事業部能力値（§4）＝配置社員の貢献度合計。算出直後に round2。 */
export function unitAbility(unit: UnitId, members: Employee[], params: SimParams = DEFAULT_PARAMS): number {
  let sum = 0
  for (const e of members) sum += contribution(e, unit, params)
  return round2(sum)
}

/** 充足率（§4）＝ count / 適正人数。丸めない生値（次段の係数表判定に使う）。 */
export function fulfillmentRate(unit: UnitId, count: number, params: SimParams = DEFAULT_PARAMS): number {
  return count / params.optimalHeadcount[unit]
}

/**
 * 人員不足補正（§4）。
 * rate >= 1.0 は 1.00（過剰側の判定に委ねる）。
 * rate < 1.0 は SHORTAGE_TABLE を上から見て rate >= minRate を満たす最初の行の factor。
 * 境界（例 90%ちょうど）は上側の帯に属する。
 */
export function shortageFactor(unit: UnitId, rate: number, params: SimParams = DEFAULT_PARAMS): number {
  if (rate >= 1.0) return 1.0
  for (const row of params.shortageTable[unit]) {
    if (rate >= row.minRate) return row.factor
  }
  // 理論上到達しない（最終行 minRate:0）。安全側に最小係数を返す。
  return params.shortageTable[unit][params.shortageTable[unit].length - 1].factor
}

/**
 * 人員過剰補正（§4）。
 * rate < 1.20 は 1.00。
 * rate >= 1.20 は SURPLUS_TABLE を上から見て rate <= maxRate を満たす最初の行の factor。
 * 境界（例 120%ちょうど）は下限を含み上限を含めない → rate=1.20 は 0.95 の帯。
 */
export function surplusFactor(rate: number, params: SimParams = DEFAULT_PARAMS): number {
  if (rate < 1.2) return 1.0
  for (const row of params.surplusTable) {
    if (rate <= row.maxRate) return row.factor
  }
  return params.surplusTable[params.surplusTable.length - 1].factor
}

/** 基本売上（§4）。算出直後に round2。 */
export function baseRevenue(unit: UnitId, ability: number, params: SimParams = DEFAULT_PARAMS): number {
  return round2(params.baseRevenue[unit] * (1 + (ability / 100) * params.growth[unit]))
}

/** 最終売上（§4）＝基本売上 × 不足補正 × 過剰補正。算出直後に round2。 */
export function finalRevenue(base: number, sFactor: number, xFactor: number): number {
  return round2(base * sFactor * xFactor)
}

/** 事業部コスト計（§4）＝Σ 人件費 × 3 を億円換算（÷COST_UNIT_DIVISOR）。算出直後に round2。 */
export function unitCostTotal(members: Employee[], params: SimParams = DEFAULT_PARAMS): number {
  let sum = 0
  for (const e of members) sum += e.cost * params.costMultiplier
  return round2(sum / COST_UNIT_DIVISOR)
}

/** 事業部結果を構築（§4）。 */
export function computeUnitResult(unit: UnitId, members: Employee[], params: SimParams = DEFAULT_PARAMS): UnitResult {
  const count = members.length
  const ability = unitAbility(unit, members, params)
  const rate = fulfillmentRate(unit, count, params)
  const sFactor = shortageFactor(unit, rate, params)
  const xFactor = surplusFactor(rate, params)
  const base = baseRevenue(unit, ability, params)
  const final = finalRevenue(base, sFactor, xFactor)
  const costTotal = unitCostTotal(members, params)
  const profit = round2(final - costTotal)
  return {
    unit,
    count,
    ability,
    fulfillmentRate: rate,
    shortageFactor: sFactor,
    surplusFactor: xFactor,
    baseRevenue: base,
    finalRevenue: final,
    costTotal,
    profit,
  }
}

/** 割当から各事業部のメンバー配列を復元 */
export function membersByUnit(
  assignment: Record<string, UnitId>,
  employees: Employee[],
): Record<UnitId, Employee[]> {
  const result: Record<UnitId, Employee[]> = { A: [], B: [], C: [] }
  // 入力順を保つため employees を走査（§7-6の決定性）
  for (const e of employees) {
    const unit = assignment[e.id]
    if (unit) result[unit].push(e)
  }
  return result
}

/** シミュレーション結果を構築（§4）。 */
export function computeSimulationResult(
  assignment: Record<string, UnitId>,
  employees: Employee[],
  params: SimParams = DEFAULT_PARAMS,
): SimulationResult {
  const grouped = membersByUnit(assignment, employees)
  const units: Record<UnitId, UnitResult> = {
    A: computeUnitResult('A', grouped.A, params),
    B: computeUnitResult('B', grouped.B, params),
    C: computeUnitResult('C', grouped.C, params),
  }
  let revenue = 0
  let profit = 0
  for (const u of UNIT_IDS) {
    revenue += units[u].finalRevenue
    profit += units[u].profit
  }
  const companyRevenue = round2(revenue)
  const companyProfit = round2(profit)
  return {
    headcount: { A: units.A.count, B: units.B.count, C: units.C.count },
    units,
    companyRevenue,
    companyProfit,
    assignment,
    feasible: companyRevenue > params.prevYearRevenue,
  }
}

/**
 * 課題の最大化対象の値を結果から取り出す（§5.1）。
 * 最適化側の選択キー（optimizer）と表示側（compareTasks）が同じ定義を使うための単一の入口。
 * 対象範囲（全社／対象事業部）は課題で固定。指標は既定が `TASK_SPEC`、
 * `metric` を渡すと上書きできる（#p4の「最適化方針」で4課題の指標を揃えるため）。
 */
export function taskPrimaryValue(result: SimulationResult, task: TaskId, metric?: TaskMetric): number {
  const { targetUnit } = TASK_SPEC[task]
  const m = resolveMetric(task, metric)
  if (targetUnit === null) return m === 'profit' ? result.companyProfit : result.companyRevenue
  const unit = result.units[targetUnit]
  return m === 'profit' ? unit.profit : unit.finalRevenue
}

/**
 * 社員タイプ分類（§4.1・機能6）。
 * 4能力値のうち最大に対応する型。同点は 営業→管理→開拓→育成 の優先順。
 */
export function classifyType(e: Employee): EmployeeType {
  const candidates: { type: EmployeeType; value: number }[] = [
    { type: '営業型', value: e.sales },
    { type: '管理型', value: e.mgmt },
    { type: '開拓型', value: e.dev },
    { type: '育成型', value: e.training },
  ]
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    // 同点は先勝ち（配列順＝優先順）なので strictly greater のときのみ更新
    if (candidates[i].value > best.value) best = candidates[i]
  }
  return best.type
}

/** 各事業部の型別内訳（機能6の表示用） */
export function typeBreakdown(members: Employee[]): Record<EmployeeType, number> {
  const counts: Record<EmployeeType, number> = { 営業型: 0, 管理型: 0, 開拓型: 0, 育成型: 0 }
  for (const e of members) counts[classifyType(e)]++
  return counts
}
