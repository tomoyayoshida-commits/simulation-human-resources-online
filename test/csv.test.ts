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
