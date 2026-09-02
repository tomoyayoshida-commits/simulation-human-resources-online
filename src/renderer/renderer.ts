// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線
//
// このファイルが持つのはアプリ全体の状態と画面遷移だけ。DOM生成は各表示モジュールに任せる。
//   #p4 データ取込→4課題横断比較 → importPanel.ts（取込UI）／compareTasks.ts（比較表示）
//   #p5 データ取込→採用前後比較   → importPanel.ts（取込UI）／compareHiring.ts（比較表示）
//
// 各画面は「取込ステップ」→（取込成功で自動的に）「結果ステップ」の一続きのフローで、
// 画面遷移（go）そのものはタブ切替のみを担う。

import type { Employee } from './types.ts'
import { importEmployees, mergeEmployees } from './csv.ts'
import { renderCompareTasks, initCompareModeToggle } from './compareTasks.ts'
import { renderCompareHiring } from './compareHiring.ts'
import { renderHiringImportError, renderHiringImportOk, renderImportReport, setupDropzone } from './importPanel.ts'
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

// ---- 取込ステップ／結果ステップの切替 ----
function showStep(panelId: string, step: 'import' | 'result'): void {
  $(`${panelId}-import-step`)?.toggleAttribute('hidden', step !== 'import')
  $(`${panelId}-result-step`)?.toggleAttribute('hidden', step !== 'result')
  renderBreadcrumb(panelId)
}

// ---- 画面遷移（モックの go(id) 移植版） ----
async function go(id: string): Promise<void> {
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.remove('active'))
  $(id)?.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })
  renderBreadcrumb(id)
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
    const resultVisible = !$(`${panelId}-result-step`)?.hasAttribute('hidden')
    if (resultVisible) {
      crumbs.push({ label: 'データ取込', onClick: () => showStep(panelId, 'import') })
      crumbs.push({ label: flowLabel })
    } else {
      crumbs.push({ label: `${flowLabel}：データ取込` })
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
  // 配置比較(#p4)：社員データ取込 → ボタン押下で4課題比較の結果ステップへ
  const updateP4ProceedBtn = (): void => {
    const proceedBtn = $('p4-proceed') as HTMLButtonElement | null
    if (proceedBtn) proceedBtn.disabled = !(state.employees100 && p4Params.isValid())
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
  $('p4-reimport')?.addEventListener('click', () => showStep('p4', 'import'))
  $('p4-back')?.addEventListener('click', () => void go('p0'))
  // 比較結果画面の戻る先は他パネルの「← 前の画面へ戻る」と同じくトップ。
  // 取込画面へ戻る導線は画面上部の「別のデータを取り込み直す」が担う。
  $('p4-result-back')?.addEventListener('click', () => void go('p0'))

  // 採用判断(#p5)：採用前100名データ取込（配置比較とは独立）
  const hiringErr100 = {
    summary: 'hiring-validation-summary-100',
    table: 'hiring-validation-errors-100',
    reasonDetail: 'hiring-error-reasons-detail-100',
    reasonList: 'hiring-error-reasons-100',
  }
  const updateHiringProceedBtn = (): void => {
    const proceedBtn = $('p5-proceed') as HTMLButtonElement | null
    if (proceedBtn) proceedBtn.disabled = !(state.hiringBase100 && state.hiringAdd10 && p5Params.isValid())
  }
  p5Params.init(updateHiringProceedBtn)
  setupDropzone('dropzone-hiring-100', 'file-hiring-100', (text) => {
    const { employees: base100, errors } = importEmployees(text, 100)
    if (!base100) {
      state.hiringBase100 = null
      renderHiringImportError(hiringErr100, errors, `取込を保留（エラー${errors.length}件）`)
      updateHiringProceedBtn()
      return
    }
    renderHiringImportOk(hiringErr100, base100.length)
    state.hiringBase100 = base100
    updateHiringProceedBtn()
  })

  // 採用判断(#p5)：追加採用10名データ取込（配置比較とは独立）
  const hiringErr10 = {
    summary: 'hiring-validation-summary-10',
    table: 'hiring-validation-errors-10',
    reasonDetail: 'hiring-error-reasons-detail-10',
    reasonList: 'hiring-error-reasons-10',
  }
  setupDropzone('dropzone-10', 'file-10', (text) => {
    const base100 = state.hiringBase100
    if (!base100) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, [], '取込を保留（先に左側の採用前100名データを取り込んでください）')
      updateHiringProceedBtn()
      return
    }
    const { employees: add10, errors } = importEmployees(text, 10)
    if (!add10) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, errors, `取込を保留（エラー${errors.length}件）`)
      updateHiringProceedBtn()
      return
    }
    const merged = mergeEmployees(base100, add10)
    if (!merged.employees) {
      state.hiringAdd10 = null
      renderHiringImportError(hiringErr10, merged.errors, '取込を保留（既存社員IDと重複）')
      updateHiringProceedBtn()
      return
    }
    renderHiringImportOk(hiringErr10, add10.length)
    state.hiringAdd10 = add10
    updateHiringProceedBtn()
  })
  $('p5-proceed')?.addEventListener('click', () => {
    const { hiringBase100, hiringAdd10 } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    const params = p5Params.getParams()
    void withLoading('採用前後の効果を計算しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, 1, params)).then(() => {
      showStep('p5', 'result')
    })
  })
  $('p5-reimport')?.addEventListener('click', () => showStep('p5', 'import'))
  $('p5-back')?.addEventListener('click', () => void go('p0'))
}

// ---- 初期化 ----
function main(): void {
  initNavigation()
  initCompareModeToggle()
  initImports()
  renderBreadcrumb('p0')
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
