// 設計書§11: 最適化・割当のテスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enumerateHeadcounts, runOptimization } from '../src/renderer/optimizer.ts'
import { solveAssignment } from '../src/renderer/assignment.ts'
import { computeSimulationResult, contribution, fulfillmentRate, shortageFactor, surplusFactor } from '../src/renderer/calcEngine.ts'
import { BASE_REVENUE, COST_MULTIPLIER, COST_UNIT_DIVISOR, GROWTH, UNIT_IDS } from '../src/renderer/constants.ts'
import type { AllocationCounts, Employee, SimulationResult, TaskId, UnitId } from '../src/renderer/types.ts'

function makeRng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

/**
 * docs/pruning-plan.md の枝刈り(branch-and-bound)導入前の全候補総当たり実装。
 * runOptimization(枝刈りあり)と結果が完全一致することを検証するための基準実装。
 * 枝刈りロジックとは独立に optimizer.ts の buildValues 相当をここで再現する
 * （枝刈り実装のバグでこの基準実装まで壊れることがないようにするため）。
 */
function bruteForceOptimize(
  employees: Employee[],
  task: TaskId,
): SimulationResult | { infeasible: true; reason: 'revenue_floor'; closestCandidate?: SimulationResult } {
  const candidates = enumerateHeadcounts(employees.length)
  let best: SimulationResult | null = null
  let bestKey: { primary: number; secondary: number; nA: number; nB: number } | null = null
  let closest: SimulationResult | null = null
  let closestCounts: AllocationCounts | null = null

  for (const counts of candidates) {
    const eff: Record<UnitId, number> = { A: 1, B: 1, C: 1 }
    for (const u of UNIT_IDS) {
      const rate = fulfillmentRate(u, counts[u])
      eff[u] = shortageFactor(u, rate) * surplusFactor(rate)
    }

    const values: Record<string, Record<UnitId, number>> = {}
    for (const e of employees) {
      const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
      for (const unit of UNIT_IDS) {
        const rev = (BASE_REVENUE[unit] * GROWTH[unit]) / 100 * eff[unit] * contribution(e, unit)
        let primary: number
        let secondary: number
        if (task === 1) {
          primary = rev
          secondary = 0
        } else {
          secondary = rev
          if (task === 2) {
            primary = unit === 'A' ? rev - (e.cost * COST_MULTIPLIER) / COST_UNIT_DIVISOR : 0
          } else if (task === 3) primary = unit === 'B' ? rev : 0
          else primary = unit === 'C' ? rev : 0
        }
        perUnit[unit] = primary * 1e6 + secondary
      }
      values[e.id] = perUnit
    }

    const assignment = solveAssignment(employees, values, counts)
    const result = computeSimulationResult(assignment, employees)

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
      primary:
        task === 1
          ? result.companyRevenue
          : task === 2
            ? result.units.A.profit
            : task === 3
              ? result.units.B.finalRevenue
              : result.units.C.finalRevenue,
      secondary: result.companyRevenue,
      nA: counts.A,
      nB: counts.B,
    }
    if (
      bestKey === null ||
      key.primary > bestKey.primary ||
      (key.primary === bestKey.primary &&
        (key.secondary > bestKey.secondary ||
          (key.secondary === bestKey.secondary &&
            (key.nA < bestKey.nA || (key.nA === bestKey.nA && key.nB < bestKey.nB)))))
    ) {
      best = result
      bestKey = key
    }
  }
  return best ?? { infeasible: true, reason: 'revenue_floor', closestCandidate: closest ?? undefined }
}

test('enumerateHeadcounts: 全候補が最低人数と合計を満たす', () => {
  const cands = enumerateHeadcounts(100)
  assert.ok(cands.length > 0)
  for (const c of cands) {
    assert.ok(c.A >= 30 && c.B >= 20 && c.C >= 10)
    assert.equal(c.A + c.B + c.C, 100)
  }
})

