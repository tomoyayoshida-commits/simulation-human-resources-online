// 機能14 What-if分析パネル（#p6）のDOM更新。表示専用・計算を持たない（CLAUDE.md §5の方針）。

import type { AllocationCounts, AssignmentDiff, Employee, SimParams, SimulationResult, TaskId, UnitId, ValidationError } from './types.ts'
import { round2, TASK_IDS, TASK_LABELS, UNIT_IDS, UNIT_LABEL } from './constants.ts'
import { deltaText, escapeAttr, escapeHtml, oku, pill } from './format.ts'
import { $, setHtml } from './dom.ts'
import { renderGaugesHtml } from './gauge.ts'

/** ①基準ケース：課題選択カード（#p2のtaskcardと同じ見た目） */
export function renderTaskCards(selectedTask: TaskId): void {
  const el = $('whatif-task-cards')
  if (!el) return
  const descs: Record<TaskId, string> = {
    1: '3事業部合計の売上を最大化',
    2: '飽和事業の利益を最大化',
    3: '成長事業へ集中投資',
    4: '新規事業へ集中投資',
  }
  el.innerHTML = TASK_IDS
    .map(
      (t) =>
        `<div class="taskcard${t === selectedTask ? ' selected' : ''}" data-whatif-task="${t}"><div class="tag">チェックパターン${t}</div><h4>${TASK_LABELS[t]}</h4><p>${descs[t]}</p></div>`,
    )
    .join('')
}

/** 基準ケースの数値（画面上部の説明文） */
export function renderBaselineNote(baseline: SimulationResult | null): void {
  const el = $('whatif-baseline-note')
  if (!el) return
  el.innerHTML = baseline
    ? `基準：全社売上 ${oku(baseline.companyRevenue)} ／ 全社利益 ${oku(baseline.companyProfit)}（配置 A:${baseline.headcount.A} B:${baseline.headcount.B} C:${baseline.headcount.C}）`
    : '基準ケースを計算中…'
}

export interface SummaryInput {
  result: SimulationResult
  baseline: SimulationResult
  minHeadcountViolations: UnitId[]
  prevYearRevenue: number
}

/** ②結果サマリー（sticky）：全社売上・全社利益・制約判定（Δ併記・§4.2） */
export function renderSummary(input: SummaryInput | null): void {
  const el = $('whatif-summary')
  if (!el) return
  if (!input) {
    el.innerHTML = '<div class="stat"><div class="k">判定</div><div class="v"><span class="pill warn">未実行</span></div></div>'
    return
  }
  const { result, baseline, minHeadcountViolations, prevYearRevenue } = input
  const revOk = result.companyRevenue > prevYearRevenue
  const minOk = minHeadcountViolations.length === 0
  el.innerHTML = `
    <div class="stat"><div class="k">全社売上</div><div class="v">${oku(result.companyRevenue)}</div><div class="d">基準比 ${deltaText(result.companyRevenue, baseline.companyRevenue)}</div></div>
    <div class="stat"><div class="k">全社利益</div><div class="v">${oku(result.companyProfit)}</div><div class="d">基準比 ${deltaText(result.companyProfit, baseline.companyProfit)}</div></div>
    <div class="stat"><div class="k">制約判定</div><div class="v">${revOk ? pill('good', '● 売上下限OK') : pill('crit', '● 売上下限未達')} ${minOk ? pill('good', '● 最低人数OK') : pill('warn', `● 最低人数割れ（${minHeadcountViolations.join('・')}）`)}</div></div>`
}

export interface RosterCardInput {
  hiringAdd10: Employee[] | null
  selectedIds: Set<string>
  baseCount: number
}

