// 機能15／15b 作業机の共有表示部品（純粋関数・DOM非依存・CLAUDE.md §5）。
//
// #p4 の workbenchPanel.ts と #p5 の hiringWorkbenchPanel.ts は片方をコピーして作られており、
// 生成するHTMLの差が「属性名・要素id・文言」だけの箇所が多かった。二重定義のまま置くと
// 片方だけ直る（実際に説明コメントと clearDropHint が採用判断側で失われていた）ので、
// docs/refactor-plan.md の gauge.ts と同じ方針でここへ集約する。
//
// 分岐が要る箇所は「呼び出し側が渡す引数」にしてある。この層で `kind === 'hiring'` のような
// 分岐を持つと、共有部品のはずが両画面の仕様を抱え込んで元の重複より読みにくくなるため。

import type { Employee, EmployeeProfile, UnitId } from './types.ts'
import { UNIT_IDS, UNIT_LABEL, UNIT_VAR } from './constants.ts'
import { clampPct, deltaText, escapeAttr, escapeHtml, oku1, pct, shortDateTime } from './format.ts'
import type { WorkbenchSortKey } from './workbench.ts'

/** 並び順プルダウンの選択肢（両画面で同一）。 */
const SORT_OPTIONS: { key: WorkbenchSortKey; label: string }[] = [
  { key: 'id', label: '社員番号順' },
  { key: 'contribution', label: '貢献度順（現在の所属）' },
  { key: 'type', label: '型別' },
  { key: 'cost', label: '人件費順' },
]

export function buildSortOptionsHtml(sortKey: WorkbenchSortKey): string {
  return SORT_OPTIONS.map(
    (o) => `<option value="${o.key}"${o.key === sortKey ? ' selected' : ''}>${o.label}</option>`,
  ).join('')
}

/**
 * 一過性の警告バナー。閉じるボタンの目印だけ画面ごとに違う
 * （#p4 は `data-wb-alert-dismiss`／#p5 は `data-hwb-alert-dismiss`）。
 */
export function buildAlertHtml(alertText: string | null, dismissAttr: string): string {
  if (!alertText) return ''
  return (
    `<div class="wb-alert-banner"><span>${escapeHtml(alertText)}</span>` +
    `<button type="button" class="wb-alert-close" ${dismissAttr} aria-label="閉じる">✕</button></div>`
  )
}

/**
 * 守るべき制約の常時表示（①26/②34）。
 *
 * 従来は最低人数を「割ったときだけ」列見出しに出しており、盤面に入る前に何を守るべきかが
 * どこにも書かれていなかった。違反の有無によらず出す（＝警告ではなく前提の掲示）。
 * 値は前提パラメータ由来なので、オプションで変えた値がそのまま出る。
 */
export function buildConstraintNoteHtml(prevYearRevenue: number, minHeadcount: Record<UnitId, number>): string {
  const mins = UNIT_IDS.map((u) => `${u} ${minHeadcount[u]}名`).join('・')
  return (
    `<p class="wb-constraints"><b>守るべき制約</b>全社売上 ${prevYearRevenue}億円超` +
    `／各事業部の最低人数 ${mins}</p>`
  )
}

/**
 * 制約を満たさないときに、次にできる操作を文章で示す（①27）。
 *
 * 具体値（あと何億円・あと何名）は書かない。表示のたびに数字が動き、読んだ瞬間には
 * 別の値になっていることがあるため（①27注記・Phase 4-4 と同じ方針）。
 * 満たしているときは何も出さない（常時出すと通常状態でも警告に見える）。
 */
export function buildNextStepHtml(feasible: boolean, minHeadcountViolations: UnitId[]): string {
  const lines: string[] = []
  if (!feasible) {
    lines.push(
      '全社売上が下限を下回っています。充足率のメーターが短い事業部へ貢献度の高い社員を移すと戻りやすく、' +
        '直前の移動は取り消せます。人数配分を変えずに割当だけ組み直す操作でも改善することがあります。',
    )
  }
  if (minHeadcountViolations.length > 0) {
    lines.push(
      `最低人数を割っているのは ${minHeadcountViolations.join('・')} です。` +
        '人数に余裕のある事業部（充足率の高い列）から、割れている事業部へ移してください。',
    )
  }
  if (lines.length === 0) return ''
  return `<div class="wb-nextstep"><b>次にできること</b>${lines.map((t) => `<p>${t}</p>`).join('')}</div>`
}

/**
 * カード内の錠前ボタン（①25/②33）。押すとその社員を動かせなくする。
 * 一括ロック（#p5 の lockBase）で既に固定されている社員には出さない——
 * 押しても外れないボタンになるため。呼び出し側が `togglable` で切り分ける。
 */
