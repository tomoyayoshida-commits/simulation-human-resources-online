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
  isLocked,
  listMoves,
  previewMove,
  resetToBaseline,
  sortCards,
  undo,
  withAssignment,
  withLockToggled,
  withMove,
  type WorkbenchCard,
  type WorkbenchSortKey,
  type WorkbenchState,
} from './workbench.ts'
import { solveForHeadcount } from './optimizer.ts'
import { saveRun, titleExists, type SavedRun } from './runStore.ts'
import { readCompareDraft, saveCompareDraft, toWorkbenchState } from './draftStore.ts'
import { withLoading } from './loading.ts'
import { taskLabel, UNIT_IDS, UNIT_LABEL } from './constants.ts'
import { createDragController } from './workbenchDnd.ts'
import { deltaText, escapeAttr, escapeHtml, oku, pill, shortDateTime, signed } from './format.ts'
import {
  buildAbilityBarsHtml,
  buildAlertHtml,
  buildCardFaceHtml,
  buildConstraintNoteHtml,
  buildDraftButtonsHtml,
  buildDraftNoteHtml,
  buildLockButtonHtml,
  buildMoveChipsHtml,
  buildNextStepHtml,
  CONTRIBUTION_NOTE_HTML,
  buildSaveFormHtml,
  buildSortOptionsHtml,
  buildUnitColumnHtml,
  DRAG_BADGE_HTML,
  type AbilityShade,
  type SaveFormIds,
} from './workbenchView.ts'
import { $, setHtml } from './dom.ts'

// ---- 純粋関数：HTML生成（テスト対象） ----

