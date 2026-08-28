// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線

import type { AllocationCounts, Employee, SimParams, SimulationResult, TaskId, UnitId, ValidationError } from './types.ts'
import { importEmployees, mergeEmployees, buildAssignmentCsv, downloadCsv } from './csv.ts'
import { runOptimization, solveForHeadcount } from './optimizer.ts'
import { renderDashboard } from './dashboard.ts'
import { renderCompareTasks, initCompareModeToggle } from './compareTasks.ts'
import { renderCompareHiring } from './compareHiring.ts'
import { DEFAULT_PARAMS, UNIT_IDS } from './constants.ts'
import { computeSimulationResult } from './calcEngine.ts'
import { generateReasonText } from './reasonText.ts'
import { diffAssignment, evaluateAssignment, headcountOf, validateParams, type WhatIfState } from './whatif.ts'
import {
  renderBaselineNote,
  renderDiffSummary,
  renderGauges,
  renderHeadcountCard,
  renderParamsCard,
  renderParamsErrors,
  renderReasonBox,
  renderRosterCard,
  renderRosterTable,
  renderSummary,
  renderTaskCards,
  renderUnitTable,
  updateHeadcountValues,
} from './whatifPanel.ts'

// ---- アプリ状態 ----
const state: {
  employees100: Employee[] | null
  selectedTask: TaskId
  currentResult: SimulationResult | null
  // 採用前後比較(#p5)は①の取込データを再利用しない独立画面のため、専用の取込状態を持つ
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
  // What-if分析(#p6・機能14)：assignmentが唯一の真実（docs/whatif-plan.md §4.1）
  whatIf: (WhatIfState & { baselineAssignment: Record<string, UnitId>; selectedCandidateIds: Set<string> }) | null
} = {
  employees100: null,
  selectedTask: 1,
  currentResult: null,
  hiringBase100: null,
  hiringAdd10: null,
  whatIf: null,
}

// 課題ごとに遅延計算してキャッシュする基準ケース（標準パラメータ・100名・docs/whatif-plan.md §4.2）
const whatIfBaselineCache: Partial<Record<TaskId, SimulationResult>> = {}

function whatIfBaseline(task: TaskId): SimulationResult | null {
  if (!state.employees100) return null
  const cached = whatIfBaselineCache[task]
  if (cached) return cached
  const r = runOptimization(state.employees100, task)
  if ('infeasible' in r) return null
  whatIfBaselineCache[task] = r
  return r
}

function cloneParams(p: SimParams): SimParams {
  return {
    weights: { A: { ...p.weights.A }, B: { ...p.weights.B }, C: { ...p.weights.C } },
    baseRevenue: { ...p.baseRevenue },
    growth: { ...p.growth },
    optimalHeadcount: { ...p.optimalHeadcount },
    minHeadcount: { ...p.minHeadcount },
    shortageTable: {
      A: p.shortageTable.A.map((r) => ({ ...r })),
      B: p.shortageTable.B.map((r) => ({ ...r })),
      C: p.shortageTable.C.map((r) => ({ ...r })),
    },
    surplusTable: p.surplusTable.map((r) => ({ ...r })),
    prevYearRevenue: p.prevYearRevenue,
    costMultiplier: p.costMultiplier,
  }
}

function paramsEqualDefault(p: SimParams): boolean {
  return JSON.stringify(p) === JSON.stringify(DEFAULT_PARAMS)
}

/** What-ifパネルの状態を初期化する（①データ取込の再取込時にも呼ぶ・基準を作り直す）。 */
function resetWhatIf(): void {
  for (const k of Object.keys(whatIfBaselineCache)) delete whatIfBaselineCache[Number(k) as TaskId]
  if (!state.employees100) {
    state.whatIf = null
    return
  }
  const task = state.selectedTask
  const baseline = whatIfBaseline(task)
  state.whatIf = {
    task,
    roster: [...state.employees100],
    params: cloneParams(DEFAULT_PARAMS),
    assignment: baseline ? { ...baseline.assignment } : {},
    baselineAssignment: baseline ? { ...baseline.assignment } : {},
    selectedCandidateIds: new Set(),
  }
}