/** ①母集団（採用シナリオ・軸4） */
export function renderRosterCard(input: RosterCardInput): void {
  const el = $('whatif-roster-card')
  if (!el) return
  if (!input.hiringAdd10) {
    el.innerHTML =
      '<p class="note">追加採用候補が未取込です。先に <a data-go="p5" style="color:var(--a);cursor:pointer;">採用前後を比較する</a> で追加採用10名分データを取り込んでください。</p>'
    return
  }
  const rows = input.hiringAdd10
    .map((e) => {
      const checked = input.selectedIds.has(e.id) ? 'checked' : ''
      // 社員番号はCSV由来。属性値・本文の両方でエスケープする（dataset 経由で読み戻す値は元のまま）
      return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px;"><input type="checkbox" data-whatif-candidate="${escapeAttr(e.id)}" ${checked}> ${escapeHtml(e.id)}（営${e.sales}/管${e.mgmt}/開${e.dev}/育${e.training}/人件費${e.cost}）</label>`
    })
    .join('')
  const total = input.baseCount + input.selectedIds.size
  el.innerHTML = `
    <div style="margin-bottom:8px;">
      <button class="btn secondary" id="whatif-hire-all" style="margin-right:6px;">全員採用</button>
      <button class="btn secondary" id="whatif-hire-none">誰も採用しない</button>
    </div>
    ${rows}
    <p class="note">合計 ${total} 名（基準100名 + 採用${input.selectedIds.size}名）</p>
    <div style="text-align:right;"><button class="btn" id="whatif-reoptimize-roster">この母集団で再最適化 ▶</button></div>`
}

export interface ParamsCardInput {
  params: SimParams
  standard: SimParams
}

function changedClass(current: number, standard: number): string {
  return current !== standard ? ' whatif-changed' : ''
}

/** ②前提パラメータ（軸3） */
export function renderParamsCard(input: ParamsCardInput): void {
  const el = $('whatif-params-card')
  if (!el) return
  const { params, standard } = input
  const numRow = (
    label: string,
    field: 'baseRevenue' | 'growth' | 'optimalHeadcount' | 'minHeadcount',
    step: string,
  ): string =>
    `<div class="bar-row"><span class="label" style="width:110px;">${label}</span>` +
    UNIT_IDS
      .map(
        (u) =>
          `<input type="number" step="${step}" data-whatif-param="${field}" data-whatif-unit="${u}" value="${params[field][u]}" class="${changedClass(params[field][u], standard[field][u]).trim()}" style="width:78px;margin-right:6px;" title="標準値 ${standard[field][u]}">`,
      )
      .join('') +
    '</div>'

  const weightRow = (key: 'sales' | 'mgmt' | 'dev' | 'training', label: string): string =>
    `<div class="bar-row"><span class="label" style="width:110px;">重み・${label}</span>` +
    UNIT_IDS
      .map(
        (u) =>
          `<input type="number" step="0.01" data-whatif-weight="${key}" data-whatif-unit="${u}" value="${params.weights[u][key]}" class="${changedClass(params.weights[u][key], standard.weights[u][key]).trim()}" style="width:78px;margin-right:6px;" title="標準値 ${standard.weights[u][key]}">`,
      )
      .join('') +
    '</div>'

  const weightSums = UNIT_IDS
    .map((u) => {
      const sum = round2(
        params.weights[u].sales + params.weights[u].mgmt + params.weights[u].dev + params.weights[u].training,
      )
      const off = Math.abs(sum - 1) > 0.001
      return `<span style="margin-right:14px;${off ? 'color:var(--warning);font-weight:600;' : ''}">${u}合計 ${sum.toFixed(2)}${off ? ' ⚠標準は1.00' : ''}</span>`
    })
    .join('')

  el.innerHTML = `
    <div class="bar-row"><span class="label" style="width:110px;"></span>${UNIT_IDS.map((u) => `<span style="width:78px;display:inline-block;text-align:center;margin-right:6px;font-size:11px;color:var(--text-muted);">${u}事業部</span>`).join('')}</div>
    ${numRow('基準売上(億円)', 'baseRevenue', '0.1')}
    ${numRow('成長係数', 'growth', '0.01')}
    ${numRow('適正人数', 'optimalHeadcount', '1')}
    ${numRow('最低人数', 'minHeadcount', '1')}
    ${weightRow('sales', '営業')}
    ${weightRow('mgmt', '管理')}
    ${weightRow('dev', '開拓')}
    ${weightRow('training', '育成')}
    <p class="note">${weightSums}</p>
    <div class="bar-row" style="margin-top:10px;">
      <span class="label" style="width:110px;">全社売上下限</span>
      <input type="number" step="0.1" data-whatif-scalar="prevYearRevenue" value="${params.prevYearRevenue}" class="${changedClass(params.prevYearRevenue, standard.prevYearRevenue).trim()}" style="width:90px;" title="標準値 ${standard.prevYearRevenue}">
      <span class="label" style="width:110px;margin-left:20px;">コスト係数</span>
      <input type="number" step="0.1" data-whatif-scalar="costMultiplier" value="${params.costMultiplier}" class="${changedClass(params.costMultiplier, standard.costMultiplier).trim()}" style="width:90px;" title="標準値 ${standard.costMultiplier}">
    </div>`
}

