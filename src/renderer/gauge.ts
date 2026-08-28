// 充足率・ペナルティ帯ゲージ（機能10/B-1）の描画。#p3 と #p6 が同じ実装を共有する。
//
// 分割前は dashboard.ts と whatifPanel.ts がそれぞれ独自にこの処理を持っており、
// マーカー位置の式が食い違っていた（docs/refactor-plan.md B-1）。
//   dashboard   : 100%〜160% を右40%に割り当てる
//   whatifPanel : 100%〜200% を右40%に割り当てる
// 実データ課題3のB事業部は充足率1.4で、同じ数値が #p3 では86.7%、#p6 では76.0%の位置に出ていた。
// SURPLUS_TABLE の最終境界（maxRate 1.6）と対応が取れる dashboard 側に統一する。

import type { SimParams, SimulationResult, UnitId } from './types.ts'
import { DEFAULT_PARAMS, UNIT_IDS } from './constants.ts'

/**
 * メーターの帯幅(%)。充足率に対して等間隔ではなく、判断が要る 70〜100% を広めに取る。
 * 0→70% に20、70→80% に15、80→90% に10、90→100% に15、100→RATE_MAX に40。
 */
const SEG_WIDTHS = [20, 15, 10, 15, 40]

/** メーター右端が表す充足率。SURPLUS_TABLE の最終境界（maxRate 1.6）に合わせる。 */
const RATE_MAX = 1.6

/**
 * 帯の色。不足補正の「悪さ」の順位に対応する（値そのものではない）。
 * C事業部は最悪でも0.70とペナルティが緩いため、一段軽い色から始める。
 */
const BAND_COLORS: Record<UnitId, string[]> = {
  A: ['var(--critical)', 'var(--serious)', 'var(--warning)', '#cfe8cf', 'var(--good)'],
  B: ['var(--critical)', 'var(--serious)', 'var(--warning)', '#cfe8cf', 'var(--good)'],
  C: ['var(--serious)', 'var(--warning)', '#f6e6b4', '#cfe8cf', 'var(--good)'],
}

/** 充足率(rate) → メーター上の位置(%)。SEG_WIDTHS の区切りと一致させる。 */
export function ratePosition(rate: number): number {
  let pos: number
  if (rate < 0.7) pos = (rate / 0.7) * 20
  else if (rate < 0.8) pos = 20 + ((rate - 0.7) / 0.1) * 15
  else if (rate < 0.9) pos = 35 + ((rate - 0.8) / 0.1) * 10
  else if (rate < 1.0) pos = 45 + ((rate - 0.9) / 0.1) * 15
  else pos = 60 + Math.min((rate - 1.0) / (RATE_MAX - 1.0), 1) * 40
  return Math.max(0, Math.min(100, pos))
}

/**
 * 帯ラベル（例「70%（0.50）」）を不足補正表から生成する。
 * 以前は表と同じ数値をラベル文字列にも書いていたため、表を直すとラベルが取り残された
 * （docs/refactor-plan.md B-4）。表を単一の出典にして二重定義を無くす。
 *
 * 表は minRate 降順で持っているため、メーターの左（低い充足率）から並べるには反転する。
 * `0.7 * 100` が 70.00000000000001 になるため、百分率は必ず丸めてから文字列にする。
 */
export function bandLabels(unit: UnitId, params: SimParams = DEFAULT_PARAMS): string[] {
  const rows = [...params.shortageTable[unit]].reverse()
  return rows.map((row, i) => {
    const factor = row.factor.toFixed(2)
    if (i === 0) {
      // 最下段は上限だけが意味を持つ（minRate は 0）
      const upper = Math.round(rows[1].minRate * 100)
      return `&lt;${upper}%（${factor}）`
    }
    const lower = Math.round(row.minRate * 100)
    return i === rows.length - 1 ? `${lower}%以上（${factor}）` : `${lower}%（${factor}）`
  })
}

/**
 * 3事業部分のゲージHTMLを生成する。
 * 見出しの事業部名は画面ごとに粒度が違う（#p3 は特性付き・#p6 は短縮）ため引数で受け取る。
 */
export function renderGaugesHtml(
  result: SimulationResult,
  unitLabels: Record<UnitId, string>,
  params: SimParams = DEFAULT_PARAMS,
): string {
  let html = ''
  for (const u of UNIT_IDS) {
    const r = result.units[u]
    const colors = BAND_COLORS[u]
    const labels = bandLabels(u, params)
    const segs = SEG_WIDTHS.map(
      (w, idx) => `<div class="seg" style="width:${w}%;background:${colors[idx]};"></div>`,
    ).join('')
    // ラベルは.meterのSEG_WIDTHS（不等幅）と揃えないと帯の境界とずれるため、同じ幅を明示する
    const labelSpans = labels
      .map((l, idx) => `<span style="flex:0 0 ${SEG_WIDTHS[idx]}%;">${l}</span>`)
      .join('')
    const pos = ratePosition(r.fulfillmentRate)
    const ratePct = Math.round(r.fulfillmentRate * 100)
    html += `<div class="gauge-title">${unitLabels[u]}　充足率 ${ratePct}% → 不足補正${r.shortageFactor.toFixed(2)}／過剰補正${r.surplusFactor.toFixed(2)}</div>
      <div class="meter">${segs}<div class="marker" style="left:${pos.toFixed(1)}%;" data-label="現在 ${ratePct}%"></div></div>
      <div class="band-labels">${labelSpans}</div>`
  }
  return html
}
