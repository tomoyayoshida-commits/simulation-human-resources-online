// 機能15b 採用判断の作業机（docs/hiring-workbench-plan.md §5.3〜§5.11 Phase3/4）。
// 表示専用（計算持たない・CLAUDE.md §5）。
//
// workbenchPanel.ts と同じ構成：HTML生成（buildHiringWorkbenchHtml以下）は純粋関数でテストでき、
// DOM配線（openHiringWorkbench以下）は `#hwb-root` への委譲リスナ1組だけを1回張る。
//
// #p4 の作業机との違いは4列目「採用候補プール」とロックの2点。列の `data-hslot` は
// UnitId ではなく HiringSlot（'A'|'B'|'C'|'pool'）を持つ。`data-unit` を使わないのは、
// #p4 と同じ属性名にすると「事業部の列」という前提のコードを共有したときに pool が紛れ込むため。

import type { UnitId } from './types.ts'
import type { WhatIfEvaluation } from './whatif.ts'
import {
  addedCost,
  buildHiringCards,
  canMove,
  canPlace,
  declinedCandidates,
  isCandidate,
  diffWithPool,
  evaluateHiring,
  hiredCandidates,
  previewMoveTo,
  resetToStart,
  serializeHiringWorkbenchState,
  undo,
  withAssignment,
  withMoveTo,
  type HiringCard,
  type HiringSlot,
  type HiringWorkbenchState,
} from './hiringWorkbench.ts'
import { headcountOf } from './whatif.ts'
import { solveForHeadcount } from './optimizer.ts'
import { saveRun, titleExists, type SavedRun } from './runStore.ts'
import { withLoading } from './loading.ts'
import { taskLabel, UNIT_IDS, UNIT_LABEL } from './constants.ts'
import { createDragController } from './workbenchDnd.ts'
import { deltaText, escapeAttr, escapeHtml, oku, pill, signed } from './format.ts'
import {
  buildAlertHtml,
  buildCardFaceHtml,
  buildConstraintNoteHtml,
  buildNextStepHtml,
  CONTRIBUTION_NOTE_HTML,
  buildSaveFormHtml,
  buildSortOptionsHtml,
  buildUnitColumnHtml as buildUnitColumn,
  DRAG_BADGE_HTML,
  type SaveFormIds,
} from './workbenchView.ts'
import { $, setHtml } from './dom.ts'
import { hasViolation, sortCards, type WorkbenchCard, type WorkbenchSortKey } from './workbench.ts'

// ---- 純粋関数：HTML生成（テスト対象） ----

/** 共有部品に渡す #p5 側の目印（#p4 は workbenchPanel.ts に同じ形で置いてある）。 */
const SAVE_FORM_IDS: SaveFormIds = {
  inputId: 'hwb-save-title',
  actionAttr: 'data-hwb-action',
  label: 'この採用案の名前',
}
const ALERT_DISMISS_ATTR = 'data-hwb-alert-dismiss'

/** 盤面の列の並び。3事業部のあとにプールを置く（§5.3）。 */
const SLOTS: HiringSlot[] = [...UNIT_IDS, 'pool']

export interface HiringWorkbenchViewData {
  state: HiringWorkbenchState
  sortKey: WorkbenchSortKey
  selectedEmployeeId: string | null
  /** 直近の操作で feasible→infeasible に変わったときの一過性の警告（§5.9）。null なら非表示。 */
  alertText: string | null
  showPhotos?: boolean
  /** 保存時の命名フォームの状態。null なら閉じている（機能16 §4.8 と同じ作法）。 */
  savingTitle?: string | null
  /** 保存フォーム直下に出す保存失敗の理由（同名衝突・通信失敗）。`null`/未指定なら非表示。 */
  saveError?: string | null
}

/**
 * 2段Δの1行（§5.4）。上段＝採用の効果（採用前比）、下段＝手で譲った分（最適解比）。
 * afterBaseline が無い（採用後に実行可能解が無い）ときは下段を「—」にする。
 */
function buildStatHtml(label: string, value: string, beforeDelta: string, afterDelta: string | null): string {
  return `
    <div class="hwb-stat">
      <span class="k">${label}</span>
      <span class="v">${value}</span>
      <span class="d">採用前比 ${beforeDelta}</span>
      <span class="d2">最適解比 ${afterDelta ?? '—（採用後の実行可能解なし）'}</span>
    </div>`
}

