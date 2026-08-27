// 設計書§5: 最適化オーケストレーション（外側ループ＋内側割当）

import type {
  AllocationCounts,
  Employee,
  InfeasibleResult,
  SimulationResult,
  TaskId,
  UnitId,
} from './types.ts'
import {
  BASE_REVENUE,
  COST_MULTIPLIER,
  COST_UNIT_DIVISOR,
  GROWTH,
  MIN_HEADCOUNT,
  TASK_SPEC,
  UNIT_IDS,
} from './constants.ts'
import {
  computeSimulationResult,
  contribution,
  fulfillmentRate,
  shortageFactor,
  surplusFactor,
  taskPrimaryValue,
} from './calcEngine.ts'
import { solveAssignment } from './assignment.ts'

/** 辞書式合成の重み（§5.1）。primary の1単位差を secondary 総和が覆さない大きさ。 */
const LEX_WEIGHT = 1e6

/**
 * 枝刈り（docs/pruning-plan.md）の丸め誤差マージン。
 * 候補の上界(UB)は丸め前、比較対象の bestScalar は丸め後の値から算出するため、
 * round2 の累積誤差を吸収できるだけの余裕を持たせる（過大側に倒しても誤答にはならず、
 * 枝刈り効果が僅かに弱まるだけなので安全側）。
 */
const PRUNE_EPS = 1e5

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

/**
 * 人数配分に依存しない社員ごとの値を1回だけ計算したもの（docs/pruning-plan.md ①）。
 *
 * `contribution(e,unit)` は人数配分と無関係（重みと能力値だけで決まる）にもかかわらず、
 * 従来は候補ごとに buildValues の中から呼び直していた。100名×3事業部×861候補×4課題で
 * 約100万回の再計算になっていたため、runOptimization の先頭で1度だけ求めて使い回す。
 */
interface EmployeeBase {
  id: string
  /** contribution(e, unit) の事前計算値 */
  contrib: Record<UnitId, number>
  /** 人件費（生値。億円換算は profitValue が行う） */
  cost: number
}

function buildEmployeeBases(employees: Employee[]): EmployeeBase[] {
  return employees.map((e) => {
    const contrib: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const unit of UNIT_IDS) contrib[unit] = contribution(e, unit)
    return { id: e.id, contrib, cost: e.cost }
  })
}

/** 売上寄与（§5.1） */
function revValue(base: EmployeeBase, unit: UnitId, effFactor: number): number {
  return (BASE_REVENUE[unit] * GROWTH[unit]) / 100 * effFactor * base.contrib[unit]
}

/** 利益寄与（§5.1）。コストは calcEngine.unitCostTotal と同じ換算（÷COST_UNIT_DIVISOR）で億円に揃える。 */
function profitValue(base: EmployeeBase, unit: UnitId, effFactor: number): number {
  return revValue(base, unit, effFactor) - (base.cost * COST_MULTIPLIER) / COST_UNIT_DIVISOR
}

/**
 * 課題ごとの割当価値 value(i,X)（§5.1）を辞書式スカラーに合成して返す。
 * value = primary * LEX_WEIGHT + secondary
 *
 * 課題1（targetUnit=null）は全事業部の売上がそのまま primary で secondary を持たない。
 * 課題2〜4 は対象事業部だけが primary を持ち、全事業部が secondary＝全社売上で評価される
 * （§7-1：目的外事業部を価値0で放置すると顔ぶれが無差別になり制約判定がブレるため）。
 */
function buildValues(
  bases: EmployeeBase[],
  task: TaskId,
  eff: Record<UnitId, number>,
): Record<string, Record<UnitId, number>> {
  const { targetUnit, metric } = TASK_SPEC[task]
  const values: Record<string, Record<UnitId, number>> = {}
  for (const base of bases) {
    const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const unit of UNIT_IDS) {
      const rev = revValue(base, unit, eff[unit])
      const isTarget = targetUnit === null || unit === targetUnit
      const primary = !isTarget ? 0 : metric === 'profit' ? profitValue(base, unit, eff[unit]) : rev
      const secondary = targetUnit === null ? 0 : rev
      perUnit[unit] = primary * LEX_WEIGHT + secondary
    }
    values[base.id] = perUnit
  }
  return values
}

/**
 * 候補の上界（docs/pruning-plan.md §2）。
 * 「1社員は1事業部にしか配属できない」制約を外した緩和問題として、事業部ごとに
 * value(i,X) 上位 counts[X] 件を単純合計する。緩和問題の最適値は本問題（MCMF）の
 * 最適値以上になるため、これは solveAssignment が返す raw 合計値を上回ることのない
 * 有効な上界（＝ rawTotal(assignment) の上界。定数項は含まない。下の shiftConstant 参照）。
 */
