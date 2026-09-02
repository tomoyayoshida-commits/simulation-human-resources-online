// 設計書§5: 最適化オーケストレーション（外側ループ＋内側割当）

import type {
  AllocationCounts,
  Employee,
  InfeasibleResult,
  SimParams,
  SimulationResult,
  TaskId,
  UnitId,
} from './types.ts'
import type { TaskMetric } from './constants.ts'
import {
  COST_UNIT_DIVISOR,
  DEFAULT_PARAMS,
  resolveMetric,
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
export function enumerateHeadcounts(
  totalCount: number,
  params: SimParams = DEFAULT_PARAMS,
): AllocationCounts[] {
  const result: AllocationCounts[] = []
  const min = params.minHeadcount
  for (let nA = min.A; nA <= totalCount; nA++) {
    for (let nB = min.B; nA + nB <= totalCount; nB++) {
      const nC = totalCount - nA - nB
      if (nC >= min.C) result.push({ A: nA, B: nB, C: nC })
    }
  }
  return result
}

/** 人数配分から各事業部の実効補正係数（§5.1）を計算 */
function effectiveFactors(counts: AllocationCounts, params: SimParams): Record<UnitId, number> {
  const f: Record<UnitId, number> = { A: 1, B: 1, C: 1 }
  for (const u of UNIT_IDS) {
    const rate = fulfillmentRate(u, counts[u], params)
    f[u] = shortageFactor(u, rate, params) * surplusFactor(rate, params)
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

function buildEmployeeBases(employees: Employee[], params: SimParams): EmployeeBase[] {
  return employees.map((e) => {
    const contrib: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const unit of UNIT_IDS) contrib[unit] = contribution(e, unit, params)
    return { id: e.id, contrib, cost: e.cost }
  })
}

/** 売上寄与（§5.1） */
function revValue(base: EmployeeBase, unit: UnitId, effFactor: number, params: SimParams): number {
  return (params.baseRevenue[unit] * params.growth[unit]) / 100 * effFactor * base.contrib[unit]
}

/** 利益寄与（§5.1）。コストは calcEngine.unitCostTotal と同じ換算（÷COST_UNIT_DIVISOR）で億円に揃える。 */
function profitValue(base: EmployeeBase, unit: UnitId, effFactor: number, params: SimParams): number {
  return revValue(base, unit, effFactor, params) - (base.cost * params.costMultiplier) / COST_UNIT_DIVISOR
}

/**
 * 課題ごとの割当価値 value(i,X)（§5.1）を辞書式スカラーに合成して返す。
 * value = primary * LEX_WEIGHT + secondary
 *
 * 課題1（targetUnit=null）は全事業部の指標がそのまま primary で secondary を持たない。
 * 課題2〜4 は対象事業部だけが primary を持ち、全事業部が secondary＝全社売上で評価される
 * （§7-1：目的外事業部を価値0で放置すると顔ぶれが無差別になり制約判定がブレるため）。
 *
 * `metric` は呼び出し側が決めた最大化指標（既定は TASK_SPEC）。式は指標によらず同じで、
 * primary に売上を入れるかコスト控除後の利益を入れるかだけが変わる。
 */
function buildValues(
  bases: EmployeeBase[],
  task: TaskId,
  eff: Record<UnitId, number>,
  params: SimParams,
  metric: TaskMetric,
): Record<string, Record<UnitId, number>> {
  const { targetUnit } = TASK_SPEC[task]
  const values: Record<string, Record<UnitId, number>> = {}
  for (const base of bases) {
    const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const unit of UNIT_IDS) {
      const rev = revValue(base, unit, eff[unit], params)
      const isTarget = targetUnit === null || unit === targetUnit
      const primary = !isTarget ? 0 : metric === 'profit' ? profitValue(base, unit, eff[unit], params) : rev
      const secondary = targetUnit === null ? 0 : rev
      perUnit[unit] = primary * LEX_WEIGHT + secondary
    }
    values[base.id] = perUnit
  }
  return values
}

/**
 * 上界計算で使う「事業部ごとの社員の並び（value降順）」。
 * null は「この事業部は候補ごとに並べ替えが要る」ことを表す（下の buildValueOrders 参照）。
 */
type ValueOrders = Record<UnitId, number[] | null>

/**
 * 上界計算の並べ替えを候補ループの外へ巻き上げる（docs/pruning-plan.md の追記）。
 *
 * buildValues の値は、コスト項が入らない (課題,事業部) の組では
 *   perUnit[u] = (K_u × eff_u) × contrib_u      （K_u ≥ 0、eff_u > 0）
 * という「社員によらない非負の係数 × contrib_u」の形になる。
 * 非負倍は順序を保つので、**事業部内の順位は人数配分に依存しない**。
 * よって contrib_u の降順を1回求めれば861候補すべてで使い回せる。
 *
 * 例外は**指標が利益の課題の対象事業部**だけ（原文どおりなら課題2のA事業部。
 * 「すべて利益」方針では課題3のB・課題4のCも該当する）。primary が利益（rev − cost）で
 * コスト項が入るため順位が eff に依存する。この組は null を返し、従来どおり候補ごとに並べ替える。
 *
 * **ビット一致について**：並べ替えの結果を再利用するだけで、加算する値も加算順も変えない。
 * 安定ソートなので、値そのものを降順ソートした場合と同じ置換になる
 * （非負倍は順序を保ち、同値のタイブレークも入力順で一致する。係数が0なら全値0で和も0）。
 * したがって ub は従来と**ビット単位で同じ値**になり、UB降順の並びも枝刈り判定も変わらない。
 */
function buildValueOrders(bases: EmployeeBase[], task: TaskId, metric: TaskMetric): ValueOrders {
  const { targetUnit } = TASK_SPEC[task]
  const orders = { A: null, B: null, C: null } as ValueOrders
  for (const u of UNIT_IDS) {
    // コスト項が入る組は contrib だけでは順位が決まらない。
    // 判定は buildValues の isTarget と同じ形にする（課題1は targetUnit=null で全事業部が
    // primary を持つため、利益指標なら3事業部すべてにコスト項が入る）。
    if (metric === 'profit' && (targetUnit === null || u === targetUnit)) continue
    const idx = bases.map((_, i) => i)
    idx.sort((a, b) => bases[b].contrib[u] - bases[a].contrib[u])
    orders[u] = idx
  }
  return orders
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
  orders: ValueOrders,
): number {
  let total = 0
  for (const u of UNIT_IDS) {
    const take = Math.min(counts[u], bases.length)
    const order = orders[u]
    if (order === null) {
      // 順位が人数配分に依存する組（利益が目的の事業部）だけ、候補ごとに並べ替える
      const perUnit = bases.map((b) => values[b.id][u]).sort((a, b) => b - a)
      for (let i = 0; i < take; i++) total += perUnit[i]
    } else {
      for (let i = 0; i < take; i++) total += values[bases[order[i]].id][u]
    }
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
function shiftConstant(task: TaskId, eff: Record<UnitId, number>, params: SimParams): number {
  const constAll = UNIT_IDS.reduce((sum, u) => sum + eff[u] * params.baseRevenue[u], 0)
  const { targetUnit } = TASK_SPEC[task]
  // 課題2の primary は A利益だが、コストに定数項は無い（全額が社員ごとの値）ため
  // 定数項は売上と同じ eff×BASE_REVENUE でよい。よって metric による分岐は要らない。
  return targetUnit === null
    ? constAll * LEX_WEIGHT
    : eff[targetUnit] * params.baseRevenue[targetUnit] * LEX_WEIGHT + constAll
}

/**
 * 各候補の上界を列挙順に返す（テスト専用の観測点）。
 *
 * 上界の並べ替えを候補ループの外へ巻き上げた（buildValueOrders）ため、
 * 「巻き上げても ub が変わらない」ことを検証できる出口が要る。
 * 巻き上げの前提が崩れると ub が静かにずれ、枝刈りが真の最適解を切り落としうるが、
 * それは総当たり比較テストでは**必ずしも顕在化しない**（実際に前提を壊しても
 * 既存テストは全通過した）。ここを直接突くのが唯一確実な守り方。
 * 本番コードからは呼ばない。
 */
export function upperBoundsForCandidates(
  employees: Employee[],
  task: TaskId,
  params: SimParams = DEFAULT_PARAMS,
  metric?: TaskMetric,
): number[] {
  const m = resolveMetric(task, metric)
  const bases = buildEmployeeBases(employees, params)
  const orders = buildValueOrders(bases, task, m)
  return enumerateHeadcounts(employees.length, params).map((counts) => {
    const eff = effectiveFactors(counts, params)
    const values = buildValues(bases, task, eff, params, m)
    return upperBoundRawTotal(bases, values, counts, orders)
  })
}

/**
 * 人数配分を固定して内側の割当だけを厳密に解く（機能14 What-if 軸1・docs/whatif-plan.md §5 Phase1）。
 * runOptimization の候補ループ1回分（buildEmployeeBases → effectiveFactors → buildValues →
 * solveAssignment）と同じ関数を呼ぶだけで、ロジックは複製しない。最低人数制約は課さない
 * （手動 What-if では制約割れの影響を見ることも目的のため・docs/whatif-plan.md §4.5）。
 */
export function solveForHeadcount(
  employees: Employee[],
  task: TaskId,
  counts: AllocationCounts,
  params: SimParams = DEFAULT_PARAMS,
  metric?: TaskMetric,
): Record<string, UnitId> {
  const bases = buildEmployeeBases(employees, params)
  const eff = effectiveFactors(counts, params)
  const values = buildValues(bases, task, eff, params, resolveMetric(task, metric))
  return solveAssignment(employees, values, counts)
}

/**
 * 全体最適化（設計書§5.4）。
 * feasible な候補から辞書式（primary→secondary(全社売上)→人数配分昇順）で最良を選ぶ。
 * feasible が無ければ revenue_floor（最も58億円に近い候補付き）を返す。
 */
export function runOptimization(
  employees: Employee[],
  task: TaskId,
  params: SimParams = DEFAULT_PARAMS,
  metric?: TaskMetric,
): SimulationResult | InfeasibleResult {
  const m = resolveMetric(task, metric)
  const candidates = enumerateHeadcounts(employees.length, params)
  if (candidates.length === 0) {
    return { infeasible: true, reason: 'min_headcount' }
  }

  // 人数配分に依存しない値は候補ループの外で1回だけ求める（docs/pruning-plan.md ①）
  const bases = buildEmployeeBases(employees, params)

  let best: SimulationResult | null = null
  let bestKey: { primary: number; secondary: number; nA: number; nB: number } | null = null
  let bestScalar = -Infinity
  let closest: SimulationResult | null = null
  let closestCounts: AllocationCounts | null = null

  // docs/pruning-plan.md: 上界(UB)を先に全候補分計算し、UB降順に処理することで
  // 有望な候補から先に厳密解(MCMF)を試す。best が見つかった後、残りの候補の UB が
  // bestScalar を(マージン込みで)超えられなければ、それ以降は全て UB が単調に
  // 小さくなるため打ち切ってよい。
  // 上界の並べ替えは（利益が目的の事業部を除き）人数配分に依存しないので、ここで1回だけ作る
  const orders = buildValueOrders(bases, task, m)

  const prepared = candidates.map((counts) => {
    const eff = effectiveFactors(counts, params)
    const values = buildValues(bases, task, eff, params, m)
    const ub = upperBoundRawTotal(bases, values, counts, orders) + shiftConstant(task, eff, params)
    return { counts, values, ub }
  })
  prepared.sort((a, b) => b.ub - a.ub)

  for (const { counts, values, ub } of prepared) {
    if (best !== null && ub < bestScalar - PRUNE_EPS) break

    const assignment = solveAssignment(employees, values, counts)
    const result = computeSimulationResult(assignment, employees, params)

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
      primary: taskPrimaryValue(result, task, m),
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