function buildHeaderHtml(state: HiringWorkbenchState, evaluation: WhatIfEvaluation): string {
  const { result } = evaluation
  const { beforeBaseline, afterBaseline } = state
  const statusPill = !result.feasible
    ? pill('crit', `● 全社売上${state.params.prevYearRevenue}億円を下回る（現在${oku(result.companyRevenue)}）`)
    : pill('good', '● 制約を満たす')
  const minHcPill =
    evaluation.minHeadcountViolations.length > 0
      ? pill('warn', `● 最低人数割れ：${evaluation.minHeadcountViolations.join('・')}`)
      : ''
  const hired = hiredCandidates(state).length
  // 分岐1は「現行配置を起点」、分岐2は「採用前の最適解を起点」。どちらの検討なのかを常に出す（§5.1）
  const originText = state.branch === 'existing' ? '現行配置を起点' : '採用前の最適解を起点'
  // チェックボックスは両方の分岐で出す。分岐2でも既存社員の異動を検討したい場面はあり、
  // 出さないと lockBase を切り替える手段が無くなって既存100名が一切動かせなくなる。
  // 既定値の違い（分岐1はON・分岐2はOFF）は renderer.ts の起動時に決める。
  const lockHtml = `<label class="hwb-lock"><input type="checkbox" id="hwb-lock"${state.lockBase ? ' checked' : ''}>既存${state.base.length}名を固定する</label>`
  return `
    <h2>採用判断の作業机：${escapeHtml(originText)}（${taskLabel(state.task, state.metric)}）</h2>
    <!-- ②28: 2段Δの基準がそれぞれ何を指すのかを画面に書く -->
    <p class="subtitle">誰を採り、どこに置くかを1つの盤面で決める。プールに残した候補は採用しない。<br>
      <b>採用前比</b>＝採用しなかった場合（${state.branch === 'existing' ? '取り込んだ現行配置' : '採用前の最適解'}・既存${state.base.length}名）との差。
      <b>最適解比</b>＝候補を全員採用し、${state.base.length + state.candidates.length}名で
      「${taskLabel(state.task, state.metric)}」を最大化したときの配置との差です。</p>
    <div class="hwb-totals">
      ${buildStatHtml('全社売上', oku(result.companyRevenue), deltaText(result.companyRevenue, beforeBaseline.companyRevenue), afterBaseline ? deltaText(result.companyRevenue, afterBaseline.companyRevenue) : null)}
      ${buildStatHtml('全社利益', oku(result.companyProfit), deltaText(result.companyProfit, beforeBaseline.companyProfit), afterBaseline ? deltaText(result.companyProfit, afterBaseline.companyProfit) : null)}
    </div>
    <div class="hwb-hire-line">
      <span class="hwb-hire"><b>採用 ${hired}/${state.candidates.length}名</b></span>
      <span class="hwb-cost">追加人件費 ${oku(addedCost(state))}</span>
      <span class="hwb-moved">異動 ${evaluation.movedFromBaseline}名</span>
      ${lockHtml}
    </div>
    <div class="wb-status">${statusPill}${minHcPill}</div>
    ${buildConstraintNoteHtml(state.params.prevYearRevenue, state.params.minHeadcount)}
    ${buildNextStepHtml(result.feasible, evaluation.minHeadcountViolations)}`
}

/**
 * カード1枚。プールにいる候補は所属が無いので3事業部ぶんの貢献度を並べる（§5.3）。
 * ロックされた社員は draggable を外し、クリック選択もさせない。
 */
function buildCardHtml(c: HiringCard, selectedEmployeeId: string | null, showPhotos: boolean): string {
  const selected = c.employee.id === selectedEmployeeId
  const nameHtml = c.profile?.name ? ` <span class="wb-card-name">${escapeHtml(c.profile.name)}</span>` : ''
  const mainHtml = c.unit
    ? `<div class="wb-card-main">${c.contributions[c.unit].toFixed(2)}</div>
       <div class="wb-card-others">${UNIT_IDS.filter((u) => u !== c.unit).map((u) => `${u} ${c.contributions[u].toFixed(2)}`).join(' ／ ')}</div>`
    : `<div class="wb-card-others hwb-card-pool">${UNIT_IDS.map((u) => `${u} ${c.contributions[u].toFixed(2)}`).join(' ／ ')}</div>`
  const cls = ['wb-card', selected ? 'selected' : '', showPhotos ? 'with-photo' : '', c.locked ? 'hwb-locked' : '', c.isCandidate ? 'hwb-candidate' : '']
    .filter(Boolean)
    .join(' ')
  return `
    <div class="${cls}" draggable="${c.locked ? 'false' : 'true'}" data-emp="${escapeAttr(c.employee.id)}" tabindex="0">
      ${showPhotos ? buildCardFaceHtml(c) : ''}
      <div class="wb-card-body">
        <div class="wb-card-id">${c.locked ? '<span class="hwb-lock-mark" title="既存社員は固定中">🔒</span>' : ''}${escapeHtml(c.employee.id)}${nameHtml}</div>
        <span class="wb-card-type">${c.type}</span>
        ${mainHtml}
      </div>
    </div>`
}

