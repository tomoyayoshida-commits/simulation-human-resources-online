// 設計書§11: 最適化・割当のテスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enumerateHeadcounts, runOptimization } from '../src/renderer/optimizer.ts'
import { solveAssignment } from '../src/renderer/assignment.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

function makeRng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
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
