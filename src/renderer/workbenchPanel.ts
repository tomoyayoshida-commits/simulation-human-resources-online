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
import { saveRun, type SavedRun } from './runStore.ts'
import { withLoading } from './loading.ts'
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
  /**
   * 顔写真サムネイルを出すか（docs/profile-plan.md §4.6・§8-5）。既定は true。
   * 写真を出すとカード1枚が高くなり、520pxの列に同時に見える枚数が約1/3になるため、
   * 俯瞰したいときに従来の密度へ戻せるようにしてある。
   */
  showPhotos?: boolean
  /**
   * 保存時の命名フォームの状態（docs/export-plan.md §4.8）。
   * `null` なら閉じている。文字列ならその値を初期値にして開いている。
   */
  savingTitle?: string | null
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

/**
 * 顔写真の枠（docs/profile-plan.md §4.6）。写真が無い社員でもレイアウトが崩れないよう、
 * 同じ寸法のプレースホルダ（所属事業部色の丸＋社員番号の下2桁）を必ず返す。
 * photo は Firestore 由来の外部入力なので escapeAttr を通す（CLAUDE.md §8）。
 */
function buildCardFaceHtml(c: WorkbenchCard): string {
  if (c.profile?.photo) {
    return `<img class="wb-card-photo" src="${escapeAttr(c.profile.photo)}" alt="" draggable="false">`
  }
  return `<span class="wb-card-photo wb-card-photo-none" style="background:${UNIT_VAR[c.unit]};">${escapeHtml(c.employee.id.slice(-2))}</span>`
}

function buildCardHtml(c: WorkbenchCard, selectedEmployeeId: string | null, showPhotos: boolean): string {
  const others = UNIT_IDS.filter((u) => u !== c.unit)
  const otherText = others.map((u) => `${u} ${c.contributions[u].toFixed(2)}`).join(' ／ ')
  const selected = c.employee.id === selectedEmployeeId
  // 氏名は Firestore 由来の外部入力。未登録なら社員番号だけの従来表示に戻る（受入基準2）。
  const nameHtml = c.profile?.name ? ` <span class="wb-card-name">${escapeHtml(c.profile.name)}</span>` : ''
  return `
    <div class="wb-card${selected ? ' selected' : ''}${showPhotos ? ' with-photo' : ''}" draggable="true" data-emp="${escapeAttr(c.employee.id)}" tabindex="0">
      ${showPhotos ? buildCardFaceHtml(c) : ''}
      <div class="wb-card-body">
        <div class="wb-card-id">${escapeHtml(c.employee.id)}${nameHtml}</div>
        <span class="wb-card-type">${c.type}</span>
        <div class="wb-card-main">${c.contributions[c.unit].toFixed(2)}</div>
        <div class="wb-card-others">${otherText}</div>
      </div>
    </div>`
}

/** 列の生成が共通で読む文脈。事業部ごとに作り直す必要のない値をまとめてある。 */
interface ColumnContext {
  state: WorkbenchState
  evaluation: WhatIfEvaluation
  /** 全社員ぶんのカード（並び替え済み）。事業部で絞るのは各列側 */
  sortedCards: WorkbenchCard[]
  selectedEmployeeId: string | null
  /** 顔写真サムネイルを出すか（§4.6） */
  showPhotos: boolean
}