interface ColumnContext {
  state: HiringWorkbenchState
  evaluation: WhatIfEvaluation
  sortedCards: HiringCard[]
  selectedEmployeeId: string | null
  showPhotos: boolean
}

/**
 * プール列（§5.3）。充足率メーターも売上も出さない——未採用者は事業部に属さないので
 * どちらも意味を持たないため。人数と「採用しない」ことだけを示す。
 *
 * この列は**追加採用候補の専用列**で、既存社員は入れられない（§5.5.1）。
 * 見出しに明記するのは、盤面上は他の3列と同じに見えてしまうため。
 */
function buildPoolColumnHtml(ctx: ColumnContext): string {
  const { state, sortedCards, selectedEmployeeId, showPhotos } = ctx
  const cards = sortedCards.filter((c) => c.unit === null)
  const cardsHtml = cards.map((c) => buildCardHtml(c, selectedEmployeeId, showPhotos)).join('')
  const declined = declinedCandidates(state).length
  return `
    <div class="wb-column hwb-pool" data-hslot="pool">
      <div class="wb-unit-head">
        <div class="wb-unit-title"><b>採用候補</b> ${cards.length}名<span class="hwb-pool-tag">候補のみ</span></div>
        <div class="hwb-pool-note">ここに残した${declined}名は採用しない（既存社員はこの列に入れられません）</div>
      </div>
      <div class="wb-cards">${cardsHtml}</div>
    </div>`
}

/** #p5 の事業部列。共有部品に渡す値だけを組み立てる（比較の基準は「採用前」）。 */
function buildUnitColumnHtml(u: UnitId, ctx: ColumnContext): string {
  const { state, evaluation, sortedCards, selectedEmployeeId, showPhotos } = ctx
  return buildUnitColumn(u, {
    slotAttr: 'data-hslot',
    unitResult: evaluation.result.units[u],
    baseUnitResult: state.beforeBaseline.units[u],
    baselineLabel: '採用前比',
    violation: evaluation.minHeadcountViolations.includes(u),
    minHeadcount: state.params.minHeadcount[u],
    cardsHtml: sortedCards
      .filter((c) => c.unit === u)
      .map((c) => buildCardHtml(c, selectedEmployeeId, showPhotos))
      .join(''),
  })
}

/** 異動の内訳を人が読む1行にする（§5.8）。採用・見送り・異動を区別して並べる。 */
function diffLine(state: HiringWorkbenchState): string {
  const diffs = diffWithPool(state.beforeBaseline.assignment, state.assignment, state.roster)
  if (diffs.length === 0) return '変更なし'
  return diffs
    .map((d) =>
      d.kind === 'hire'
        ? `採用→${d.to} ${d.count}名`
        : d.kind === 'decline'
          ? `${d.from}→見送り ${d.count}名`
          : `${d.from}→${d.to} ${d.count}名`,
    )
    .join(' ／ ')
}

function buildActionsHtml(
  state: HiringWorkbenchState,
  evaluation: WhatIfEvaluation,
  sortKey: WorkbenchSortKey,
  showPhotos: boolean,
  savingTitle: string | null,
  saveError: string | null,
): string {
  const violation = hasViolation(evaluation)
  const sortOptionsHtml = buildSortOptionsHtml(sortKey)
  // §5.6: ロック中の「組み直す」は既存社員を動かしてしまうので押させない。
  // optimizer.ts の内部関数（buildValues 等）が未exportで、既存固定のまま追加分だけ厳密に
  // 解く手段が無いため。export を足しにいくのではなく、ここで止める判断にしてある。
  const resolveAttr = state.lockBase
    ? ' disabled title="既存社員の固定を外すと実行できます"'
    : ''
  return `
    <div class="wb-actions">
      <div class="wb-actions-left">
        <label class="wb-sort-label">並び順：<select id="hwb-sort" class="wb-sort">${sortOptionsHtml}</select></label>
        <label class="wb-photo-label"><input type="checkbox" id="hwb-show-photos"${showPhotos ? ' checked' : ''}>顔写真</label>
      </div>
      <div class="wb-actions-right">
        <button type="button" class="btn secondary" data-hwb-action="undo"${state.history.length === 0 ? ' disabled' : ''}>元に戻す</button>
        <button type="button" class="btn secondary" data-hwb-action="reset" title="出発点（現行配置または採用前の最適解）の配置に戻す">リセット</button>
        <button type="button" class="btn secondary" data-hwb-action="resolve"${resolveAttr}>この人数配分のまま最適に組み直す</button>
        <button type="button" class="btn" data-hwb-action="save"${savingTitle === null ? '' : ' disabled'}>この案を保存</button>
      </div>
    </div>
    ${buildSaveFormHtml(savingTitle, violation, saveError, SAVE_FORM_IDS)}
    <p class="wb-diff">内訳：${escapeHtml(diffLine(state))}</p>
    ${CONTRIBUTION_NOTE_HTML}`
}

