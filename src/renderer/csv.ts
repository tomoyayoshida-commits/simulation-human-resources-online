// 設計書§8: CSV入出力（外部ライブラリ不使用・ブラウザ標準APIのみ）

import type { Employee, SimParams, SimulationResult, UnitId, ValidationError } from './types.ts'
import { ASSIGNMENT_COLUMN, COLUMN_MAP, DEFAULT_PARAMS, EXPORT_HEADERS, FORMULA_TRIGGER, PROFILE_COLUMN_MAP, UNIT_IDS, UNIT_LABEL } from './constants.ts'
import { contribution, classifyType } from './calcEngine.ts'
import { validateEmployees } from './validation.ts'

type Field = keyof Employee

/** 先頭BOMを除去 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * RFC4180準拠の最小限のCSVパーサ（外部ライブラリ不使用）。
 * クォート内のカンマ・CR/LF・エスケープされた `""` を正しく1フィールドとして扱う。
 * 末尾の空行（データなしの行）は無視する。
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i += 1
        }
      } else {
        field += c
        i += 1
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
    } else if (c === ',') {
      row.push(field)
      field = ''
      i += 1
    } else if (c === '\r' || c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += c
      i += 1
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0].trim() === '') rows.pop()
  return rows
}

/**
 * CSVインジェクション対策の前置ガードが要る値か。
 *
 * `=` `+` `-` `@` 始まりは表計算ソフトが数式として評価するため `'` を前置する。
 * **`'` 始まりも対象にする**のが要点で、こうしないとガードが可逆にならない。
 * （`'=A1` はガード不要と判定され、再取込時に先頭の `'` を「ガード」と誤認して剥がされ `=A1` になっていた）
 */
function needsGuard(raw: string): boolean {
  return FORMULA_TRIGGER.test(raw) || raw.startsWith("'")
}

