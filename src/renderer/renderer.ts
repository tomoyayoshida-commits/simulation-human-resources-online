// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線

import type { Employee, SimulationResult, TaskId, ValidationError } from './types.ts'
import { importEmployees, mergeEmployees, buildAssignmentCsv, downloadCsv } from './csv.ts'
import { runOptimization } from './optimizer.ts'
import { renderDashboard } from './dashboard.ts'
import { renderCompareTasks } from './compareTasks.ts'
import { renderCompareHiring } from './compareHiring.ts'

// ---- アプリ状態 ----
const state: {
  employees100: Employee[] | null
  employees10: Employee[] | null
  selectedTask: TaskId
  currentResult: SimulationResult | null
} = {
  employees100: null,
  employees10: null,
  selectedTask: 1,
  currentResult: null,
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
  if (id === 'p5' && state.employees100 && state.employees10) {
    renderCompareHiring(state.employees100, state.employees10, state.selectedTask)
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
      alert('先に①データ取込で human_resources_100.csv を取り込んでください。')
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

  // 100名データ取込
  setupDropzone('dropzone-100', 'file-100', (text) => {
    const { employees, errors } = importEmployees(text, 100)
    state.employees100 = employees
    renderImportReport(employees, errors)
  })

  // 追加採用10名データ取込
  setupDropzone('dropzone-10', 'file-10', (text) => {
    if (!state.employees100) {
      alert('先に100名データを取り込んでください。')
      return
    }
    const { employees: add10, errors } = importEmployees(text, 10)
    if (!add10) {
      alert(`追加採用データにエラーがあります（${errors.length}件）。`)
      return
    }
    const merged = mergeEmployees(state.employees100, add10)
    if (!merged.employees) {
      alert('追加採用データの社員IDが既存社員と重複しています。')
      return
    }
    state.employees10 = add10
    renderCompareHiring(state.employees100, state.employees10, state.selectedTask)
  })
}

document.addEventListener('DOMContentLoaded', main)