/** 採用判断の作業机パネル全体のHTMLを組み立てる（純粋関数・DOM非依存）。 */
export function buildHiringWorkbenchHtml(data: HiringWorkbenchViewData): string {
  const { state, sortKey, selectedEmployeeId, alertText } = data
  const showPhotos = data.showPhotos ?? true
  const savingTitle = data.savingTitle ?? null
  const saveError = data.saveError ?? null
  const evaluation = evaluateHiring(state)
  // カードの組み立てと並び替えは列に依存しないので1回で済ませる。
  // sortCards は WorkbenchCard 用だが、比較に使うのは employee.id / type / cost / contributions[unit] だけ。
  // HiringCard は unit が null を取りうるので、プールのカードは 'contribution' 指定でも
  // 貢献度で並べられない——そこは id 順に落とす（下の poolSafeSort）。
  const cards = poolSafeSort(buildHiringCards(state), sortKey)
  const ctx: ColumnContext = { state, evaluation, sortedCards: cards, selectedEmployeeId, showPhotos }
  const columnsHtml = SLOTS.map((s) => (s === 'pool' ? buildPoolColumnHtml(ctx) : buildUnitColumnHtml(s, ctx))).join('')
  return (
    buildAlertHtml(alertText, ALERT_DISMISS_ATTR) +
    buildHeaderHtml(state, evaluation) +
    `<div class="hwb-board">${columnsHtml}</div>` +
    buildActionsHtml(state, evaluation, sortKey, showPhotos, savingTitle, saveError) +
    DRAG_BADGE_HTML
  )
}

/**
 * 並び替え。'contribution' は「現在の所属での貢献度」降順なので、所属の無いプールのカードでは
 * 定義できない。プールぶんは常に社員番号順にして、事業部のカードだけ指定のキーで並べる。
 */
function poolSafeSort(cards: HiringCard[], key: WorkbenchSortKey): HiringCard[] {
  const byId = new Map(cards.map((c) => [c.employee.id, c]))
  // sortCards は WorkbenchCard（unit: UnitId）を要求する。プールのカードは unit が null なので
  // 'A' で埋めて渡すが、プール側は 'contribution' を 'id' に落とすため この値は比較に使われない。
  const asWorkbenchCard = (c: HiringCard): WorkbenchCard => ({
    employee: c.employee,
    unit: c.unit ?? 'A',
    type: c.type,
    contributions: c.contributions,
    profile: c.profile,
  })
  const pick = (sorted: WorkbenchCard[]): HiringCard[] => sorted.map((c) => byId.get(c.employee.id)!)
  return [
    ...pick(sortCards(cards.filter((c) => c.unit !== null).map(asWorkbenchCard), key)),
    ...pick(sortCards(cards.filter((c) => c.unit === null).map(asWorkbenchCard), key === 'contribution' ? 'id' : key)),
  ]
}

// ---- DOM配線（未テスト・workbenchPanel.ts と同じ方針） ----

const view: {
  state: HiringWorkbenchState | null
  sortKey: WorkbenchSortKey
  selectedEmployeeId: string | null
  alertText: string | null
  alertKind: 'revenue' | 'headcount' | null
  showPhotos: boolean
  savingTitle: string | null
  saveError: string | null
} = {
  state: null,
  sortKey: 'id',
  selectedEmployeeId: null,
  alertText: null,
  alertKind: null,
  showPhotos: true,
  savingTitle: null,
  saveError: null,
}