/** requestAnimationFrameを1回挟んでボタンのラベル変更を確実に描画させてから重い計算に入る（docs/whatif-plan.md §4.7）。 */
function runHeavyWhatIf(button: HTMLButtonElement, busyLabel: string, fn: () => void): void {
  const original = button.textContent
  button.disabled = true
  button.textContent = busyLabel
  requestAnimationFrame(() => {
    try {
      fn()
    } finally {
      button.disabled = false
      button.textContent = original
    }
  })
}

/** #p6 全体を再描画する。 */
function renderWhatIfAll(): void {
  const wi = state.whatIf
  if (!wi || !state.employees100) return

  renderTaskCards(wi.task)
  const baseline = whatIfBaseline(wi.task)
  renderBaselineNote(baseline)

  const evaluation = evaluateAssignment(wi, wi.baselineAssignment)
  if (baseline) {
    renderSummary({
      result: evaluation.result,
      baseline,
      minHeadcountViolations: evaluation.minHeadcountViolations,
      prevYearRevenue: wi.params.prevYearRevenue,
    })
    renderUnitTable(evaluation.result, baseline)
    renderReasonBox(generateReasonText(evaluation.result, wi.task, wi.params), !paramsEqualDefault(wi.params))
  } else {
    renderSummary(null)
  }
  renderGauges(evaluation.result, wi.params)
  renderDiffSummary(diffAssignment(wi.baselineAssignment, wi.assignment))

  renderRosterCard({
    hiringAdd10: state.hiringAdd10,
    selectedIds: wi.selectedCandidateIds,
    baseCount: state.employees100.length,
  })
  renderParamsCard({ params: wi.params, standard: DEFAULT_PARAMS })
  renderParamsErrors(validateParams(wi.params))

  const counts = headcountOf(wi.assignment, wi.roster)
  renderHeadcountCard({ counts, rosterSize: wi.roster.length })
  renderRosterTable({ roster: wi.roster, baselineAssignment: wi.baselineAssignment, assignment: wi.assignment })
}

