// 4課題横断比較（#p4）のカード生成テスト。
// 描画はDOMに依存するが、HTML生成は buildCompareGridHtml に切り出してあるので単体で検証できる。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type AllTaskResults,
  buildCompareGridHtml,
  metricFor,
  type OptimizePolicy,
  selectResults,
} from '../src/renderer/compareTasks.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { TASK_IDS } from '../src/renderer/constants.ts'
import type { Employee, SimulationResult, TaskId, UnitId } from '../src/renderer/types.ts'

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

/**
 * (課題 × 指標) 8通りの結果。方針の違いが見えるよう、売上版と利益版で別の人数配分にしてある
 * （実際の最適化でも指標を変えると配分が動く。課題2で 47/41/12 → 53/37/10 など）。
 */
function feasibleAll(): AllTaskResults {
  return {
    1: { revenue: makeResult({ A: 40, B: 35, C: 25 }), profit: makeResult({ A: 40, B: 35, C: 25 }) },
    2: { revenue: makeResult({ A: 53, B: 37, C: 10 }), profit: makeResult({ A: 47, B: 41, C: 12 }) },
    3: { revenue: makeResult({ A: 41, B: 49, C: 10 }), profit: makeResult({ A: 42, B: 48, C: 10 }) },
    4: { revenue: makeResult({ A: 40, B: 35, C: 25 }), profit: makeResult({ A: 39, B: 36, C: 25 }) },
  }
}

/** 指定課題のカードから見出し（指標名と大きな数字）を取り出す */
function primaryOf(html: string, task: TaskId): { label: string; value: string } {
  const card = html.split('class="compare-card"')[task]
  const label = /<div class="k">([^<]*)<\/div>/.exec(card)
  const value = /<div class="v"[^>]*>(-?[\d.]+)<span class="unit">/.exec(card)
  assert.ok(label && value, `課題${task}の見出しが取れる`)
  return { label: label[1], value: value[1] }
}

/** 指定課題のカードの課題名（見出しの h4） */
function taskTitleOf(html: string, task: TaskId): string {
  const card = html.split('class="compare-card"')[task]
  const m = /<h4>([^<]*)<\/h4>/.exec(card)
  assert.ok(m, `課題${task}の課題名が取れる`)
  return m[1]
}

test('metricFor: 原文どおりは課題2だけ利益、揃える方針では全課題が同じ指標', () => {
  assert.deepEqual(TASK_IDS.map((t) => metricFor(t, 'original')), ['revenue', 'profit', 'revenue', 'revenue'])
  assert.deepEqual(TASK_IDS.map((t) => metricFor(t, 'revenue')), ['revenue', 'revenue', 'revenue', 'revenue'])
  assert.deepEqual(TASK_IDS.map((t) => metricFor(t, 'profit')), ['profit', 'profit', 'profit', 'profit'])
})

test('selectResults: 方針ごとに (課題 × 指標) の表から正しい1枚を選ぶ', () => {
  const all = feasibleAll()
  const original = selectResults(all, 'original')
  // 原文どおりでは課題2だけが利益版、他は売上版
  assert.equal(original[1], all[1].revenue)
  assert.equal(original[2], all[2].profit)
  assert.equal(original[3], all[3].revenue)
  assert.equal(original[4], all[4].revenue)
  // 「すべて売上」では課題2も売上版に替わる（＝原文と違う配置になる）
  assert.equal(selectResults(all, 'revenue')[2], all[2].revenue)
  assert.equal(selectResults(all, 'profit')[3], all[3].profit)
})

test('buildCompareGridHtml: 4課題分のカードを生成する', () => {
  const html = buildCompareGridHtml(feasibleAll(), 'profit', 'original')
  assert.equal(html.match(/class="compare-card"/g)?.length, 4)
  for (const t of TASK_IDS) assert.ok(html.includes(`課題${t}`), `課題${t}のバッジ`)
})

test('buildCompareGridHtml: 実行不能の課題は専用カードになる', () => {
  const all = feasibleAll()
  all[3].revenue = { infeasible: true, reason: 'revenue_floor' }
  const html = buildCompareGridHtml(all, 'profit', 'original')
  assert.ok(html.includes('● 実行不能'))
  // 実行不能カードは border-color を critical にする（他3枚は通常カード）
  assert.equal(html.match(/border-color:var\(--critical\)/g)?.length, 1)
  // 同じ課題3でも「すべて利益」方針では利益版を引くので実行不能にならない
  assert.ok(!buildCompareGridHtml(all, 'profit', 'profit').includes('● 実行不能'))
})