/** 保存された配置案を受け取る側（#p7 の出力画面へ渡す）。renderer.ts が配線する。 */
let onSaved: (run: SavedRun) => void = () => {}

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
  setHtml(
    'hwb-root',
    buildHiringWorkbenchHtml({
      state: view.state,
      sortKey: view.sortKey,
      selectedEmployeeId: view.selectedEmployeeId,
      alertText: view.alertText,
      showPhotos: view.showPhotos,
      savingTitle: view.savingTitle,
      saveError: view.saveError,
    }),
  )
}

/** #p5 の結果ステップから遷移してきた初期状態で作業机を開く（§5.1）。 */
export function openHiringWorkbench(initial: HiringWorkbenchState): void {
  view.state = initial
  view.sortKey = 'id'
  view.selectedEmployeeId = null
  view.alertText = null
  view.alertKind = null
  view.savingTitle = null
  view.saveError = null
  drag.reset()
  render()
}

function commitMove(id: string, slot: HiringSlot): void {
  const state = view.state
  if (!state) return
  // §5.5.1: 既存社員をプールへ落とす操作は黙って無視せず、なぜできないのかを出す。
  // 無反応だと「掴み損ねた」と思って何度も試すことになるため。
  if (slot === 'pool' && !isCandidate(state, id)) {
    view.selectedEmployeeId = null
    view.alertKind = null
    view.alertText = '採用候補の列に入れられるのは追加採用の候補だけです。この画面では既存社員の雇用は扱いません。'
    render()
    return
  }
  const before = evaluateHiring(state)
  const next = withMoveTo(state, id, slot)
  view.selectedEmployeeId = null
  if (next === state) {
    render()
    return
  }
  const after = evaluateHiring(next)
  view.state = next
  // §5.9: feasible→infeasible に変わった操作の直後だけ警告を出す（ドロップ自体は拒否しない）
  if (!hasViolation(before) && hasViolation(after)) {
    view.alertKind = !after.result.feasible ? 'revenue' : 'headcount'
    // ①27注記: バナーには現在値を書かない（書いた瞬間の値が続く操作ですぐ古くなるため）。
    // 現在値はヘッダの全社売上に常時出ており、そちらは再描画のたびに更新される。
    view.alertText = !after.result.feasible
      ? `全社売上が下限（${state.params.prevYearRevenue}億円）を下回りました`
      : `最低人数を割りました（${after.minHeadcountViolations.join('・')}）`
  } else {
    clearAlertIfResolved(after)
  }
  render()
}

function defaultRunTitle(state: HiringWorkbenchState): string {
  const hired = hiredCandidates(state).length
  return `採用案 ${hired}名採用 ${new Date().toISOString().slice(0, 10)}`
}

/**
 * いまの採用案を1件追記し、出力画面へ渡す（§5.11）。
 * 制約違反があっても保存は止めない。出力側で止める（機能16 §4.5）。
 * roster には**採用した社員だけ**を渡す——未採用の候補は組織図に載らないため、
 * 出力される名簿に混ざると告知用の文書が誤りになる。
 */
async function commitSave(): Promise<void> {
  const state = view.state
  if (!state) return
  const title = ($('hwb-save-title') as HTMLInputElement | null)?.value.trim() || defaultRunTitle(state)
  const evaluation = evaluateHiring(state)
  const ex = serializeHiringWorkbenchState(state)
  const hiredRoster = state.roster.filter((e) => state.assignment[e.id] !== undefined)
  try {
    if (await withLoading('確認しています…', async () => titleExists(title))) {
      view.saveError = `「${title}」という名前は既に保存されています。別の名前を付けてください。`
      render()
      return
    }
    const run = await withLoading('採用案を保存しています…', async () =>
      saveRun({
        title,
        task: state.task,
        metric: state.metric,
        assignment: { ...state.assignment },
        params: state.params,
        roster: hiredRoster,
        // 出力の可否は「全社売上下限」と「最低人数」の両方で決まる（機能16 §4.5・workbenchPanel.ts と同じ）。
        // result.feasible は売上下限しか見ないため、最低人数割れの案が #p7 で「制約を満たす」と出て
        // 告知用PDFまで出せてしまう（保存フォームの警告文とも食い違う）。
        feasible: !hasViolation(evaluation),
        companyRevenue: evaluation.result.companyRevenue,
        companyProfit: evaluation.result.companyProfit,
        movedFromBaseline: evaluation.movedFromBaseline,
        kind: 'hiring',
        hiredIds: ex.hiredIds,
        declinedIds: ex.declinedIds,
        branch: ex.branch,
        lockBase: ex.lockBase,
      }),
    )
    view.savingTitle = null
    view.saveError = null
    render()
    onSaved(run)
  } catch (e) {
    console.warn('採用案の保存に失敗しました。', e)
    view.saveError = '保存できませんでした。通信状態を確認してもう一度お試しください。'
    render()
  }
}

