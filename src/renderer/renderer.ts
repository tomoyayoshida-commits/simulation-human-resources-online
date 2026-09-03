// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線
//
// このファイルが持つのはアプリ全体の状態と画面遷移だけ。DOM生成は各表示モジュールに任せる。
//   #p4 データ取込→4課題横断比較 → importPanel.ts（取込UI）／compareTasks.ts（比較表示）
//   #p5 データ取込→採用前後比較   → importPanel.ts（取込UI）／compareHiring.ts（比較表示）
//
// 各画面は「取込ステップ」→（取込成功で自動的に）「結果ステップ」の一続きのフローで、
// 画面遷移（go）そのものはタブ切替のみを担う。

import type { Employee, SimParams, ValidationError } from './types.ts'
import { importEmployees, mergeEmployees } from './csv.ts'
import { currentCardResult, initCompareModeToggle, initWorkbenchLaunch, renderCompareTasks } from './compareTasks.ts'
import { initWorkbenchPanel, openWorkbench } from './workbenchPanel.ts'
import { renderCompareHiring } from './compareHiring.ts'
import type { HiringImportIds } from './importPanel.ts'
import {
  renderHiringImportError,
  renderHiringImportOk,
  renderImportConditions,
  renderImportReport,
  setupDropzone,
} from './importPanel.ts'
import { createParamsOptionsPanel } from './paramsOptions.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'
import { escapeHtml } from './format.ts'
import { completeRedirectSignIn, signInWithGoogle, signOutUser, watchAuthState } from './auth.ts'

// ---- アプリ状態 ----
const state: {
  employees100: Employee[] | null
  // 採用判断(#p5)は配置比較(#p4)の取込データを再利用しない独立画面のため、専用の取込状態を持つ
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
} = {
  employees100: null,
  hiringBase100: null,
  hiringAdd10: null,
}

const p4Params = createParamsOptionsPanel('p4')
const p5Params = createParamsOptionsPanel('p5')

// ---- リロード耐性（タブを閉じるまでの範囲）----
// 復元対象は画面位置・取込データ・前提パラメータのみ。作業机(#p4-bench-step)の手動編集・undo履歴は対象外
// （その場のリロードに耐えれば十分という合意のため、複雑な履歴の直列化は行わない。bench保存時はresultへ読み替える）。
const SESSION_KEY = 'hr-sim-session-v1'

interface SessionSnapshot {
  panelId: string
  p4Step: Step
  p5Step: Step
  employees100: Employee[] | null
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
  p4Params: SimParams
  p5Params: SimParams
}

function saveSnapshot(): void {
  try {
    const panelId = document.querySelector<HTMLElement>('.panel.active')?.id ?? 'p0'
    const snapshot: SessionSnapshot = {
      panelId,
      p4Step: currentStep('p4'),
      p5Step: currentStep('p5'),
      employees100: state.employees100,
      hiringBase100: state.hiringBase100,
      hiringAdd10: state.hiringAdd10,
      p4Params: p4Params.getParams(),
      p5Params: p5Params.getParams(),
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    // プライベートモード等でsessionStorageが使えない場合は保存を諦める（機能自体は元通り動く）
  }
}

// ---- 取込／結果／作業机ステップの切替（機能15・docs/workbench-plan.md §4.1） ----
// `#p4-bench-step` は #p4 にのみ存在する。#p5 では該当要素が無いため toggleAttribute は何もしない。
type Step = 'import' | 'result' | 'bench'
function showStep(panelId: string, step: Step): void {
  for (const s of ['import', 'result', 'bench'] as const) {
    $(`${panelId}-${s}-step`)?.toggleAttribute('hidden', s !== step)
  }
  renderBreadcrumb(panelId)
  saveSnapshot()
}

/** panelId の現在表示中のステップ。#p5 のように bench-step が無いパネルは 'bench' を返さない。 */
function currentStep(panelId: string): Step {
  const benchEl = $(`${panelId}-bench-step`)
  if (benchEl && !benchEl.hasAttribute('hidden')) return 'bench'
  const resultVisible = !$(`${panelId}-result-step`)?.hasAttribute('hidden')
  return resultVisible ? 'result' : 'import'
}

// ---- 画面遷移（モックの go(id) 移植版） ----
async function go(id: string): Promise<void> {
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.remove('active'))
  $(id)?.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })
  renderBreadcrumb(id)
  saveSnapshot()
}

const FLOW_LABEL: Record<string, string> = { p4: '配置比較', p5: '採用判断' }