test('buildCompareGridHtml: バー表示モードでラベルとスケールが切り替わる', () => {
  const all = feasibleAll()
  const profit = buildCompareGridHtml(all, 'profit', 'original')
  const revenue = buildCompareGridHtml(all, 'revenue', 'original')

  assert.ok(profit.includes('事業部別利益') && !profit.includes('事業部別売上'))
  assert.ok(revenue.includes('事業部別売上') && !revenue.includes('事業部別利益'))
  // 利益は固定スケール30億、売上は4課題×3事業部の最大値から算出するので別の値になる
  assert.ok(profit.includes('共通スケール 0〜30.00億円'))
  assert.ok(!revenue.includes('共通スケール 0〜30.00億円'))
})

test('buildCompareGridHtml: モード切替で見出しのラベルと数値も切り替わる', () => {
  const all = feasibleAll()
  const profit = buildCompareGridHtml(all, 'profit', 'original')
  const revenue = buildCompareGridHtml(all, 'revenue', 'original')
  const r1 = all[1].revenue as SimulationResult
  const r2 = all[2].profit as SimulationResult

  // 対象範囲（課題1=全社／課題2=A事業部）は課題固定、指標だけが表示モードに追随する
  assert.equal(primaryOf(revenue, 1).label, '全社売上')
  assert.equal(primaryOf(profit, 1).label, '全社利益')
  assert.equal(primaryOf(profit, 2).label, 'A事業部利益')
  assert.equal(primaryOf(revenue, 2).label, 'A事業部売上')

  // 数値もラベルと同じ指標を指している
  assert.equal(primaryOf(profit, 1).value, r1.companyProfit.toFixed(2))
  assert.equal(primaryOf(revenue, 1).value, r1.companyRevenue.toFixed(2))
  assert.equal(primaryOf(profit, 2).value, r2.units.A.profit.toFixed(2))
  assert.equal(primaryOf(revenue, 2).value, r2.units.A.finalRevenue.toFixed(2))
})

test('buildCompareGridHtml: 最適化方針で課題名と参照する結果が切り替わる', () => {
  const all = feasibleAll()
  const original = buildCompareGridHtml(all, 'profit', 'original')
  const allRevenue = buildCompareGridHtml(all, 'profit', 'revenue')
  const allProfit = buildCompareGridHtml(all, 'profit', 'profit')

  // 課題名が実際に最適化した指標を名乗る（原文では課題2だけ利益）
  assert.equal(taskTitleOf(original, 2), 'A事業部利益最大化')
  assert.equal(taskTitleOf(allRevenue, 2), 'A事業部売上最大化')
  assert.equal(taskTitleOf(original, 3), 'B事業部売上最大化')
  assert.equal(taskTitleOf(allProfit, 3), 'B事業部利益最大化')

  // 参照する結果も切り替わる（課題2の人数配分が 47/41/12 → 53/37/10）
  assert.ok(original.includes('47名') && !original.includes('53名'))
  assert.ok(allRevenue.includes('53名') && !allRevenue.includes('47名'))
})

test('buildCompareGridHtml: 「すべて利益」では課題1に売上最大化と同じ配置になる旨を書く', () => {
  // 全社コストが配置によらず一定なので課題1だけ方針で解が動かない。
  // 切り替えても数字が変わらないのを不具合と誤読されないよう明示する。
  const all = feasibleAll()
  const note = '利益で最大化しても売上最大化と同じ配置になる'
  assert.ok(buildCompareGridHtml(all, 'profit', 'profit').includes(note))
  assert.ok(!buildCompareGridHtml(all, 'profit', 'original').includes(note))
})

test('buildCompareGridHtml: 前年度比は全社売上を見ているときだけ出す', () => {
  const all = feasibleAll()
  // 前年度実績として持っているのは売上のみ。利益表示で前年度比を出すと比較対象が食い違う
  assert.ok(buildCompareGridHtml(all, 'revenue', 'original').includes('前年度比'))
  assert.ok(!buildCompareGridHtml(all, 'profit', 'original').includes('前年度比'))
})

test('buildCompareGridHtml: 同じ入力なら同じHTMLになる（モジュール状態に依存しない）', () => {
  const all = feasibleAll()
  const first = buildCompareGridHtml(all, 'revenue', 'original')
  // 別モード・別方針を挟んでも結果が変わらないこと（以前はモジュール変数を読んでいた）
  for (const mode of ['profit', 'revenue'] as const) {
    for (const policy of ['original', 'revenue', 'profit'] as OptimizePolicy[]) {
      buildCompareGridHtml(all, mode, policy)
    }
  }
  assert.equal(buildCompareGridHtml(all, 'revenue', 'original'), first)
})