function handleAction(action: string): void {
  const state = view.state
  if (!state) return
  if (action === 'undo') {
    view.state = undo(state)
    clearAlertIfResolved(evaluateHiring(view.state))
    render()
  } else if (action === 'reset') {
    view.state = resetToStart(state)
    view.alertText = null
    view.alertKind = null
    render()
  } else if (action === 'resolve') {
    // §5.6: 未採用者は渡さない。渡すとソルバが採否まで決め直し、利用者の判断を上書きしてしまう
    if (state.lockBase) return
    const hired = state.roster.filter((e) => state.assignment[e.id] !== undefined)
    const counts = headcountOf(state.assignment, state.roster)
    const assignment = solveForHeadcount(hired, state.task, counts, state.params, state.metric)
    view.state = withAssignment(state, assignment)
    clearAlertIfResolved(evaluateHiring(view.state))
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
  }
}

function handleClick(e: Event): void {
  const target = e.target as HTMLElement | null
  if (!target || !view.state) return

  if (target.closest('[data-hwb-alert-dismiss]')) {
    view.alertText = null
    render()
    return
  }

  const actionBtn = target.closest<HTMLElement>('[data-hwb-action]')
  if (actionBtn) {
    handleAction(actionBtn.dataset.hwbAction ?? '')
    return
  }

  const cardEl = target.closest<HTMLElement>('[data-emp]')
  if (cardEl) {
    const id = cardEl.dataset.emp ?? ''
    // ロック中の既存社員は選択もさせない（選べてしまうと列クリックで動く錯覚を与える）
    if (!canMove(view.state, id)) return
    view.selectedEmployeeId = view.selectedEmployeeId === id ? null : id
    render()
    return
  }

  // クリック操作のフォールバック（§5.3）：選択中の1名を、クリックした列へ移動する
  const colEl = target.closest<HTMLElement>('[data-hslot]')
  if (colEl && view.selectedEmployeeId) {
    commitMove(view.selectedEmployeeId, colEl.dataset.hslot as HiringSlot)
  }
}

function handleChange(e: Event): void {
  const target = e.target
  if (target instanceof HTMLInputElement && target.id === 'hwb-show-photos') {
    view.showPhotos = target.checked
    render()
    return
  }
  if (target instanceof HTMLInputElement && target.id === 'hwb-lock') {
    if (!view.state) return
    view.state = { ...view.state, lockBase: target.checked }
    view.selectedEmployeeId = null
    render()
    return
  }
  if (!(target instanceof HTMLSelectElement) || target.id !== 'hwb-sort') return
  view.sortKey = target.value as WorkbenchSortKey
  render()
}

/**
 * ドラッグ&ドロップは workbenchDnd.ts と共有する（#p4 と処理が同一だったため）。
 * #p5 だけの事情はロック（canMove）とプール列の受け入れ制限（canPlace）の2つで、
 * どちらも引数で渡す（§5.5・§5.5.1）。
 */
const drag = createDragController<HiringSlot>({
  rootId: 'hwb-root',
  slotSelector: '[data-hslot]',
  slotOf: (colEl) => colEl.dataset.hslot as HiringSlot,
  isReady: () => view.state !== null,
  canGrab: (id) => view.state !== null && canMove(view.state, id),
  accept: (id, slot) => view.state !== null && id !== null && canPlace(view.state, id, slot),
  baseRevenue: () => (view.state ? evaluateHiring(view.state).result.companyRevenue : 0),
  previewRevenue: (id, slot) => (view.state ? previewMoveTo(view.state, id, slot).companyRevenue : 0),
  badgeText: (slot, d) => `${slot === 'pool' ? '採用しない' : `${UNIT_LABEL[slot]}へ移す`}と 全社売上 ${signed(d)}億円`,
  onDrop: commitMove,
})

/** 採用判断の作業机の委譲リスナを1回だけ張る（`#hwb-root` は起動時から存在する空div）。 */
export function initHiringWorkbenchPanel(onSavedRun: (run: SavedRun) => void): void {
  onSaved = onSavedRun
  const root = $('hwb-root')
  if (!root) return
  root.addEventListener('click', handleClick)
  root.addEventListener('change', handleChange)
  drag.attach(root)
}