// ---- What-if(#p6) イベント配線 ----
function initWhatIfPanel(): void {
  document.getElementById('whatif-task-cards')?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-whatif-task]')
    const wi = state.whatIf
    if (!target || !wi) return
    const task = Number(target.dataset.whatifTask) as TaskId
    wi.task = task
    const opt = runOptimization(wi.roster, task, wi.params)
    if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
    const baseline = whatIfBaseline(task)
    wi.baselineAssignment = baseline ? { ...baseline.assignment } : {}
    renderWhatIfAll()
  })

  // 軸1：人数配分スライダー（同期・range要素は再生成しない §4.7）
  const headcountCard = document.getElementById('whatif-headcount-card')
  headcountCard?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    const unit = target.dataset.whatifHeadcount as UnitId | undefined
    const wi = state.whatIf
    if (!unit || !wi) return
    const rosterSize = wi.roster.length
    const before = headcountOf(wi.assignment, wi.roster)
    let newValue = Math.max(0, Math.min(rosterSize, Number(target.value)))
    const others = UNIT_IDS.filter((u) => u !== unit)
    const otherSum = others.reduce((s, u) => s + before[u], 0) || 1
    const remaining = rosterSize - newValue
    const counts: AllocationCounts = { A: 0, B: 0, C: 0 }
    counts[unit] = newValue
    let assigned = 0
    others.forEach((u, idx) => {
      const v =
        idx === others.length - 1
          ? Math.max(0, remaining - assigned)
          : Math.max(0, Math.round((remaining * before[u]) / otherSum))
      counts[u] = v
      assigned += v
    })
    wi.assignment = solveForHeadcount(wi.roster, wi.task, counts, wi.params)
    updateHeadcountValues(counts, rosterSize)
    // 人数配分以外（サマリー・事業部別テーブル・社員一覧・配置差分）は都度再計算して更新する。
    // headcount-card自体はupdateHeadcountValuesで軽量更新済みのため、ここでは再構築しない。
    const wiForRender = wi
    const baseline = whatIfBaseline(wiForRender.task)
    const evaluation = evaluateAssignment(wiForRender, wiForRender.baselineAssignment)
    if (baseline) {
      renderSummary({
        result: evaluation.result,
        baseline,
        minHeadcountViolations: evaluation.minHeadcountViolations,
        prevYearRevenue: wiForRender.params.prevYearRevenue,
      })
      renderUnitTable(evaluation.result, baseline)
      renderReasonBox(generateReasonText(evaluation.result, wiForRender.task, wiForRender.params), !paramsEqualDefault(wiForRender.params))
    }
    renderGauges(evaluation.result, wiForRender.params)
    renderDiffSummary(diffAssignment(wiForRender.baselineAssignment, wiForRender.assignment))
    renderRosterTable({ roster: wiForRender.roster, baselineAssignment: wiForRender.baselineAssignment, assignment: wiForRender.assignment })
  })
  headcountCard?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id !== 'whatif-auto-optimize') return
    const wi = state.whatIf
    if (!wi) return
    runHeavyWhatIf(e.target as HTMLButtonElement, '再最適化中…', () => {
      const opt = runOptimization(wi.roster, wi.task, wi.params)
      if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
      renderWhatIfAll()
    })
  })

  // 軸2：個別異動セレクタ（同期）
  document.getElementById('whatif-roster-table-card')?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement
    const id = target.dataset.whatifMove
    const wi = state.whatIf
    if (!id || !wi) return
    wi.assignment[id] = target.value as UnitId
    renderWhatIfAll()
  })
  document.getElementById('whatif-reset-assignment')?.addEventListener('click', () => {
    const wi = state.whatIf
    if (!wi) return
    for (const e of wi.roster) {
      const base = wi.baselineAssignment[e.id]
      if (base) wi.assignment[e.id] = base
    }
    renderWhatIfAll()
  })

  // 軸3：前提パラメータ（changeで確定・再最適化は明示ボタンのみ §4.4/§4.7）
  document.getElementById('whatif-params-card')?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    const wi = state.whatIf
    if (!wi) return
    const unit = target.dataset.whatifUnit as UnitId | undefined
    const field = target.dataset.whatifParam as
      | 'baseRevenue'
      | 'growth'
      | 'optimalHeadcount'
      | 'minHeadcount'
      | undefined
    const weightKey = target.dataset.whatifWeight as 'sales' | 'mgmt' | 'dev' | 'training' | undefined
    const scalar = target.dataset.whatifScalar as 'prevYearRevenue' | 'costMultiplier' | undefined
    const value = Number(target.value)
    if (field && unit) wi.params[field][unit] = value
    else if (weightKey && unit) wi.params.weights[unit][weightKey] = value
    else if (scalar) wi.params[scalar] = value
    else return
    renderParamsCard({ params: wi.params, standard: DEFAULT_PARAMS })
    renderParamsErrors(validateParams(wi.params))
  })
  document.getElementById('whatif-params-reset')?.addEventListener('click', () => {
    const wi = state.whatIf
    if (!wi) return
    wi.params = cloneParams(DEFAULT_PARAMS)
    wi.assignment = { ...wi.baselineAssignment }
    renderWhatIfAll()
  })
  document.getElementById('whatif-params-reoptimize')?.addEventListener('click', (e) => {
    const wi = state.whatIf
    if (!wi) return
    const errors = validateParams(wi.params)
    if (errors.length > 0) return
    runHeavyWhatIf(e.currentTarget as HTMLButtonElement, '再最適化中…', () => {
      const opt = runOptimization(wi.roster, wi.task, wi.params)
      if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
      renderWhatIfAll()
    })
  })

  // 軸4：採用シナリオ（母集団を変えて再最適化・明示ボタンのみ）
  document.getElementById('whatif-roster-card')?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    const id = target.dataset.whatifCandidate
    const wi = state.whatIf
    if (!id || !wi) return
    if (target.checked) wi.selectedCandidateIds.add(id)
    else wi.selectedCandidateIds.delete(id)
    renderRosterCard({
      hiringAdd10: state.hiringAdd10,
      selectedIds: wi.selectedCandidateIds,
      baseCount: state.employees100?.length ?? 0,
    })
  })
  document.getElementById('whatif-roster-card')?.addEventListener('click', (e) => {
    const wi = state.whatIf
    if (!wi || !state.hiringAdd10) return
    const targetId = (e.target as HTMLElement).id
    if (targetId === 'whatif-hire-all') {
      wi.selectedCandidateIds = new Set(state.hiringAdd10.map((c) => c.id))
      renderRosterCard({ hiringAdd10: state.hiringAdd10, selectedIds: wi.selectedCandidateIds, baseCount: state.employees100?.length ?? 0 })
    } else if (targetId === 'whatif-hire-none') {
      wi.selectedCandidateIds = new Set()
      renderRosterCard({ hiringAdd10: state.hiringAdd10, selectedIds: wi.selectedCandidateIds, baseCount: state.employees100?.length ?? 0 })
    } else if (targetId === 'whatif-reoptimize-roster') {
      if (!state.employees100) return
      const selected = state.hiringAdd10.filter((c) => wi.selectedCandidateIds.has(c.id))
      const merged = mergeEmployees(state.employees100, selected)
      if (!merged.employees) {
        alert('採用候補のIDが既存社員と重複しています。')
        return
      }
      runHeavyWhatIf(e.target as HTMLButtonElement, '再最適化中…', () => {
        wi.roster = merged.employees!
        const opt = runOptimization(wi.roster, wi.task, wi.params)
        if (!('infeasible' in opt)) wi.assignment = { ...opt.assignment }
        renderWhatIfAll()
      })
    }
  })

  // 仕上げ：What-if配置のCSV出力（機能14・§5 Phase6）
  document.getElementById('whatif-export-csv')?.addEventListener('click', () => {
    const wi = state.whatIf
    if (!wi) {
      alert('先にWhat-if分析でデータを準備してください。')
      return
    }
    const result = computeSimulationResult(wi.assignment, wi.roster, wi.params)
    const csv = buildAssignmentCsv(wi.roster, result, wi.params)
    downloadCsv('whatif_assignment.csv', csv)
  })
}

