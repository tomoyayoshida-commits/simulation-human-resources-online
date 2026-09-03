// 機能15b 採用判断の作業机の表示層（docs/hiring-workbench-plan.md §5.3〜§5.11）。
// buildHiringWorkbenchHtml は純粋関数なのでDOMなしで検証できる（workbenchPanel.test.ts と同じ方針）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHiringWorkbenchHtml } from '../src/renderer/hiringWorkbenchPanel.ts'
import { withMoveTo, type HiringWorkbenchState } from '../src/renderer/hiringWorkbench.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

function emp(id: string, cost = 10): Employee {
  return { id, sales: 60, mgmt: 55, dev: 50, training: 45, cost }
}

function makeState(over: Partial<HiringWorkbenchState> = {}): HiringWorkbenchState {
  const base = [emp('E1'), emp('E2'), emp('E3'), emp('E4'), emp('E5'), emp('E6')]
  const candidates = [emp('C1', 8), emp('C2', 12)]
  const roster = [...base, ...candidates]
  const params = { ...DEFAULT_PARAMS, minHeadcount: { A: 1, B: 1, C: 1 } }
  const assignment: Record<string, UnitId> = { E1: 'A', E2: 'A', E3: 'B', E4: 'B', E5: 'C', E6: 'C' }
  const beforeBaseline = computeSimulationResult(assignment, base, params)
  return {
    task: 1,
    metric: 'revenue',
    base,
    candidates,
    roster,
    params,
    assignment,
    beforeBaseline,
    afterBaseline: computeSimulationResult({ ...assignment, C1: 'A', C2: 'B' }, roster, params),
    lockBase: true,
    branch: 'existing',
    history: [],
    ...over,
  }
}

const view = (state: HiringWorkbenchState, over: Record<string, unknown> = {}): string =>
  buildHiringWorkbenchHtml({ state, sortKey: 'id', selectedEmployeeId: null, alertText: null, ...over })

test('盤面は4列（A/B/C＋採用候補プール）', () => {
  const html = view(makeState())
  for (const slot of ['A', 'B', 'C', 'pool']) {
    assert.ok(html.includes(`data-hslot="${slot}"`), `列 ${slot} が無い`)
  }
  assert.ok(html.includes('採用候補'))
})

test('開始直後は候補がプール列に並び、採用0名と出る', () => {
  const html = view(makeState())
  assert.ok(html.includes('採用 0/2名'))
  assert.ok(html.includes('ここに残した2名は採用しない'))
})

test('候補を採用すると採用人数と追加人件費が更新される', () => {
  const html = view(withMoveTo(makeState(), 'C1', 'A'))
  assert.ok(html.includes('採用 1/2名'))
  assert.ok(html.includes('追加人件費 0.24億円'))
})

test('Δは2段（採用前比・最適解比）で出る（§5.4）', () => {
  const html = view(makeState())
  assert.ok(html.includes('採用前比'))
  assert.ok(html.includes('最適解比'))
  // 起点そのものなので採用前比は基準と同じ
  assert.ok(html.includes('採用前比 ±0.00億円（基準と同じ）'))
})

test('afterBaseline が無いと最適解比は「—」になる（§5.4）', () => {
  const html = view(makeState({ afterBaseline: null }))
  assert.ok(html.includes('最適解比 —（採用後の実行可能解なし）'))
})

test('ロック中は既存社員が draggable=false で 🔒 が付く（§5.5）', () => {
  const html = view(makeState({ lockBase: true }))
  const e1 = /<div class="[^"]*"[^>]*data-emp="E1"[^>]*>/.exec(html)
  assert.ok(e1, 'E1 のカードが見つからない')
  assert.ok(e1[0].includes('draggable="false"'))
  assert.ok(html.includes('hwb-lock-mark'))
  // 候補は動かせる
  const c1 = /<div class="[^"]*"[^>]*data-emp="C1"[^>]*>/.exec(html)
  assert.ok(c1 && c1[0].includes('draggable="true"'))
})

test('ロックを外すと既存社員も draggable=true になる', () => {
  const html = view(makeState({ lockBase: false }))
  const e1 = /<div class="[^"]*"[^>]*data-emp="E1"[^>]*>/.exec(html)
  assert.ok(e1 && e1[0].includes('draggable="true"'))
})

test('ロック中は「組み直す」が disabled（§5.6）', () => {
  const locked = /data-hwb-action="resolve"[^>]*>/.exec(view(makeState({ lockBase: true })))
  assert.ok(locked && locked[0].includes('disabled'))
  const unlocked = /data-hwb-action="resolve"[^>]*>/.exec(view(makeState({ lockBase: false })))
  assert.ok(unlocked && !unlocked[0].includes('disabled'))
})

test('制約違反があっても保存ボタンは disabled にしない（§5.9・機能16へ門を譲った）', () => {
  const s = makeState()
  const lowRoster = s.roster.map((e) => ({ ...e, sales: 1, mgmt: 1, dev: 1, training: 1 }))
  const violating = { ...s, roster: lowRoster, base: lowRoster.slice(0, 6), candidates: lowRoster.slice(6) }
  const html = view(violating)
  const saveBtn = /data-hwb-action="save"[^>]*>/.exec(html)
  assert.ok(saveBtn && !saveBtn[0].includes('disabled'))
  assert.ok(!html.includes('data-hwb-action="csv"'))
  assert.ok(!html.includes('CSV出力'))
})

test('分岐で見出しと固定チェックボックスが変わる（§5.1・§5.5）', () => {
  const existing = view(makeState({ branch: 'existing' }))
  assert.ok(existing.includes('現行配置を起点'))
  assert.ok(existing.includes('id="hwb-lock"'))
  // 分岐2は起点が最適解なので「固定する」の意味が無い
  const optimal = view(makeState({ branch: 'optimal' }))
  assert.ok(optimal.includes('採用前の最適解を起点'))
  assert.ok(!optimal.includes('id="hwb-lock"'))
})

test('内訳に採用・見送りが出る（§5.8）', () => {
  const hired = view(withMoveTo(makeState(), 'C1', 'B'))
  assert.ok(hired.includes('採用→B 1名'))
  const start: Record<string, UnitId> = { E1: 'A', E2: 'A', E3: 'B', E4: 'B', E5: 'C', E6: 'C', C1: 'A' }
  const s = makeState({ assignment: start })
  const declined = view(withMoveTo({ ...s, beforeBaseline: computeSimulationResult(start, s.roster, s.params) }, 'C1', 'pool'))
  assert.ok(declined.includes('A→見送り 1名'))
})

test('プールのカードは3事業部ぶんの貢献度を並べる（所属が無いため・§5.3）', () => {
  const html = view(makeState())
  assert.ok(html.includes('hwb-card-pool'))
})

test('社員番号のHTMLはエスケープされる（CLAUDE.md §8）', () => {
  const base = [emp('<script>alert(1)</script>'), emp('E2'), emp('E3'), emp('E4'), emp('E5'), emp('E6')]
  const candidates = [emp('C1'), emp('C2')]
  const roster = [...base, ...candidates]
  const params = { ...DEFAULT_PARAMS, minHeadcount: { A: 1, B: 1, C: 1 } }
  const assignment: Record<string, UnitId> = {
    '<script>alert(1)</script>': 'A', E2: 'A', E3: 'B', E4: 'B', E5: 'C', E6: 'C',
  }
  const html = view(makeState({ base, candidates, roster, assignment, beforeBaseline: computeSimulationResult(assignment, base, params), afterBaseline: null }))
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})
