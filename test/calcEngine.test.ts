// 設計書§11: 計算エンジンの単体テスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contribution,
  baseRevenue,
  shortageFactor,
  surplusFactor,
  classifyType,
  computeSimulationResult,
} from '../src/renderer/calcEngine.ts'
import { BASE_HEADCOUNT, DEFAULT_PARAMS, UNIT_IDS, standardParamsFor } from '../src/renderer/constants.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

// 適正人数・最低人数の人数比スケール（2026-09-07 合意・constants.standardParamsFor）
test('standardParamsFor: 100名では DEFAULT_PARAMS と完全に一致する（既存結果を動かさない）', () => {
  assert.deepEqual(standardParamsFor(BASE_HEADCOUNT), DEFAULT_PARAMS)
})

test('standardParamsFor: 200名で適正・最低人数が2倍になる', () => {
  const p = standardParamsFor(200)
  assert.deepEqual(p.optimalHeadcount, { A: 80, B: 70, C: 50 })
  assert.deepEqual(p.minHeadcount, { A: 60, B: 40, C: 20 })
  // 売上モデル側（基準売上・全社売上下限）は人数で変えない
  assert.deepEqual(p.baseRevenue, DEFAULT_PARAMS.baseRevenue)
  assert.equal(p.prevYearRevenue, DEFAULT_PARAMS.prevYearRevenue)
})

test('standardParamsFor: 適正人数は充足率の分母なので1を下回らない', () => {
  const p = standardParamsFor(1)
  for (const u of UNIT_IDS) assert.ok(p.optimalHeadcount[u] >= 1, `${u} の適正人数が0以下`)
})

test('contribution: 手計算値と一致', () => {
  const e: Employee = { id: 'X', sales: 80, mgmt: 60, dev: 40, training: 20, cost: 10 }
  // A: 80*.45+60*.35+40*.10+20*.10 = 63
  assert.equal(contribution(e, 'A'), 63)
  // C: 80*.20+60*.10+40*.50+20*.20 = 46
  assert.equal(contribution(e, 'C'), 46)
})

test('baseRevenue: ability=100 → A=10.6', () => {
  assert.equal(baseRevenue('A', 100), 10.6)
})

test('shortageFactor: 境界は上側に含める（90%→0.85）', () => {
  assert.equal(shortageFactor('A', 1.0), 1.0)
  assert.equal(shortageFactor('A', 0.9), 0.85)
  assert.equal(shortageFactor('A', 0.8999), 0.7)
  assert.equal(shortageFactor('B', 0.7), 0.65)
  assert.equal(shortageFactor('C', 0.6999), 0.7)
})

test('surplusFactor: 1.20未満は1.00、1.20ちょうどは0.95', () => {
  assert.equal(surplusFactor(1.199), 1.0)
  assert.equal(surplusFactor(1.2), 0.95)
  assert.equal(surplusFactor(1.4), 0.95)
  assert.equal(surplusFactor(1.4001), 0.9)
  assert.equal(surplusFactor(1.6), 0.9)
  assert.equal(surplusFactor(1.6001), 0.8)
})

test('classifyType: 同点は営業→管理→開拓→育成の優先順', () => {
  assert.equal(classifyType({ id: 't', sales: 50, mgmt: 50, dev: 10, training: 10, cost: 5 }), '営業型')
  assert.equal(classifyType({ id: 't', sales: 10, mgmt: 50, dev: 50, training: 10, cost: 5 }), '管理型')
  assert.equal(classifyType({ id: 't', sales: 10, mgmt: 10, dev: 90, training: 10, cost: 5 }), '開拓型')
  assert.equal(classifyType({ id: 't', sales: 10, mgmt: 10, dev: 10, training: 90, cost: 5 }), '育成型')
})

test('computeSimulationResult: 事業部人数と丸め整合', () => {
  const emps: Employee[] = Array.from({ length: 6 }, (_, i) => ({
    id: `E${i}`, sales: 60, mgmt: 60, dev: 60, training: 60, cost: 5,
  }))
  const assign: Record<string, UnitId> = { E0: 'A', E1: 'A', E2: 'B', E3: 'B', E4: 'C', E5: 'C' }
  const r = computeSimulationResult(assign, emps)
  assert.deepEqual(r.headcount, { A: 2, B: 2, C: 2 })
  assert.equal(r.companyRevenue, Math.round(r.companyRevenue * 100) / 100)
  assert.equal(r.units.A.count, 2)
})