// ---- 画面遷移（モックの go(id) 移植版） ----
function go(id: string): void {
  document.querySelectorAll<HTMLElement>('.phasebtn').forEach((b) => b.classList.remove('active'))
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.remove('active'))
  document.querySelector<HTMLElement>(`.phasebtn[data-tab="${id}"]`)?.classList.add('active')
  document.getElementById(id)?.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })

  // 比較画面は遷移時に最新データで再描画
  if (id === 'p4' && state.employees100) renderCompareTasks(state.employees100)
  if (id === 'p5' && state.hiringBase100 && state.hiringAdd10) {
    renderCompareHiring(state.hiringBase100, state.hiringAdd10, state.selectedTask)
  }
  if (id === 'p6') {
    if (!state.whatIf && state.employees100) resetWhatIf()
    renderWhatIfAll()
  }
}

// ---- CSV取込 UI（ドロップゾーン＋ファイル選択） ----
function setupDropzone(dropId: string, inputId: string, onText: (text: string) => void): void {
  const drop = document.getElementById(dropId)
  const input = document.getElementById(inputId) as HTMLInputElement | null
  if (!drop || !input) return

  drop.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (file) onText(await file.text())
    input.value = ''
  })
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('dragover')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'))
  drop.addEventListener('drop', async (e) => {
    e.preventDefault()
    drop.classList.remove('dragover')
    const file = e.dataTransfer?.files?.[0]
    if (file) onText(await file.text())
  })
}