export function renderParamsErrors(errors: ValidationError[]): void {
  const el = $('whatif-params-errors')
  if (!el) return
  if (errors.length === 0) {
    el.innerHTML = ''
    return
  }
  el.innerHTML =
    '<table class="errtable" style="margin:8px 0;"><tr><th>項目</th><th class="num">実測値</th><th>期待範囲</th></tr>' +
    errors.map((e) => `<tr><td class="err">${escapeHtml(e.column)}</td><td class="num err">${escapeHtml(e.actual)}</td><td>${escapeHtml(e.expected)}</td></tr>`).join('') +
    '</table>'
  const btn = $('whatif-params-reoptimize') as HTMLButtonElement | null
  if (btn) btn.disabled = true
}

export function clearParamsErrorsGate(): void {
  const btn = $('whatif-params-reoptimize') as HTMLButtonElement | null
  if (btn) btn.disabled = false
}

export interface HeadcountCardInput {
  counts: AllocationCounts
  rosterSize: number
}

/**
 * ③配置：人数配分スライダー（軸1）。
 * ドラッグ中に呼ばれる updateHeadcountValues は input 要素自体を再生成しない
 * （innerHTML で作り直すとドラッグ中の range 要素が破棄され、ドラッグ操作が中断するため）。
 */
export function renderHeadcountCard(input: HeadcountCardInput): void {
  const el = $('whatif-headcount-card')
  if (!el) return
  const { counts, rosterSize } = input
  el.innerHTML =
    UNIT_IDS
      .map(
        (u) =>
          `<div class="bar-row"><span class="label">${UNIT_LABEL[u]}</span>
            <input type="range" min="0" max="${rosterSize}" value="${counts[u]}" data-whatif-headcount="${u}" style="flex:1;">
            <span class="val" data-whatif-headcount-label="${u}">${counts[u]}名</span></div>`,
      )
      .join('') +
    `<p class="note" data-whatif-headcount-total>合計 ${counts.A + counts.B + counts.C} / ${rosterSize}名（3スライダーの合計が常に母集団数になるよう自動調整）</p>
     <div style="text-align:right;"><button class="btn secondary" id="whatif-auto-optimize">最適化に任せる ▶</button></div>`
}

/** ドラッグ中の軽量更新：既存のrange要素を再生成せず値だけ同期する。 */
export function updateHeadcountValues(counts: AllocationCounts, rosterSize: number): void {
  for (const u of UNIT_IDS) {
    const slider = document.querySelector<HTMLInputElement>(`[data-whatif-headcount="${u}"]`)
    if (slider && Number(slider.value) !== counts[u]) slider.value = String(counts[u])
    const label = document.querySelector<HTMLElement>(`[data-whatif-headcount-label="${u}"]`)
    if (label) label.textContent = `${counts[u]}名`
  }
  const total = document.querySelector<HTMLElement>('[data-whatif-headcount-total]')
  if (total) total.textContent = `合計 ${counts.A + counts.B + counts.C} / ${rosterSize}名（3スライダーの合計が常に母集団数になるよう自動調整）`
}