/** 現在どんな操作をしてここに来たかを示すパンくずリスト。トップバーのタブナビの代わり。 */
function renderBreadcrumb(panelId: string): void {
  const el = $('breadcrumb')
  if (!el) return

  type Crumb = { label: string; onClick?: () => void }
  const crumbs: Crumb[] = [{ label: 'トップ', onClick: panelId !== 'p0' ? () => void go('p0') : undefined }]

  const flowLabel = FLOW_LABEL[panelId]
  if (flowLabel) {
    const step = currentStep(panelId)
    if (step === 'import') {
      crumbs.push({ label: `${flowLabel}：データ取込` })
    } else {
      crumbs.push({ label: 'データ取込', onClick: () => showStep(panelId, 'import') })
      if (step === 'result') {
        crumbs.push({ label: flowLabel })
      } else {
        crumbs.push({ label: flowLabel, onClick: () => showStep(panelId, 'result') })
        crumbs.push({ label: '作業机' })
      }
    }
  }

  el.innerHTML = crumbs
    .map((c, i) => {
      const sep = i > 0 ? '<span class="crumb-sep">▸</span>' : ''
      const tag = c.onClick ? 'button type="button" class="crumb-link"' : 'span class="crumb-current"'
      const closeTag = c.onClick ? 'button' : 'span'
      return `${sep}<${tag} data-crumb="${i}">${escapeHtml(c.label)}</${closeTag}>`
    })
    .join('')
  crumbs.forEach((c, i) => {
    if (c.onClick) el.querySelector<HTMLElement>(`[data-crumb="${i}"]`)?.addEventListener('click', c.onClick)
  })
}

// ---- ナビゲーション初期化 ----
function initNavigation(): void {
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.go) void go(el.dataset.go)
    })
  })
}

