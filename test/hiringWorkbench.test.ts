// 機能15b 採用判断の作業机（docs/hiring-workbench-plan.md §6 Phase2）の純粋関数テスト。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addedCost,
  buildHiringCards,
  canMove,
  canPlace,
  currentSlot,
  isCandidate,
  declinedCandidates,
  diffWithPool,
  evaluateHiring,
  hiredCandidates,
  moveEmployeeTo,
  previewMoveTo,
  resetToStart,
  serializeHiringWorkbenchState,
  undo,
  withMoveTo,
  type HiringWorkbenchState,
} from '../src/renderer/hiringWorkbench.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { COST_UNIT_DIVISOR, DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

function emp(id: string, cost = 10): Employee {
  return { id, sales: 60, mgmt: 55, dev: 50, training: 45, cost }
}

/** 既存6名（A2/B2/C2）＋候補2名（プール）。最低人数は 1/1/1 に緩めて盤面の挙動だけを見る。 */
function makeState(over: Partial<HiringWorkbenchState> = {}): HiringWorkbenchState {
  const base = [emp('E1'), emp('E2'), emp('E3'), emp('E4'), emp('E5'), emp('E6')]
  const candidates = [emp('C1', 8), emp('C2', 12)]
  const roster = [...base, ...candidates]
  const params = { ...DEFAULT_PARAMS, minHeadcount: { A: 1, B: 1, C: 1 } }
  const assignment: Record<string, UnitId> = { E1: 'A', E2: 'A', E3: 'B', E4: 'B', E5: 'C', E6: 'C' }
  return {
    task: 1,
    metric: 'revenue',
    base,
    candidates,
    roster,
    params,
    assignment,
    beforeBaseline: computeSimulationResult(assignment, base, params),
    afterBaseline: null,
    lockBase: true,
    branch: 'existing',
    history: [],
    ...over,
  }
}

// ---- プール（未採用）の表現 ----

test('開始直後は候補が全員プールにいる', () => {
  const s = makeState()
  assert.equal(currentSlot(s, 'C1'), 'pool')
  assert.equal(currentSlot(s, 'C2'), 'pool')
  assert.equal(currentSlot(s, 'E1'), 'A')
  assert.deepEqual(declinedCandidates(s).map((e) => e.id), ['C1', 'C2'])
  assert.deepEqual(hiredCandidates(s), [])
})

test('候補を採用すると assignment にキーが増え、人数と全社売上が上がる', () => {
  const s = makeState()
  const before = evaluateHiring(s)
  const next = withMoveTo(s, 'C1', 'A')
  const after = evaluateHiring(next)
  assert.equal(currentSlot(next, 'C1'), 'A')
  assert.equal(after.result.headcount.A, before.result.headcount.A + 1)
  assert.ok(after.result.companyRevenue > before.result.companyRevenue)
})

test('プールに戻すと assignment からキーが消え、人件費が利益に戻る（§2.2）', () => {
  const s = makeState()
  const hired = withMoveTo(s, 'C1', 'A')
  const back = withMoveTo(hired, 'C1', 'pool')
  assert.equal(back.assignment.C1, undefined)
  assert.ok(!('C1' in back.assignment))
  assert.equal(addedCost(back), 0)
  // 起点と同じ配置に戻っているので全社利益も一致する
  assert.equal(evaluateHiring(back).result.companyProfit, evaluateHiring(s).result.companyProfit)
})

test('未採用者は人件費に加算されない（プール1名の有無で利益が変わる）', () => {
  const s = makeState()
  const withC1 = withMoveTo(s, 'C1', 'A')
  const withBoth = withMoveTo(withC1, 'C2', 'A')
  const c1 = evaluateHiring(withC1).result.units.A.costTotal
  const c2 = evaluateHiring(withBoth).result.units.A.costTotal
  assert.ok(c2 > c1, `costTotal が増えるはず: ${c1} → ${c2}`)
  // プールに残した候補の人件費は入っていない
  assert.equal(c2 - c1, Math.round((12 * DEFAULT_PARAMS.costMultiplier) / COST_UNIT_DIVISOR * 100) / 100)
})

// ---- 追加人件費（換算） ----

test('addedCost が compareHiring と同じ換算になる（CLAUDE.md §8）', () => {
  const s = withMoveTo(withMoveTo(makeState(), 'C1', 'A'), 'C2', 'B')
  const expected = (8 * s.params.costMultiplier + 12 * s.params.costMultiplier) / COST_UNIT_DIVISOR
  assert.equal(addedCost(s), Math.round(expected * 100) / 100)
})

test('addedCost は採用した候補だけを数える（既存100名は含めない）', () => {
  const s = withMoveTo(makeState(), 'C1', 'A')
  assert.equal(addedCost(s), Math.round((8 * s.params.costMultiplier) / COST_UNIT_DIVISOR * 100) / 100)
})

