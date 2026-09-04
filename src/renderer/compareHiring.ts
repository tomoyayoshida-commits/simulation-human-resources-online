// 設計書§6/§10: 採用前後比較（#p5）
//
// 目的（課題×指標）は #p4 と同じ8通りから選べる（ui-overhaul-plan.md Phase 7・②19）。
// 以前は task=1 / metric='revenue' 固定で、「A事業部の利益重視」のような検討ができなかった。
// 選択状態はこのモジュールが持ち、再計算の実行（ローディング演出込み）は hiringFlow.ts の担当。

import type { Employee, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import {
  COST_UNIT_DIVISOR,
  DEFAULT_PARAMS,
  PROFIT_SCALE,
  round2,
  TASK_IDS,
  taskLabel,
  TASK_SPEC,
  taskTargetLabel,
  UNIT_IDS,
  UNIT_VAR,
} from './constants.ts'
import { barRow, oku, oku1, signed } from './format.ts'
import { $, setHtml, setText } from './dom.ts'
import { taskPrimaryValue, totalHeadcount } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'

/**
 * #p5 で検討中の目的（②19）。既定は課題1・原文どおりの指標＝従来の固定値と同じ。
 * #p4 の8通り先読みと違い、こちらは切り替えのたびに2回（採用前・採用後）解き直す。
 */
const target: { task: TaskId; metric: TaskMetric } = { task: 1, metric: TASK_SPEC[1].metric }

/** いま選ばれている目的。作業机を開くとき（hiringFlow.ts）が読む。 */
export function currentHiringTarget(): { task: TaskId; metric: TaskMetric } {
  return { ...target }
}

/** 目的の選択UI。#p4 のカード内トグルと同じ役目を、1画面ぶんまとめて出す。 */
export function renderHiringTargetToggle(): void {
  const taskBtns = TASK_IDS.map(
    (t) =>
      `<button type="button" class="mode-toggle-btn${t === target.task ? ' active' : ''}" data-h-task="${t}" aria-pressed="${t === target.task}">${taskLabel(t, target.metric)}</button>`,
  ).join('')
  const metricBtns = (['revenue', 'profit'] as const)
    .map(
      (m) =>
        `<button type="button" class="mode-toggle-btn${m === target.metric ? ' active' : ''}" data-h-metric="${m}" aria-pressed="${m === target.metric}">${m === 'profit' ? '利益' : '売上'}</button>`,
    )
    .join('')
  setHtml(
    'hiring-target-toggle',
    `<div class="mode-toggle"><span class="mode-toggle-label">検討する目的：</span>${taskBtns}</div>` +
      `<div class="mode-toggle"><span class="mode-toggle-label">最適化：</span>${metricBtns}</div>`,
  )
}

/**
 * 目的の選択を配線する（1回だけ呼ぶ）。選び直すと採用前・採用後を解き直す必要があるため、
 * 再計算そのものは呼び出し側（hiringFlow.ts）に onChange で渡す。
 */
export function initHiringTargetToggle(onChange: () => void): void {
  $('hiring-target-toggle')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-h-task],[data-h-metric]')
    if (!btn) return
    const task = btn.dataset.hTask
    const metric = btn.dataset.hMetric
    if (task) {
      const next = Number(task) as TaskId
      if (next === target.task) return
      target.task = next
    } else if (metric) {
      if (metric === target.metric) return
      target.metric = metric as TaskMetric
    } else {
      return
    }
    renderHiringTargetToggle()
    onChange()
  })
}

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

/** 見出し数字は選んだ目的の主指標（②19）。課題1なら従来どおり全社売上になる。 */
function primaryOf(r: SimulationResult): { label: string; value: number } {
  return {
    label: taskTargetLabel(target.task, target.metric),
    value: taskPrimaryValue(r, target.task, target.metric),
  }
}

function beforeCard(r: SimulationResult, scale: number): string {
  const primary = primaryOf(r)
  return `
    <div class="compare-before">
      <div class="compare-head"><span class="compare-badge" style="background:var(--baseline);color:#0b0b0b;">採用前</span><h4>${totalHeadcount(r)}名</h4></div>
      <div class="compare-primary"><div class="k">${primary.label}</div><div class="v">${primary.value.toFixed(2)}<span class="unit">億円</span></div></div>
      <div class="bars-label">事業部別売上（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${revenueBars(r, scale)}</div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v">${oku(r.companyProfit)}</span></div></div>
    </div>`
}

function afterCard(r: SimulationResult, before: SimulationResult, scale: number): string {
  const dProfit = round2(r.companyProfit - before.companyProfit)
  const primary = primaryOf(r)
  const dPrimary = round2(primary.value - primaryOf(before).value)
  return `
    <div class="compare-after">
      <div class="compare-head"><span class="compare-badge" style="background:var(--good);">採用後</span><h4>${totalHeadcount(r)}名</h4></div>
      <div class="compare-primary"><div class="k">${primary.label}</div><div class="v" style="color:var(--good);">${primary.value.toFixed(2)}<span class="unit">億円</span></div><div class="d good">採用前比 ${signed(dPrimary)}億円</div></div>
      <div class="bars-label">事業部別売上（共通スケール 0〜${scale.toFixed(2)}億円）</div>
      <div class="compare-bars">${revenueBars(r, scale)}</div>
      <div class="bars-label">事業部別利益（共通スケール 0〜${PROFIT_SCALE}億円）</div>
      <div class="compare-bars">${profitBars(r)}</div>
      <div class="compare-sub"><div><span class="cs-k">全社利益</span><span class="cs-v" style="color:var(--good);">${oku(r.companyProfit)}　<span style="font-size:11px;">(${signed(dProfit)}億円)</span></span></div></div>
    </div>`
}

/**
 * 採用前後比較を実行して #p5 を更新（設計書§6）。
 * 目的（課題×指標）は引数で受け取り、未指定なら現在選ばれているもの（既定は課題1・原文の指標）。
 * params未指定時は標準の前提パラメータを使う（#p5の「オプション」で前提を変えた場合はその値）。
 */
export function renderCompareHiring(
  base: Employee[],
  additional: Employee[],
  task: TaskId = target.task,
  params: SimParams = DEFAULT_PARAMS,
  metric: TaskMetric = target.metric,
): void {
  // 表示側（primaryOf）が読む選択状態を、実際に解いた目的に合わせる
  target.task = task
  target.metric = metric
  renderHiringTargetToggle()
  const beforeRes = runOptimization(base, task, params, metric)
  const afterRes = runOptimization([...base, ...additional], task, params, metric)

  if ('infeasible' in beforeRes || 'infeasible' in afterRes) {
    setHtml(
      'compare-hiring-grid',
      `<div class="compare-before"><p class="compare-summary">「${taskLabel(task, metric)}」では、採用前後いずれかで制約を満たす配置が存在しないため比較できません。別の目的を選ぶか、オプションの前提条件を見直してください。</p></div>`,
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
    `「${taskLabel(task, metric)}」を目的として配置した場合、追加採用${additional.length}名により全社売上は${signed(dRev)}億円、全社利益は${signed(dProfit)}億円変化した。${deltaLabel}のは${maxUnit}事業部（${signed(round2(maxDelta))}億円）。追加人件費コスト${oku(addCost)}と照らし、投資対効果を確認できる。`,
  )
}
