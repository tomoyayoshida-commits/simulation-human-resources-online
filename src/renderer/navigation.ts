// 画面遷移とステップ切替（設計書§10・モックの go(id) 移植版）。
//
// パネル(#p0…#p7)の表示切替、パネル内の「取込→結果→作業机」ステップの出し入れ、
// パンくずリストを持つ。DOM生成は各表示モジュールの担当で、ここは出し入れだけを見る。
//
// 画面が動いたあとの保存（session.ts の saveSnapshot）は setAfterNavigate() で受け取る。
// 直接呼ぶと session.ts と相互参照になるため（exportPanel.ts が showStep を受け取るのと同じ作法）。

import { state } from './appState.ts'
import { openRunsList } from './exportPanel.ts'
import { $ } from './dom.ts'
import { escapeHtml } from './format.ts'

// ---- 取込／結果／作業机ステップの切替（機能15・docs/workbench-plan.md §4.1） ----
// bench は #p4（配置比較）と #p5（採用判断・機能15b）の両方が持つ。
// list/export は #p7（保存した配置案・docs/export-plan.md §4.1）だけが持つ。
// 該当要素が無いパネルでは toggleAttribute が何もしないので、パネルごとの分岐は要らない。
export type Step = 'import' | 'result' | 'bench' | 'list' | 'export'
const STEPS = ['import', 'result', 'bench', 'list', 'export'] as const

/** 画面が動いたあとに走らせる処理。renderer.ts が session.ts の saveSnapshot を挿す。 */
let afterNavigate: () => void = () => {}

export function setAfterNavigate(fn: () => void): void {
  afterNavigate = fn
}

export function showStep(panelId: string, step: Step): void {
  for (const s of STEPS) {
    $(`${panelId}-${s}-step`)?.toggleAttribute('hidden', s !== step)
  }
  window.scrollTo({ top: 0, behavior: 'instant' })
  updateResumeButtons()
  renderBreadcrumb(panelId)
  afterNavigate()
}

/**
 * トップの「前回の続き」導線を出し入れする。取込済みで、かつ比較結果まで進んだ実績がある時だけ出す。
 * 入口ボタン（「始める」）は常に取込ステップへ着地させ、続きから見る操作はこちらに分けてある。
 * 前回位置へ勝手に飛ばさず、どこへ入るかを毎回利用者が選べるようにするための一対。
 * 作りかけ再開ボタンは draftStore から下書きがあるときだけ出す。
 */
export function updateResumeButtons(): void {
  const p4Ready = state.employees100 !== null && currentStep('p4') !== 'import'
  const p5Ready = state.hiringBase100 !== null && state.hiringAdd10 !== null && currentStep('p5') !== 'import'
  $('p4-resume')?.toggleAttribute('hidden', !p4Ready)
  $('p5-resume')?.toggleAttribute('hidden', !p5Ready)
}

/**
 * トップの「作りかけ再開」導線を出し入れする（draftStore 連携）。下書きがある時だけ出す。
 * #p4 と #p5 で別関数にしてあるのは、片方のフローの更新がもう片方のボタンを巻き添えで
 * 消さないようにするため（両方を一度に受ける関数だと、呼び出し側が自分に関係ない側へ
 * false を渡してしまい、もう片方の下書きが見えなくなる）。
 */
export function updateP4DraftResumeButton(hasDraft: boolean): void {
  $('p4-resume-draft')?.toggleAttribute('hidden', !hasDraft)
}

export function updateP5DraftResumeButton(hasDraft: boolean): void {
  $('p5-resume-draft')?.toggleAttribute('hidden', !hasDraft)
}

/** panelId の現在表示中のステップ。該当要素が無いパネルはそのステップを返さない。 */
export function currentStep(panelId: string): Step {
  for (const s of ['export', 'list', 'bench'] as const) {
    const el = $(`${panelId}-${s}-step`)
    if (el && !el.hasAttribute('hidden')) return s
  }
  const resultVisible = !$(`${panelId}-result-step`)?.hasAttribute('hidden')
  return resultVisible ? 'result' : 'import'
}

// ---- 画面遷移（モックの go(id) 移植版） ----
export async function go(id: string): Promise<void> {
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.remove('active'))
  $(id)?.classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })
  renderBreadcrumb(id)
  afterNavigate()
}

const FLOW_LABEL: Record<string, string> = { p4: '配置案の検討', p5: '採用判断' }

/** 現在どんな操作をしてここに来たかを示すパンくずリスト。トップバーのタブナビの代わり。 */
export function renderBreadcrumb(panelId: string): void {
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
export function initNavigation(): void {
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
