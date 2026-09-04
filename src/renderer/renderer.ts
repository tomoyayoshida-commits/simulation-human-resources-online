// 設計書§10: 画面初期化・イベントバインド・各モジュールの結線
//
// このファイルが持つのはアプリ全体の状態と画面遷移だけ。DOM生成は各表示モジュールに任せる。
//   #p4 データ取込→4課題横断比較 → importPanel.ts（取込UI）／compareTasks.ts（比較表示）
//   #p5 データ取込→採用前後比較   → importPanel.ts（取込UI）／compareHiring.ts（比較表示）
//
// 各画面は「取込ステップ」→（取込成功で自動的に）「結果ステップ」の一続きのフローで、
// 画面遷移（go）そのものはタブ切替のみを担う。

import type { Employee, SimParams, UnitId, ValidationError } from './types.ts'
import type { ProfileRow } from './csv.ts'
import { importEmployees, importProfiles, matchProfilePhotos, mergeEmployees, parseAssignmentColumn } from './csv.ts'
import { initHiringWorkbenchPanel, openHiringWorkbench } from './hiringWorkbenchPanel.ts'
import { computeSimulationResult } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'
import { currentCardResult, initCompareModeToggle, initWorkbenchLaunch, renderCompareTasks } from './compareTasks.ts'
import { initWorkbenchPanel, openWorkbench } from './workbenchPanel.ts'
import { initExportPanel, openExportFor, openRunsList } from './exportPanel.ts'
import { renderCompareHiring } from './compareHiring.ts'
import type { HiringImportIds } from './importPanel.ts'
import {
  renderHiringImportError,
  renderHiringImportOk,
  renderImportConditions,
  renderImportReport,
  setupDropzone,
  setupFilesDropzone,
} from './importPanel.ts'
import { renderProfileCsvStatus, renderProfileDraft, renderProfilePhotosStatus, renderRegisteredProfiles } from './profilePanel.ts'
import { normalizePhoto } from './photo.ts'
import { createParamsOptionsPanel } from './paramsOptions.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'
import { escapeHtml } from './format.ts'
import { completeRedirectSignIn, signInWithGoogle, signOutUser, watchAuthState } from './auth.ts'
import { deleteProfile, getProfiles, loadProfiles, saveProfiles } from './profileStore.ts'

// ---- アプリ状態 ----
const state: {
  employees100: Employee[] | null
  // 採用判断(#p5)は配置比較(#p4)の取込データを再利用しない独立画面のため、専用の取込状態を持つ
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
  /**
   * 採用前100名CSVに「配置先事業部」列があったときの現行配置（機能15b §5.1）。
   * null なら配置案なし＝作業机は採用前の最適解を起点にする（分岐2）。
   */
  hiringBaseAssignment: Record<string, UnitId> | null
} = {
  employees100: null,
  hiringBase100: null,
  hiringAdd10: null,
  hiringBaseAssignment: null,
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
  /** 取込データの一部（機能15b §5.1）。復元しないとリロードで分岐1が分岐2に化ける */
  hiringBaseAssignment: Record<string, UnitId> | null
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
      hiringBaseAssignment: state.hiringBaseAssignment,
      p4Params: p4Params.getParams(),
      p5Params: p5Params.getParams(),
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    // プライベートモード等でsessionStorageが使えない場合は保存を諦める（機能自体は元通り動く）
  }
}

// ---- 取込／結果／作業机ステップの切替（機能15・docs/workbench-plan.md §4.1） ----
// bench は #p4（配置比較）と #p5（採用判断・機能15b）の両方が持つ。
// list/export は #p7（保存した配置案・docs/export-plan.md §4.1）だけが持つ。
// 該当要素が無いパネルでは toggleAttribute が何もしないので、パネルごとの分岐は要らない。
type Step = 'import' | 'result' | 'bench' | 'list' | 'export'
const STEPS = ['import', 'result', 'bench', 'list', 'export'] as const

function showStep(panelId: string, step: Step): void {
  for (const s of STEPS) {
    $(`${panelId}-${s}-step`)?.toggleAttribute('hidden', s !== step)
  }
  window.scrollTo({ top: 0, behavior: 'instant' })
  updateResumeButtons()
  renderBreadcrumb(panelId)
  saveSnapshot()
}