function buildColumnHtml(u: UnitId, ctx: ColumnContext): string {
  const { state, evaluation, sortedCards, selectedEmployeeId, showPhotos } = ctx
  const unitResult = evaluation.result.units[u]
  const baseUnitResult = state.baseline.units[u]
  const violation = evaluation.minHeadcountViolations.includes(u)
  const meterPct = clampPct(unitResult.fulfillmentRate * 100)
  const cardsHtml = sortedCards
    .filter((c) => c.unit === u)
    .map((c) => buildCardHtml(c, selectedEmployeeId, showPhotos))
    .join('')
  return `
    <div class="wb-column${violation ? ' violation' : ''}" data-unit="${u}">
      <div class="wb-unit-head">
        <div class="wb-unit-title"><b>${UNIT_LABEL[u]}</b> ${unitResult.count}名 <span class="wb-unit-pct">${pct(unitResult.fulfillmentRate)}</span>${violation ? ` <span class="wb-unit-warn">⚠ 最低${state.params.minHeadcount[u]}名</span>` : ''}</div>
        <div class="meter-mini"><div class="meter-mini-fill" style="width:${meterPct.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div>
        <div class="wb-unit-sub">売上${oku1(unitResult.finalRevenue)}（${deltaText(unitResult.finalRevenue, baseUnitResult.finalRevenue)}）</div>
      </div>
      <div class="wb-cards">${cardsHtml}</div>
    </div>`
}

/**
 * 保存時の命名フォーム（docs/export-plan.md §4.8）。`savingTitle` が null なら閉じている。
 * 別ダイアログにせず操作列の直下に開く。制約違反があっても保存自体は止めない（§4.5）。
 */
function buildSaveFormHtml(savingTitle: string | null, violation: boolean): string {
  if (savingTitle === null) return ''
  return `
    <div class="wb-save-form">
      <label class="wb-save-label">この配置案の名前
        <input type="text" id="wb-save-title" class="wb-save-input" maxlength="80" value="${escapeAttr(savingTitle)}">
      </label>
      <button type="button" class="btn" data-wb-action="save-confirm">保存する</button>
      <button type="button" class="btn secondary" data-wb-action="save-cancel">やめる</button>
      ${violation ? '<p class="warn-text">制約違反があります。記録としては保存できますが、CSV・PDFの出力はできません。</p>' : ''}
    </div>`
}

function buildActionsHtml(
  state: WorkbenchState,
  evaluation: WhatIfEvaluation,
  sortKey: WorkbenchSortKey,
  showPhotos: boolean,
  savingTitle: string | null,
): string {
  const violation = hasViolation(evaluation)
  const diffs = diffAssignment(state.baseline.assignment, state.assignment)
  const diffText = diffs.length === 0 ? '異動なし' : diffs.map((d) => `${d.from}→${d.to} ${d.count}名`).join(' ／ ')
  const sortOptionsHtml = SORT_OPTIONS.map(
    (o) => `<option value="${o.key}"${o.key === sortKey ? ' selected' : ''}>${o.label}</option>`,
  ).join('')
  return `
    <div class="wb-actions">
      <div class="wb-actions-left">
        <label class="wb-sort-label">並び順：<select id="wb-sort" class="wb-sort">${sortOptionsHtml}</select></label>
        <label class="wb-photo-label"><input type="checkbox" id="wb-show-photos"${showPhotos ? ' checked' : ''}>顔写真</label>
      </div>
      <div class="wb-actions-right">
        <button type="button" class="btn secondary" data-wb-action="undo"${state.history.length === 0 ? ' disabled' : ''}>元に戻す</button>
        <button type="button" class="btn secondary" data-wb-action="reset">最適解に戻す</button>
        <button type="button" class="btn secondary" data-wb-action="resolve">この人数配分のまま最適に組み直す</button>
        <button type="button" class="btn" data-wb-action="save"${savingTitle === null ? '' : ' disabled'}>この案を保存</button>
      </div>
    </div>
    ${buildSaveFormHtml(savingTitle, violation)}
    <p class="wb-diff">異動の内訳：${diffText}</p>`
}

