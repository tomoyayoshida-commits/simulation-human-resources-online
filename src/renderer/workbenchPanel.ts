// 機能15 作業机（docs/workbench-plan.md §4.3〜§4.8 Phase2/3）。表示専用（計算持たない・CLAUDE.md §5）。
//
// HTML生成（buildWorkbenchHtml以下）は純粋関数・DOM非依存でテストできる。
// DOM配線（openWorkbench/initWorkbenchPanel以下）は#p4のcompareTasks.tsと同じく、
// #wb-root への委譲リスナ1組だけを1回張り、以後は再描画のたびに張り直さない。

import type { UnitId } from './types.ts'
import type { WhatIfEvaluation } from './whatif.ts'
import { diffAssignment, evaluateAssignment, headcountOf } from './whatif.ts'
import {
  buildWorkbenchCards,
  hasViolation,
  previewMove,
  resetToBaseline,
  sortCards,
  undo,
  withAssignment,
  withMove,
  type WorkbenchCard,
  type WorkbenchSortKey,
  type WorkbenchState,
} from './workbench.ts'
import { solveForHeadcount } from './optimizer.ts'
import { buildAssignmentCsv, downloadCsv } from './csv.ts'
import { round2, taskLabel, UNIT_IDS, UNIT_LABEL, UNIT_VAR } from './constants.ts'
import { clampPct, deltaText, escapeAttr, escapeHtml, oku, oku1, pct, pill, signed } from './format.ts'
import { $, setHtml } from './dom.ts'

// ---- 純粋関数：HTML生成（テスト対象） ----

const SORT_OPTIONS: { key: WorkbenchSortKey; label: string }[] = [
  { key: 'id', label: '社員番号順' },
  { key: 'contribution', label: '貢献度順（現在の所属）' },
  { key: 'type', label: '型別' },
  { key: 'cost', label: '人件費順' },
]

/**
 * 現在の assignment を baseline と突き合わせて評価する。
 * 「基準は常に baseline.assignment」という判断がこのモジュールの6箇所に散らばっていたのを1点に集約した
 * （baseline は作業机の操作では書き換わらないので、状態さえ渡せば基準は一意に決まる）。
 */
function evaluate(state: WorkbenchState): WhatIfEvaluation {
  return evaluateAssignment(state, state.baseline.assignment)
}

export interface WorkbenchViewData {
  state: WorkbenchState
  sortKey: WorkbenchSortKey
  selectedEmployeeId: string | null
  /** 直近の操作で feasible→infeasible に変わったときの一過性の警告（§8-1）。null なら非表示。 */
  alertText: string | null
}

function buildAlertHtml(alertText: string | null): string {
  if (!alertText) return ''
  return (
    `<div class="wb-alert-banner"><span>${escapeHtml(alertText)}</span>` +
    `<button type="button" class="wb-alert-close" data-wb-alert-dismiss aria-label="閉じる">✕</button></div>`
  )
}

function buildHeaderHtml(
  state: WorkbenchState,
  evaluation: WhatIfEvaluation,
): string {
  const { result } = evaluation
  const { baseline } = state
  const statusPill = !result.feasible
    ? pill('crit', `● 全社売上${state.params.prevYearRevenue}億円を下回る（現在${oku(result.companyRevenue)}）`)
    : pill('good', '● 制約を満たす')
  const minHcPill =
    evaluation.minHeadcountViolations.length > 0
      ? pill('warn', `● 最低人数割れ：${evaluation.minHeadcountViolations.join('・')}`)
      : ''
  return `
    <h2>作業机：${taskLabel(state.task, state.metric)}の配置を調整</h2>
    <p class="subtitle">最適解を出発点に人手で寄せ、そのコストをその場で確認する</p>
    <div class="wb-totals">
      <div class="wb-stat"><span class="k">全社売上</span><span class="v">${oku(result.companyRevenue)}</span><span class="d">${deltaText(result.companyRevenue, baseline.companyRevenue)}</span></div>
      <div class="wb-stat"><span class="k">全社利益</span><span class="v">${oku(result.companyProfit)}</span><span class="d">${deltaText(result.companyProfit, baseline.companyProfit)}</span></div>
      <div class="wb-stat"><span class="k">異動</span><span class="v">${evaluation.movedFromBaseline}名</span></div>
    </div>
    <div class="wb-status">${statusPill}${minHcPill}</div>`
}