/**
 * トップの「前回の続き」導線を出し入れする。取込済みで、かつ比較結果まで進んだ実績がある時だけ出す。
 * 入口ボタン（「始める」）は常に取込ステップへ着地させ、続きから見る操作はこちらに分けてある。
 * 前回位置へ勝手に飛ばさず、どこへ入るかを毎回利用者が選べるようにするための一対。
 */
function updateResumeButtons(): void {
  const p4Ready = state.employees100 !== null && currentStep('p4') !== 'import'
  const p5Ready = state.hiringBase100 !== null && state.hiringAdd10 !== null && currentStep('p5') !== 'import'
  $('p4-resume')?.toggleAttribute('hidden', !p4Ready)
  $('p5-resume')?.toggleAttribute('hidden', !p5Ready)
}

/** panelId の現在表示中のステップ。該当要素が無いパネルはそのステップを返さない。 */
function currentStep(panelId: string): Step {
  for (const s of ['export', 'list', 'bench'] as const) {
    const el = $(`${panelId}-${s}-step`)
    if (el && !el.hasAttribute('hidden')) return s
  }
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

  // #p7 は2ステップしか無いので FLOW_LABEL の3段構造に乗せず個別に組む（export-plan.md §4.1）。
  if (panelId === 'p7') {
    const step = currentStep(panelId)
    if (step === 'export') {
      // 作業机から直行してきた場合は一覧をまだ読んでいないので、戻るときに読み込む
      crumbs.push({ label: '保存した配置案', onClick: () => void openRunsList() })
      crumbs.push({ label: '出力' })
    } else {
      crumbs.push({ label: '保存した配置案' })
    }
  }

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
      const sep = i > 0 ? '<span class="crumb-sep">›</span>' : ''
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
      const id = el.dataset.go
      if (!id) return
      // data-fresh（トップの入口ボタン）は「始める」と書いてある以上、前回どこまで進んでいても
      // 必ず取込ステップから始める。続きから見たい場合はカード下の「前回の続き」を使う。
      if (el.hasAttribute('data-fresh')) showStep(id, 'import')
      void go(id)
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
    const params = p4Params.getParams()
    renderImportConditions(params.prevYearRevenue, params.optimalHeadcount, params.minHeadcount)
    const proceedBtn = $('p4-proceed') as HTMLButtonElement | null
    if (proceedBtn) proceedBtn.disabled = !(state.employees100 && p4Params.isValid())
    $('p4-file-actions')?.toggleAttribute('hidden', !state.employees100)
    updateResumeButtons()
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
  // トップの「前回の続き」：前回の到達点から入り直す。作業机の手動編集は復元対象外のため結果ステップまで。
  // 表示中の結果DOMはリロードで空になるので、ここでも取込済みデータから計算し直してから見せる。
  $('p4-resume')?.addEventListener('click', () => {
    const employees100 = state.employees100
    if (!employees100 || !p4Params.isValid()) return
    void withLoading('前回の比較結果を復元しています…', () => renderCompareTasks(employees100, p4Params.getParams())).then(() => {
      showStep('p4', 'result')
      void go('p4')
    })
  })
  // 「ファイルを変更」：取込済みデータはそのままにファイル選択ダイアログだけ開き直す
  $('p4-file-change')?.addEventListener('click', () => ($('file-100') as HTMLInputElement | null)?.click())
  // 「取り込みを解除」：取込結果をクリアして未取込状態に戻す（前回の到達点も一緒に捨てる）
  $('p4-file-clear')?.addEventListener('click', () => {
    state.employees100 = null
    renderImportReport(null, [])
    showStep('p4', 'import')
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
      // docs/profile-plan.md §4.2: 未取得なら空。カードは番号のみで描画され作業机は正常に動く。
      profiles: getProfiles(),
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
    updateResumeButtons()
    saveSnapshot()
  }

  // 取込を受け入れる／保留する。どちらも「状態を書き換え → 結果を表示 → 次へボタンを引き直す」で終わり、
  // このうち最後の1手を忘れると次へボタンが古い判定のまま残る。3手を必ず揃えるためにここへ寄せてある。
  type HiringSlot = 'hiringBase100' | 'hiringAdd10'
  const acceptHiring = (slot: HiringSlot, ids: HiringImportIds, employees: Employee[], note = ''): void => {
    renderHiringImportOk(ids, employees.length, note)
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
    if (!base100) {
      state.hiringBaseAssignment = null
      return rejectHiring('hiringBase100', hiringErr100, errors, errorMessage(errors))
    }
    // 機能15b §5.1: 「配置先事業部」列があれば現行配置を起点にする（分岐1）。
    // 列が無ければ null＝分岐2。列はあるが欠け・不正があれば補完せず分岐2へ落とし、理由を出す。
    const { assignment, errors: assignErrors } = parseAssignmentColumn(text, base100)
    state.hiringBaseAssignment = assignment
    const note = assignment
      ? '／配置案を検出（現行配置を起点にします）'
      : assignErrors.length > 0
        ? `／配置先事業部列に不備${assignErrors.length}件のため、最適解を起点にします`
        : ''
    acceptHiring('hiringBase100', hiringErr100, base100, note)
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
  // トップの「前回の続き」（#p4と同じ扱い。作業机は復元対象外なので結果ステップまで戻す）
  $('p5-resume')?.addEventListener('click', () => {
    const { hiringBase100, hiringAdd10 } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    void withLoading('前回の比較結果を復元しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, 1, p5Params.getParams())).then(() => {
      showStep('p5', 'result')
      void go('p5')
    })
  })
  $('p5-back')?.addEventListener('click', () => void go('p0'))
  $('p5-result-back')?.addEventListener('click', () => showStep('p5', 'import'))

  // 機能15b 採用判断の作業机（docs/hiring-workbench-plan.md §5.1・§5.4）
  $('p5-open-bench')?.addEventListener('click', () => {
    const { hiringBase100, hiringAdd10, hiringBaseAssignment } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    const params = p5Params.getParams()
    const task = 1
    const metric = 'revenue' as const
    const roster = [...hiringBase100, ...hiringAdd10]
    void withLoading('作業机の基準を計算しています…', () => {
      // 上段Δの相手。分岐1は取り込んだ現行配置そのもの（最適解ではない）、分岐2は採用前の最適解。
      const beforeOpt = hiringBaseAssignment ? null : runOptimization(hiringBase100, task, params, metric)
      const beforeBaseline =
        hiringBaseAssignment !== null
          ? computeSimulationResult(hiringBaseAssignment, hiringBase100, params)
          : beforeOpt && !('infeasible' in beforeOpt)
            ? beforeOpt
            : null
      // 下段Δの相手。採用後110名の最適解。実行可能解が無ければ null にして「—」と出す（§5.4）
      const afterOpt = runOptimization(roster, task, params, metric)
      const afterBaseline = 'infeasible' in afterOpt ? null : afterOpt
      return { beforeBaseline, afterBaseline }
    }).then(({ beforeBaseline, afterBaseline }) => {
      if (!beforeBaseline) {
        window.alert('採用前100名で制約を満たす配置が見つからないため、作業机を開けません。')
        return
      }
      openHiringWorkbench({
        task,
        metric,
        base: hiringBase100,
        candidates: hiringAdd10,
        roster,
        params,
        // 候補は全員プールから始まる。beforeBaseline は100名ぶんしか持たないのでキーが無い＝未採用（§5.4）
        assignment: { ...beforeBaseline.assignment },
        beforeBaseline,
        afterBaseline,
        // 分岐1は現実の組織図が起点なので異動は重い＝既定で固定。
        // 分岐2は最適解が起点で「現実の異動」という概念が無いため既定で解除しておく
        // （固定したままだと既存100名が一切動かせず、盤面が候補10名だけの画面になる）。
        lockBase: hiringBaseAssignment !== null,
        branch: hiringBaseAssignment !== null ? 'existing' : 'optimal',
        history: [],
        // docs/profile-plan.md §4.2: 未取得なら空。カードは番号のみで描画され作業机は正常に動く。
        profiles: getProfiles(),
      })
      showStep('p5', 'bench')
    })
  })
  $('p5-bench-back')?.addEventListener('click', () => showStep('p5', 'result'))

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
      state.hiringBaseAssignment = snap.hiringBaseAssignment ?? null
      renderHiringImportOk(
        hiringErr100,
        snap.hiringBase100.length,
        state.hiringBaseAssignment ? '／配置案を検出（現行配置を起点にします）' : '',
      )
    }
    if (snap.hiringAdd10) {
      state.hiringAdd10 = snap.hiringAdd10
      renderHiringImportOk(hiringErr10, snap.hiringAdd10.length)
    }
    updateHiringProceedBtn()

    const employees100 = state.employees100
    const hiringBase100 = state.hiringBase100
    const hiringAdd10 = state.hiringAdd10

    // #p4/#p5 は前回の到達点を各パネルのステップに戻すだけで、画面はトップに留める。
    // 勝手に前回位置へ飛ばすと「取込をやり直すつもりが作業机に着く」ため、入口は必ず利用者に選ばせる
    // （トップの「始める」＝取込から／「前回の続き」＝ここで戻した到達点から）。
    if (employees100 && snap.p4Step !== 'import') showStep('p4', 'result')
    if (hiringBase100 && hiringAdd10 && snap.p5Step !== 'import') showStep('p5', 'result')
    updateResumeButtons()

    // #p7 は出力対象の SavedRun をメモリにしか持たないため出力ステップは復元できない。
    // 一覧まで戻して読み直す（bench を result へ読み替えるのと同じ考え方）。
    if (snap.panelId === 'p7') {
      void go('p7')
      void openRunsList()
      return
    }

    renderBreadcrumb('p0')
  }
}

