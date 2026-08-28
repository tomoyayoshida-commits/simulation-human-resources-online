// 設計書§8: CSV入出力（外部ライブラリ不使用・ブラウザ標準APIのみ）

import type { Employee, SimParams, SimulationResult, UnitId, ValidationError } from './types.ts'
import { COLUMN_MAP, DEFAULT_PARAMS, EXPORT_HEADERS } from './constants.ts'
import { contribution, classifyType } from './calcEngine.ts'
import { validateEmployees } from './validation.ts'

type Field = keyof Employee

/** 先頭BOMを除去 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 行分割（CRLF/CR/LF対応）。末尾の空行は無視。 */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/)
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines
}

/**
 * ヘッダ配列を COLUMN_MAP に照合し、各フィールドの列インデックスを解決する。
 * 未解決フィールドがあれば ValidationError（column スキーマ不一致）を返す。
 */
function resolveColumns(header: string[]): {
  indices: Record<Field, number> | null
  errors: ValidationError[]
} {
  const trimmed = header.map((h) => h.trim())
  const indices = {} as Record<Field, number>
  const errors: ValidationError[] = []
  for (const field of Object.keys(COLUMN_MAP) as Field[]) {
    const aliases = COLUMN_MAP[field]
    const idx = trimmed.findIndex((h) => aliases.includes(h))
    if (idx === -1) {
      errors.push({
        row: 0,
        column: aliases[0],
        actual: header.join(','),
        expected: `カラム「${aliases[0]}」が必要（ヘッダに存在しない）`,
      })
    } else {
      indices[field] = idx
    }
  }
  return { indices: errors.length === 0 ? indices : null, errors }
}

/**
 * CSVテキストを取り込み、Employee[] とエラーを返す（設計書§7・§8）。
 * 構造・カラム・件数・範囲のすべてを検査し、1件でもエラーがあれば employees は null。
 */
export function importEmployees(
  text: string,
  expectedCount: number,
): { employees: Employee[] | null; errors: ValidationError[] } {
  const cleaned = stripBom(text)
  const lines = splitLines(cleaned)

  if (lines.length === 0) {
    return {
      employees: null,
      errors: [{ row: 0, column: '(ファイル)', actual: '空', expected: 'ヘッダ行＋データ行' }],
    }
  }
  if (lines.length === 1) {
    return {
      employees: null,
      errors: [{ row: 0, column: '(ファイル)', actual: 'ヘッダのみ', expected: 'データ行が1行以上' }],
    }
  }

  const header = lines[0].split(',')
  const { indices, errors: colErrors } = resolveColumns(header)
  if (indices === null) {
    return { employees: null, errors: colErrors }
  }

  // データ行をパース → 正規フィールド名の Record<string,string>[] に変換
  const structuralErrors: ValidationError[] = []
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    const rowNo = i // データ行番号（1-based, ヘッダ除く）
    if (cells.length !== header.length) {
      structuralErrors.push({
        row: rowNo,
        column: '(行全体)',
        actual: `${cells.length}列`,
        expected: `${header.length}列（ヘッダと同数）`,
      })
      continue
    }
    const rec: Record<string, string> = {}
    for (const field of Object.keys(COLUMN_MAP) as Field[]) {
      rec[field] = cells[indices[field]].trim()
    }
    rows.push(rec)
  }

  // 範囲・件数チェック（§7）
  const validationErrors = validateEmployees(rows, expectedCount)

  const allErrors = [...structuralErrors, ...validationErrors]
  if (allErrors.length > 0) {
    return { employees: null, errors: allErrors }
  }

  const employees: Employee[] = rows.map((r) => ({
    id: r.id,
    sales: Number(r.sales),
    mgmt: Number(r.mgmt),
    dev: Number(r.dev),
    training: Number(r.training),
    cost: Number(r.cost),
  }))
  return { employees, errors: [] }
}

/**
 * 追加採用データを既存社員にマージ（設計書§8）。
 * id 衝突があればエラーとし、マージ結果は返さない。
 */
export function mergeEmployees(
  base: Employee[],
  additional: Employee[],
): { employees: Employee[] | null; errors: ValidationError[] } {
  const errors: ValidationError[] = []
  const baseIds = new Set(base.map((e) => e.id))
  const seenAdditionalIds = new Set<string>()
  additional.forEach((e, i) => {
    if (baseIds.has(e.id)) {
      errors.push({
        row: i + 1,
        column: EXPORT_HEADERS.id,
        actual: e.id,
        expected: '既存社員IDと重複しないID',
      })
    } else if (seenAdditionalIds.has(e.id)) {
      errors.push({
        row: i + 1,
        column: EXPORT_HEADERS.id,
        actual: e.id,
        expected: '追加採用データ内で重複しないID',
      })
    }
    seenAdditionalIds.add(e.id)
  })
  if (errors.length > 0) return { employees: null, errors }
  return { employees: [...base, ...additional], errors: [] }
}

/**
 * 配置結果CSV文字列を生成（設計書§8）。
 * 列: id, 営業力, 管理力, 開拓力, 育成力, 人件費, 配置先事業部（入出力往復可能）。
 * 参考として貢献度・タイプ列も付す。
 */
export function buildAssignmentCsv(
  employees: Employee[],
  result: SimulationResult,
  params: SimParams = DEFAULT_PARAMS,
): string {
  const h = EXPORT_HEADERS
  const header = [h.id, h.sales, h.mgmt, h.dev, h.training, h.cost, h.assignedUnit, '貢献度', 'タイプ']
  const lines = [header.join(',')]
  const unitLabel: Record<UnitId, string> = { A: 'A事業部', B: 'B事業部', C: 'C事業部' }
  for (const e of employees) {
    const unit = result.assignment[e.id]
    const contrib = unit ? contribution(e, unit, params) : ''
    lines.push(
      [e.id, e.sales, e.mgmt, e.dev, e.training, e.cost, unit ? unitLabel[unit] : '', contrib, classifyType(e)].join(
        ',',
      ),
    )
  }
  return lines.join('\n')
}

/** CSV文字列をブラウザのダウンロードとして保存（設計書§8） */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
