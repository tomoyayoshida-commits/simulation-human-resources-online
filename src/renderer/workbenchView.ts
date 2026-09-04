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
import { UNIT_LABEL, UNIT_VAR } from './constants.ts'
import { clampPct, deltaText, escapeAttr, escapeHtml, oku1, pct } from './format.ts'
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
        <div class="wb-unit-title"><b>${UNIT_LABEL[u]}</b> ${d.unitResult.count}名 <span class="wb-unit-pct">${pct(d.unitResult.fulfillmentRate)}</span>${d.violation ? ` <span class="wb-unit-warn">⚠ 最低${d.minHeadcount}名</span>` : ''}</div>
        <div class="meter-mini"><div class="meter-mini-fill" style="width:${meterPct.toFixed(1)}%;background:${UNIT_VAR[u]};"></div></div>
        <div class="wb-unit-sub">売上${oku1(d.unitResult.finalRevenue)}（${deltaText(d.unitResult.finalRevenue, d.baseUnitResult.finalRevenue)}）</div>
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