export function buildLockButtonHtml(employeeId: string, locked: boolean, lockAttr: string): string {
  const label = locked ? 'この社員の固定を解除する' : 'この社員を動かさないように固定する'
  return (
    `<button type="button" class="wb-lock-btn${locked ? ' locked' : ''}" ${lockAttr}="${escapeAttr(employeeId)}"` +
    ` title="${label}" aria-label="${label}" aria-pressed="${locked}">${locked ? '🔒' : '🔓'}</button>`
  )
}

/** 1名分の異動チップ。元の所属を左端の色帯で示す（①24/②32）。 */
export interface MoveChip {
  employeeId: string
  /** 表示する遷移（例：A→C、採用→B、A→見送り） */
  transition: string
  /** 色帯に使う元の所属。採用（元の所属なし）は null */
  from: UnitId | null
  /** 氏名（登録済みなら番号の後ろに出す） */
  name?: string
}

/**
 * 異動した社員の一覧（①24/②32）。集計行（A→B 3名）だけでは誰が動いたか分からないため、
 * 社員番号を1名ずつ並べる。元の所属は事業部色の帯で表し、行が長くなっても追えるようにする。
 * 0件のときは何も出さない（「異動なし」は集計行が既に書いている）。
 */
export function buildMoveChipsHtml(chips: MoveChip[]): string {
  if (chips.length === 0) return ''
  const items = chips
    .map((c) => {
      const color = c.from ? UNIT_VAR[c.from] : 'var(--good)'
      const name = c.name ? ` <span class="wb-move-name">${escapeHtml(c.name)}</span>` : ''
      return (
        `<span class="wb-move" style="border-left-color:${color};">` +
        `<b>${escapeHtml(c.employeeId)}</b>${name} <span class="wb-move-arrow">${escapeHtml(c.transition)}</span></span>`
      )
    })
    .join('')
  return `<div class="wb-moves">${items}</div>`
}

/**
 * カードに並ぶ数字の読み方（①22注記）。両画面のカードは同じ組み立てなので文言も共有する。
 * 貢献度そのものの定義（能力値×重み）を書いておかないと、Δ何億円との関係が読めない。
 */
export const CONTRIBUTION_NOTE_HTML =
  '<p class="wb-note">カードの大きい数字は<b>いまの所属事業部での貢献度</b>' +
  '（社員の能力値 × その事業部の重みの合計）。小さい数字は他の事業部へ移したときの貢献度です。' +
  '事業部の売上は所属者の貢献度の合計から決まるので、貢献度の高い人ほど動かしたときの増減が大きくなります。</p>'

/** 顔写真の枠に必要な最小限のカード情報。unit が null なのは未採用（プール）の候補。 */
export interface CardFaceData {
  employee: Employee
  unit: UnitId | null
  profile?: EmployeeProfile
}

/**
 * 顔写真の枠（docs/profile-plan.md §4.6）。写真が無い社員でもレイアウトが崩れないよう、
 * 同じ寸法のプレースホルダ（所属事業部色の丸＋社員番号の下2桁）を必ず返す。
 * 所属の無い候補（unit === null）は事業部色を持たないので中立色にする。
 * photo は Firestore 由来の外部入力なので escapeAttr を通す（CLAUDE.md §8）。
 */
export function buildCardFaceHtml(c: CardFaceData): string {
  if (c.profile?.photo) {
    return `<img class="wb-card-photo" src="${escapeAttr(c.profile.photo)}" alt="" draggable="false">`
  }
  const bg = c.unit ? UNIT_VAR[c.unit] : 'var(--text-muted)'
  return `<span class="wb-card-photo wb-card-photo-none" style="background:${bg};">${escapeHtml(c.employee.id.slice(-2))}</span>`
}

/** 保存フォームのうち画面ごとに違う部分。 */
export interface SaveFormIds {
  /** 名前入力欄の要素id（#p4: wb-save-title／#p5: hwb-save-title） */
  inputId: string
  /** ボタンの目印（#p4: data-wb-action／#p5: data-hwb-action） */
  actionAttr: string
  /** 「この配置案の名前」「この採用案の名前」 */
  label: string
}

/**
 * 保存時の命名フォーム（docs/export-plan.md §4.8）。`savingTitle` が null なら閉じている。
 * 別ダイアログにせず操作列の直下に開く。制約違反があっても保存自体は止めない（§4.5・§5.9）。
 */
export function buildSaveFormHtml(
  savingTitle: string | null,
  violation: boolean,
  saveError: string | null,
  ids: SaveFormIds,
): string {
  if (savingTitle === null) return ''
  return `
    <div class="wb-save-form">
      <label class="wb-save-label">${escapeHtml(ids.label)}
        <input type="text" id="${ids.inputId}" class="wb-save-input" maxlength="80" value="${escapeAttr(savingTitle)}">
      </label>
      <button type="button" class="btn" ${ids.actionAttr}="save-confirm">保存する</button>
      <button type="button" class="btn secondary" ${ids.actionAttr}="save-cancel">やめる</button>
      ${saveError ? `<p class="warn-text">${escapeHtml(saveError)}</p>` : ''}
      ${violation ? '<p class="warn-text">制約違反があります。記録としては保存できますが、CSV・PDFの出力はできません。</p>' : ''}
    </div>`
}