/** 作業机パネル全体のHTMLを組み立てる（純粋関数・DOM非依存）。 */
export function buildWorkbenchHtml(data: WorkbenchViewData): string {
  const { state, sortKey, selectedEmployeeId, alertText } = data
  // 既定はON（§8-5）。この機能の目的が「誰かを分かるようにする」ことなので、
  // 既定でOFFだと機能に気づかれないまま終わる。
  const showPhotos = data.showPhotos ?? true
  const evaluation = evaluate(state)
  // カードの組み立て（100名×3事業部の貢献度）と並び替えは事業部に依存しないので、
  // 列ごとに作り直さず1回で済ませる（従来は3列それぞれで buildWorkbenchCards を呼び直していた）。
  const ctx: ColumnContext = {
    state,
    evaluation,
    sortedCards: sortCards(buildWorkbenchCards(state), sortKey),
    selectedEmployeeId,
    showPhotos,
  }
  const columnsHtml = UNIT_IDS.map((u) => buildColumnHtml(u, ctx)).join('')
  return (
    buildAlertHtml(alertText) +
    buildHeaderHtml(state, evaluation) +
    `<div class="wb-board">${columnsHtml}</div>` +
    buildActionsHtml(state, evaluation, sortKey, showPhotos, data.savingTitle ?? null) +
    // ドラッグ中の増減プレビュー。列ヘッダに置くと長い列の下端を掴んでいるとき画面外に出て読めないため、
    // カーソル追従の浮動バッジにしている。ドラッグ中はstateが変わらず再描画も起きないので、
    // このHTMLに含めておけばドラッグ開始から終了まで生き残る。
    `<div class="wb-drag-badge" hidden></div>`
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
  /** いまプレビューを出している列。同じ列の中で動いている間は再計算しないための番人（§7） */
  dragHoverUnit: UnitId | null
  alertText: string | null
  /** alertText を出した原因の種類。原因が解消されたら自動で消すための判定に使う */
  alertKind: 'revenue' | 'headcount' | null
  /** 顔写真サムネイルの表示（§4.6）。作業机を開き直しても保つ（毎回切り直させない） */
  showPhotos: boolean
  /** 保存時の命名フォーム（export-plan.md §4.8）。null なら閉じている */
  savingTitle: string | null
} = { state: null, sortKey: 'id', selectedEmployeeId: null, dragEmployeeId: null, dragBaseRevenue: 0, dragHoverUnit: null, alertText: null, alertKind: null, showPhotos: true, savingTitle: null }

/** 保存された配置案を受け取る側（#p7 の出力画面へ渡す）。renderer.ts が配線する。 */
let onSaved: (run: SavedRun) => void = () => {}

/** 表示中の警告が指す原因（全社売上不足／最低人数割れ）が解消されていれば自動で消す。 */
function clearAlertIfResolved(evaluation: WhatIfEvaluation): void {
  if (!view.alertKind) return
  const resolved = view.alertKind === 'revenue' ? evaluation.result.feasible : evaluation.minHeadcountViolations.length === 0
  if (resolved) {
    view.alertText = null
    view.alertKind = null
  }
}

function render(): void {
  if (!view.state) return
  setHtml('wb-root', buildWorkbenchHtml({ state: view.state, sortKey: view.sortKey, selectedEmployeeId: view.selectedEmployeeId, alertText: view.alertText, showPhotos: view.showPhotos, savingTitle: view.savingTitle }))
}

/** #p4 のカードから遷移してきた初期状態で作業机を開く（機能15・§4.1）。 */
export function openWorkbench(initial: WorkbenchState): void {
  view.state = initial
  view.sortKey = 'id'
  view.selectedEmployeeId = null
  view.alertText = null
  view.alertKind = null
  view.dragEmployeeId = null
  view.dragHoverUnit = null
  view.savingTitle = null
  render()
}

/** 保存フォームの既定名（§4.8）。 */
function defaultRunTitle(state: WorkbenchState): string {
  return `課題${state.task} 配置案 ${new Date().toISOString().slice(0, 10)}`
}

/**
 * いまの配置を1件追記し、出力画面へ渡す（§4.1）。
 * 制約違反があっても保存は止めない。出力側で止める（§4.5）。
 */
async function commitSave(): Promise<void> {
  const state = view.state
  if (!state) return
  const title = ($('wb-save-title') as HTMLInputElement | null)?.value.trim() || defaultRunTitle(state)
  const evaluation = evaluate(state)
  try {
    const run = await withLoading('配置案を保存しています…', async () =>
      saveRun({
        title,
        task: state.task,
        metric: state.metric,
        assignment: { ...state.assignment },
        params: state.params,
        roster: state.roster,
        // 出力の可否は「全社売上下限」と「最低人数」の両方で決まる（§4.5）。
        // result.feasible は売上下限しか見ないのでそのままでは使えない。
        feasible: !hasViolation(evaluation),
        companyRevenue: evaluation.result.companyRevenue,
        companyProfit: evaluation.result.companyProfit,
        movedFromBaseline: evaluation.movedFromBaseline,
      }),
    )
    view.savingTitle = null
    render()
    onSaved(run)
  } catch (e) {
    console.warn('配置案の保存に失敗しました。', e)
    view.alertText = '保存できませんでした。通信状態を確認してもう一度お試しください。'
    view.alertKind = null
    render()
  }
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
    view.alertKind = !after.result.feasible ? 'revenue' : 'headcount'
    view.alertText = !after.result.feasible
      ? `全社売上が${state.params.prevYearRevenue}億円を下回りました（現在${oku(after.result.companyRevenue)}）`
      : `最低人数を割りました（${after.minHeadcountViolations.join('・')}）`
  } else {
    clearAlertIfResolved(after)
  }
  render()
}