// ---- 人材プロフィール管理(#p6)の配線（docs/profile-plan.md §4.4） ----

/** 縮小済みの顔写真1枚。matchProfilePhotos は `{ name }` だけを見るのでこの形で渡せる。 */
interface LoadedPhoto {
  name: string
  dataUrl: string
}

const profileState: { rows: ProfileRow[] | null; photos: LoadedPhoto[] } = { rows: null, photos: [] }

/** 警告文で列挙する名前の上限。全件出すと100件のリストで画面が埋まる。 */
const WARN_SAMPLE = 5

function sample(names: string[]): string {
  const head = names.slice(0, WARN_SAMPLE).join('、')
  return names.length > WARN_SAMPLE ? `${head} ほか${names.length - WARN_SAMPLE}件` : head
}

/**
 * 名簿・写真・（取込済みなら）スキルCSVを突き合わせて保存内容を組み立てる。
 * 片側欠落はすべて警告であり保存は止めない（§4.4）。プロフィールは計算に入らないため、
 * 欠けていても配置比較は正しく動く。
 */
function rebuildProfileDraft(): void {
  const rows = profileState.rows
  if (!rows) {
    renderProfileDraft(null)
    return
  }
  const match = matchProfilePhotos(rows, profileState.photos)
  const profiles = match.pairs.map(({ row, file }) => ({ id: row.id, name: row.name, photo: file?.dataUrl ?? '' }))

  const warnings: string[] = []
  if (match.missingFiles.length > 0) {
    warnings.push(`名簿が指定した写真が見つかりません（${match.missingFiles.length}件）：${sample(match.missingFiles)}`)
  }
  if (match.unusedFiles.length > 0) {
    warnings.push(`名簿から参照されていない写真があります（${match.unusedFiles.length}件）：${sample(match.unusedFiles)}`)
  }
  const employees = state.employees100
  if (employees) {
    const rosterIds = new Set(employees.map((e) => e.id))
    const profileIds = new Set(rows.map((r) => r.id))
    const notInRoster = rows.filter((r) => !rosterIds.has(r.id)).map((r) => r.id)
    const notInProfiles = employees.filter((e) => !profileIds.has(e.id)).map((e) => e.id)
    if (notInRoster.length > 0) {
      warnings.push(`取込済みの社員データに存在しない社員番号です（${notInRoster.length}件）：${sample(notInRoster)}`)
    }
    if (notInProfiles.length > 0) {
      warnings.push(`名簿に無いため番号のみで表示される社員がいます（${notInProfiles.length}件）：${sample(notInProfiles)}`)
    }
  }
  renderProfileDraft({ profiles, warnings })
}

