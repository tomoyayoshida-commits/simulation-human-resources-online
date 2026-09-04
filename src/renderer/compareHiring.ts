// 設計書§6/§10: 採用前後比較（#p5）

import type { Employee, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import { COST_UNIT_DIVISOR, DEFAULT_PARAMS, PROFIT_SCALE, round2, UNIT_IDS, UNIT_VAR } from './constants.ts'
import { barRow, oku, oku1, signed } from './format.ts'
import { setHtml, setText } from './dom.ts'
import { totalHeadcount } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'

function profitBars(r: SimulationResult): string {
  return UNIT_IDS.map((u) =>
    barRow(u, (r.units[u].profit / PROFIT_SCALE) * 100, UNIT_VAR[u], oku1(r.units[u].profit), true),
  ).join('')
}

/**
 * ②16注記: 事業部別のバーが利益だけだと、採用で売上がどう動いたかが事業部単位で読めない。
 * 売上バーも並べる。スケールは採用前後の全事業部の最大値で揃える（#p4 の revenueScale と同じ考え）。
 */
function revenueBars(r: SimulationResult, scale: number): string {
  return UNIT_IDS.map((u) =>
    barRow(u, (r.units[u].finalRevenue / scale) * 100, UNIT_VAR[u], oku1(r.units[u].finalRevenue), true),
  ).join('')
}

function revenueScale(before: SimulationResult, after: SimulationResult): number {
  let max = 0
  for (const r of [before, after]) {
    for (const u of UNIT_IDS) max = Math.max(max, r.units[u].finalRevenue)
  }
  return max > 0 ? max : 1
}

function beforeCard(r: SimulationResult, scale: number): string {
  return `
    <div class="compare-before">
      <div class="compare-head"><span class="compare-badge" style="background:var(--baseline);color:#0b0b0b;">採用前</span><h4>${totalHeadcount(r)}名</h4></div>
      <div class="compare-primary"><div class="k">全社売上</div><div class="v">${r.companyRevenue.toFixed(2)}<span class="unit">億円</span></div></div>
      <div class="bars-label">事業部別売上（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${revenueBars(r, scale)}</div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v">${oku(r.companyProfit)}</span></div></div>
    </div>`
}

function afterCard(r: SimulationResult, before: SimulationResult, scale: number): string {
  const dRev = round2(r.companyRevenue - before.companyRevenue)
  const dProfit = round2(r.companyProfit - before.companyProfit)
  return `
    <div class="compare-after">
      <div class="compare-head"><span class="compare-badge" style="background:var(--good);">採用後</span><h4>${totalHeadcount(r)}名</h4></div>
      <div class="compare-primary"><div class="k">全社売上</div><div class="v" style="color:var(--good);">${r.companyRevenue.toFixed(2)}<span class="unit">億円</span></div><div class="d good">採用前比 ${signed(dRev)}億円</div></div>
      <div class="bars-label">事業部別売上（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${revenueBars(r, scale)}</div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v" style="color:var(--good);">${oku(r.companyProfit)}　<span style="font-size:11px;">(${signed(dProfit)}億円)</span></span></div></div>
    </div>`
}

/**
 * 採用前後比較を実行して #p5 を更新（設計書§6）。
 * 既定の目的関数はタスク1（全社売上最大化）。params未指定時は標準の前提パラメータを使う
 * （#p5の「オプション」で前提を変えた場合はその値が渡される）。
 */
export function renderCompareHiring(
  base: Employee[],
  additional: Employee[],
  task: TaskId = 1,
  params: SimParams = DEFAULT_PARAMS,
): void {
  const beforeRes = runOptimization(base, task, params)
  const afterRes = runOptimization([...base, ...additional], task, params)

  if ('infeasible' in beforeRes || 'infeasible' in afterRes) {
    setHtml(
      'compare-hiring-grid',
      '<div class="compare-before"><p class="compare-summary">採用前後いずれかで制約を満たす配置が存在しないため、比較できません。</p></div>',
    )
    setText('hiring-summary', '')
    setHtml('hiring-roi', '')
    return
  }

  const barScale = revenueScale(beforeRes, afterRes)
  setHtml('compare-hiring-grid', beforeCard(beforeRes, barScale) + afterCard(afterRes, beforeRes, barScale))

  // ROI（参考）
  // 億円表示のため calcEngine.unitCostTotal と同じ換算（÷COST_UNIT_DIVISOR）を通す
  const addCost = round2(
    additional.reduce((s, e) => s + e.cost * params.costMultiplier, 0) / COST_UNIT_DIVISOR,
  )
  const dRev = round2(afterRes.companyRevenue - beforeRes.companyRevenue)
  const dProfit = round2(afterRes.companyProfit - beforeRes.companyProfit)
  setHtml(
    'hiring-roi',
    `
      <tr><th></th><th class="num">追加人件費コスト</th><th class="num">売上増分</th><th class="num">利益増分</th></tr>
      <tr><td>${additional.length}名採用の効果</td><td class="num">${oku(addCost)}</td><td class="num">${signed(dRev)}億円</td><td class="num">${signed(dProfit)}億円</td></tr>`,
  )

  // 最も利益が伸びた事業部を特定
  let maxUnit: UnitId = 'A'
  let maxDelta = -Infinity
  for (const u of UNIT_IDS) {
    const d = afterRes.units[u].profit - beforeRes.units[u].profit
    if (d > maxDelta) {
      maxDelta = d
      maxUnit = u
    }
  }
  // 全事業部の利益が減るシナリオもあるため符号は signed() に任せる
  // （`+` を固定で書いていたときは `+-1.00億円` と表示されていた）
  const deltaLabel = maxDelta >= 0 ? '利益の伸びが最も大きい' : '利益の落ち込みが最も小さい'
  setText(
    'hiring-summary',
    `追加採用${additional.length}名により全社売上は${signed(dRev)}億円、全社利益は${signed(dProfit)}億円変化した。${deltaLabel}のは${maxUnit}事業部（${signed(round2(maxDelta))}億円）。追加人件費コスト${oku(addCost)}と照らし、投資対効果を確認できる。`,
  )
}