// ---- CSV取込の配線 ----
// 取込成功後も自動遷移はせず、「見る」ボタンを押すまでは取込ステップに留まる
// （取込直後にいきなり結果画面へ切り替わると、取込内容を見直す余地がなくなるため）。
function initImports(): void {
  renderImportConditions()
  // 配置比較(#p4)：社員データ取込 → ボタン押下で4課題比較の結果ステップへ
  const updateP4ProceedBtn = (): void => {
    const proceedBtn = $('p4-proceed') as HTMLButtonElement | null
    if (proceedBtn) proceedBtn.disabled = !(state.employees100 && p4Params.isValid())
    $('p4-file-actions')?.toggleAttribute('hidden', !state.employees100)
    saveSnapshot()
  }
  p4Params.init(updateP4ProceedBtn)
  setupDropzone('dropzone-100', 'file-100', (text) => {
    const { employees, errors } = importEmployees(text, 100)
    state.employees100 = employees
    renderImportReport(employees, errors)
    updateP4ProceedBtn()
  })
  $('p4-proceed')?.addEventListener('click', () => {
    const employees100 = state.employees100
    if (!employees100 || !p4Params.isValid()) return
    const params = p4Params.getParams()
    void withLoading('4課題を計算しています…', () => renderCompareTasks(employees100, params)).then(() => {
      showStep('p4', 'result')
    })
  })
  // 「ファイルを変更」：取込済みデータはそのままにファイル選択ダイアログだけ開き直す
  $('p4-file-change')?.addEventListener('click', () => ($('file-100') as HTMLInputElement | null)?.click())
  // 「取り込みを解除」：取込結果をクリアして未取込状態に戻す
  $('p4-file-clear')?.addEventListener('click', () => {
    state.employees100 = null
    renderImportReport(null, [])
    updateP4ProceedBtn()
  })
  $('p4-back')?.addEventListener('click', () => void go('p0'))
  // 4課題比較・作業机の「← 前の画面へ戻る」はデータ取込ステップへ戻す。
  $('p4-result-back')?.addEventListener('click', () => showStep('p4', 'import'))

  // 機能15 作業机：カード下部のボタンから起動（docs/workbench-plan.md §4.1）
  initWorkbenchLaunch((task) => {
    const employees100 = state.employees100
    const card = currentCardResult(task)
    if (!employees100 || !card) return
    openWorkbench({
      task,
      metric: card.metric,
      roster: employees100,
      params: card.params,
      assignment: { ...card.result.assignment },
      baseline: card.result,
      history: [],
    })
    showStep('p4', 'bench')
  })
  // 作業机の「← 前の画面へ戻る」は直前の4課題比較結果へ戻す。
  $('p4-bench-back')?.addEventListener('click', () => showStep('p4', 'result'))

  // 採用判断(#p5)：左（採用前100名）・右（追加採用10名）の2つの独立した取込欄
  const hiringErr100: HiringImportIds = {
    summary: 'hiring-validation-summary-100',
    table: 'hiring-validation-errors-100',
    reasonDetail: 'hiring-error-reasons-detail-100',
    reasonList: 'hiring-error-reasons-100',
  }
  const hiringErr10: HiringImportIds = {
    summary: 'hiring-validation-summary-10',
    table: 'hiring-validation-errors-10',
    reasonDetail: 'hiring-error-reasons-detail-10',
    reasonList: 'hiring-error-reasons-10',
  }
  const updateHiringProceedBtn = (): void => {
    const proceedBtn = $('p5-proceed') as HTMLButtonElement | null
    if (proceedBtn) proceedBtn.disabled = !(state.hiringBase100 && state.hiringAdd10 && p5Params.isValid())
    saveSnapshot()
  }

  // 取込を受け入れる／保留する。どちらも「状態を書き換え → 結果を表示 → 次へボタンを引き直す」で終わり、
  // このうち最後の1手を忘れると次へボタンが古い判定のまま残る。3手を必ず揃えるためにここへ寄せてある。
  type HiringSlot = 'hiringBase100' | 'hiringAdd10'
  const acceptHiring = (slot: HiringSlot, ids: HiringImportIds, employees: Employee[]): void => {
    renderHiringImportOk(ids, employees.length)
    state[slot] = employees
    updateHiringProceedBtn()
  }
  const rejectHiring = (
    slot: HiringSlot,
    ids: HiringImportIds,
    errors: ValidationError[],
    message: string,
  ): void => {
    state[slot] = null
    renderHiringImportError(ids, errors, message)
    updateHiringProceedBtn()
  }
  const errorMessage = (errors: ValidationError[]): string => `取込を保留（エラー${errors.length}件）`

  p5Params.init(updateHiringProceedBtn)
  setupDropzone('dropzone-hiring-100', 'file-hiring-100', (text) => {
    const { employees: base100, errors } = importEmployees(text, 100)
    if (!base100) return rejectHiring('hiringBase100', hiringErr100, errors, errorMessage(errors))
    acceptHiring('hiringBase100', hiringErr100, base100)
  })

  setupDropzone('dropzone-10', 'file-10', (text) => {
    const base100 = state.hiringBase100
    if (!base100) {
      return rejectHiring('hiringAdd10', hiringErr10, [], '取込を保留（先に左側の採用前100名データを取り込んでください）')
    }
    const { employees: add10, errors } = importEmployees(text, 10)
    if (!add10) return rejectHiring('hiringAdd10', hiringErr10, errors, errorMessage(errors))
    // 追加10名だけで検証が通っても、既存100名と社員番号が衝突すれば取り込めない
    const merged = mergeEmployees(base100, add10)
    if (!merged.employees) {
      return rejectHiring('hiringAdd10', hiringErr10, merged.errors, '取込を保留（既存社員IDと重複）')
    }
    acceptHiring('hiringAdd10', hiringErr10, add10)
  })
  $('p5-proceed')?.addEventListener('click', () => {
    const { hiringBase100, hiringAdd10 } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    const params = p5Params.getParams()
    void withLoading('採用前後の効果を計算しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, 1, params)).then(() => {
      showStep('p5', 'result')
    })
  })
  $('p5-back')?.addEventListener('click', () => void go('p0'))
  $('p5-result-back')?.addEventListener('click', () => void go('p0'))

  restoreSession()

  // リロード直後の画面・取込データ・前提パラメータを復元する。作業机(bench)の手動編集は対象外のため
  // bench保存時はresultへ読み替える（openWorkbenchを呼ばないので編集内容そのものは復元されない）。
  function restoreSession(): void {
    let raw: string | null
    try {
      raw = sessionStorage.getItem(SESSION_KEY)
    } catch {
      return
    }
    if (!raw) return

    let snap: SessionSnapshot
    try {
      snap = JSON.parse(raw) as SessionSnapshot
    } catch {
      return
    }

    if (snap.p4Params) p4Params.setParams(snap.p4Params)
    if (snap.p5Params) p5Params.setParams(snap.p5Params)

    if (snap.employees100) {
      state.employees100 = snap.employees100
      renderImportReport(snap.employees100, [])
    }
    updateP4ProceedBtn()

    if (snap.hiringBase100) {
      state.hiringBase100 = snap.hiringBase100
      renderHiringImportOk(hiringErr100, snap.hiringBase100.length)
    }
    if (snap.hiringAdd10) {
      state.hiringAdd10 = snap.hiringAdd10
      renderHiringImportOk(hiringErr10, snap.hiringAdd10.length)
    }
    updateHiringProceedBtn()

    const employees100 = state.employees100
    const hiringBase100 = state.hiringBase100
    const hiringAdd10 = state.hiringAdd10

    if (snap.panelId === 'p4' && employees100) {
      if (snap.p4Step === 'import') {
        showStep('p4', 'import')
        void go('p4')
        return
      }
      void withLoading('前回の比較結果を復元しています…', () => renderCompareTasks(employees100, p4Params.getParams())).then(() => {
        showStep('p4', 'result')
        void go('p4')
      })
      return
    }

    if (snap.panelId === 'p5' && hiringBase100 && hiringAdd10) {
      if (snap.p5Step === 'import') {
        showStep('p5', 'import')
        void go('p5')
        return
      }
      void withLoading('前回の比較結果を復元しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, 1, p5Params.getParams())).then(() => {
        showStep('p5', 'result')
        void go('p5')
      })
      return
    }

    renderBreadcrumb('p0')
  }
}