test('solveAssignment: 全探索(5名×3事業部)の最適値と一致', () => {
  const rnd = makeRng(42)
  const emps: Employee[] = Array.from({ length: 5 }, (_, i) => ({
    id: `S${i}`, sales: 0, mgmt: 0, dev: 0, training: 0, cost: 1,
  }))
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of emps) values[e.id] = { A: rnd() * 100, B: rnd() * 100, C: rnd() * 100 }
  const counts = { A: 2, B: 2, C: 1 }

  const asg = solveAssignment(emps, values, counts)
  const solved = emps.reduce((acc, e) => acc + values[e.id][asg[e.id]], 0)

  // 全探索
  const units: UnitId[] = ['A', 'B', 'C']
  let best = -Infinity
  const assign = new Array<UnitId>(5)
  const rec = (i: number, cnt: Record<UnitId, number>, sum: number): void => {
    if (i === 5) {
      if (cnt.A === 2 && cnt.B === 2 && cnt.C === 1) best = Math.max(best, sum)
      return
    }
    for (const u of units) {
      if (cnt[u] < counts[u]) {
        cnt[u]++; assign[i] = u
        rec(i + 1, cnt, sum + values[emps[i].id][u])
        cnt[u]--
      }
    }
  }
  rec(0, { A: 0, B: 0, C: 0 }, 0)

  assert.ok(Math.abs(solved - best) < 1e-9, `solved=${solved} best=${best}`)
  const cc: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
  for (const e of emps) cc[asg[e.id]]++
  assert.deepEqual(cc, counts)
})

test('runOptimization: 課題1〜4が可行・最低人数を満たす・決定的', () => {
  const rnd = makeRng(7)
  const emps: Employee[] = Array.from({ length: 100 }, (_, i) => ({
    id: `E${String(i + 1).padStart(3, '0')}`,
    sales: 50 + Math.floor(rnd() * 51), mgmt: 50 + Math.floor(rnd() * 51),
    dev: 50 + Math.floor(rnd() * 51), training: 50 + Math.floor(rnd() * 51),
    cost: 1 + Math.floor(rnd() * 20),
  }))
  for (const task of [1, 2, 3, 4] as const) {
    const r = runOptimization(emps, task)
    assert.ok(!('infeasible' in r), `課題${task}が不可行`)
    if ('infeasible' in r) return
    assert.equal(r.feasible, true)
    assert.ok(r.headcount.A >= 30 && r.headcount.B >= 20 && r.headcount.C >= 10)
    // 決定性
    const r2 = runOptimization(emps, task)
    assert.deepEqual(r2, r)
  }
})

test('runOptimization: 能力が極端に低いと revenue_floor + closestCandidate', () => {
  const weak: Employee[] = Array.from({ length: 100 }, (_, i) => ({
    id: `W${i}`, sales: 0, mgmt: 0, dev: 0, training: 0, cost: 1,
  }))
  const r = runOptimization(weak, 1)
  assert.ok('infeasible' in r)
  if ('infeasible' in r) {
    assert.equal(r.reason, 'revenue_floor')
    assert.ok(r.closestCandidate)
  }
})

test('runOptimization: 最低人数合計を満たせないと min_headcount', () => {
  // 合計 50 名（最低合計 60 未満）→ 候補0通り
  const tiny: Employee[] = Array.from({ length: 50 }, (_, i) => ({
    id: `T${i}`, sales: 80, mgmt: 80, dev: 80, training: 80, cost: 5,
  }))
  const r = runOptimization(tiny, 1)
  assert.ok('infeasible' in r && r.reason === 'min_headcount')
})

test('runOptimization: 枝刈り(docs/pruning-plan.md)ありでも全候補総当たりと完全一致する', () => {
  // seed=1・110名 は枝刈り導入時に実際に不一致（誤った候補を選ぶ／closestの同点タイブレーク崩れ）
  // を検出した回帰ケース。総当たり(bruteForceOptimize)はO(N^3)×候補数で低速なため、
  // テスト時間予算（CLAUDE.md §3: 全体で約10秒台）を踏まえケースを絞る。
  const sizesAndSeeds: [number, number][] = [[110, 1]]
  for (const [size, seed] of sizesAndSeeds) {
    const rnd = makeRng(seed)
    const emps: Employee[] = Array.from({ length: size }, (_, i) => ({
      id: `E${String(i + 1).padStart(3, '0')}`,
      sales: Math.floor(rnd() * 101),
      mgmt: Math.floor(rnd() * 101),
      dev: Math.floor(rnd() * 101),
      training: Math.floor(rnd() * 101),
      cost: 1 + Math.floor(rnd() * 20),
    }))
    for (const task of [1, 2, 3, 4] as const) {
      const pruned = runOptimization(emps, task)
      const brute = bruteForceOptimize(emps, task)
      assert.deepEqual(
        pruned,
        brute,
        `size=${size} seed=${seed} task=${task} で枝刈り結果と総当たり結果が不一致`,
      )
    }
  }
})