/** 共有部品に渡す #p4 側の目印。#p5 は同じ形で hwb- を使う（workbenchView.ts）。 */
const SAVE_FORM_IDS: SaveFormIds = {
  inputId: 'wb-save-title',
  actionAttr: 'data-wb-action',
  label: 'この配置案の名前',
}
const ALERT_DISMISS_ATTR = 'data-wb-alert-dismiss'
/** 個人ロックの錠前ボタンの目印（①25）。#p5 は data-hwb-lock を使う。 */
const LOCK_ATTR = 'data-wb-lock'

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
   * 能力バーを出すか（docs/ability-bars-plan.md §3.3）。既定は true。
   * 貢献度は重み付き合成値で初見では検算できないため、既定ONで内訳が見える状態にしておく。
   * 出すとカード1枚が高くなり列に同時に見える枚数が減るので、俯瞰したいときはOFFにできる。
   */
  showAbilities?: boolean
  /**
   * 保存時の命名フォームの状態（docs/export-plan.md §4.8）。
   * `null` なら閉じている。文字列ならその値を初期値にして開いている。
   */
  savingTitle?: string | null
  /** 保存フォーム直下に出す保存失敗の理由（同名衝突・通信失敗）。`null`/未指定なら非表示。 */
  saveError?: string | null
  /** 一時保存されている盤面の保存時刻（ISO・draftStore.ts）。`null`/未指定なら下書き無し。 */
  draftSavedAt?: string | null
  /** 一時保存・読み込みの結果報告。`null`/未指定なら非表示。 */
  draftNote?: string | null
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
    <p class="subtitle">最適解を出発点に人手で寄せ、そのコストをその場で確認する。</p>
    <!-- ②28: 「最適解」が何を指すかを画面に書く。Δの基準もこれ -->
    <details class="wb-detail">
      <summary class="detail-summary">詳細</summary>
      <p class="subtitle">ここでいう<b>最適解</b>とは、取り込んだ${state.roster.length}名と現在の前提条件のもとで
        「${taskLabel(state.task, state.metric)}」を最大化する配置のことです（この盤面の出発点）。</p>
    </details>
    <div class="wb-header-row">
      <div class="wb-totals">
        <div class="wb-stat"><span class="k">全社売上</span><span class="v">${oku(result.companyRevenue)}</span><span class="d">最適解比 ${deltaText(result.companyRevenue, baseline.companyRevenue)}</span></div>
        <div class="wb-stat"><span class="k">全社利益</span><span class="v">${oku(result.companyProfit)}</span><span class="d">最適解比 ${deltaText(result.companyProfit, baseline.companyProfit)}</span></div>
        <div class="wb-stat"><span class="k">異動</span><span class="v">${evaluation.movedFromBaseline}名</span><span class="d">最適解から</span></div>
      </div>
      ${buildConstraintNoteHtml(state.params.prevYearRevenue, state.params.minHeadcount)}
    </div>
    <div class="wb-status">${statusPill}${minHcPill}</div>
    ${buildNextStepHtml(result.feasible, evaluation.minHeadcountViolations)}`
}

function buildCardHtml(
  c: WorkbenchCard,
  selectedEmployeeId: string | null,
  showPhotos: boolean,
  /** 能力バーの濃淡（docs/ability-bars-plan.md §3）。null なら能力バー自体を出さない */
  abilityShade: AbilityShade | null,
): string {
  const others = UNIT_IDS.filter((u) => u !== c.unit)
  const otherText = others.map((u) => `${u} ${c.contributions[u].toFixed(2)}`).join(' ／ ')
  const selected = c.employee.id === selectedEmployeeId
  // 氏名は Firestore 由来の外部入力。未登録なら社員番号だけの従来表示に戻る（受入基準2）。
  const nameHtml = c.profile?.name ? ` <span class="wb-card-name">${escapeHtml(c.profile.name)}</span>` : ''
  return `
    <div class="wb-card${selected ? ' selected' : ''}${showPhotos ? ' with-photo' : ''}${c.locked ? ' wb-locked' : ''}" draggable="${c.locked ? 'false' : 'true'}" data-emp="${escapeAttr(c.employee.id)}" tabindex="0">
      ${showPhotos ? buildCardFaceHtml(c) : ''}
      <div class="wb-card-body">
        <div class="wb-card-id">${escapeHtml(c.employee.id)}${nameHtml}${buildLockButtonHtml(c.employee.id, c.locked, LOCK_ATTR)}</div>
        <span class="wb-card-type">${c.type}</span>
        <div class="wb-card-main">${c.contributions[c.unit].toFixed(2)}</div>
        <div class="wb-card-others">${otherText}</div>
        ${abilityShade ? buildAbilityBarsHtml(c.employee, abilityShade) : ''}
      </div>
    </div>`
}

function buildActionsHtml(
  state: WorkbenchState,
  evaluation: WhatIfEvaluation,
  sortKey: WorkbenchSortKey,
  showPhotos: boolean,
  showAbilities: boolean,
  savingTitle: string | null,
  saveError: string | null,
  /** 一時保存の状態（draftStore.ts）。savedAt が null なら下書き無し */
  draft: { savedAt: string | null; note: string | null },
): string {
  const violation = hasViolation(evaluation)
  const diffs = diffAssignment(state.baseline.assignment, state.assignment)
  const diffText = diffs.length === 0 ? '異動なし' : diffs.map((d) => `${d.from}→${d.to} ${d.count}名`).join(' ／ ')
  // ①24: 集計行の下に「誰が」を1名ずつ出す。元の所属はチップの色帯で示す
  const moveChipsHtml = buildMoveChipsHtml(
    listMoves(state.baseline.assignment, state.assignment).map((m) => ({
      employeeId: m.employeeId,
      transition: `${m.from}→${m.to}`,
      from: m.from,
      name: state.profiles?.[m.employeeId]?.name,
    })),
  )
  const sortOptionsHtml = buildSortOptionsHtml(sortKey)
  // ①25: 組み直しは全員を配置し直すのでロックした社員も動く。#p5 の lockBase と同じ扱いで止める
  // （optimizer が固定制約を受け取れないため。docs/hiring-workbench-plan.md §5.6 と同じ判断）。
  const resolveAttr =
    (state.lockedIds?.length ?? 0) > 0 ? ' disabled title="固定した社員がいます。固定を外すと実行できます"' : ''
  return `
    <div class="wb-actions">
      <div class="wb-actions-left">
        <label class="wb-sort-label">並び順：<select id="wb-sort" class="wb-sort">${sortOptionsHtml}</select></label>
        <label class="wb-photo-label"><input type="checkbox" id="wb-show-photos"${showPhotos ? ' checked' : ''}>顔写真</label>
        <label class="wb-photo-label" title="カードに4能力値のバーを出す。濃い部分がこの事業部での寄与"><input type="checkbox" id="wb-show-abilities"${showAbilities ? ' checked' : ''}>能力値</label>
      </div>
      <div class="wb-actions-right">
        <button type="button" class="btn secondary" data-wb-action="undo"${state.history.length === 0 ? ' disabled' : ''}>元に戻す</button>
        <button type="button" class="btn secondary" data-wb-action="reset" title="出発点（最適解）の配置に戻す">リセット</button>
        <button type="button" class="btn secondary" data-wb-action="resolve"${resolveAttr}>この人数配分のまま最適に組み直す</button>
        ${buildDraftButtonsHtml(draft.savedAt, 'data-wb-action')}
        <button type="button" class="btn" data-wb-action="save"${savingTitle === null ? '' : ' disabled'}>この案を保存</button>
      </div>
    </div>
    ${buildDraftNoteHtml(draft.note)}
    ${buildSaveFormHtml(savingTitle, violation, saveError, SAVE_FORM_IDS)}
    <p class="wb-diff">異動の内訳：${diffText}</p>
    ${moveChipsHtml}
    <details class="wb-detail">
      <summary class="detail-summary">詳細</summary>
      ${CONTRIBUTION_NOTE_HTML}
    </details>`
}

/** 作業机パネル全体のHTMLを組み立てる（純粋関数・DOM非依存）。 */
export function buildWorkbenchHtml(data: WorkbenchViewData): string {
  const { state, sortKey, selectedEmployeeId, alertText } = data
  // 既定はON（§8-5）。この機能の目的が「誰かを分かるようにする」ことなので、
  // 既定でOFFだと機能に気づかれないまま終わる。
  const showPhotos = data.showPhotos ?? true
  // 既定はON（docs/ability-bars-plan.md §3.3）。顔写真と同じ理由で、既定OFFだと気づかれない。
  const showAbilities = data.showAbilities ?? true
  const evaluation = evaluate(state)
  // カードの組み立て（100名×3事業部の貢献度）と並び替えは事業部に依存しないので、
  // 列ごとに作り直さず1回で済ませる（従来は3列それぞれで buildWorkbenchCards を呼び直していた）。
  const sortedCards = sortCards(buildWorkbenchCards(state), sortKey)
  const columnsHtml = UNIT_IDS.map((u) =>
    buildUnitColumnHtml(u, {
      slotAttr: 'data-unit',
      unitResult: evaluation.result.units[u],
      baseUnitResult: state.baseline.units[u],
      baselineLabel: '最適解比',
      violation: evaluation.minHeadcountViolations.includes(u),
      minHeadcount: state.params.minHeadcount[u],
      cardsHtml: sortedCards
        .filter((c) => c.unit === u)
        // 濃淡の重みは定数ではなく現在の前提パラメータから取る（オプションで変更可能・§1）
        .map((c) =>
          buildCardHtml(c, selectedEmployeeId, showPhotos, showAbilities ? { unit: u, weights: state.params.weights[u] } : null),
        )
        .join(''),
    }),
  ).join('')
  return (
    buildAlertHtml(alertText, ALERT_DISMISS_ATTR) +
    buildHeaderHtml(state, evaluation) +
    `<div class="wb-board">${columnsHtml}</div>` +
    buildActionsHtml(state, evaluation, sortKey, showPhotos, showAbilities, data.savingTitle ?? null, data.saveError ?? null, {
      savedAt: data.draftSavedAt ?? null,
      note: data.draftNote ?? null,
    }) +
    DRAG_BADGE_HTML
  )
}

// ---- DOM配線（未テスト・compareTasks.tsと同じ方針） ----

const view: {
  state: WorkbenchState | null
  sortKey: WorkbenchSortKey
  selectedEmployeeId: string | null
  alertText: string | null
  /** alertText を出した原因の種類。原因が解消されたら自動で消すための判定に使う */
  alertKind: 'revenue' | 'headcount' | null
  /** 顔写真サムネイルの表示（§4.6）。作業机を開き直しても保つ（毎回切り直させない） */
  showPhotos: boolean
  /** 能力バーの表示（ability-bars-plan.md §3.3）。showPhotos と同じく開き直しても保つ */
  showAbilities: boolean
  /** 保存時の命名フォーム（export-plan.md §4.8）。null なら閉じている */
  savingTitle: string | null
  /** 保存フォーム直下に出す保存失敗の理由（同名衝突・通信失敗）。null なら非表示 */
  saveError: string | null
  /**
   * 一時保存されている盤面の保存時刻（draftStore.ts）。null なら下書き無し。
   * 再描画のたびに localStorage を読み直すとドラッグ中も含めて毎回パースが走るので、
   * 作業机を開いたときと一時保存を操作したときだけ更新する
   */
  draftSavedAt: string | null
  /** 一時保存・読み込みの結果報告。null なら非表示 */
  draftNote: string | null
} = {
  state: null,
  sortKey: 'id',
  selectedEmployeeId: null,
  alertText: null,
  alertKind: null,
  showPhotos: true,
  showAbilities: true,
  savingTitle: null,
  saveError: null,
  draftSavedAt: null,
  draftNote: null,
}

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
  setHtml('wb-root', buildWorkbenchHtml({ state: view.state, sortKey: view.sortKey, selectedEmployeeId: view.selectedEmployeeId, alertText: view.alertText, showPhotos: view.showPhotos, showAbilities: view.showAbilities, savingTitle: view.savingTitle, saveError: view.saveError, draftSavedAt: view.draftSavedAt, draftNote: view.draftNote }))
}

/** #p4 のカードから遷移してきた初期状態で作業机を開く（機能15・§4.1）。 */
export function openWorkbench(initial: WorkbenchState): void {
  view.state = initial
  view.sortKey = 'id'
  view.selectedEmployeeId = null
  view.alertText = null
  view.alertKind = null
  view.savingTitle = null
  view.saveError = null
  // 下書きの有無は開いた時点で1回だけ読む（以後の再描画では読み直さない）
  view.draftSavedAt = readCompareDraft()?.savedAt ?? null
  view.draftNote = null
  drag.reset()
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
    if (await withLoading('確認しています…', async () => titleExists(title))) {
      view.saveError = `「${title}」という名前は既に保存されています。別の名前を付けてください。`
      render()
      return
    }
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
    view.saveError = null
    render()
    onSaved(run)
  } catch (e) {
    console.warn('配置案の保存に失敗しました。', e)
    view.saveError = '保存できませんでした。通信状態を確認してもう一度お試しください。'
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
    // ①27注記: バナーには現在値を書かない。バナーは操作を続けても残るため、書いた瞬間の値が
    // すぐ古くなる（現在値はヘッダの全社売上に常時出ており、そちらは再描画のたびに更新される）。
    view.alertText = !after.result.feasible
      ? `全社売上が下限（${state.params.prevYearRevenue}億円）を下回りました`
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
    view.saveError = null
    render()
  } else if (action === 'save-cancel') {
    view.savingTitle = null
    view.saveError = null
    render()
  } else if (action === 'save-confirm') {
    void commitSave()
  } else if (action === 'draft-save') {
    const savedAt = saveCompareDraft(state)
    view.draftSavedAt = savedAt ?? view.draftSavedAt
    view.draftNote = savedAt
      ? `いまの盤面を一時保存しました（${shortDateTime(savedAt)}）。この画面を離れても「一時保存を開く」で続きから戻れます。`
      : '一時保存できませんでした（このブラウザの保存領域が使えません）。'
    render()
  } else if (action === 'draft-load') {
    const draft = readCompareDraft()
    if (!draft) {
      view.draftSavedAt = null
      view.draftNote = '一時保存した盤面が見つかりませんでした。'
      render()
      return
    }
    // 下書きは名簿・前提パラメータ・出発点（最適解）を自分で持つので、盤面ごと入れ替える。
    // 顔写真は保存対象外なので、いま画面が持っているものを引き継ぐ（draftStore.ts 冒頭）。
    view.state = toWorkbenchState(draft, state.profiles)
    view.selectedEmployeeId = null
    view.alertText = null
    view.alertKind = null
    view.draftSavedAt = draft.savedAt
    view.draftNote = `一時保存した盤面（${shortDateTime(draft.savedAt)}）を開きました。「元に戻す」の履歴は引き継ぎません。`
    render()
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

  // ①25: 錠前ボタンはカードの中にあるので、カード選択より先に拾う
  const lockBtn = target.closest<HTMLElement>('[data-wb-lock]')
  if (lockBtn) {
    view.state = withLockToggled(view.state, lockBtn.dataset.wbLock ?? '')
    render()
    return
  }

  const cardEl = target.closest<HTMLElement>('[data-emp]')
  if (cardEl) {
    const id = cardEl.dataset.emp ?? ''
    // ロック中の社員は選べない（選んでも行き先の列を押した時点で弾かれ、無反応に見えるため）
    if (isLocked(view.state, id)) return
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
  if (target instanceof HTMLInputElement && target.id === 'wb-show-abilities') {
    view.showAbilities = target.checked
    render()
    return
  }
  if (!(target instanceof HTMLSelectElement) || target.id !== 'wb-sort') return
  view.sortKey = target.value as WorkbenchSortKey
  render()
}

/**
 * ドラッグ&ドロップは workbenchDnd.ts と共有する（#p5 と処理が同一だったため）。
 * #p4 は置けない列が無いので accept は常に true、掴めない社員も無いので canGrab も常に true。
 */
const drag = createDragController<UnitId>({
  rootId: 'wb-root',
  slotSelector: '[data-unit]',
  slotOf: (colEl) => colEl.dataset.unit as UnitId,
  isReady: () => view.state !== null,
  canGrab: () => true,
  accept: () => true,
  baseRevenue: () => (view.state ? evaluate(view.state).result.companyRevenue : 0),
  previewRevenue: (id, unit) => (view.state ? previewMove(view.state, id, unit).companyRevenue : 0),
  badgeText: (unit, d) => `${UNIT_LABEL[unit]}へ移すと 全社売上 ${signed(d)}億円`,
  onDrop: commitMove,
})

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
  drag.attach(root)
}