/** 出力側：ガード対象なら `'` を前置し、カンマ/引用符/改行を含むならRFC4180クォートを付与 */
function escapeCsvField(raw: string): string {
  const guarded = needsGuard(raw) ? `'${raw}` : raw
  if (!/[",\r\n]/.test(guarded)) return guarded
  return `"${guarded.replace(/"/g, '""')}"`
}

/**
 * 入力側：出力時に前置した `'` ガードを1つだけ取り除き、往復互換を保つ。
 * needsGuard と対になっているため、`'` を含む値も欠けずに戻る（`''=A1` → `'=A1`）。
 */
function stripFormulaGuard(value: string): string {
  return value.startsWith("'") && needsGuard(value.slice(1)) ? value.slice(1) : value
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
 * maxCount は受け入れる行数の上限（1件以上・maxCount以下。2026-09-07 合意）。
 */
export function importEmployees(
  text: string,
  maxCount: number,
): { employees: Employee[] | null; errors: ValidationError[] } {
  const cleaned = stripBom(text)
  const table = parseCsv(cleaned)

  if (table.length === 0) {
    return {
      employees: null,
      errors: [{ row: 0, column: '(ファイル)', actual: '空', expected: 'ヘッダ行＋データ行' }],
    }
  }
  if (table.length === 1) {
    return {
      employees: null,
      errors: [{ row: 0, column: '(ファイル)', actual: 'ヘッダのみ', expected: 'データ行が1行以上' }],
    }
  }

  const header = table[0]
  const { indices, errors: colErrors } = resolveColumns(header)
  if (indices === null) {
    return { employees: null, errors: colErrors }
  }

  // データ行をパース → 正規フィールド名の Record<string,string>[] に変換
  const structuralErrors: ValidationError[] = []
  const rows: Record<string, string>[] = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
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
      rec[field] = stripFormulaGuard(cells[indices[field]].trim())
    }
    rows.push(rec)
  }

  // 範囲・件数チェック（§7）
  const validationErrors = validateEmployees(rows, maxCount)

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

/** 表記ゆれを吸収した「配置先事業部の値 → UnitId」の逆引き（'A事業部' と 'A' の両方を許す）。 */
const UNIT_BY_LABEL: Map<string, UnitId> = (() => {
  const m = new Map<string, UnitId>()
  for (const u of UNIT_IDS) {
    m.set(UNIT_LABEL[u].toLowerCase(), u)
    m.set(u.toLowerCase(), u)
  }
  return m
})()

/**
 * CSVから「配置先事業部」列だけを読む（docs/hiring-workbench-plan.md §5.7）。
 *
 * importEmployees とは独立した関数にしてある。既存パーサの戻り値型を変えると
 * #p4 の取込にも波及するため（§5.7「既存のパーサは1行も変えない」）。
 *
 * 列が無ければ `assignment: null` かつ `errors` は空＝「配置案なし」（分岐2）。
 * 列はあるが一部でも欠け・不正・IDの食い違いがあれば `assignment: null` に
 * `errors` を添えて返す。**部分的な配置案は絶対に補完しない**（どう補完しても嘘になる）。
 */
export function parseAssignmentColumn(
  text: string,
  employees: Employee[],
): { assignment: Record<string, UnitId> | null; errors: ValidationError[] } {
  const table = parseCsv(stripBom(text))
  if (table.length < 2) return { assignment: null, errors: [] }

  const header = table[0].map((h) => h.trim())
  // 別名は列挙順に優先する（'配置先事業部' と '事業部' が両方ある場合に前者を採る）
  let unitIdx = -1
  for (const alias of ASSIGNMENT_COLUMN) {
    unitIdx = header.findIndex((h) => h === alias)
    if (unitIdx !== -1) break
  }
  if (unitIdx === -1) return { assignment: null, errors: [] }

  const idIdx = header.findIndex((h) => (COLUMN_MAP.id as readonly string[]).includes(h))
  if (idIdx === -1) {
    return {
      assignment: null,
      errors: [{ row: 0, column: COLUMN_MAP.id[0], actual: header.join(','), expected: `配置先事業部列を読むには「${COLUMN_MAP.id[0]}」列も必要` }],
    }
  }

  const errors: ValidationError[] = []
  const assignment: Record<string, UnitId> = {}
  const label = ASSIGNMENT_COLUMN[0]
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const rowNo = i
    if (cells.length !== header.length) continue // 行の形の異常は importEmployees が報告済み
    // 出力時の `'` ガードを剥がすのは他の列と同じ往復対称の扱い（CLAUDE.md §8）
    const id = stripFormulaGuard(cells[idIdx].trim())
    const raw = stripFormulaGuard(cells[unitIdx].trim())
    if (raw === '') {
      errors.push({ row: rowNo, column: label, actual: '(空)', expected: `${UNIT_LABEL.A}／${UNIT_LABEL.B}／${UNIT_LABEL.C} のいずれか` })
      continue
    }
    const unit = UNIT_BY_LABEL.get(raw.toLowerCase())
    if (!unit) {
      errors.push({ row: rowNo, column: label, actual: raw, expected: `${UNIT_LABEL.A}／${UNIT_LABEL.B}／${UNIT_LABEL.C} のいずれか` })
      continue
    }
    assignment[id] = unit
  }

  // 取込済みの社員と1対1で対応していることを確かめる（§5.7）。
  // 行単位のエラーが既にあるなら、その社員が assignment に入らないのは当然なので二重報告しない。
  if (errors.length === 0) {
    for (const e of employees) {
      if (assignment[e.id] === undefined) {
        errors.push({ row: 0, column: label, actual: `${e.id} の配置先が無い`, expected: '全社員ぶんの配置先' })
      }
    }
  }
  const known = new Set(employees.map((e) => e.id))
  for (const id of Object.keys(assignment)) {
    if (!known.has(id)) {
      errors.push({ row: 0, column: COLUMN_MAP.id[0], actual: id, expected: '取り込んだ社員データに存在する社員番号' })
    }
  }

  return errors.length > 0 ? { assignment: null, errors } : { assignment, errors: [] }
}

/** 名簿CSV1行ぶん（docs/profile-plan.md §4.4）。写真ファイル名は任意列なので空文字がありうる。 */
export interface ProfileRow {
  id: string
  name: string
  photoFile: string
}

/**
 * 名簿CSV（社員番号,氏名,写真ファイル名）を取り込む（docs/profile-plan.md §4.4）。
 *
 * importEmployees と違い**件数検証をしない**。100名固定にすると追加採用10名を
 * 同じ画面で登録できなくなるため。取り込みを止めるのは氏名の空と社員番号の重複だけで、
 * スキルCSVとの突き合わせ（片側欠落）は警告として管理画面側が表示する。
 */
export function importProfiles(text: string): { rows: ProfileRow[] | null; errors: ValidationError[] } {
  const table = parseCsv(stripBom(text))
  if (table.length === 0) {
    return { rows: null, errors: [{ row: 0, column: '(ファイル)', actual: '空', expected: 'ヘッダ行＋データ行' }] }
  }
  if (table.length === 1) {
    return { rows: null, errors: [{ row: 0, column: '(ファイル)', actual: 'ヘッダのみ', expected: 'データ行が1行以上' }] }
  }

  const header = table[0].map((h) => h.trim())
  const errors: ValidationError[] = []
  const idIdx = header.findIndex((h) => (PROFILE_COLUMN_MAP.id as readonly string[]).includes(h))
  const nameIdx = header.findIndex((h) => (PROFILE_COLUMN_MAP.name as readonly string[]).includes(h))
  const photoIdx = header.findIndex((h) => (PROFILE_COLUMN_MAP.photoFile as readonly string[]).includes(h))
  if (idIdx === -1) {
    errors.push({ row: 0, column: PROFILE_COLUMN_MAP.id[0], actual: header.join(','), expected: `カラム「${PROFILE_COLUMN_MAP.id[0]}」が必要（ヘッダに存在しない）` })
  }
  if (nameIdx === -1) {
    errors.push({ row: 0, column: PROFILE_COLUMN_MAP.name[0], actual: header.join(','), expected: `カラム「${PROFILE_COLUMN_MAP.name[0]}」が必要（ヘッダに存在しない）` })
  }
  if (errors.length > 0) return { rows: null, errors }

  const rows: ProfileRow[] = []
  const seen = new Map<string, number>()
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const rowNo = i
    if (cells.length !== header.length) {
      errors.push({ row: rowNo, column: '(行全体)', actual: `${cells.length}列`, expected: `${header.length}列（ヘッダと同数）` })
      continue
    }
    // 出力時の `'` ガードを取り除くのはスキルCSVと同じ扱い（往復対称・CLAUDE.md §8）
    const id = stripFormulaGuard(cells[idIdx].trim())
    const name = stripFormulaGuard(cells[nameIdx].trim())
    const photoFile = photoIdx === -1 ? '' : stripFormulaGuard(cells[photoIdx].trim())

    if (id === '') {
      errors.push({ row: rowNo, column: PROFILE_COLUMN_MAP.id[0], actual: '(空)', expected: '空でない社員番号（結合キーのため必須）' })
    } else if (FORMULA_TRIGGER.test(id)) {
      errors.push({ row: rowNo, column: PROFILE_COLUMN_MAP.id[0], actual: id, expected: '数式扱いされない社員番号（= + - @ 始まりは不可）' })
    } else if (seen.has(id)) {
      errors.push({ row: rowNo, column: PROFILE_COLUMN_MAP.id[0], actual: id, expected: `重複しない社員番号（先頭出現: 行${seen.get(id)}）` })
    } else {
      seen.set(id, rowNo)
    }
    if (name === '') {
      errors.push({ row: rowNo, column: PROFILE_COLUMN_MAP.name[0], actual: '(空)', expected: '空でない氏名' })
    }
    rows.push({ id, name, photoFile })
  }

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: [] }
}

