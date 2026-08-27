// docs/solver-oracle-plan.md §5 Phase1
//
// assignment.ts（自前MCMF）を、実装系統が完全に独立したHiGHS(MILP)で検証する。
// 比較は目的関数値のみで行う（割当自体は同値解が複数あり得るため比較しない）。
// 役割分担：このファイルは solveAssignment 単体の正しさを守る。
// optimizer.test.ts の「枝刈り…完全一致」は、bruteForceOptimize が内部で solveAssignment を
// 再利用しているため枝刈りロジックの回帰しか検出できない（§2.3）。両者は互いを代替しない。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveAssignment } from '../src/renderer/assignment.ts'
import { enumerateHeadcounts } from '../src/renderer/optimizer.ts'
import { contribution, fulfillmentRate, shortageFactor, surplusFactor } from '../src/renderer/calcEngine.ts'
import { BASE_REVENUE, GROWTH, UNIT_IDS } from '../src/renderer/constants.ts'
import type { AllocationCounts, Employee, UnitId } from '../src/renderer/types.ts'
import { solveAssignmentObjectiveLP, assertRelativelyClose } from './helpers/lpOracle.ts'

function makeRng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

function makeEmployees(n: number, rnd: () => number, prefix = 'E'): Employee[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    sales: Math.floor(rnd() * 101),
    mgmt: Math.floor(rnd() * 101),
    dev: Math.floor(rnd() * 101),
    training: Math.floor(rnd() * 101),
    cost: 1 + Math.floor(rnd() * 20),
  }))
}

/** calcEngine相当の生の売上値（task=1と同じ、1e6スケールを乗せない「素の」スケール） */
function plainRevenueValues(employees: Employee[], counts: AllocationCounts): Record<string, Record<UnitId, number>> {
  const eff: Record<UnitId, number> = { A: 1, B: 1, C: 1 }
  for (const u of UNIT_IDS) {
    const rate = fulfillmentRate(u, counts[u])
    eff[u] = shortageFactor(u, rate) * surplusFactor(rate)
  }
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of employees) {
    const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const u of UNIT_IDS) {
      perUnit[u] = ((BASE_REVENUE[u] * GROWTH[u]) / 100) * eff[u] * contribution(e, u)
    }
    values[e.id] = perUnit
  }
  return values
}

/** buildValues(optimizer.ts)と同じ「primary*1e6+secondary」スケールを直接生成する */
function scaledValues(employees: Employee[], rnd: () => number, allowNegative: boolean): Record<string, Record<UnitId, number>> {
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of employees) {
    const perUnit: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
    for (const u of UNIT_IDS) {
      const primary = (allowNegative ? rnd() * 300 - 150 : rnd() * 150) // 課題2のprofitValueは負になりうる
      const secondary = rnd() * 100
      perUnit[u] = primary * 1e6 + secondary
    }
    values[e.id] = perUnit
  }
  return values
}

async function assertSolveAssignmentMatchesOracle(
  employees: Employee[],
  values: Record<string, Record<UnitId, number>>,
  counts: AllocationCounts,
  label: string,
): Promise<void> {
  const assignment = solveAssignment(employees, values, counts)

  // 人数制約の充足
  const actualCounts: AllocationCounts = { A: 0, B: 0, C: 0 }
  for (const e of employees) actualCounts[assignment[e.id]]++
  assert.deepEqual(actualCounts, counts, `${label}: 人数制約が満たされていない`)

  const solvedObjective = employees.reduce((sum, e) => sum + values[e.id][assignment[e.id]], 0)
  const oracleObjective = await solveAssignmentObjectiveLP(employees, values, counts)

  assertRelativelyClose(solvedObjective, oracleObjective)
}

test('assignment oracle #1: 実データ規模(100名)・enumerateHeadcountsから複数サンプル', async () => {
  const rnd = makeRng(101)
  const employees = makeEmployees(100, rnd)
  const candidates = enumerateHeadcounts(100)
  const samples = [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates[candidates.length - 1]]
  for (const counts of samples) {
    const values = plainRevenueValues(employees, counts)
    await assertSolveAssignmentMatchesOracle(employees, values, counts, `#1 counts=${JSON.stringify(counts)}`)
  }
})

test('assignment oracle #2: primary*1e6+secondaryと同じスケール（最重要）', async () => {
  const rnd = makeRng(202)
  const employees = makeEmployees(100, rnd)
  const counts: AllocationCounts = { A: 47, B: 41, C: 12 }
  const values = scaledValues(employees, rnd, false)
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#2')
})

test('assignment oracle #3: 同値が多数（離散値からvaluesを生成）', async () => {
  const rnd = makeRng(303)
  const employees = makeEmployees(30, rnd)
  const pool = [10, 20, 30]
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of employees) {
    values[e.id] = {
      A: pool[Math.floor(rnd() * pool.length)],
      B: pool[Math.floor(rnd() * pool.length)],
      C: pool[Math.floor(rnd() * pool.length)],
    }
  }
  const counts: AllocationCounts = { A: 10, B: 10, C: 10 }
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#3')
})

test('assignment oracle #4: 負値を含む（課題2のprofitValue相当）', async () => {
  const rnd = makeRng(404)
  const employees = makeEmployees(40, rnd)
  const counts: AllocationCounts = { A: 15, B: 15, C: 10 }
  const values = scaledValues(employees, rnd, true)
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#4')
})

test('assignment oracle #5: 全値が同一（退化ケース）', async () => {
  const employees = makeEmployees(20, makeRng(505))
  const values: Record<string, Record<UnitId, number>> = {}
  for (const e of employees) values[e.id] = { A: 42, B: 42, C: 42 }
  const counts: AllocationCounts = { A: 8, B: 7, C: 5 }
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#5')
})

test('assignment oracle #6: countsが極端（最低人数境界）', async () => {
  const rnd = makeRng(606)
  const employees = makeEmployees(100, rnd)
  const counts: AllocationCounts = { A: 80, B: 10, C: 10 }
  const values = plainRevenueValues(employees, counts)
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#6')
})

test('assignment oracle #7: 110名（採用後サイズ）', async () => {
  const rnd = makeRng(707)
  const employees = makeEmployees(110, rnd)
  const candidates = enumerateHeadcounts(110)
  const counts = candidates[Math.floor(candidates.length / 3)]
  const values = scaledValues(employees, rnd, false)
  await assertSolveAssignmentMatchesOracle(employees, values, counts, '#7')
})