function initProfileAdmin(): void {
  setupDropzone('dropzone-profile-csv', 'file-profile-csv', (text) => {
    const { rows, errors } = importProfiles(text)
    profileState.rows = rows
    renderProfileCsvStatus(rows, errors)
    rebuildProfileDraft()
  })

  setupFilesDropzone('dropzone-profile-photos', 'file-profile-photos', (files) => {
    // 選択された時点で128pxへ縮小する（§4.5）。元のまま保持すると100名で数百MBになる。
    void (async () => {
      const loaded: LoadedPhoto[] = []
      const errors: string[] = []
      for (const f of files) {
        try {
          loaded.push({ name: f.name, dataUrl: await normalizePhoto(f) })
        } catch (e) {
          errors.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      profileState.photos = loaded
      renderProfilePhotosStatus(loaded.length, errors)
      rebuildProfileDraft()
    })()
  })

  const saveBtn = $('profile-save') as HTMLButtonElement | null
  saveBtn?.addEventListener('click', () => {
    const rows = profileState.rows
    if (!rows) return
    const match = matchProfilePhotos(rows, profileState.photos)
    const profiles = match.pairs.map(({ row, file }) => ({ id: row.id, name: row.name, photo: file?.dataUrl ?? '' }))
    const label = saveBtn.textContent
    saveBtn.disabled = true
    saveBtn.textContent = '保存しています…'
    void saveProfiles(profiles)
      .then(() => {
        renderRegisteredProfiles(getProfiles())
        saveBtn.textContent = `保存しました（${profiles.length}件）`
      })
      .catch((e: unknown) => {
        saveBtn.textContent = label ?? 'マスタに保存する'
        saveBtn.disabled = false
        window.alert(`保存に失敗しました。${e instanceof Error ? e.message : String(e)}`)
      })
  })

  // 登録済み一覧の削除（§8-8で物理削除と決定）
  $('profile-registered')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-profile-del]')
    const id = btn?.dataset.profileDel
    if (!id) return
    if (!window.confirm(`${id} のプロフィールを削除します。よろしいですか？`)) return
    void deleteProfile(id)
      .then(() => renderRegisteredProfiles(getProfiles()))
      .catch((err: unknown) => window.alert(`削除に失敗しました。${err instanceof Error ? err.message : String(err)}`))
  })

  // #p6 に入るたびに最新のマスタを出す（他の人が別ブラウザで登録した分を拾う）
  document.querySelectorAll<HTMLElement>('[data-go="p6"]').forEach((el) => {
    el.addEventListener('click', () => {
      void loadProfiles(true).then(renderRegisteredProfiles)
    })
  })
}