// ---- 採用前後比較(#p5)の取込エラー表示 ----
// alert()はElectronで主プロセスとの同期IPCを介するため、file inputのchangeイベント直後に
// 呼ぶと描画が一瞬止まって固まったように見える。取込報告(#p1)と同様にインライン表示する。
// #p5 は左（採用前100名）・右（追加採用10名）の2つの独立取込を持つため、対象のDOM ID組を受け取る。
function renderHiringImportError(ids: { summary: string; table: string }, errors: ValidationError[], message: string): void {
  const summary = document.getElementById(ids.summary)
  const errTable = document.getElementById(ids.table)
  if (summary) {
    summary.innerHTML = `<div class="stat"><div class="k">判定</div><div class="v"><span class="pill crit">${message}</span></div></div>`
  }
  if (errTable) {
    let html = '<tr><th>行番号</th><th>カラム</th><th class="num">実測値</th><th>期待範囲</th></tr>'
    for (const e of errors) {
      html += `<tr><td>${e.row === 0 ? '-' : e.row}</td><td>${e.column}</td><td class="num err">${String(e.actual)}</td><td>${e.expected}</td></tr>`
    }
    errTable.innerHTML = html
  }
}

// 取込成功時：判定ピルを「取込OK」に変え件数を示す。エラー表は空にする（前回の残骸を消す）
function renderHiringImportOk(ids: { summary: string; table: string }, count: number): void {
  const summary = document.getElementById(ids.summary)
  const errTable = document.getElementById(ids.table)
  if (summary) {
    summary.innerHTML = `<div class="stat"><div class="k">判定</div><div class="v"><span class="pill good">取込OK（${count}件）</span></div></div>`
  }
  if (errTable) errTable.innerHTML = ''
}

// ---- 入力検証レポート描画（#p1） ----
function renderImportReport(employees: Employee[] | null, errors: ValidationError[]): void {
  // プレビュー（先頭5名）
  const preview = document.getElementById('preview-100')
  if (preview) {
    let html =
      '<tr><th>社員ID</th><th class="num">営業力</th><th class="num">管理力</th><th class="num">開拓力</th><th class="num">育成力</th><th class="num">人件費</th></tr>'
    const rows = employees ?? []
    for (const e of rows.slice(0, 5)) {
      html += `<tr><td>${e.id}</td><td class="num">${e.sales}</td><td class="num">${e.mgmt}</td><td class="num">${e.dev}</td><td class="num">${e.training}</td><td class="num">${e.cost}</td></tr>`
    }
    if (rows.length === 0) html += '<tr><td colspan="6">（取込に成功したデータがありません）</td></tr>'
    preview.innerHTML = html
  }

  // サマリー
  const count = employees?.length ?? 0
  const ok = errors.length === 0 && employees !== null
  const summary = document.getElementById('validation-summary')
  if (summary) {
    summary.innerHTML = `
      <div class="stat"><div class="k">取込件数</div><div class="v">${count} / 100</div></div>
      <div class="stat"><div class="k">エラー件数</div><div class="v" style="color:${errors.length > 0 ? 'var(--critical)' : 'inherit'};">${errors.length}</div></div>
      <div class="stat"><div class="k">判定</div><div class="v">${ok ? '<span class="pill good">取込OK</span>' : '<span class="pill crit">取込を保留</span>'}</div></div>`
  }

  // エラーテーブル
  const errTable = document.getElementById('validation-errors')
  if (errTable) {
    let html = '<tr><th>行番号</th><th>カラム</th><th class="num">実測値</th><th>期待範囲</th></tr>'
    if (errors.length === 0) {
      html += '<tr><td colspan="4">エラーはありません。次のステップへ進めます。</td></tr>'
    } else {
      for (const e of errors) {
        html += `<tr><td>${e.row === 0 ? '-' : e.row}</td><td>${e.column}</td><td class="num err">${String(e.actual)}</td><td>${e.expected}</td></tr>`
      }
    }
    errTable.innerHTML = html
  }

  // エラーが1件でもある間は次のステップへ進めない（誤った状態で②以降に進むのを防ぐ）
  const nextBtn = document.getElementById('next-to-p2') as HTMLButtonElement | null
  if (nextBtn) nextBtn.disabled = !ok
  const invalidWarning = document.getElementById('import-invalid-warning')
  if (invalidWarning) invalidWarning.style.display = ok ? 'none' : 'block'
}