/**
 * 一時保存（draftStore.ts）のボタン2つ。画面差は目印（#p4 は data-wb-action／#p5 は data-hwb-action）だけ。
 *
 * 「この案を保存」（Firestore への確定保存）と紛れないよう、文言に必ず「一時保存」を入れる。
 * 下書きが無いときは「開く」を押せなくする（押しても何も起きないボタンは何が悪いのか読めないため）。
 */
export function buildDraftButtonsHtml(draftSavedAt: string | null, actionAttr: string): string {
  const loadAttr = draftSavedAt
    ? ` title="一時保存した盤面（${escapeAttr(shortDateTime(draftSavedAt))}）に戻す"`
    : ' disabled title="一時保存した盤面がありません"'
  return (
    `<button type="button" class="btn secondary" ${actionAttr}="draft-save"` +
    ` title="いまの盤面をこのブラウザに一時保存する（あとで続きから開ける）">一時保存</button>` +
    `<button type="button" class="btn secondary" ${actionAttr}="draft-load"${loadAttr}>一時保存を開く</button>`
  )
}

/**
 * 一時保存の結果を伝える1行。null なら何も出さない。
 * 警告バナー（buildAlertHtml）と分けてあるのは、こちらが制約違反ではなく操作の結果報告のため。
 */
export function buildDraftNoteHtml(note: string | null): string {
  if (!note) return ''
  return `<p class="wb-draft-note">${escapeHtml(note)}</p>`
}

/** 事業部列の見出しが読む集計値。`UnitResult` の必要な3項目だけを構造的に受ける。 */
export interface ColumnUnitStat {
  count: number
  fulfillmentRate: number
  finalRevenue: number
}

export interface UnitColumnData {
  /** 列に付ける目印。#p4 は `data-unit`、#p5 は `data-hslot`（pool が紛れ込まないよう名前を分けてある） */
  slotAttr: string
  /** 現在の集計 */
  unitResult: ColumnUnitStat
  /** 比較の基準（#p4 は最適解、#p5 は採用前） */
  baseUnitResult: ColumnUnitStat
  /**
   * Δの基準の呼び名（①22/②30）。「最適解比」「採用前比」など。
   * 基準名の無い ±X は何と比べた差か読めないため、画面ごとに必ず渡す。
   */
  baselineLabel: string
  /** 最低人数割れか */
  violation: boolean
  /** 割れているときに出す最低人数 */
  minHeadcount: number
  /** この列に並べるカードのHTML（絞り込みと1枚ぶんの描画は画面ごとに違うので呼び出し側の担当） */
  cardsHtml: string
}

/** 事業部1列ぶん。プール列は事業部ではないので共有せず、採用判断側が個別に持つ。 */
export function buildUnitColumnHtml(u: UnitId, d: UnitColumnData): string {
  const meterPct = clampPct(d.unitResult.fulfillmentRate * 100)
  return `
    <div class="wb-column${d.violation ? ' violation' : ''}" ${d.slotAttr}="${u}">
      <div class="wb-unit-head">
        <div class="wb-unit-title"><b>${UNIT_LABEL[u]}</b> ${d.unitResult.count}名 <span class="wb-unit-pct">${pct(d.unitResult.fulfillmentRate)}</span>${d.violation ? ` <span class="wb-unit-warn">⚠ 最低${d.minHeadcount}名</span>` : ` <span class="wb-unit-min">最低${d.minHeadcount}名</span>`}</div>
        <div class="meter-mini"><div class="meter-mini-fill" style="width:${meterPct.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div>
        <div class="wb-unit-sub">売上${oku1(d.unitResult.finalRevenue)}（${escapeHtml(d.baselineLabel)} ${deltaText(d.unitResult.finalRevenue, d.baseUnitResult.finalRevenue)}）</div>
      </div>
      <div class="wb-cards">${d.cardsHtml}</div>
    </div>`
}

/**
 * ドラッグ中の増減プレビュー用バッジ。列ヘッダに置くと長い列の下端を掴んでいるとき画面外に出て
 * 読めないため、カーソル追従の浮動バッジにしている。ドラッグ中は state が変わらず再描画も
 * 起きないので、パネルのHTMLに含めておけばドラッグ開始から終了まで生き残る。
 */
export const DRAG_BADGE_HTML = '<div class="wb-drag-badge" hidden></div>'
