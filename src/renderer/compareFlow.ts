// 配置比較(#p4)の配線：社員データ取込 → 4課題横断比較 → 作業机（機能15）。
//
// 取込UIは importPanel.ts、比較表示は compareTasks.ts、作業机は workbenchPanel.ts が持つ。
// ここが持つのはボタンとステップの結び付けだけで、DOM生成も計算もしない（CLAUDE.md §5）。
//
// 取込成功後も自動遷移はせず、「見る」ボタンを押すまでは取込ステップに留まる
// （取込直後にいきなり結果画面へ切り替わると、取込内容を見直す余地がなくなるため）。

import { p4Params, state } from './appState.ts'
import { go, showStep, updateResumeButtons } from './navigation.ts'
import { saveSnapshot, type SessionSnapshot } from './session.ts'
import { importEmployees } from './csv.ts'
import { renderImportConditions, renderImportReport, setupDropzone } from './importPanel.ts'
import { currentCardResult, initWorkbenchLaunch, renderCompareTasks } from './compareTasks.ts'
import { openWorkbench } from './workbenchPanel.ts'
import { getProfiles } from './profileStore.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'

// ファイルを一度でも投入したか。取込がエラーなら state.employees100 は null のままなので、
// 「ファイルを変更／取り込みを解除」の出し分けを取込成否ではなくこちらで判定する（B-1）。
let fileTouched = false
// 直近の取込で出たエラー件数。エラーが残る間は「次へ」ボタンごと隠す（②18注記）。
let importErrorCount = 0

/**
 * 取込状態・前提パラメータの変化を画面に反映する。
 * 「次へ」ボタンの活殺・前提条件の表示・ファイル操作ボタン・トップの再開導線・保存を必ず揃えて動かす。
 */
export function refreshCompareGate(): void {
  const params = p4Params.getParams()
  renderImportConditions(params.prevYearRevenue, params.optimalHeadcount, params.minHeadcount)
  const proceedBtn = $('p4-proceed') as HTMLButtonElement | null
  if (proceedBtn) {
    proceedBtn.disabled = !(state.employees100 && p4Params.isValid())
    // エラー時は押せないボタンを残さず消す。直すべき対象（エラー表）へ視線を向けるため。
    proceedBtn.toggleAttribute('hidden', importErrorCount > 0)
  }
  // 取込エラー時こそやり直す手段が要るので、取込に失敗していても投入済みなら出したままにする（B-1）
  $('p4-file-actions')?.toggleAttribute('hidden', !(state.employees100 || fileTouched))
  updateResumeButtons()
  saveSnapshot()
}

export function initCompareFlow(): void {
  renderImportConditions()
  p4Params.init(refreshCompareGate)
  setupDropzone('dropzone-100', 'file-100', (text) => {
    const { employees, errors } = importEmployees(text, 100)
    state.employees100 = employees
    fileTouched = true
    importErrorCount = errors.length
    renderImportReport(employees, errors)
    refreshCompareGate()
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
    fileTouched = false
    importErrorCount = 0
    renderImportReport(null, [])
    showStep('p4', 'import')
    refreshCompareGate()
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
}

/** リロード直後に #p4 の取込データと前提パラメータを戻す（ステップの復元は renderer.ts 側）。 */
export function restoreCompareFrom(snap: SessionSnapshot): void {
  if (snap.p4Params) p4Params.setParams(snap.p4Params)
  if (snap.employees100) {
    state.employees100 = snap.employees100
    fileTouched = true
    renderImportReport(snap.employees100, [])
  }
  refreshCompareGate()
}
