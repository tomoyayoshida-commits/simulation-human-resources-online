// 設計書§6/§10: 採用前後比較（#p5）

import type { Employee, SimulationResult, TaskId, UnitId } from './types.ts'
import { COST_MULTIPLIER, COST_UNIT_DIVISOR, PROFIT_SCALE, round2, UNIT_IDS, UNIT_VAR } from './constants.ts'
import { oku, oku1, signed } from './format.ts'
import { $ } from './dom.ts'
import { runOptimization } from './optimizer.ts'

function profitBars(r: SimulationResult): string {
  return UNIT_IDS.map((u) => {
    const w = Math.max(0, Math.min(100, (r.units[u].profit / PROFIT_SCALE) * 100))
    return `<div class="cbar-row"><span>${u}</span><div class="cbar-track"><div class="cbar-fill" style="width:${w.toFixed(1)}%;background:${UNIT_VAR[u]};opacity:.6;"></div></div><b>${oku1(r.units[u].profit)}</b></div>`
  }).join('')
}

function beforeCard(r: SimulationResult): string {
  return `
    <div class="compare-before">
      <div class="compare-head"><span class="compare-badge" style="background:var(--baseline);color:#0b0b0b;">採用前</span><h4>${r.headcount.A + r.headcount.B + r.headcount.C}名</h4></div>
      <div class="compare-primary"><div class="k">全社売上</div><div class="v">${r.companyRevenue.toFixed(2)}<span class="unit">億円</span></div></div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v">${oku(r.companyProfit)}</span></div></div>
    </div>`
}

function afterCard(r: SimulationResult, before: SimulationResult): string {
  const dRev = round2(r.companyRevenue - before.companyRevenue)
  const dProfit = round2(r.companyProfit - before.companyProfit)
  return `
    <div class="compare-after">
      <div class="compare-head"><span class="compare-badge" style="background:var(--good);">採用後</span><h4>${r.headcount.A + r.headcount.B + r.headcount.C}名</h4></div>
      <div class="compare-primary"><div class="k">全社売上</div><div class="v" style="color:var(--good);">${r.companyRevenue.toFixed(2)}<span class="unit">億円</span></div><div class="d good">採用前比 ${signed(dRev)}億円</div></div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v" style="color:var(--good);">${oku(r.companyProfit)}　<span style="font-size:11px;">(${signed(dProfit)}億円)</span></span></div></div>
    </div>`
}

/**
 * 採用前後比較を実行して #p5 を更新（設計書§6）。
 * 既定の目的関数はタスク1（全社売上最大化）。
 */
export function renderCompareHiring(base: Employee[], additional: Employee[], task: TaskId = 1): void {
  const grid = $('compare-hiring-grid')
  const summary = $('hiring-summary')
  const roi = $('hiring-roi')

  const beforeRes = runOptimization(base, task)
  const afterRes = runOptimization([...base, ...additional], task)

  if ('infeasible' in beforeRes || 'infeasible' in afterRes) {
    if (grid)
      grid.innerHTML =
        '<div class="compare-before"><p class="compare-summary">採用前後いずれかで制約を満たす配置が存在しないため、比較できません。</p></div>'
    if (summary) summary.textContent = ''
    if (roi) roi.innerHTML = ''
    return
  }

  if (grid) grid.innerHTML = beforeCard(beforeRes) + afterCard(afterRes, beforeRes)

  // ROI（参考）
  // 億円表示のため calcEngine.unitCostTotal と同じ換算（÷COST_UNIT_DIVISOR）を通す
  const addCost = round2(
    additional.reduce((s, e) => s + e.cost * COST_MULTIPLIER, 0) / COST_UNIT_DIVISOR,
  )
  const dRev = round2(afterRes.companyRevenue - beforeRes.companyRevenue)
  const dProfit = round2(afterRes.companyProfit - beforeRes.companyProfit)
  if (roi) {
    roi.innerHTML = `
      <tr><th></th><th class="num">追加人件費コスト</th><th class="num">売上増分</th><th class="num">利益増分</th></tr>
      <tr><td>${additional.length}名採用の効果</td><td class="num">${oku(addCost)}</td><td class="num">${signed(dRev)}億円</td><td class="num">${signed(dProfit)}億円</td></tr>`
  }

  if (summary) {
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
    summary.textContent = `追加採用${additional.length}名により全社売上は${signed(dRev)}億円、全社利益は${signed(dProfit)}億円変化した。利益の伸びが最も大きいのは${maxUnit}事業部（+${round2(maxDelta).toFixed(2)}億円）。追加人件費コスト${oku(addCost)}と照らし、投資対効果を確認できる。`
  }
}