// ---- ロック（§5.5） ----

test('ロック中は既存社員を動かせない', () => {
  const s = makeState({ lockBase: true })
  assert.equal(canMove(s, 'E1'), false)
  assert.equal(canMove(s, 'C1'), true)
  const next = withMoveTo(s, 'E1', 'C')
  assert.equal(next, s)
  assert.equal(next.assignment.E1, 'A')
})

test('ロックを外すと既存社員が動かせる', () => {
  const s = makeState({ lockBase: false })
  assert.equal(canMove(s, 'E1'), true)
  assert.equal(withMoveTo(s, 'E1', 'C').assignment.E1, 'C')
})

// ---- 既存社員をプールへ落とせない＝解雇は扱わない（§5.5.1） ----

test('ロック中は既存社員をプールへも落とせない', () => {
  const s = makeState({ lockBase: true })
  assert.equal(withMoveTo(s, 'E1', 'pool'), s)
})

test('ロックを外しても既存社員はプールへ落とせない（解雇は扱わない）', () => {
  const s = makeState({ lockBase: false })
  // 事業部間の異動はできる
  assert.equal(withMoveTo(s, 'E1', 'C').assignment.E1, 'C')
  // プールへは落とせない
  assert.equal(canPlace(s, 'E1', 'pool'), false)
  assert.equal(withMoveTo(s, 'E1', 'pool'), s)
  assert.equal(moveEmployeeTo(s, 'E1', 'pool'), s.assignment)
  assert.equal(s.assignment.E1, 'A')
})

test('候補はロックを外してもプールへ戻せる（採用の取り消し）', () => {
  const s = withMoveTo(makeState({ lockBase: false }), 'C1', 'A')
  assert.equal(canPlace(s, 'C1', 'pool'), true)
  assert.equal(withMoveTo(s, 'C1', 'pool').assignment.C1, undefined)
})

test('canPlace: 事業部への移動は canMove と一致する（プール以外は制限しない）', () => {
  const locked = makeState({ lockBase: true })
  assert.equal(canPlace(locked, 'E1', 'B'), false)
  assert.equal(canPlace(locked, 'C1', 'B'), true)
  const open = makeState({ lockBase: false })
  assert.equal(canPlace(open, 'E1', 'B'), true)
})

test('isCandidate: 既存社員と候補を見分ける', () => {
  const s = makeState()
  assert.equal(isCandidate(s, 'C1'), true)
  assert.equal(isCandidate(s, 'E1'), false)
  assert.equal(isCandidate(s, 'X999'), false)
})

test('全員をプールへ落とそうとしても既存6名は残る（100名を候補に突っ込めない）', () => {
  let s = makeState({ lockBase: false })
  for (const e of s.roster) s = withMoveTo(s, e.id, 'pool')
  assert.equal(hiredCandidates(s).length, 0)
  // 既存6名は事業部に残ったまま
  for (const e of s.base) assert.ok(s.assignment[e.id] !== undefined, `${e.id} が消えた`)
  assert.equal(evaluateHiring(s).result.headcount.A + evaluateHiring(s).result.headcount.B + evaluateHiring(s).result.headcount.C, 6)
})

test('roster にいない社員IDでは状態が変わらない', () => {
  const s = makeState()
  assert.equal(withMoveTo(s, 'X999', 'A'), s)
  assert.equal(moveEmployeeTo(s, 'X999', 'A'), s.assignment)
})

// ---- 元を破壊しない・履歴 ----

test('moveEmployeeTo は新しいオブジェクトを返し、元の assignment を破壊しない', () => {
  const s = makeState()
  const snapshot = { ...s.assignment }
  const next = moveEmployeeTo(s, 'C1', 'B')
  assert.notEqual(next, s.assignment)
  assert.deepEqual(s.assignment, snapshot)
  assert.equal(next.C1, 'B')
})

test('同じ列へ動かしても履歴は増えない', () => {
  const s = withMoveTo(makeState(), 'C1', 'A')
  assert.equal(withMoveTo(s, 'C1', 'A'), s)
})

test('undo で1手戻る。履歴が空なら何もしない', () => {
  const s = makeState()
  const moved = withMoveTo(s, 'C1', 'A')
  const back = undo(moved)
  assert.deepEqual(back.assignment, s.assignment)
  assert.equal(undo(s), s)
})

test('resetToStart で候補が全員プールへ帰り、履歴が空になる', () => {
  let s = makeState()
  s = withMoveTo(s, 'C1', 'A')
  s = withMoveTo(s, 'C2', 'B')
  const reset = resetToStart(s)
  assert.deepEqual(reset.assignment, makeState().assignment)
  assert.deepEqual(reset.history, [])
  assert.equal(hiredCandidates(reset).length, 0)
})

