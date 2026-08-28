// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線
//
// このファイルが持つのはアプリ全体の状態と画面遷移だけ。DOM生成は各表示モジュールに任せる。
//   #p1 / #p5 の取込UI  → importPanel.ts
//   #p3 結果ダッシュボード → dashboard.ts
//   #p4 4課題横断比較     → compareTasks.ts
//   #p5 採用前後比較      → compareHiring.ts
//   #p6 What-if分析      → whatifController.ts（状態）／whatifPanel.ts（表示）

import type { Employee, SimulationResult, TaskId } from './types.ts'
import { importEmployees, mergeEmployees, buildAssignmentCsv, downloadCsv } from './csv.ts'
import { runOptimization } from './optimizer.ts'
import { renderDashboard } from './dashboard.ts'
import { renderCompareTasks, initCompareModeToggle } from './compareTasks.ts'
import { renderCompareHiring } from './compareHiring.ts'
import { renderHiringImportError, renderHiringImportOk, renderImportReport, setupDropzone } from './importPanel.ts'
import { ensureWhatIf, initWhatIfPanel, renderWhatIfAll, resetWhatIf } from './whatifController.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'

// ---- アプリ状態 ----
const state: {
  employees100: Employee[] | null
  selectedTask: TaskId
  currentResult: SimulationResult | null
  // 採用前後比較(#p5)は①の取込データを再利用しない独立画面のため、専用の取込状態を持つ
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
} = {
  employees100: null,
  selectedTask: 1,
  currentResult: null,
  hiringBase100: null,
  hiringAdd10: null,
}

// ---- 画面遷移（モックの go(id) 移植版） ----
// 比較画面（p4/p5/p6）は最新データで再計算するため重い同期処理を伴う。
// withLoading で1フレーム描画してから計算に入り、体感の「固まった」印象を防ぐ（loading.ts）。
async function go(id: string): Promise<void> {
  document.querySelectorAll<HTMLElement>('.phasebtn').forEach((b) => b.classList.remove('active'))
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.remove('active'))
  document.querySelector<HTMLElement>(`.phasebtn[data-tab="${id}"]`)?.classList.add('active')
  $(id)?.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })

  // 比較画面は遷移時に最新データで再描画
  if (id === 'p4' && state.employees100) {
    const employees100 = state.employees100
    await withLoading('4課題を計算しています…', () => renderCompareTasks(employees100))
  }
  if (id === 'p5' && state.hiringBase100 && state.hiringAdd10) {
    const { hiringBase100, hiringAdd10, selectedTask } = state
    await withLoading('採用前後の効果を計算しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, selectedTask))
  }
  if (id === 'p6') {
    ensureWhatIf()
    await withLoading('What-if分析を計算しています…', () => renderWhatIfAll())
  }
}

// ---- ナビゲーション初期化 ----
function initNavigation(): void {
  document.querySelectorAll<HTMLElement>('.phasebtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) void go(btn.dataset.tab)
    })
  })
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.go) void go(el.dataset.go)
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
  $('run-simulation')?.addEventListener('click', () => {
    if (!state.employees100) {
      alert('先に①データ取込で社員データを取り込んでください。')
      void go('p1')
      return
    }
    const employees100 = state.employees100
    const selectedTask = state.selectedTask
    void withLoading('シミュレーションを実行しています…', () => runOptimization(employees100, selectedTask)).then(
      async (result) => {
        state.currentResult = 'infeasible' in result ? null : result
        renderDashboard(result, selectedTask, employees100)
        await go('p3')
      },
    )
  })
}

// ---- CSV出力 ----
function initExportButton(): void {
  $('export-csv')?.addEventListener('click', () => {
    if (!state.currentResult || !state.employees100) {
      alert('先にシミュレーションを実行してください。')
      return
    }
    downloadCsv('assignment_result.csv', buildAssignmentCsv(state.employees100, state.currentResult))
  })
}

// ---- CSV取込の配線 ----
function initImports(): void {
  // ① 社員データ取込
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
    if (state.hiringAdd10) renderCompareHiring(base100, state.hiringAdd10, state.selectedTask)
  })

  // 採用前後比較(#p5)：追加採用10名データ取込（①とは独立）
  const hiringErr10 = { summary: 'hiring-validation-summary-10', table: 'hiring-validation-errors-10' }
  setupDropzone('dropzone-10', 'file-10', (text) => {
    const base100 = state.hiringBase100
    if (!base100) {
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
    const merged = mergeEmployees(base100, add10)
    if (!merged.employees) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, merged.errors, '取込を保留（既存社員IDと重複）')
      return
    }
    renderHiringImportOk(hiringErr10, add10.length)
    state.hiringAdd10 = add10
    renderCompareHiring(base100, add10, state.selectedTask)
  })
}

// ---- 初期化 ----
function main(): void {
  initNavigation()
  initTaskSelection()
  initRunButton()
  initExportButton()
  initCompareModeToggle()
  initWhatIfPanel(() => state)
  initImports()
}

document.addEventListener('DOMContentLoaded', main)
