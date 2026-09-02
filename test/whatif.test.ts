// docs/whatif-plan.md §5: 機能14 What-if分析のテスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runOptimization, solveForHeadcount } from '../src/renderer/optimizer.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { importEmployees } from '../src/renderer/csv.ts'
import { DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import { diffAssignment, evaluateAssignment, headcountOf, validateParams } from '../src/renderer/whatif.ts'
import type { Employee, SimParams, SimulationResult, TaskId, UnitId } from '../src/renderer/types.ts'

function makeRng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

function loadRealEmployees(): Employee[] {
  const text = readFileSync(
    '/mnt/c/Users/pluser1/Desktop/本課題　必要資料/human_resources_100.csv',
    'utf-8',
  )
  const { employees } = importEmployees(text, 100)
  assert.ok(employees)
  return employees
}

test('solveForHeadcount: runOptimizationのheadcountを渡すと同じ売上・利益が得られる（4課題）', () => {
  const employees = loadRealEmployees()
  for (const task of [1, 2, 3, 4] as TaskId[]) {
    const opt = runOptimization(employees, task)
    assert.ok(!('infeasible' in opt), `課題${task}は可行のはず`)
    const best = opt as SimulationResult
    const assignment = solveForHeadcount(employees, task, best.headcount)
    const result = computeSimulationResult(assignment, employees)
    assert.equal(result.companyRevenue, best.companyRevenue, `課題${task}: companyRevenue`)
    assert.equal(result.companyProfit, best.companyProfit, `課題${task}: companyProfit`)
  }
})

test('solveForHeadcount: 5名の小規模ケースで全割当総当たりの最適値と一致', () => {
  const rnd = makeRng(7)
  const employees: Employee[] = Array.from({ length: 5 }, (_, i) => ({
    id: `W${i}`,
    sales: Math.round(rnd() * 100),
    mgmt: Math.round(rnd() * 100),
    dev: Math.round(rnd() * 100),
    training: Math.round(rnd() * 100),
    cost: 1 + Math.round(rnd() * 19),
  }))
  const counts = { A: 2, B: 2, C: 1 }
  const task: TaskId = 1

  const assignment = solveForHeadcount(employees, task, counts)
  const result = computeSimulationResult(assignment, employees)

  // 全探索：5名を{A:2,B:2,C:1}に分ける全パターンでcompanyRevenueの最大値を求める
  const units: UnitId[] = ['A', 'B', 'C']
  let bestRevenue = -Infinity
  const assign = new Array<UnitId>(5)
  function backtrack(i: number, used: Record<UnitId, number>): void {
    if (i === 5) {
      const asg: Record<string, UnitId> = {}
      employees.forEach((e, idx) => (asg[e.id] = assign[idx]))
      const r = computeSimulationResult(asg, employees)
      if (r.companyRevenue > bestRevenue) bestRevenue = r.companyRevenue
      return
    }
    for (const u of units) {
      if (used[u] >= counts[u]) continue
      assign[i] = u
      used[u]++
      backtrack(i + 1, used)
      used[u]--
    }
  }
  backtrack(0, { A: 0, B: 0, C: 0 })

  assert.equal(result.companyRevenue, bestRevenue)
})

test('headcountOf: assignmentの集計と一致する', () => {
  const employees = loadRealEmployees()
  const opt = runOptimization(employees, 1)
  assert.ok(!('infeasible' in opt))
  const best = opt as SimulationResult
  const counts = headcountOf(best.assignment, employees)
  assert.deepEqual(counts, best.headcount)
})

test('evaluateAssignment: 最低人数割れを検出し、result.feasibleは売上下限のみを見る（§2.3）', () => {
  const employees = loadRealEmployees()
  const opt = runOptimization(employees, 1)
  assert.ok(!('infeasible' in opt))
  const baseline = (opt as SimulationResult).assignment

  // A事業部の最低人数(30)を割るように、Aの社員のほとんどをCへ付け替える
  const assignment: Record<string, UnitId> = { ...baseline }
  let movedA = 0
  for (const id of Object.keys(assignment)) {
    if (assignment[id] === 'A' && movedA < 20) {
      assignment[id] = 'C'
      movedA++
    }
  }

  const evalResult = evaluateAssignment({ task: 1, roster: employees, params: DEFAULT_PARAMS, assignment }, baseline)
  assert.ok(evalResult.minHeadcountViolations.includes('A'))
  assert.equal(evalResult.movedFromBaseline, movedA)
  // feasibleは売上下限（会社売上>58億）しか見ない。最低人数割れの影響で feasible が変わるわけではない。
  assert.equal(evalResult.result.feasible, evalResult.result.companyRevenue > DEFAULT_PARAMS.prevYearRevenue)
})

test('evaluateAssignment: paramsを標準値にしたときcomputeSimulationResultと一致する', () => {
  const employees = loadRealEmployees()
  const opt = runOptimization(employees, 1)
  assert.ok(!('infeasible' in opt))
  const best = opt as SimulationResult
  const evalResult = evaluateAssignment(
    { task: 1, roster: employees, params: DEFAULT_PARAMS, assignment: best.assignment },
    best.assignment,
  )
  assert.deepEqual(evalResult.result, computeSimulationResult(best.assignment, employees, DEFAULT_PARAMS))
  assert.equal(evalResult.movedFromBaseline, 0)
})

test('validateParams: §4.6の各行を検出する', () => {
  assert.equal(validateParams(DEFAULT_PARAMS).length, 0)

  const withZeroOptimal: SimParams = {
    ...DEFAULT_PARAMS,
    optimalHeadcount: { ...DEFAULT_PARAMS.optimalHeadcount, A: 0 },
  }
  assert.ok(validateParams(withZeroOptimal).some((e) => e.column.includes('適正人数')))

  const withNegativeMin: SimParams = {
    ...DEFAULT_PARAMS,
    minHeadcount: { ...DEFAULT_PARAMS.minHeadcount, B: -1 },
  }
  assert.ok(validateParams(withNegativeMin).some((e) => e.column.includes('最低人数')))

  const withNegativeBaseRevenue: SimParams = {
    ...DEFAULT_PARAMS,
    baseRevenue: { ...DEFAULT_PARAMS.baseRevenue, C: -1 },
  }
  assert.ok(validateParams(withNegativeBaseRevenue).some((e) => e.column.includes('基準売上')))

  const withNegativeGrowth: SimParams = {
    ...DEFAULT_PARAMS,
    growth: { ...DEFAULT_PARAMS.growth, A: -0.1 },
  }
  assert.ok(validateParams(withNegativeGrowth).some((e) => e.column.includes('成長係数')))

  const withNegativeWeight: SimParams = {
    ...DEFAULT_PARAMS,
    weights: { ...DEFAULT_PARAMS.weights, A: { ...DEFAULT_PARAMS.weights.A, sales: -0.1 } },
  }
  assert.ok(validateParams(withNegativeWeight).some((e) => e.column.includes('重み')))

  const withNegativePrevYear: SimParams = { ...DEFAULT_PARAMS, prevYearRevenue: -1 }
  assert.ok(validateParams(withNegativePrevYear).some((e) => e.column.includes('全社売上下限')))

  const withNegativeCostMultiplier: SimParams = { ...DEFAULT_PARAMS, costMultiplier: -1 }
  assert.ok(validateParams(withNegativeCostMultiplier).some((e) => e.column.includes('コスト係数')))

  // Σ minHeadcount超過は§4.6の方針により弾かない（警告のみ）
  const withHugeMin: SimParams = {
    ...DEFAULT_PARAMS,
    minHeadcount: { A: 1000, B: 1000, C: 1000 },
  }
  assert.equal(validateParams(withHugeMin).length, 0)

  // Σ weights ≈ 1.0 は2026-09-02の合意によりブロック対象（貢献度の意味が崩れるため）
  const withSkewedWeights: SimParams = {
    ...DEFAULT_PARAMS,
    weights: { ...DEFAULT_PARAMS.weights, A: { sales: 0.9, mgmt: 0.9, dev: 0.9, training: 0.9 } },
  }
  assert.ok(validateParams(withSkewedWeights).some((e) => e.column.includes('重み合計')))
})

test('diffAssignment: 異動を(from,to,count)に集計する', () => {
  const baseline: Record<string, UnitId> = { e1: 'A', e2: 'A', e3: 'B', e4: 'C' }
  const current: Record<string, UnitId> = { e1: 'B', e2: 'B', e3: 'B', e4: 'A' }
  const diff = diffAssignment(baseline, current)
  assert.deepEqual(
    diff.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    [
      { from: 'A', to: 'B', count: 2 },
      { from: 'C', to: 'A', count: 1 },
    ],
  )
})