// ---- previewMoveTo（§5.9 のプレビュー） ----

test('previewMoveTo は「実際に動かしてから評価」と一致する', () => {
  const s = makeState()
  const preview = previewMoveTo(s, 'C1', 'C')
  const actual = evaluateHiring(withMoveTo(s, 'C1', 'C')).result
  assert.equal(preview.companyRevenue, actual.companyRevenue)
  assert.equal(preview.companyProfit, actual.companyProfit)
  // プレビューは状態を変えない
  assert.equal(currentSlot(s, 'C1'), 'pool')
})

// ---- 最低人数の警告（§5.9・whatif の判定をそのまま使う） ----

test('最低人数を割ると minHeadcountViolations に事業部が出る（ブロックはしない）', () => {
  const s = makeState({ lockBase: false, params: { ...DEFAULT_PARAMS, minHeadcount: { A: 1, B: 1, C: 2 } } })
  const moved = withMoveTo(s, 'E5', 'A')
  assert.deepEqual(evaluateHiring(moved).minHeadcountViolations, ['C'])
  // 操作自体は成立している
  assert.equal(moved.assignment.E5, 'A')
})

// ---- diffWithPool（§5.8・§2.5 の穴をふさぐ） ----

test('diffWithPool: 採用を hire として拾う（whatif.diffAssignment が落とすケース）', () => {
  const s = withMoveTo(makeState(), 'C1', 'B')
  const diffs = diffWithPool(s.beforeBaseline.assignment, s.assignment, s.roster)
  assert.deepEqual(diffs, [{ kind: 'hire', to: 'B', count: 1 }])
})

test('diffWithPool: 見送りを decline として拾う', () => {
  const start: Record<string, UnitId> = { ...makeState().assignment, C1: 'A' }
  const s = makeState({ assignment: start })
  const declined = withMoveTo(s, 'C1', 'pool')
  const diffs = diffWithPool(start, declined.assignment, s.roster)
  assert.deepEqual(diffs, [{ kind: 'decline', from: 'A', count: 1 }])
})

test('diffWithPool: 事業部間の異動は move として集計する', () => {
  const s = makeState({ lockBase: false })
  const moved = withMoveTo(withMoveTo(s, 'E1', 'C'), 'E2', 'C')
  const diffs = diffWithPool(s.assignment, moved.assignment, s.roster)
  assert.deepEqual(diffs, [{ kind: 'move', from: 'A', to: 'C', count: 2 }])
})

test('diffWithPool: 変化が無ければ空配列', () => {
  const s = makeState()
  assert.deepEqual(diffWithPool(s.assignment, s.assignment, s.roster), [])
})

// ---- カード ----

test('buildHiringCards: プールの候補は unit が null・既存社員は locked', () => {
  const cards = buildHiringCards(makeState())
  const c1 = cards.find((c) => c.employee.id === 'C1')!
  const e1 = cards.find((c) => c.employee.id === 'E1')!
  assert.equal(c1.unit, null)
  assert.equal(c1.isCandidate, true)
  assert.equal(c1.locked, false)
  assert.equal(e1.unit, 'A')
  assert.equal(e1.isCandidate, false)
  assert.equal(e1.locked, true)
})

test('buildHiringCards: 貢献度は3事業部ぶん揃う（所属に依存しない）', () => {
  const cards = buildHiringCards(makeState())
  for (const c of cards) {
    assert.equal(Object.keys(c.contributions).length, 3)
    for (const u of ['A', 'B', 'C'] as UnitId[]) assert.ok(Number.isFinite(c.contributions[u]))
  }
})

// ---- 保存フォーマット（§5.11） ----

test('serializeHiringWorkbenchState: hiredIds/declinedIds が assignment と整合する', () => {
  const s = withMoveTo(makeState(), 'C1', 'A')
  const ex = serializeHiringWorkbenchState(s)
  assert.equal(ex.kind, 'hiring')
  assert.deepEqual(ex.hiredIds, ['C1'])
  assert.deepEqual(ex.declinedIds, ['C2'])
  assert.equal(ex.assignment.C1, 'A')
  assert.ok(!('C2' in ex.assignment))
  assert.equal(ex.lockBase, true)
  assert.equal(ex.branch, 'existing')
})

test('serializeHiringWorkbenchState: assignment は複製され、後の操作に追随しない', () => {
  const s = withMoveTo(makeState(), 'C1', 'A')
  const ex = serializeHiringWorkbenchState(s)
  withMoveTo(s, 'C2', 'B')
  assert.ok(!('C2' in ex.assignment))
})