function buildCardHtml(c: WorkbenchCard, selectedEmployeeId: string | null): string {
  const others = UNIT_IDS.filter((u) => u !== c.unit)
  const otherText = others.map((u) => `${u} ${c.contributions[u].toFixed(2)}`).join(' ／ ')
  const selected = c.employee.id === selectedEmployeeId
  return `
    <div class="wb-card${selected ? ' selected' : ''}" draggable="true" data-emp="${escapeAttr(c.employee.id)}" tabindex="0">
      <div class="wb-card-id">${escapeHtml(c.employee.id)}</div>
      <span class="wb-card-type">${c.type}</span>
      <div class="wb-card-main">${c.contributions[c.unit].toFixed(2)}</div>
      <div class="wb-card-others">${otherText}</div>
    </div>`
}

/** 列の生成が共通で読む文脈。事業部ごとに作り直す必要のない値をまとめてある。 */
interface ColumnContext {
  state: WorkbenchState
  evaluation: WhatIfEvaluation
  /** 全社員ぶんのカード（並び替え済み）。事業部で絞るのは各列側 */
  sortedCards: WorkbenchCard[]
  selectedEmployeeId: string | null
}

function buildColumnHtml(u: UnitId, ctx: ColumnContext): string {
  const { state, evaluation, sortedCards, selectedEmployeeId } = ctx
  const unitResult = evaluation.result.units[u]
  const baseUnitResult = state.baseline.units[u]
  const violation = evaluation.minHeadcountViolations.includes(u)
  const meterPct = clampPct(unitResult.fulfillmentRate * 100)
  const cardsHtml = sortedCards
    .filter((c) => c.unit === u)
    .map((c) => buildCardHtml(c, selectedEmployeeId))
    .join('')
  return `
    <div class="wb-column${violation ? ' violation' : ''}" data-unit="${u}">
      <div class="wb-unit-head">
        <div class="wb-unit-title"><b>${UNIT_LABEL[u]}</b> ${unitResult.count}名 <span class="wb-unit-pct">${pct(unitResult.fulfillmentRate)}</span>${violation ? ` <span class="wb-unit-warn">⚠ 最低${state.params.minHeadcount[u]}名</span>` : ''}</div>
        <div class="meter-mini"><div class="meter-mini-fill" style="width:${meterPct.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div>
        <div class="wb-unit-sub">売上${oku1(unitResult.finalRevenue)}（${deltaText(unitResult.finalRevenue, baseUnitResult.finalRevenue)}）</div>
        <div class="wb-preview-hint" hidden></div>
      </div>
      <div class="wb-cards">${cardsHtml}</div>
    </div>`
}

function buildActionsHtml(state: WorkbenchState, evaluation: WhatIfEvaluation, sortKey: WorkbenchSortKey): string {
  const violation = hasViolation(evaluation)
  const diffs = diffAssignment(state.baseline.assignment, state.assignment)
  const diffText = diffs.length === 0 ? '異動なし' : diffs.map((d) => `${d.from}→${d.to} ${d.count}名`).join(' ／ ')
  const sortOptionsHtml = SORT_OPTIONS.map(
    (o) => `<option value="${o.key}"${o.key === sortKey ? ' selected' : ''}>${o.label}</option>`,
  ).join('')
  return `
    <div class="wb-actions">
      <label class="wb-sort-label">並び順：<select id="wb-sort" class="wb-sort">${sortOptionsHtml}</select></label>
      <button type="button" class="btn secondary" data-wb-action="undo"${state.history.length === 0 ? ' disabled' : ''}>元に戻す</button>
      <button type="button" class="btn secondary" data-wb-action="reset">最適解に戻す</button>
      <button type="button" class="btn secondary" data-wb-action="resolve">この人数配分のまま最適に組み直す</button>
      <button type="button" class="btn" data-wb-action="csv"${violation ? ' disabled title="制約違反があるため出力できません"' : ''}>CSV出力</button>
    </div>
    <p class="wb-diff">異動の内訳：${diffText}</p>`
}