export interface RosterTableInput {
  roster: Employee[]
  baselineAssignment: Record<string, UnitId>
  assignment: Record<string, UnitId>
}

/** ③配置：社員ごとの現在の所属セレクタ（軸2） */
export function renderRosterTable(input: RosterTableInput): void {
  const el = $('whatif-roster-table-card')
  if (!el) return
  const { roster, baselineAssignment, assignment } = input
  let html =
    '<table><tr><th>社員ID</th><th>基準の所属</th><th>現在の所属</th></tr>'
  for (const e of roster) {
    const base = baselineAssignment[e.id]
    const cur = assignment[e.id]
    const moved = base !== cur
    html += `<tr${moved ? ' class="whatif-moved"' : ''}><td>${escapeHtml(e.id)}</td><td>${base ? UNIT_LABEL[base] : '-'}</td><td><select data-whatif-move="${escapeAttr(e.id)}">${UNIT_IDS
      .map((u) => `<option value="${u}" ${u === cur ? 'selected' : ''}>${UNIT_LABEL[u]}</option>`)
      .join('')}</select></td></tr>`
  }
  html += '</table>'
  el.innerHTML = html
}

/** 結果詳細：事業部別テーブル（基準→What-if→Δ） */
export function renderUnitTable(current: SimulationResult, baseline: SimulationResult): void {
  const el = $('whatif-unit-table')
  if (!el) return
  let html =
    '<table><tr><th>事業部</th><th class="num">人数(基準→現在)</th><th class="num">充足率</th><th class="num">売上(基準→現在)</th><th class="num">Δ売上</th><th class="num">利益(基準→現在)</th><th class="num">Δ利益</th></tr>'
  for (const u of UNIT_IDS) {
    const b = baseline.units[u]
    const c = current.units[u]
    html += `<tr><td>${UNIT_LABEL[u]}</td><td class="num">${b.count}→${c.count}</td><td class="num">${Math.round(c.fulfillmentRate * 100)}%</td><td class="num">${oku(b.finalRevenue)}→${oku(c.finalRevenue)}</td><td class="num">${deltaText(c.finalRevenue, b.finalRevenue)}</td><td class="num">${oku(b.profit)}→${oku(c.profit)}</td><td class="num">${deltaText(c.profit, b.profit)}</td></tr>`
  }
  html += '</table>'
  el.innerHTML = html
}

/**
 * 結果詳細：充足率・ペナルティ帯ゲージ（#p3のfulfillment-gaugesと同じ見せ方）。
 * 描画は gauge.ts と共有する（以前は #p3 と式が食い違っていた・docs/refactor-plan.md B-1）。
 * 帯は前提パラメータの不足補正表から作るため、params を渡して #p6 の変更に追従させる。
 */
export function renderGauges(current: SimulationResult, params?: SimParams): void {
  setHtml('whatif-gauges', renderGaugesHtml(current, UNIT_LABEL, params))
}

/** 結果詳細：配置差分サマリー */
export function renderDiffSummary(diffs: AssignmentDiff[]): void {
  const el = $('whatif-diff-summary')
  if (!el) return
  if (diffs.length === 0) {
    el.innerHTML = '<p class="note">基準の配置から異動はありません。</p>'
    return
  }
  const total = diffs.reduce((s, d) => s + d.count, 0)
  const detail = diffs.map((d) => `${UNIT_LABEL[d.from]}→${UNIT_LABEL[d.to]} ${d.count}名`).join('、')
  el.innerHTML = `<p class="compare-summary">基準から ${total} 名が異動：${detail}</p>`
}

export function renderReasonBox(html: string, paramsChanged: boolean): void {
  const el = $('whatif-reason-box')
  if (!el) return
  const prefix = paramsChanged
    ? '<p class="note" style="color:var(--warning);">※ 前提パラメータを標準値から変更しています。</p>'
    : ''
  el.innerHTML = prefix + html
}
