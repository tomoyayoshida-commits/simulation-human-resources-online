// 設計書§10: CSV取込UI（#p1 社員データ取込・#p5 採用前後比較の2つの取込欄）のDOM更新。
// 表示専用で計算を持たない（CLAUDE.md §5）。取り込んだデータの保持と後続処理は renderer.ts 側。

import type { Employee, ValidationError } from './types.ts'
import { escapeHtml } from './format.ts'
import { $ } from './dom.ts'

/** #p5 は左（採用前100名）・右（追加採用10名）の2つの独立取込を持つため、対象のDOM ID組を受け取る。 */
export interface HiringImportIds {
  summary: string
  table: string
  reasonDetail: string
  reasonList: string
}

/**
 * 検証エラー1行。
 * actual にはCSVの生の値がそのまま入る（`テストケース/採用04_XSSスクリプト混入.csv` の
 * 社員番号は `<script>` を含む）ため、必ずエスケープしてから埋め込む。
 */
function errorRow(e: ValidationError): string {
  return `<tr><td>${e.row === 0 ? '-' : e.row}</td><td>${escapeHtml(e.column)}</td><td class="num err">${escapeHtml(e.actual)}</td><td>${escapeHtml(e.expected)}</td></tr>`
}

const ERROR_TABLE_HEAD = '<tr><th>行番号</th><th>カラム</th><th class="num">実測値</th><th>期待範囲</th></tr>'

/**
 * エラー1件を人が読める理由文にする（表示専用・検証ロジックは持たない）。
 * validateEmployees が返す column/expected/actual の組み合わせから、なぜ弾かれたかを判定する。
 */
function errorReason(e: ValidationError): string {
  const where = e.row === 0 ? '全体' : `${e.row}行目`
  const expected = String(e.expected)
  const actual = escapeHtml(e.actual)
  if (e.column === '(件数)') {
    return `取込件数が${escapeHtml(e.expected)}に一致しません（実際は${actual}件）。ファイルの行数（ヘッダー除く）を確認してください。`
  }
  if (e.column === '社員番号') {
    if (e.actual === '(空)') return `${where}の社員番号が空です。社員番号は社員を一意に識別するキーとして使われるため必須です。`
    if (expected.includes('重複')) return `${where}の社員番号「${actual}」が他の行と重複しています（${escapeHtml(expected)}）。社員番号は一意である必要があります。`
    if (expected.includes('数式')) return `${where}の社員番号「${actual}」は = + - @ で始まっており、表計算ソフトが数式として誤解釈するため使用できません。`
    return `${where}の社員番号「${actual}」が不正です（期待：${escapeHtml(expected)}）。`
  }
  return `${where}の${escapeHtml(e.column)}「${actual}」が期待範囲（${escapeHtml(expected)}）から外れています。CSVの該当セルの数値を確認してください。`
}

/** エラー理由の折り畳みを更新する。エラーがなければ非表示にする。 */
function renderErrorReasons(detailId: string, listId: string, errors: ValidationError[]): void {
  const detail = $(detailId) as HTMLDetailsElement | null
  const list = $(listId)
  if (detail) detail.hidden = errors.length === 0
  if (list) list.innerHTML = errors.map((e) => `<li>${errorReason(e)}</li>`).join('')
}

/** ドロップゾーン＋ファイル選択の配線。読み取ったテキストを onText に渡す。 */
export function setupDropzone(dropId: string, inputId: string, onText: (text: string) => void): void {
  const drop = $(dropId)
  const input = $(inputId) as HTMLInputElement | null
  if (!drop || !input) return

  drop.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (file) onText(await file.text())
    // 同じファイルを選び直しても change が発火するようにクリアする
    input.value = ''
  })
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('dragover')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'))
  drop.addEventListener('drop', async (e) => {
    e.preventDefault()
    drop.classList.remove('dragover')
    const file = e.dataTransfer?.files?.[0]
    if (file) onText(await file.text())
  })
}

/**
 * 採用前後比較(#p5)の取込エラー表示。
 * alert()はElectronで主プロセスとの同期IPCを介するため、file inputのchangeイベント直後に
 * 呼ぶと描画が一瞬止まって固まったように見える。取込報告(#p1)と同様にインライン表示する。
 */
export function renderHiringImportError(
  ids: HiringImportIds,
  errors: ValidationError[],
  message: string,
): void {
  const summary = $(ids.summary)
  const errTable = $(ids.table)
  if (summary) {
    summary.innerHTML = `<div class="stat"><div class="k">判定</div><div class="v"><span class="pill crit">${message}</span></div></div>`
  }
  if (errTable) {
    errTable.innerHTML = ERROR_TABLE_HEAD + errors.map(errorRow).join('')
  }
  renderErrorReasons(ids.reasonDetail, ids.reasonList, errors)
}

/** 取込成功時：判定ピルを「取込OK」に変え件数を示す。エラー表・エラー理由は空にする（前回の残骸を消す） */
export function renderHiringImportOk(ids: HiringImportIds, count: number): void {
  const summary = $(ids.summary)
  const errTable = $(ids.table)
  if (summary) {
    summary.innerHTML = `<div class="stat"><div class="k">判定</div><div class="v"><span class="pill good">取込OK（${count}件）</span></div></div>`
  }
  if (errTable) errTable.innerHTML = ''
  renderErrorReasons(ids.reasonDetail, ids.reasonList, [])
}

/** 入力検証レポート（#p1・機能13/D-2）。プレビュー・サマリー・エラー表・次へボタンの活性を更新する。 */
export function renderImportReport(employees: Employee[] | null, errors: ValidationError[]): void {
  // プレビュー（先頭5名）
  const preview = $('preview-100')
  if (preview) {
    let html =
      '<tr><th>社員ID</th><th class="num">営業力</th><th class="num">管理力</th><th class="num">開拓力</th><th class="num">育成力</th><th class="num">人件費</th></tr>'
    const rows = employees ?? []
    for (const e of rows.slice(0, 5)) {
      // 社員番号はCSVの生の文字列。能力値・人件費は検証済みの数値なのでエスケープ不要。
      html += `<tr><td>${escapeHtml(e.id)}</td><td class="num">${e.sales}</td><td class="num">${e.mgmt}</td><td class="num">${e.dev}</td><td class="num">${e.training}</td><td class="num">${e.cost}</td></tr>`
    }
    if (rows.length === 0) html += '<tr><td colspan="6">（取込に成功したデータがありません）</td></tr>'
    preview.innerHTML = html
  }

  // サマリー
  const count = employees?.length ?? 0
  const ok = errors.length === 0 && employees !== null
  const summary = $('validation-summary')
  if (summary) {
    summary.innerHTML = `
      <div class="stat"><div class="k">取込件数</div><div class="v">${count} / 100</div></div>
      <div class="stat"><div class="k">エラー件数</div><div class="v" style="color:${errors.length > 0 ? 'var(--critical)' : 'inherit'};">${errors.length}</div></div>
      <div class="stat"><div class="k">判定</div><div class="v">${ok ? '<span class="pill good">取込OK</span>' : '<span class="pill crit">取込を保留</span>'}</div></div>`
  }

  // エラーテーブル
  const errTable = $('validation-errors')
  if (errTable) {
    const body =
      errors.length === 0
        ? '<tr><td colspan="4">エラーはありません。次のステップへ進めます。</td></tr>'
        : errors.map(errorRow).join('')
    errTable.innerHTML = ERROR_TABLE_HEAD + body
  }
  renderErrorReasons('validation-error-reasons-detail', 'validation-error-reasons', errors)
}