/**
 * ファイル名の突き合わせ用キー（docs/profile-plan.md §4.4）。
 *
 * NFC正規化が要るのは、macOSで作られたZIP・フォルダの日本語ファイル名が濁点をNFD
 * （`か`＋結合濁点）で持つため。正規化しないと `吉田.jpg` 同士が文字列一致しない。
 * 拡張子の大文字小文字（.JPG / .jpg）も揺れるので小文字化する。
 */
function photoKey(fileName: string): string {
  return fileName.normalize('NFC').trim().toLowerCase()
}

/** 名簿と実ファイルの突き合わせ結果（docs/profile-plan.md §4.4）。いずれの欠落も警告であり登録は止めない。 */
export interface ProfileMatch<T> {
  pairs: { row: ProfileRow; file: T | null }[]
  /** 名簿が参照しているのに選択されなかった写真のファイル名 */
  missingFiles: string[]
  /** 選択されたのに名簿から参照されていない写真のファイル名 */
  unusedFiles: string[]
}

/**
 * 名簿CSVの「写真ファイル名」列と、選択された写真ファイルを突き合わせる（純粋関数）。
 * File そのものではなく `{ name }` を持つ型で受けるので、node:test からも素のオブジェクトで検証できる。
 */
export function matchProfilePhotos<T extends { name: string }>(rows: ProfileRow[], files: T[]): ProfileMatch<T> {
  const byKey = new Map<string, T>()
  for (const f of files) byKey.set(photoKey(f.name), f)

  const used = new Set<string>()
  const missingFiles: string[] = []
  const pairs = rows.map((row) => {
    if (row.photoFile === '') return { row, file: null }
    const key = photoKey(row.photoFile)
    const file = byKey.get(key) ?? null
    if (file) used.add(key)
    else missingFiles.push(row.photoFile)
    return { row, file }
  })

  const unusedFiles = files.filter((f) => !used.has(photoKey(f.name))).map((f) => f.name)
  return { pairs, missingFiles, unusedFiles }
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
  const lines = [header.map((v) => escapeCsvField(String(v))).join(',')]
  for (const e of employees) {
    const unit = result.assignment[e.id]
    const contrib = unit ? contribution(e, unit, params) : ''
    lines.push(
      [e.id, e.sales, e.mgmt, e.dev, e.training, e.cost, unit ? UNIT_LABEL[unit] : '', contrib, classifyType(e)]
        .map((v) => escapeCsvField(String(v)))
        .join(','),
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
