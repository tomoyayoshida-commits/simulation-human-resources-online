// 設計書§7: 入力バリデーション（機能13/D-2）

import type { ValidationError } from './types.ts'
import { FORMULA_TRIGGER } from './constants.ts'

interface RangeSpec {
  field: string
  label: string
  min: number
  max: number
}

// 能力値 0〜100、人件費 1〜20（設計書§7）
const RANGES: RangeSpec[] = [
  { field: 'sales', label: '営業力', min: 0, max: 100 },
  { field: 'mgmt', label: '管理力', min: 0, max: 100 },
  { field: 'dev', label: '開拓力', min: 0, max: 100 },
  { field: 'training', label: '育成力', min: 0, max: 100 },
  { field: 'cost', label: '人件費', min: 1, max: 20 },
]

/**
 * 正規フィールド名にマップ済みの行を検証する（設計書§7）。
 * - 行数が expectedCount と一致するか
 * - 各数値が範囲内か（数値変換不能もエラー）
 * row は1-based のデータ行番号（ヘッダ除く）。
 */
export function validateEmployees(
  rows: Record<string, string>[],
  expectedCount: number,
): ValidationError[] {
  const errors: ValidationError[] = []

  // 件数チェック
  if (rows.length !== expectedCount) {
    errors.push({
      row: 0,
      column: '(件数)',
      actual: rows.length,
      expected: `${expectedCount}件`,
    })
  }

  // 社員番号そのものの検査。
  // id は assignment（employeeId -> unit）のキーとして全体で使われるため、空だと複数人が
  // 同一キーに潰れて配置が壊れる。従来は空をエラーにしておらず、重複チェックも空を素通りしていた。
  // また `=1+1` のような値は表計算ソフトで数式として評価される取り込み事故の典型なので、
  // 社員番号としては受け付けずに入力検証で報告する（出力側のガードは csv.escapeCsvField が担う）。
  rows.forEach((row, i) => {
    const id = (row.id ?? '').trim()
    if (id === '') {
      errors.push({
        row: i + 1,
        column: '社員番号',
        actual: '(空)',
        expected: '空でない社員番号',
      })
    } else if (FORMULA_TRIGGER.test(id)) {
      errors.push({
        row: i + 1,
        column: '社員番号',
        actual: id,
        expected: '= + - @ で始まらない社員番号（表計算ソフトが数式として評価するため）',
      })
    }
  })

  // 社員番号重複チェック（id はシステム全体で一意キーとして使われるため必須）
  const firstRowById = new Map<string, number>()
  rows.forEach((row, i) => {
    const rowNo = i + 1
    const id = row.id
    if (id === '' || id === undefined) return
    const firstRow = firstRowById.get(id)
    if (firstRow !== undefined) {
      errors.push({
        row: rowNo,
        column: '社員番号',
        actual: id,
        expected: `重複しない社員番号（先頭出現: 行${firstRow}）`,
      })
    } else {
      firstRowById.set(id, rowNo)
    }
  })

  rows.forEach((row, i) => {
    const rowNo = i + 1
    for (const spec of RANGES) {
      const raw = row[spec.field]
      const value = Number(raw)
      if (raw === '' || raw === undefined || !Number.isFinite(value)) {
        errors.push({
          row: rowNo,
          column: spec.label,
          actual: raw ?? '(空)',
          expected: `数値 ${spec.min}〜${spec.max}`,
        })
        continue
      }
      if (value < spec.min || value > spec.max) {
        errors.push({
          row: rowNo,
          column: spec.label,
          actual: value,
          expected: `${spec.min}〜${spec.max}`,
        })
      }
    }
  })

  return errors
}
