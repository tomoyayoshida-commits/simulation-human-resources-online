// docs/workbench-plan.md §5 Phase1: 機能15 作業机の純粋関数のテスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runOptimization } from '../src/renderer/optimizer.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { importEmployees } from '../src/renderer/csv.ts'
import { DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import { evaluateAssignment } from '../src/renderer/whatif.ts'
import {
  buildWorkbenchCards,
  hasViolation,
  MAX_HISTORY,
  moveEmployee,
  previewMove,
  resetToBaseline,
  serializeWorkbenchState,
  sortCards,
  undo,
  withAssignment,
  withMove,
  type WorkbenchState,
} from '../src/renderer/workbench.ts'
import type { Employee, SimulationResult, UnitId } from '../src/renderer/types.ts'

function loadRealEmployees(): Employee[] {
  const text = readFileSync('/mnt/c/Users/pluser1/Desktop/本課題　必要資料/human_resources_100.csv', 'utf-8')
  const { employees } = importEmployees(text, 100)
  assert.ok(employees)
  return employees
}

/** 課題1（全社売上最大化）の最適解を baseline にした作業机の初期状態 */
function makeState(): WorkbenchState {
  const roster = loadRealEmployees()
  const opt = runOptimization(roster, 1)
  assert.ok(!('infeasible' in opt))
  const baseline = opt as SimulationResult
  return {
    task: 1,
    metric: 'revenue',
    roster,
    params: DEFAULT_PARAMS,
    assignment: { ...baseline.assignment },
    baseline,
    history: [],
  }
}

test('moveEmployee: 新しいオブジェクトを返す（元を破壊しない）', () => {
  const state = makeState()
  const before = state.assignment
  const id = state.roster[0].id
  const otherUnit: UnitId = before[id] === 'A' ? 'B' : 'A'
  const after = moveEmployee(before, id, otherUnit, state.roster)
  assert.notEqual(after, before)
  assert.equal(after[id], otherUnit)
  assert.equal(before[id], state.baseline.assignment[id], '元のオブジェクトは変わっていない')
})

test('moveEmployee: 存在しない社員IDでは状態が変わらない（同じ参照を返す）', () => {
  const state = makeState()
  const after = moveEmployee(state.assignment, 'NOT_EXIST', 'A', state.roster)
  assert.equal(after, state.assignment)
})

test('previewMove: 実際に動かしてから computeSimulationResult した結果と一致する', () => {
  const state = makeState()
  const id = state.roster[0].id
  const otherUnit: UnitId = state.assignment[id] === 'C' ? 'B' : 'C'
  const preview = previewMove(state, id, otherUnit)
  const moved = moveEmployee(state.assignment, id, otherUnit, state.roster)
  const expected = computeSimulationResult(moved, state.roster, state.params)
  assert.deepEqual(preview, expected)
})

test('previewMove: state.assignment 自体は変更しない', () => {
  const state = makeState()
  const before = { ...state.assignment }
  const id = state.roster[5].id
  const otherUnit: UnitId = state.assignment[id] === 'A' ? 'B' : 'A'
  previewMove(state, id, otherUnit)
  assert.deepEqual(state.assignment, before)
})

test('withMove: 最低人数を割る移動で evaluateAssignment の minHeadcountViolations に該当事業部が出る', () => {
  let state = makeState()
  // A事業部(最低30)を割るまでAの社員をCへ動かす
  let movedA = 0
  for (const id of Object.keys(state.assignment)) {
    if (state.assignment[id] === 'A' && movedA < 20) {
      state = withMove(state, id, 'C')
      movedA++
    }
  }
  const evalResult = evaluateAssignment(state, state.baseline.assignment)
  assert.ok(evalResult.minHeadcountViolations.includes('A'))
  assert.equal(evalResult.movedFromBaseline, movedA)
  assert.ok(hasViolation(evalResult))
})

test('withMove: 現在の所属と同じ事業部への移動は履歴を積まない', () => {
  const state = makeState()
  const id = state.roster[0].id
  const sameUnit = state.assignment[id]
  const after = withMove(state, id, sameUnit)
  assert.equal(after, state)
})

test('withMove: 履歴が上限(MAX_HISTORY)を超えると古いものから捨てられる', () => {
  let state = makeState()
  const id = state.roster[0].id
  for (let i = 0; i < MAX_HISTORY + 10; i++) {
    const unit: UnitId = i % 2 === 0 ? 'A' : 'B'
    state = withMove(state, id, unit)
  }
  assert.equal(state.history.length, MAX_HISTORY)
})

test('undo: 1手戻ると直前の assignment に戻り、履歴が1つ減る', () => {
  const state = makeState()
  const id = state.roster[0].id
  const before = state.assignment
  const otherUnit: UnitId = before[id] === 'A' ? 'B' : 'A'
  const moved = withMove(state, id, otherUnit)
  assert.equal(moved.history.length, 1)
  const undone = undo(moved)
  assert.deepEqual(undone.assignment, before)
  assert.equal(undone.history.length, 0)
})

test('undo: 履歴が空なら何もしない（同じ参照を返す）', () => {
  const state = makeState()
  assert.equal(undo(state), state)
})

test('resetToBaseline: assignment が baseline に戻り、履歴が空になる', () => {
  const state = makeState()
  const id = state.roster[0].id
  const otherUnit: UnitId = state.assignment[id] === 'A' ? 'B' : 'A'
  const moved = withMove(state, id, otherUnit)
  const reset = resetToBaseline(moved)
  assert.deepEqual(reset.assignment, state.baseline.assignment)
  assert.equal(reset.history.length, 0)
})

test('withAssignment: assignmentを丸ごと差し替え、直前のassignmentを履歴に積む', () => {
  const state = makeState()
  const before = state.assignment
  const swapped: Record<string, UnitId> = {}
  for (const [id, u] of Object.entries(before)) swapped[id] = u === 'A' ? 'B' : u === 'B' ? 'A' : u
  const after = withAssignment(state, swapped)
  assert.deepEqual(after.assignment, swapped)
  assert.equal(after.history.length, 1)
  assert.equal(after.history[0], before)
})

test('buildWorkbenchCards: 全社員ぶん、現在の所属・型・3事業部分の貢献度を持つ', () => {
  const state = makeState()
  const cards = buildWorkbenchCards(state)
  assert.equal(cards.length, state.roster.length)
  for (const c of cards) {
    assert.equal(c.unit, state.assignment[c.employee.id])
    assert.equal(Object.keys(c.contributions).sort().join(','), 'A,B,C')
  }
})

test('sortCards: id は社員番号の昇順（既定・§8-3）', () => {
  const state = makeState()
  const sorted = sortCards(buildWorkbenchCards(state), 'id')
  const ids = sorted.map((c) => c.employee.id)
  assert.deepEqual(ids, [...ids].sort())
})

test('sortCards: contribution は現在の所属事業部での貢献度の降順', () => {
  const state = makeState()
  const sorted = sortCards(buildWorkbenchCards(state), 'contribution')
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].contributions[sorted[i - 1].unit] >= sorted[i].contributions[sorted[i].unit])
  }
})

test('sortCards: cost は人件費の降順', () => {
  const state = makeState()
  const sorted = sortCards(buildWorkbenchCards(state), 'cost')
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].employee.cost >= sorted[i].employee.cost)
  }
})

test('sortCards: 元の配列は変更しない', () => {
  const state = makeState()
  const cards = buildWorkbenchCards(state)
  const before = cards.map((c) => c.employee.id)
  sortCards(cards, 'cost')
  assert.deepEqual(
    cards.map((c) => c.employee.id),
    before,
  )
})

test('serializeWorkbenchState: task/metric/assignment を持ち、assignment は複製である', () => {
  const state = makeState()
  const exported = serializeWorkbenchState(state)
  assert.equal(exported.task, state.task)
  assert.equal(exported.metric, state.metric)
  assert.deepEqual(exported.assignment, state.assignment)
  assert.notEqual(exported.assignment, state.assignment)
  assert.ok(!Number.isNaN(Date.parse(exported.updatedAt)))
})
