// 表示用の文字列整形。DOMに触らない純粋関数のみ（dashboard / compareTasks / compareHiring /
// whatifPanel / reasonText / csv の6モジュールが同じ整形を各自で持っていたのを集約したもの）。

import { round2 } from './constants.ts'

/**
 * HTMLエスケープ。
 *
 * CSV由来の値（社員番号・ValidationError の column/actual）は利用者が用意したテキストであり、
 * `テストケース/採用04_XSSスクリプト混入.csv` のように `<script>` や
 * `<img src=x onerror=...>` を社員番号に含むデータが実際に想定されている。
 * contextIsolation はレンダラー自身が innerHTML に書いたHTMLの実行までは防がないため、
 * 外部由来の文字列は必ずここを通してから埋め込む。自前の定数・数値は対象外。
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 属性値へ埋め込む場合のエスケープ。
 * 属性は必ず二重引用符で囲む前提のため escapeHtml と同じ処理でよいが、
 * 「属性に入れている」という意図を呼び出し側に残すために別名で公開する。
 */
export const escapeAttr = escapeHtml

/** 億円表記（例 61.53億円） */
export function oku(n: number): string {
  return `${n.toFixed(2)}億円`
}

/** 億円表記の短縮形（例 61.53億）。カード内のバーなど幅が限られる箇所で使う。 */
export function oku1(n: number): string {
  return `${n.toFixed(2)}億`
}

/** 符号付き数値（例 +1.53 / -0.42）。差分表示で「+」を明示するために使う。 */
export function signed(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`
}

/**
 * 基準値との差分表記（例 +1.53億円 / ±0.00億円（基準と同じ））。
 * 差はここで round2 してから表示する（±0 の判定を丸め後の値で行うため）。
 */
export function deltaText(current: number, base: number, unit = '億円'): string {
  const d = round2(current - base)
  if (d === 0) return `±0.00${unit}（基準と同じ）`
  return `${signed(d)}${unit}`
}

/** 充足率などの百分率表記（例 90%） */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** 判定バッジ。styles.css の .pill.good / .warn / .crit に対応する。 */
export function pill(kind: 'good' | 'warn' | 'crit', text: string): string {
  return `<span class="pill ${kind}">${text}</span>`
}

/**
 * バー幅を 0〜100(%) に収める。
 * 共通スケールを超える値（例：利益が PROFIT_SCALE を超える事業部）や負値が来ても
 * トラックからはみ出さないよう、幅を出す箇所は必ずここを通す。
 */
export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * 横棒1行（styles.css の .cbar-row）。
 * #p4のカード（人数バー・金額バー）と #p5の採用前後比較が同じマークアップを各自で持っていたのを集約した。
 * `dim` は金額系バー＝塗りを薄くして人数バーと見分けるための指定。
 */
export function barRow(label: string, widthPct: number, color: string, value: string, dim = false): string {
  return (
    `<div class="cbar-row"><span>${label}</span><div class="cbar-track">` +
    `<div class="cbar-fill" style="width:${clampPct(widthPct).toFixed(1)}%;background:${color};${dim ? 'opacity:.6;' : ''}"></div>` +
    `</div><b>${value}</b></div>`
  )
}