function handleAction(action: string): void {
  const state = view.state
  if (!state) return
  if (action === 'undo') {
    view.state = undo(state)
    view.selectedEmployeeId = null
    clearAlertIfResolved(evaluate(view.state))
    render()
  } else if (action === 'reset') {
    view.state = resetToBaseline(state)
    view.selectedEmployeeId = null
    view.alertText = null
    view.alertKind = null
    render()
  } else if (action === 'resolve') {
    const counts = headcountOf(state.assignment, state.roster)
    const assignment = solveForHeadcount(state.roster, state.task, counts, state.params, state.metric)
    view.state = withAssignment(state, assignment)
    clearAlertIfResolved(evaluate(view.state))
    render()
  } else if (action === 'save') {
    view.savingTitle = defaultRunTitle(state)
    render()
  } else if (action === 'save-cancel') {
    view.savingTitle = null
    render()
  } else if (action === 'save-confirm') {
    void commitSave()
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
  if (target instanceof HTMLInputElement && target.id === 'wb-show-photos') {
    view.showPhotos = target.checked
    render()
    return
  }
  if (!(target instanceof HTMLSelectElement) || target.id !== 'wb-sort') return
  view.sortKey = target.value as WorkbenchSortKey
  render()
}

/** イベント発生位置の事業部列。ドラッグ系4ハンドラが同じ探索をしていたのを1箇所に。 */
function columnAt(e: Event): HTMLElement | null {
  return (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-unit]') ?? null
}

/** カーソル追従バッジ。表示中の寸法を持っておき、画面端でのはみ出し補正を計測なしで済ませる。 */
let badgeSize = { w: 0, h: 0 }

function dragBadgeEl(): HTMLElement | null {
  return $('wb-root')?.querySelector<HTMLElement>('.wb-drag-badge') ?? null
}

/** バッジをカーソルの右下に置く。画面右端・下端では内側へ折り返す。 */
function moveDragBadge(x: number, y: number): void {
  const el = dragBadgeEl()
  if (!el || el.hidden) return
  const gap = 14
  const edge = 8
  el.style.left = `${Math.max(edge, Math.min(x + gap, window.innerWidth - badgeSize.w - edge))}px`
  el.style.top = `${Math.max(edge, Math.min(y + gap, window.innerHeight - badgeSize.h - edge))}px`
}

/** 列のドロップ強調を消す。 */
function clearDropHint(colEl: Element | null | undefined): void {
  colEl?.classList.remove('drop-hover')
}

/** どの列にもプレビューが出ていない状態へ戻す。 */
function clearAllDropHints(): void {
  if (view.dragHoverUnit === null) return
  $('wb-root')?.querySelectorAll<HTMLElement>('[data-unit]').forEach((el) => clearDropHint(el))
  const el = dragBadgeEl()
  if (el) el.hidden = true
  view.dragHoverUnit = null
}

/** その列へ移した場合の全社売上差をバッジに出し、列を強調する。 */
function showDropHint(colEl: HTMLElement, unit: UnitId): void {
  const state = view.state
  if (!state || !view.dragEmployeeId) return
  const preview = previewMove(state, view.dragEmployeeId, unit)
  const d = round2(preview.companyRevenue - view.dragBaseRevenue)
  const el = dragBadgeEl()
  if (el) {
    // バッジは列から離れて浮くので、どこへ移す話なのかを行き先の名前で示す
    el.textContent = `${UNIT_LABEL[unit]}へ移すと 全社売上 ${signed(d)}億円`
    el.hidden = false
    badgeSize = { w: el.offsetWidth, h: el.offsetHeight }
  }
  colEl.classList.add('drop-hover')
  view.dragHoverUnit = unit
}

function handleDragStart(e: DragEvent): void {
  const cardEl = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-emp]')
  const state = view.state
  if (!cardEl || !state) return
  const id = cardEl.dataset.emp ?? ''
  view.dragEmployeeId = id
  view.dragHoverUnit = null
  // ドラッグ中に state は変わらないので、比較の基準はここで1回だけ求める
  view.dragBaseRevenue = evaluate(state).result.companyRevenue
  e.dataTransfer?.setData('text/plain', id)
}