/** 作業机パネル全体のHTMLを組み立てる（純粋関数・DOM非依存）。 */
export function buildWorkbenchHtml(data: WorkbenchViewData): string {
  const { state, sortKey, selectedEmployeeId, alertText } = data
  const evaluation = evaluate(state)
  // カードの組み立て（100名×3事業部の貢献度）と並び替えは事業部に依存しないので、
  // 列ごとに作り直さず1回で済ませる（従来は3列それぞれで buildWorkbenchCards を呼び直していた）。
  const ctx: ColumnContext = {
    state,
    evaluation,
    sortedCards: sortCards(buildWorkbenchCards(state), sortKey),
    selectedEmployeeId,
  }
  const columnsHtml = UNIT_IDS.map((u) => buildColumnHtml(u, ctx)).join('')
  return (
    buildAlertHtml(alertText) +
    buildHeaderHtml(state, evaluation) +
    `<div class="wb-board">${columnsHtml}</div>` +
    buildActionsHtml(state, evaluation, sortKey)
  )
}

// ---- DOM配線（未テスト・compareTasks.tsと同じ方針） ----

const view: {
  state: WorkbenchState | null
  sortKey: WorkbenchSortKey
  selectedEmployeeId: string | null
  dragEmployeeId: string | null
  /** ドラッグ開始時点の全社売上。ドラッグ中は state が変わらないので、列に入るたびに測り直さない（§7） */
  dragBaseRevenue: number
  alertText: string | null
} = { state: null, sortKey: 'id', selectedEmployeeId: null, dragEmployeeId: null, dragBaseRevenue: 0, alertText: null }

function render(): void {
  if (!view.state) return
  setHtml('wb-root', buildWorkbenchHtml({ state: view.state, sortKey: view.sortKey, selectedEmployeeId: view.selectedEmployeeId, alertText: view.alertText }))
}

/** #p4 のカードから遷移してきた初期状態で作業机を開く（機能15・§4.1）。 */
export function openWorkbench(initial: WorkbenchState): void {
  view.state = initial
  view.sortKey = 'id'
  view.selectedEmployeeId = null
  view.alertText = null
  view.dragEmployeeId = null
  render()
}

function commitMove(id: string, unit: UnitId): void {
  const state = view.state
  if (!state) return
  const before = evaluate(state)
  const next = withMove(state, id, unit)
  view.selectedEmployeeId = null
  if (next === state) {
    render()
    return
  }
  const after = evaluate(next)
  view.state = next
  // §8-1: feasible→infeasible に変わった操作の直後だけ警告を出す（ドロップ自体は拒否しない）
  if (!hasViolation(before) && hasViolation(after)) {
    view.alertText = !after.result.feasible
      ? `全社売上が${state.params.prevYearRevenue}億円を下回りました（現在${oku(after.result.companyRevenue)}）`
      : `最低人数を割りました（${after.minHeadcountViolations.join('・')}）`
  }
  render()
}

function handleAction(action: string): void {
  const state = view.state
  if (!state) return
  if (action === 'undo') {
    view.state = undo(state)
    view.selectedEmployeeId = null
    render()
  } else if (action === 'reset') {
    view.state = resetToBaseline(state)
    view.selectedEmployeeId = null
    view.alertText = null
    render()
  } else if (action === 'resolve') {
    const counts = headcountOf(state.assignment, state.roster)
    const assignment = solveForHeadcount(state.roster, state.task, counts, state.params, state.metric)
    view.state = withAssignment(state, assignment)
    render()
  } else if (action === 'csv') {
    const evaluation = evaluate(state)
    if (hasViolation(evaluation)) return // ボタンはdisabledのはずだが二重防御（§8-2）
    downloadCsv(`作業机_課題${state.task}_配置.csv`, buildAssignmentCsv(state.roster, evaluation.result, state.params))
  }
}

function handleClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target || !view.state) return

  if (target.closest('[data-wb-alert-dismiss]')) {
    view.alertText = null
    render()
    return
  }

  const actionBtn = target.closest<HTMLElement>('[data-wb-action]')
  if (actionBtn) {
    handleAction(actionBtn.dataset.wbAction ?? '')
    return
  }

  const cardEl = target.closest<HTMLElement>('[data-emp]')
  if (cardEl) {
    const id = cardEl.dataset.emp ?? ''
    view.selectedEmployeeId = view.selectedEmployeeId === id ? null : id
    render()
    return
  }

  // クリック操作のフォールバック（§4.4）：選択中の1名を、クリックした列（事業部）へ移動する
  const colEl = target.closest<HTMLElement>('[data-unit]')
  if (colEl && view.selectedEmployeeId) {
    commitMove(view.selectedEmployeeId, colEl.dataset.unit as UnitId)
  }
}

function handleChange(e: Event): void {
  const target = e.target
  if (!(target instanceof HTMLSelectElement) || target.id !== 'wb-sort') return
  view.sortKey = target.value as WorkbenchSortKey
  render()
}

/** イベント発生位置の事業部列。ドラッグ系4ハンドラが同じ探索をしていたのを1箇所に。 */
function columnAt(e: Event): HTMLElement | null {
  return (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-unit]') ?? null
}

/** 列のドロップ強調とプレビュー吹き出しを消す。 */
function clearDropHint(colEl: Element | null | undefined): void {
  colEl?.classList.remove('drop-hover')
  colEl?.querySelector('.wb-preview-hint')?.setAttribute('hidden', '')
}

function handleDragStart(e: DragEvent): void {
  const cardEl = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-emp]')
  const state = view.state
  if (!cardEl || !state) return
  const id = cardEl.dataset.emp ?? ''
  view.dragEmployeeId = id
  // ドラッグ中に state は変わらないので、比較の基準はここで1回だけ求める
  view.dragBaseRevenue = evaluate(state).result.companyRevenue
  e.dataTransfer?.setData('text/plain', id)
}

function handleDragOver(e: DragEvent): void {
  // ここでは計算しない（毎フレーム発火するため・§7）。ドロップ許可のpreventDefaultのみ。
  if (columnAt(e)) e.preventDefault()
}

function handleDragEnter(e: DragEvent): void {
  const state = view.state
  const colEl = columnAt(e)
  if (!state || !colEl || !view.dragEmployeeId) return
  const unit = colEl.dataset.unit as UnitId
  const preview = previewMove(state, view.dragEmployeeId, unit)
  const d = round2(preview.companyRevenue - view.dragBaseRevenue)
  const hint = colEl.querySelector<HTMLElement>('.wb-preview-hint')
  if (hint) {
    hint.textContent = `この1名を動かすと全社売上 ${signed(d)}億円`
    hint.removeAttribute('hidden')
  }
  colEl.classList.add('drop-hover')
}

function handleDragLeave(e: DragEvent): void {
  clearDropHint(columnAt(e))
}

function handleDrop(e: DragEvent): void {
  e.preventDefault()
  const colEl = columnAt(e)
  clearDropHint(colEl)
  const id = e.dataTransfer?.getData('text/plain') || view.dragEmployeeId
  view.dragEmployeeId = null
  if (colEl && id) commitMove(id, colEl.dataset.unit as UnitId)
}

function handleDragEnd(): void {
  view.dragEmployeeId = null
  $('wb-root')?.querySelectorAll<HTMLElement>('[data-unit]').forEach((el) => clearDropHint(el))
}

/**
 * 作業机の委譲リスナを1回だけ張る（`#p4-bench-step` は骨格のみindex.htmlに存在し、
 * `#wb-root` はopenWorkbench以降しかDOMを持たないため、要素の有無に関わらず登録できる
 * `document` への委譲にはせず、`#wb-root` 自体に張る＝要素は起動時から存在する空divでよい）。
 */
export function initWorkbenchPanel(): void {
  const root = $('wb-root')
  if (!root) return
  root.addEventListener('click', handleClick)
  root.addEventListener('change', handleChange)
  root.addEventListener('dragstart', handleDragStart)
  root.addEventListener('dragover', handleDragOver)
  root.addEventListener('dragenter', handleDragEnter)
  root.addEventListener('dragleave', handleDragLeave)
  root.addEventListener('drop', handleDrop)
  root.addEventListener('dragend', handleDragEnd)
}
