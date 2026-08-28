// 4課題横断比較（#p4）のカード生成テスト。
// 描画はDOMに依存するが、HTML生成は buildCompareGridHtml に切り出してあるので単体で検証できる。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompareGridHtml, type TaskResults } from '../src/renderer/compareTasks.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { TASK_IDS } from '../src/renderer/constants.ts'
import type { Employee, SimulationResult, UnitId } from '../src/renderer/types.ts'

/** 制約を満たす程度に能力の高い人員を作り、A/B/C に配る */
function makeResult(counts: { A: number; B: number; C: number }): SimulationResult {
  const employees: Employee[] = []
  const assignment: Record<string, UnitId> = {}
  let n = 0
  for (const u of ['A', 'B', 'C'] as UnitId[]) {
    for (let i = 0; i < counts[u]; i++) {
      const id = `E${String(++n).padStart(3, '0')}`
      employees.push({ id, sales: 70, mgmt: 65, dev: 60, training: 55, cost: 8 })
      assignment[id] = u
    }
  }
  return computeSimulationResult(assignment, employees)
}

function feasibleResults(): TaskResults {
  return {
    1: makeResult({ A: 40, B: 35, C: 25 }),
    2: makeResult({ A: 47, B: 41, C: 12 }),
    3: makeResult({ A: 41, B: 49, C: 10 }),
    4: makeResult({ A: 40, B: 35, C: 25 }),
  }
}

test('buildCompareGridHtml: 4課題分のカードを生成する', () => {
  const results = feasibleResults()
  const html = buildCompareGridHtml(results, results[1] as SimulationResult, 'profit')
  assert.equal(html.match(/class="compare-card"/g)?.length, 4)
  for (const t of TASK_IDS) assert.ok(html.includes(`課題${t}`), `課題${t}のバッジ`)
})

test('buildCompareGridHtml: 実行不能の課題は専用カードになる', () => {
  const results = feasibleResults()
  results[3] = { infeasible: true, reason: 'revenue_floor' }
  const html = buildCompareGridHtml(results, results[1] as SimulationResult, 'profit')
  assert.ok(html.includes('● 実行不能'))
  // 実行不能カードは border-color を critical にする（他3枚は通常カード）
  assert.equal(html.match(/border-color:var\(--critical\)/g)?.length, 1)
})

test('buildCompareGridHtml: バー表示モードでラベルとスケールが切り替わる', () => {
  const results = feasibleResults()
  const baseline = results[1] as SimulationResult
  const profit = buildCompareGridHtml(results, baseline, 'profit')
  const revenue = buildCompareGridHtml(results, baseline, 'revenue')

  assert.ok(profit.includes('事業部別利益') && !profit.includes('事業部別売上'))
  assert.ok(revenue.includes('事業部別売上') && !revenue.includes('事業部別利益'))
  // 利益は固定スケール30億、売上は4課題×3事業部の最大値から算出するので別の値になる
  assert.ok(profit.includes('共通スケール 0〜30.00億円'))
  assert.ok(!revenue.includes('共通スケール 0〜30.00億円'))
})

test('buildCompareGridHtml: 同じ入力なら同じHTMLになる（モジュール状態に依存しない）', () => {
  const results = feasibleResults()
  const baseline = results[1] as SimulationResult
  const first = buildCompareGridHtml(results, baseline, 'revenue')
  // 別モードを1度挟んでも結果が変わらないこと（以前はモジュール変数を読んでいた）
  buildCompareGridHtml(results, baseline, 'profit')
  assert.equal(buildCompareGridHtml(results, baseline, 'revenue'), first)
})
