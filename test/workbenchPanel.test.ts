// docs/workbench-plan.md §5 Phase3: 機能15 作業机パネルのHTML生成テスト（node:test）
// 描画はDOMに依存するが、HTML生成は buildWorkbenchHtml に切り出してあるので単体で検証できる。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkbenchHtml } from '../src/renderer/workbenchPanel.ts'
import { computeSimulationResult, contribution } from '../src/renderer/calcEngine.ts'
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

// ---- 能力バー（docs/ability-bars-plan.md §5 受入基準）----

/** 能力バーの (バー全長, 濃い部分の割合) を出現順に拾う。1枚のカードにつき4組。 */
function abilityBars(html: string): { fill: number; part: number | null }[] {
  return [...html.matchAll(/wb-abil-fill" style="width:([\d.]+)%;">(?:<b class="wb-abil-part" style="width:([\d.]+)%)?/g)].map(
    (m) => ({ fill: Number(m[1]), part: m[2] === undefined ? null : Number(m[2]) }),
  )
}

test('buildWorkbenchHtml: 既定で能力バーが出て、幅が能力値と重みに一致する（受入基準1〜3）', () => {
  const html = buildWorkbenchHtml({ state: makeState(), sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const bars = abilityBars(html).slice(0, 4)
  // fixture は全員 営70/管65/開60/育55、先頭カードはA事業部（重み .45/.35/.10/.10）
  assert.deepEqual(
    bars,
    [
      { fill: 70, part: 45 },
      { fill: 65, part: 35 },
      { fill: 60, part: 10 },
      { fill: 55, part: 10 },
    ],
  )
})

// 案③の要：濃い部分の絶対長を4本足すと貢献度になる（重みの合計が1.00のため）。
// この対応が崩れると「バーを見れば貢献度が分かる」という説明そのものが嘘になるので、
// 幅の一致（上のテスト）とは別に、合計側からも押さえる。
test('buildWorkbenchHtml: 濃い部分の長さの合計が貢献度と一致する（§3.1）', () => {
  const state = makeState()
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const bars = abilityBars(html).slice(0, 4)
  const sum = bars.reduce((s, b) => s + (b.fill * (b.part ?? 0)) / 100, 0)
  assert.equal(sum, contribution(state.roster[0], 'A', state.params))
})

test('buildWorkbenchHtml: 濃淡は DEFAULT_PARAMS ではなく state.params.weights を見る（受入基準3）', () => {
  const params = {
    ...DEFAULT_PARAMS,
    weights: { ...DEFAULT_PARAMS.weights, A: { sales: 0.7, mgmt: 0.1, dev: 0.1, training: 0.1 } },
  }
  const state = makeState({ params })
  const html = buildWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null })
  const bars = abilityBars(html).slice(0, 4)
  assert.deepEqual(bars.map((b) => b.part), [70, 10, 10, 10])
  const sum = bars.reduce((s, b) => s + (b.fill * (b.part ?? 0)) / 100, 0)
  assert.equal(sum, contribution(state.roster[0], 'A', params))
})

test('buildWorkbenchHtml: showAbilities:false でバーが1本も出ない（受入基準5）', () => {
  const html = buildWorkbenchHtml({
    state: makeState(),
    sortKey: 'id',
    selectedEmployeeId: null,
    alertText: null,
    showAbilities: false,
  })
  assert.ok(!html.includes('wb-abil'))
})