// ---- 初期化 ----
function main(): void {
  initNavigation()
  initCompareModeToggle()
  initWorkbenchPanel()
  initImports() // 内部でrestoreSession()を呼び、必要なら復元した画面のbreadcrumbまで描画する
}

// ---- 認証ガード ----
// 未ログイン・許可外アカウントの間は #login-screen のみを表示し、
// アプリ本体（#app-topbar/#app-wrap）は隠す（auth.ts参照）。
let appInitialized = false

function initAuthGuard(): void {
  $('login-google')?.addEventListener('click', () => {
    const errEl = $('login-error')
    errEl?.setAttribute('hidden', '')
    void signInWithGoogle().catch(() => {
      if (errEl) {
        errEl.textContent = 'ログインに失敗しました。社内のGoogleアカウントで再度お試しください。'
        errEl.removeAttribute('hidden')
      }
    })
  })
  $('logout-button')?.addEventListener('click', () => {
    void signOutUser()
  })

  // getRedirectResult() の解決を待ってから onAuthStateChanged を登録すると、
  // 何らかの理由で前者のPromiseが解決しない（実機で発生：identitytoolkitへの通信は
  // 200で成功しているのにgetRedirectResult自体が完了しない）場合、認証状態の反映処理が
  // 一切走らず無言でログイン画面のまま固まる。onAuthStateChangedはそれ単体で認証状態を
  // 反映できるため、待ち合わせず独立に登録する。redirectInfoはエラーメッセージの補助情報として
  // 解決でき次第使う（間に合わなければ redirected=false のまま扱う）。
  const redirectInfo: { redirected: boolean; errorCode?: string } = { redirected: false }
  void completeRedirectSignIn().then((info) => {
    redirectInfo.redirected = info.redirected
    redirectInfo.errorCode = info.errorCode
    if (info.errorCode) console.error('[auth] redirect sign-in failed:', info.errorCode)
  })

  watchAuthState((user, reason) => {
    const loginScreen = $('login-screen')
    const topbar = $('app-topbar')
    const wrap = $('app-wrap')
    const userLabel = $('login-user')
    const errEl = $('login-error')

    // 認証状態の復元が完了した（=初回コールバックが来た）ので中立画面を退場させる。
    $('auth-loading')?.setAttribute('hidden', '')

    if (!user) {
      loginScreen?.removeAttribute('hidden')
      topbar?.setAttribute('hidden', '')
      wrap?.setAttribute('hidden', '')
      // reason='disallowed' はサインイン自体は成功しドメイン外で弾かれたケース。
      // redirected(=このページ読み込みでgetRedirectResultが非nullを返したか)に関係なく必ず表示する
      // （ブラウザの既存Googleセッションで無言サインインされ即弾かれる場合、redirectedはfalseになる）。
      if (errEl && (redirectInfo.redirected || reason === 'disallowed')) {
        errEl.textContent = redirectInfo.errorCode
          ? `ログインに失敗しました（${redirectInfo.errorCode}）。社内のGoogleアカウントで再度お試しください。`
          : '許可されていないアカウントです。社内の会社アカウントでログインしてください。'
        errEl.removeAttribute('hidden')
      }
      return
    }

    loginScreen?.setAttribute('hidden', '')
    topbar?.removeAttribute('hidden')
    wrap?.removeAttribute('hidden')
    if (userLabel) userLabel.innerHTML = escapeHtml(user.email)

    if (!appInitialized) {
      appInitialized = true
      main()
    }
  })
}

document.addEventListener('DOMContentLoaded', initAuthGuard)
