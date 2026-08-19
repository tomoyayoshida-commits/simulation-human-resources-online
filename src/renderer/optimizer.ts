// 設計書§5: 最適化オーケストレーション（外側ループ＋内側割当）

import type {
  AllocationCounts,
  Employee,
  InfeasibleResult,
  SimulationResult,
  TaskId,
  UnitId,
} from './types.ts'
import { BASE_REVENUE, COST_MULTIPLIER, GROWTH, MIN_HEADCOUNT, UNIT_IDS } from './constants.ts'
import { computeSimulationResult, contribution, fulfillmentRate, shortageFactor, surplusFactor } from './calcEngine.ts'
import { solveAssignment } from './assignment.ts'

/** 辞書式合成の重み（§5.1）。primary の1単位差を secondary 総和が覆さない大きさ。 */
const LEX_WEIGHT = 1e6

/**
 * 外側ループ：人数配分の全列挙（§5.2）。
 * nX >= MIN_HEADCOUNT.X かつ nA+nB+nC === totalCount を満たす全配分。
 */
export function enumerateHeadcounts(totalCount: number): AllocationCounts[] {
  const result: AllocationCounts[] = []
  for (let nA = MIN_HEADCOUNT.A; nA <= totalCount; nA++) {
    for (let nB = MIN_HEADCOUNT.B; nA + nB <= totalCount; nB++) {
      const nC = totalCount - nA - nB
      if (nC >= MIN_HEADCOUNT.C) result.push({ A: nA, B: nB, C: nC })
    }
  }
  return result
}

/** 人数配分から各事業部の実効補正係数（§5.1）を計算 */
function effectiveFactors(counts: AllocationCounts): Record<UnitId, number> {
  const f: Record<UnitId, number> = { A: 1, B: 1, C: 1 }
  for (const u of UNIT_IDS) {
    const rate = fulfillmentRate(u, counts[u])
    f[u] = shortageFactor(u, rate) * surplusFactor(rate)
  }
  return f
}

/** 売上寄与（§5.1） */
function revValue(e: Employee, unit: UnitId, effFactor: number): number {
  return (BASE_REVENUE[unit] * GROWTH[unit]) / 100 * effFactor * contribution(e, unit)
}

/** 利益寄与（§5.1） */
function profitValue(e: Employee, unit: UnitId, effFactor: number): number {
  return revValue(e, unit, effFactor) - e.cost * COST_MULTIPLIER
}

/**
 * 課題ごとの割当価値 value(i,X)（§5.1）を辞書式スカラーに合成して返す。
 * value = primary * LEX_WEIGHT + secondary
 */
function buildValues(
  employees: Employee[],
  task: TaskId,
  eff: Record<UnitId, number>,
): Record<string, Record<UnitId, number>> {
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of employees) {
    const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const unit of UNIT_IDS) {
      const rev = revValue(e, unit, eff[unit])
      let primary: number
      let secondary: number
      if (task === 1) {
        primary = rev
        secondary = 0
      } else {
        secondary = rev // 全事業部共通で全社売上を第2優先
        if (task === 2) primary = unit === 'A' ? profitValue(e, 'A', eff.A) : 0
        else if (task === 3) primary = unit === 'B' ? rev : 0
        else primary = unit === 'C' ? rev : 0
      }
      perUnit[unit] = primary * LEX_WEIGHT + secondary
    }
    values[e.id] = perUnit
  }
  return values
}

/** 課題の primary 指標（表示・選択用）を SimulationResult から取り出す */
function primaryMetric(result: SimulationResult, task: TaskId): number {
  switch (task) {
    case 1:
      return result.companyRevenue
    case 2:
      return result.units.A.profit
    case 3:
      return result.units.B.finalRevenue
    case 4:
      return result.units.C.finalRevenue
  }
}

/**
 * 全体最適化（設計書§5.4）。
 * feasible な候補から辞書式（primary→secondary(全社売上)→人数配分昇順）で最良を選ぶ。
 * feasible が無ければ revenue_floor（最も58億円に近い候補付き）を返す。
 */
export function runOptimization(
  employees: Employee[],
  task: TaskId,
): SimulationResult | InfeasibleResult {
  const candidates = enumerateHeadcounts(employees.length)
  if (candidates.length === 0) {
    return { infeasible: true, reason: 'min_headcount' }
  }

  let best: SimulationResult | null = null
  let bestKey: { primary: number; secondary: number; nA: number; nB: number } | null = null
  let closest: SimulationResult | null = null

  for (const counts of candidates) {
    const eff = effectiveFactors(counts)
    const values = buildValues(employees, task, eff)
    const assignment = solveAssignment(employees, values, counts)
    const result = computeSimulationResult(assignment, employees)

    // 最も58億円に近い候補（revenue_floor 用）を全候補から追跡
    if (closest === null || result.companyRevenue > closest.companyRevenue) {
      closest = result
    }

    if (!result.feasible) continue

    const key = {
      primary: primaryMetric(result, task),
      secondary: result.companyRevenue,
      nA: counts.A,
      nB: counts.B,
    }
    if (bestKey === null || isBetter(key, bestKey)) {
      best = result
      bestKey = key
    }
  }

  if (best === null) {
    return { infeasible: true, reason: 'revenue_floor', closestCandidate: closest ?? undefined }
  }
  return best
}

/** 辞書式比較: primary大 > secondary大 > nA小 > nB小 */
function isBetter(
  a: { primary: number; secondary: number; nA: number; nB: number },
  b: { primary: number; secondary: number; nA: number; nB: number },
): boolean {
  if (a.primary !== b.primary) return a.primary > b.primary
  if (a.secondary !== b.secondary) return a.secondary > b.secondary
  if (a.nA !== b.nA) return a.nA < b.nA
  return a.nB < b.nB
}