/**
 * プレビューの表示位置判定はここに一本化する（機能15の判定幅拡張）。
 * dragenter/dragleave は列の中の社員カードをまたぐたびに発火し、しかも
 * 「新しい要素へenter → 古い要素をleave」の順で来るため、enterで出した吹き出しを
 * 直後のleaveが消してしまい、実質ヘッダ周辺でしか見えなかった。
 * dragoverなら列の全域（社員カードの上を含む）で毎フレーム位置が取れる。
 * 重い previewMove は列が変わったときだけ呼ぶので、毎フレームの計算にはならない（§7）。
 */
function handleDragOver(e: DragEvent): void {
  const colEl = columnAt(e)
  if (!colEl) {
    clearAllDropHints()
    return
  }
  e.preventDefault()
  const unit = colEl.dataset.unit as UnitId
  if (unit !== view.dragHoverUnit) {
    clearAllDropHints()
    showDropHint(colEl, unit)
  }
  // 位置合わせだけは毎フレーム。計算は伴わない
  moveDragBadge(e.clientX, e.clientY)
}

function handleDragEnter(e: DragEvent): void {
  // 表示はdragover側の担当。ここはドロップ先として認めるpreventDefaultのみ。
  if (columnAt(e)) e.preventDefault()
}

function handleDragLeave(e: DragEvent): void {
  // 作業机の外へ出たときだけ消す。列や社員カードをまたぐdragleaveでは消さない。
  // relatedTargetを返さないブラウザでは何もせず、dragend側の全消しに任せる。
  const root = $('wb-root')
  const to = e.relatedTarget as Node | null
  if (root && to && !root.contains(to)) clearAllDropHints()
}

function handleDrop(e: DragEvent): void {
  e.preventDefault()
  const colEl = columnAt(e)
  clearAllDropHints()
  const id = e.dataTransfer?.getData('text/plain') || view.dragEmployeeId
  view.dragEmployeeId = null
  if (colEl && id) commitMove(id, colEl.dataset.unit as UnitId)
}

function handleDragEnd(): void {
  view.dragEmployeeId = null
  clearAllDropHints()
}

/**
 * 作業机の委譲リスナを1回だけ張る（`#p4-bench-step` は骨格のみindex.htmlに存在し、
 * `#wb-root` はopenWorkbench以降しかDOMを持たないため、要素の有無に関わらず登録できる
 * `document` への委譲にはせず、`#wb-root` 自体に張る＝要素は起動時から存在する空divでよい）。
 */
export function initWorkbenchPanel(onSavedRun: (run: SavedRun) => void): void {
  onSaved = onSavedRun
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
