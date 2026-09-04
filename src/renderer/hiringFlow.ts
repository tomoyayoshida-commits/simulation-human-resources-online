// 採用判断(#p5)の配線：採用前100名＋追加10名の取込 → 採用前後比較 → 採用判断の作業机（機能15b）。
//
// #p4 の取込データは再利用しない独立画面のため、取込欄も状態も専用に持つ（appState.ts）。
// 取込UIは importPanel.ts、比較表示は compareHiring.ts、作業机は hiringWorkbenchPanel.ts が持つ。

import type { Employee, ValidationError } from './types.ts'
import { p5Params, state } from './appState.ts'
import { go, showStep, updateResumeButtons } from './navigation.ts'
import { saveSnapshot, type SessionSnapshot } from './session.ts'
import { importEmployees, mergeEmployees, parseAssignmentColumn } from './csv.ts'
import type { HiringImportIds } from './importPanel.ts'
import { renderHiringImportError, renderHiringImportOk, renderImportConditions, setupDropzone } from './importPanel.ts'
import { currentHiringTarget, initHiringTargetToggle, renderCompareHiring, renderHiringTargetToggle } from './compareHiring.ts'
import { openHiringWorkbench } from './hiringWorkbenchPanel.ts'
import { computeSimulationResult } from './calcEngine.ts'
import { runOptimization } from './optimizer.ts'
import { getProfiles } from './profileStore.ts'
import { withLoading } from './loading.ts'
import { $ } from './dom.ts'

// 左（採用前100名）・右（追加採用10名）の2つの独立した取込欄
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

// 左右それぞれの取込欄に残っているエラー件数。どちらかに残る間は「次へ」ボタンごと隠す（②18注記）。
const importErrorCount: Record<HiringSlot, number> = { hiringBase100: 0, hiringAdd10: 0 }

/** 取込状態・前提パラメータの変化を画面に反映する（#p4 の refreshCompareGate と同じ役目）。 */
export function refreshHiringGate(): void {
  // ②12/②26: #p5 にも取込の時点で前提条件を出す（オプションを開く前に見える位置に置く）
  const params = p5Params.getParams()
  renderImportConditions(params.prevYearRevenue, params.optimalHeadcount, params.minHeadcount, 'p5-')
  const proceedBtn = $('p5-proceed') as HTMLButtonElement | null
  if (proceedBtn) {
    proceedBtn.disabled = !(state.hiringBase100 && state.hiringAdd10 && p5Params.isValid())
    // エラー時は押せないボタンを残さず消す。直すべき対象（エラー表）へ視線を向けるため。
    proceedBtn.toggleAttribute('hidden', importErrorCount.hiringBase100 + importErrorCount.hiringAdd10 > 0)
  }
  updateResumeButtons()
  saveSnapshot()
}

// 取込を受け入れる／保留する。どちらも「状態を書き換え → 結果を表示 → 次へボタンを引き直す」で終わり、
// このうち最後の1手を忘れると次へボタンが古い判定のまま残る。3手を必ず揃えるためにここへ寄せてある。
type HiringSlot = 'hiringBase100' | 'hiringAdd10'

function acceptHiring(slot: HiringSlot, ids: HiringImportIds, employees: Employee[], note = ''): void {
  renderHiringImportOk(ids, employees.length, note)
  state[slot] = employees
  importErrorCount[slot] = 0
  refreshHiringGate()
}

function rejectHiring(slot: HiringSlot, ids: HiringImportIds, errors: ValidationError[], message: string): void {
  state[slot] = null
  renderHiringImportError(ids, errors, message)
  // 明細の無い保留（左側未取込・ID重複）も「エラーが残っている」として数える
  importErrorCount[slot] = Math.max(errors.length, 1)
  refreshHiringGate()
}

const errorMessage = (errors: ValidationError[]): string => `取込を保留（エラー${errors.length}件）`

export function initHiringFlow(): void {
  const initial = p5Params.getParams()
  renderImportConditions(initial.prevYearRevenue, initial.optimalHeadcount, initial.minHeadcount, 'p5-')
  renderHiringTargetToggle()
  p5Params.init(refreshHiringGate)
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
    const { task, metric } = currentHiringTarget()
    void withLoading('採用前後の効果を計算しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, task, params, metric)).then(() => {
      showStep('p5', 'result')
    })
  })
  // Phase 7（②19）: 目的を選び直したらその場で解き直す（採用前・採用後の2回）
  initHiringTargetToggle(() => {
    const { hiringBase100, hiringAdd10 } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    const { task, metric } = currentHiringTarget()
    void withLoading('選んだ目的で計算し直しています…', () =>
      renderCompareHiring(hiringBase100, hiringAdd10, task, p5Params.getParams(), metric),
    )
  })
  // トップの「前回の続き」（#p4と同じ扱い。作業机は復元対象外なので結果ステップまで戻す）
  $('p5-resume')?.addEventListener('click', () => {
    const { hiringBase100, hiringAdd10 } = state
    if (!hiringBase100 || !hiringAdd10 || !p5Params.isValid()) return
    const { task, metric } = currentHiringTarget()
    void withLoading('前回の比較結果を復元しています…', () => renderCompareHiring(hiringBase100, hiringAdd10, task, p5Params.getParams(), metric)).then(() => {
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
    // Phase 7（②19）: 比較画面で選んだ目的をそのまま作業机へ持ち込む（旧：task=1/metric='revenue' 固定）
    const { task, metric } = currentHiringTarget()
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
}

/** リロード直後に #p5 の取込データと前提パラメータを戻す（ステップの復元は renderer.ts 側）。 */
export function restoreHiringFrom(snap: SessionSnapshot): void {
  if (snap.p5Params) p5Params.setParams(snap.p5Params)
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
  refreshHiringGate()
}
