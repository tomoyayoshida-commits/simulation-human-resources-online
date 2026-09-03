// docs/workbench-plan.md §5 Phase3: 機能15 作業机パネルのHTML生成テスト（node:test）
// 描画はDOMに依存するが、HTML生成は buildWorkbenchHtml に切り出してあるので単体で検証できる。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkbenchHtml } from '../src/renderer/workbenchPanel.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import type { WorkbenchState } from '../src/renderer/workbench.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

/** 課題1・適正人数(40/35/25)ちょうど・全社売上58億円超の作業机初期状態（baseline=assignment）。 */
function makeState(overrides: Partial<WorkbenchState> = {}): WorkbenchState {
  const employees: Employee[] = []
  const assignment: Record<string, UnitId> = {}
  const counts = { A: 40, B: 35, C: 25 }
  let n = 0
  for (const u of ['A', 'B', 'C'] as UnitId[]) {
    for (let i = 0; i < counts[u]; i++) {
      const id = `E${String(++n).padStart(3, '0')}`
      employees.push({ id, sales: 70, mgmt: 65, dev: 60, training: 55, cost: 8 })
      assignment[id] = u
    }
  }
  const baseline = computeSimulationResult(assignment, employees)
  assert.ok(baseline.companyRevenue > DEFAULT_PARAMS.prevYearRevenue, 'fixtureは可行であること')
  return {
    task: 1,
    metric: 'revenue',
    roster: employees,
    params: DEFAULT_PARAMS,
    assignment: { ...assignment },
    baseline,
    history: [],
    ...overrides,
  }
}

test('buildWorkbenchHtml: 社員番号の<script>がタグとして解釈されない（CLAUDE.md §8）', () => {
  const employees: Employee[] = [
    { id: '<script>alert(1)</script>', sales: 70, mgmt: 65, dev: 60, training: 55, cost: 8 },
    { id: 'E002', sales: 70, mgmt: 65, dev: 60, training: 55, cost: 8 },
    { id: 'E003', sales: 70, mgmt: 65, dev: 60, training: 55, cost: 8 },
  ]
  const assignment: Record<string, UnitId> = { [employees[0].id]: 'A', E002: 'B', E003: 'C' }
  const baseline = computeSimulationResult(assignment, employees)
  const state: WorkbenchState = {
    task: 1,
    metric: 'revenue',
    roster: employees,
    params: DEFAULT_PARAMS,
    assignment,
    baseline,
    history: [],
  }
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

// 出力は作業机から切り離した（docs/export-plan.md §4.1）。作業机が持つのは保存だけで、
// 制約違反の門は出力側（#p7）へ移した（§4.5）。ここでは「違反していても保存はできる」ことを守る。
test('buildWorkbenchHtml: 作業机に出力ボタンが無い（export-plan.md §4.1・受入基準1）', () => {
  const state = makeState()
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(!html.includes('data-wb-action="csv"'))
  assert.ok(!html.includes('CSV出力'))
  assert.ok(html.includes('data-wb-action="save"'))
})

test('buildWorkbenchHtml: 制約違反があっても保存ボタンはdisabledでない（export-plan.md §4.5）', () => {
  const state = makeState()
  const lowRoster = state.roster.map((e) => ({ ...e, sales: 1, mgmt: 1, dev: 1, training: 1 }))
  const lowBaseline = computeSimulationResult(state.assignment, lowRoster)
  const violating: WorkbenchState = { ...state, roster: lowRoster, baseline: lowBaseline }
  const html = buildWorkbenchHtml({ state: violating, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const saveBtn = /data-wb-action="save"[^>]*>/.exec(html)
  assert.ok(saveBtn && !saveBtn[0].includes('disabled'))
})

test('buildWorkbenchHtml: savingTitle が null なら命名フォームは閉じている（§4.8）', () => {
  const state = makeState()
  const closed = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(!closed.includes('wb-save-form'))

  const open = buildWorkbenchHtml({
    state,
    sortKey: 'id',
    selectedEmployeeId: null,
    alertText: null,
    savingTitle: '課題1 配置案 2026-09-03',
  })
  assert.ok(open.includes('wb-save-form'))
  assert.ok(open.includes('value="課題1 配置案 2026-09-03"'))
  // フォームを開いている間は保存ボタン自体を止め、二重に開かせない
  assert.ok(/data-wb-action="save"[^>]*disabled/.test(open))
})

test('buildWorkbenchHtml: 命名フォームの既定値がタグとして解釈されない（CLAUDE.md §8）', () => {
  const state = makeState()
  const html = buildWorkbenchHtml({
    state,
    sortKey: 'id',
    selectedEmployeeId: null,
    alertText: null,
    savingTitle: '"><script>alert(1)</script>',
  })
  assert.ok(!html.includes('"><script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('buildWorkbenchHtml: alertTextがあれば警告バナーを表示、無ければ表示しない（§8-1）', () => {
  const state = makeState()
  const withAlert = buildWorkbenchHtml({
    state,
    sortKey: 'id',
    selectedEmployeeId: null,
    alertText: '最低人数を割りました（A）',
  })
  assert.ok(withAlert.includes('wb-alert-banner'))
  assert.ok(withAlert.includes('最低人数を割りました'))
  const withoutAlert = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(!withoutAlert.includes('wb-alert-banner'))
})

test('buildWorkbenchHtml: selectedEmployeeId に一致するカードに selected クラスが付く', () => {
  const state = makeState()
  const id = state.roster[0].id
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: id, alertText: null })
  // 顔写真ON（既定・docs/profile-plan.md §8-5）のときは後ろに with-photo が付くため、
  // クラス属性の完全一致ではなく selected が付いていることを見る。
  assert.match(html, new RegExp(`class="wb-card selected[^"]*" draggable="true" data-emp="${id}"`))
})

test('buildWorkbenchHtml: 選択中のソートキーの option に selected が付く', () => {
  const state = makeState()
  const html = buildWorkbenchHtml({ state, sortKey: 'cost', selectedEmployeeId: null, alertText: null })
  assert.ok(/<option value="cost" selected>/.test(html))
  assert.ok(!/<option value="id" selected>/.test(html))
})

test('buildWorkbenchHtml: assignment が baseline と同じとき全指標のΔが0.00（受入基準5）', () => {
  const state = makeState()
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const zeroDeltas = html.match(/±0\.00億円（基準と同じ）/g) ?? []
  // 全社売上・全社利益・A/B/C の売上 = 5箇所
  assert.equal(zeroDeltas.length, 5)
})

test('buildWorkbenchHtml: 履歴が空なら「元に戻す」がdisabled、あればdisabledでない', () => {
  const state = makeState()
  const empty = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(/data-wb-action="undo"[^>]*disabled/.test(empty))

  const withHistory: WorkbenchState = { ...state, history: [state.assignment] }
  const html = buildWorkbenchHtml({ state: withHistory, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const btn = /data-wb-action="undo"[^>]*>/.exec(html)
  assert.ok(btn && !btn[0].includes('disabled'))
})

test('buildWorkbenchHtml: 最低人数を割った事業部に警告表示が出る（§4.6）', () => {
  const state = makeState()
  const assignment = { ...state.assignment }
  let movedA = 0
  for (const id of Object.keys(assignment)) {
    if (assignment[id] === 'A' && movedA < 11) {
      assignment[id] = 'C'
      movedA++
    }
  }
  const violating: WorkbenchState = { ...state, assignment }
  const html = buildWorkbenchHtml({ state: violating, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  assert.ok(html.includes('最低人数割れ'))
  assert.ok(html.includes('⚠ 最低30名'))
})
