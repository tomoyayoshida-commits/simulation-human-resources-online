// 設計書§9: 配置方針テキスト生成

import type { SimParams, SimulationResult, TaskId } from './types.ts'
import { DEFAULT_PARAMS, round2, TASK_LABELS, taskTargetLabel, UNIT_IDS, UNIT_LABEL } from './constants.ts'
import { pct } from './format.ts'

/**
 * 配置方針・理由の文章を生成する（設計書§9）。
 * reason-box の innerHTML として使う <ul> 文字列を返す。
 */
export function generateReasonText(
  result: SimulationResult,
  task: TaskId,
  params: SimParams = DEFAULT_PARAMS,
): string {
  const bullets: string[] = []
  const { headcount, units } = result

  // 1. 課題（目的）と人数配分
  bullets.push(
    `選択課題は「${TASK_LABELS[task]}」。この目的に対し A:${headcount.A}名／B:${headcount.B}名／C:${headcount.C}名（合計${headcount.A + headcount.B + headcount.C}名）を配置した。`,
  )

  // 2. 各事業部の充足率と適用係数
  for (const u of UNIT_IDS) {
    const r = units[u]
    const notes: string[] = []
    if (r.shortageFactor < 1) notes.push(`不足補正 ${r.shortageFactor.toFixed(2)}`)
    if (r.surplusFactor < 1) notes.push(`過剰補正 ${r.surplusFactor.toFixed(2)}`)
    const factorText = notes.length > 0 ? notes.join('・') + ' が適用' : '不足・過剰ペナルティなし（補正1.00）'
    bullets.push(
      `${UNIT_LABEL[u]}：充足率 ${pct(r.fulfillmentRate)}（適正${params.optimalHeadcount[u]}名に対し${r.count}名）→ ${factorText}。`,
    )
  }

  // 3. 全社売上・利益と前年度差
  const diff = round2(result.companyRevenue - params.prevYearRevenue)
  const sign = diff >= 0 ? '+' : ''
  bullets.push(
    `全社売上は ${result.companyRevenue}億円で前年度売上（${params.prevYearRevenue}億円）を ${sign}${diff}億円 ${diff > 0 ? '上回り' : '下回り'}、全社利益は ${result.companyProfit}億円。`,
  )

  // 4. 課題2〜4は辞書式方針の説明
  if (task !== 1) {
    bullets.push(
      `本配置は${taskTargetLabel(task)}を最優先で最大化したうえで、残りの人員は全社売上が最大となるよう配置している（目的外事業部を放置せず、二次目的として全社売上を確保）。`,
    )
  }

  return '<ul>' + bullets.map((b) => `<li>${b}</li>`).join('') + '</ul>'
}