// ---- ナビゲーション初期化 ----
function initNavigation(): void {
  document.querySelectorAll<HTMLElement>('.phasebtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) go(btn.dataset.tab)
    })
  })
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.go) go(el.dataset.go)
    })
  })
}

// ---- 課題選択 ----
function initTaskSelection(): void {
  document.querySelectorAll<HTMLElement>('.taskcard').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('.taskcard').forEach((x) => x.classList.remove('selected'))
      card.classList.add('selected')
      const task = Number(card.dataset.task)
      if (task >= 1 && task <= 4) state.selectedTask = task as TaskId
    })
  })
}

// ---- シミュレーション実行 ----
function initRunButton(): void {
  const btn = document.getElementById('run-simulation')
  btn?.addEventListener('click', () => {
    if (!state.employees100) {
      alert('先に①データ取込で社員データを取り込んでください。')
      go('p1')
      return
    }
    const result = runOptimization(state.employees100, state.selectedTask)
    state.currentResult = 'infeasible' in result ? null : result
    renderDashboard(result, state.selectedTask, state.employees100)
    go('p3')
  })
}

// ---- CSV出力 ----
function initExportButton(): void {
  const btn = document.getElementById('export-csv')
  btn?.addEventListener('click', () => {
    if (!state.currentResult || !state.employees100) {
      alert('先にシミュレーションを実行してください。')
      return
    }
    const csv = buildAssignmentCsv(state.employees100, state.currentResult)
    downloadCsv('assignment_result.csv', csv)
  })
}

// ---- 初期化 ----
function main(): void {
  initNavigation()
  initTaskSelection()
  initRunButton()
  initExportButton()
  initCompareModeToggle()
  initWhatIfPanel()

  // 100名データ取込
  setupDropzone('dropzone-100', 'file-100', (text) => {
    const { employees, errors } = importEmployees(text, 100)
    state.employees100 = employees
    renderImportReport(employees, errors)
    // What-ifの基準ケース・母集団は①のデータに紐づくため、再取込時は作り直す
    resetWhatIf()
  })

  // 採用前後比較(#p5)：採用前100名データ取込（①とは独立）
  const hiringErr100 = { summary: 'hiring-validation-summary-100', table: 'hiring-validation-errors-100' }
  setupDropzone('dropzone-hiring-100', 'file-hiring-100', (text) => {
    const { employees: base100, errors } = importEmployees(text, 100)
    if (!base100) {
      state.hiringBase100 = null
      renderHiringImportError(hiringErr100, errors, `取込を保留（エラー${errors.length}件）`)
      return
    }
    renderHiringImportOk(hiringErr100, base100.length)
    state.hiringBase100 = base100
    if (state.hiringAdd10) renderCompareHiring(state.hiringBase100, state.hiringAdd10, state.selectedTask)
  })

  // 採用前後比較(#p5)：追加採用10名データ取込（①とは独立）
  const hiringErr10 = { summary: 'hiring-validation-summary-10', table: 'hiring-validation-errors-10' }
  setupDropzone('dropzone-10', 'file-10', (text) => {
    if (!state.hiringBase100) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, [], '取込を保留（先に左側の採用前100名データを取り込んでください）')
      return
    }
    const { employees: add10, errors } = importEmployees(text, 10)
    if (!add10) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, errors, `取込を保留（エラー${errors.length}件）`)
      return
    }
    const merged = mergeEmployees(state.hiringBase100, add10)
    if (!merged.employees) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, merged.errors, '取込を保留（既存社員IDと重複）')
      return
    }
    renderHiringImportOk(hiringErr10, add10.length)
    state.hiringAdd10 = add10
    renderCompareHiring(state.hiringBase100, state.hiringAdd10, state.selectedTask)
  })
}

document.addEventListener('DOMContentLoaded', main)