// ---- 保存した配置案(#p7)の配線（docs/export-plan.md §4.1） ----
function initExportFlow(): void {
  initExportPanel((step) => showStep('p7', step))
  // #p6 と同じく、入るたびに読み直す（他の人が保存した案を拾う）
  document.querySelectorAll<HTMLElement>('[data-go="p7"]').forEach((el) => {
    el.addEventListener('click', () => void openRunsList())
  })
}

// ---- 初期化 ----
function main(): void {
  initNavigation()
  initCompareModeToggle()
  // 保存に成功したら #p7 の出力画面へ直行する（export-plan.md §4.1）。
  // 作業机は保存の成否だけを知り、遷移は renderer 側の責務にしてある。
  initWorkbenchPanel((run) => {
    void go('p7')
    openExportFor(run, true)
  })
  // 採用判断の作業机も同じ経路で #p7 へ渡す（機能15b §5.11）
  initHiringWorkbenchPanel((run) => {
    void go('p7')
    openExportFor(run, true)
  })
  initProfileAdmin()
  initExportFlow()
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
      // docs/profile-plan.md §4.3: 人材プロフィールはログイン直後にバックグラウンドで取り込む。
      // ユーザーはこの後CSV取込→4課題比較（実データで約0.95〜1.6秒）と進むため、
      // 作業机に着くころには揃っている。await しないのは主動線をこの取得で待たせないため。
      void loadProfiles()
    }
  })
}

document.addEventListener('DOMContentLoaded', initAuthGuard)