function upperBoundRawTotal(
  bases: EmployeeBase[],
  values: Record<string, Record<UnitId, number>>,
  counts: AllocationCounts,
): number {
  let total = 0
  for (const u of UNIT_IDS) {
    const perUnit = bases.map((b) => values[b.id][u]).sort((a, b) => b - a)
    const take = counts[u]
    for (let i = 0; i < take && i < perUnit.length; i++) total += perUnit[i]
  }
  return total
}

/**
 * buildValues の rawTotal（MCMFが最大化する値）には、baseRevenue の定数項
 * （BASE_REVENUE×eff。ability に依存しない部分）が含まれていない。
 * そのため rawTotal は候補間で直接比較できず、比較の前に候補固有の定数項を
 * 加算して外側の key（primaryMetric*1e6 + companyRevenue、丸め後）とスケールを揃える。
 * 揃えないと「達成可能な最大値」を過小評価し、実際にはより良い候補を誤って
 * 枝刈りしてしまう（丸め後の実測値と丸め前の raw 値を直接比較する際の既知の罠）。
 *
 * 導出（§4の式より、round2を無視した生値ベース）:
 *   companyRevenueRaw = Σ_u eff_u*BASE_u + rawTotal(task1相当の合計)
 *   → task1: shift = ConstAll * LEX_WEIGHT
 *   → task2: primary=A利益なので A の定数項のみ LEX_WEIGHT 倍、secondary(全社売上)は ConstAll
 *   → task3/4: primary=B/Cの売上なので B/C の定数項のみ LEX_WEIGHT 倍、secondary は ConstAll
 */
function shiftConstant(task: TaskId, eff: Record<UnitId, number>): number {
  const constAll = UNIT_IDS.reduce((sum, u) => sum + eff[u] * BASE_REVENUE[u], 0)
  const { targetUnit } = TASK_SPEC[task]
  // 課題2の primary は A利益だが、コストに定数項は無い（全額が社員ごとの値）ため
  // 定数項は売上と同じ eff×BASE_REVENUE でよい。よって metric による分岐は要らない。
  return targetUnit === null
    ? constAll * LEX_WEIGHT
    : eff[targetUnit] * BASE_REVENUE[targetUnit] * LEX_WEIGHT + constAll
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

  // 人数配分に依存しない値は候補ループの外で1回だけ求める（docs/pruning-plan.md ①）
  const bases = buildEmployeeBases(employees)

  let best: SimulationResult | null = null
  let bestKey: { primary: number; secondary: number; nA: number; nB: number } | null = null
  let bestScalar = -Infinity
  let closest: SimulationResult | null = null
  let closestCounts: AllocationCounts | null = null

  // docs/pruning-plan.md: 上界(UB)を先に全候補分計算し、UB降順に処理することで
  // 有望な候補から先に厳密解(MCMF)を試す。best が見つかった後、残りの候補の UB が
  // bestScalar を(マージン込みで)超えられなければ、それ以降は全て UB が単調に
  // 小さくなるため打ち切ってよい。
  const prepared = candidates.map((counts) => {
    const eff = effectiveFactors(counts)
    const values = buildValues(bases, task, eff)
    const ub = upperBoundRawTotal(bases, values, counts) + shiftConstant(task, eff)
    return { counts, values, ub }
  })
  prepared.sort((a, b) => b.ub - a.ub)

  for (const { counts, values, ub } of prepared) {
    if (best !== null && ub < bestScalar - PRUNE_EPS) break

    const assignment = solveAssignment(employees, values, counts)
    const result = computeSimulationResult(assignment, employees)

    // 最も58億円に近い候補（revenue_floor 用）を全候補から追跡。
    // UB降順で処理順が enumerateHeadcounts の元順（nA→nB昇順）と変わったため、
    // 同点（companyRevenue完全一致）の場合は明示的に nA→nB 昇順を優先し、
    // 反復順に依存しない決定性を保つ（§7-6のタイブレーク方針に準拠）。
    if (
      closest === null ||
      result.companyRevenue > closest.companyRevenue ||
      (result.companyRevenue === closest.companyRevenue &&
        closestCounts !== null &&
        (counts.A < closestCounts.A || (counts.A === closestCounts.A && counts.B < closestCounts.B)))
    ) {
      closest = result
      closestCounts = counts
    }

    if (!result.feasible) continue

    const key = {
      primary: taskPrimaryValue(result, task),
      secondary: result.companyRevenue,
      nA: counts.A,
      nB: counts.B,
    }
    if (bestKey === null || isBetter(key, bestKey)) {
      best = result
      bestKey = key
      bestScalar = key.primary * LEX_WEIGHT + key.secondary
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
