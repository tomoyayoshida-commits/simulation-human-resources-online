// 作りかけの盤面の一時保存（下書き）。localStorage に画面ごと1件だけ置く。
//
// 既存の2つとは役割が違うので別の置き場にしてある：
// - runStore.ts（Firestore の simulationRuns）は「確定した配置案を追記して残す」履歴。
//   Security Rules で更新・削除を禁じてあり、同名も弾くので、同じ盤面を何度も上書きする用途には使えない。
// - session.ts のリロード復元は作業机の手動編集を明示的に対象外にしている（session.ts 冒頭の合意）。
// ここは「同じ盤面を何度でも上書きし、後から開き直す」ためだけの置き場。
//
// 下書きは roster / params / baseline を自分で持ち、単体で作業机を開ける（SavedRun と同じ考え方）。
// おかげで比較結果を計算し直さなくても——リロード直後や取込をやり直した後でも——
// 保存した時点の盤面がそのまま開く。
//
// 保存しないもの：
// - profiles（氏名・顔写真）… 128px JPEG の data URI が110名ぶん入ると localStorage の容量を食う。
//   計算に使わない表示専用データなので、開くときに呼び出し側が渡し直す。
// - history（元に戻す用の履歴・最大50面）… 盤面1つの最大50倍になる。復元後は履歴なしで始める。

import type { Employee, ProfileMap, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import type { WorkbenchState } from './workbench.ts'
import type { HiringBranch, HiringWorkbenchState } from './hiringWorkbench.ts'

const COMPARE_KEY = 'hr-sim-draft-p4-v1'
const HIRING_KEY = 'hr-sim-draft-p5-v1'

/** #p4 作業机の下書き。WorkbenchState から profiles と history を落とした形。 */
export interface CompareDraft {
  /** 保存時刻（ISO文字列）。JSON に日付型が無いので文字列で持ち、表示側で整形する */
  savedAt: string
  task: TaskId
  metric: TaskMetric
  roster: Employee[]
  params: SimParams
  assignment: Record<string, UnitId>
  baseline: SimulationResult
  lockedIds?: string[]
}

/** #p5 採用判断の作業机の下書き。未採用は assignment のキー無しで表現される（機能15b §2.2）。 */
export interface HiringDraft {
  savedAt: string
  task: TaskId
  metric: TaskMetric
  base: Employee[]
  candidates: Employee[]
  roster: Employee[]
  params: SimParams
  assignment: Record<string, UnitId>
  beforeBaseline: SimulationResult
  afterBaseline: SimulationResult | null
  lockBase: boolean
  branch: HiringBranch
  lockedIds?: string[]
}

/** 書けたら true。プライベートモード・容量超過では false（呼び出し側が利用者に伝える）。 */
function write(key: string, draft: object): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function read(key: string): Record<string, unknown> | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 盤面として最低限成り立っているか。
 * 読み出した値は外部入力として扱う（runStore.toSummary と同じ方針）が、こちらは既定値で埋めない——
 * 半端に埋まった盤面を作業机へ渡すと、名簿と assignment が食い違ったまま計算に入るため。
 * 疑わしいものは「下書き無し」に倒す。
 */
function looksLikeBoard(d: Record<string, unknown>): boolean {
  return (
    typeof d.savedAt === 'string' &&
    Array.isArray(d.roster) &&
    d.roster.length > 0 &&
    isPlainObject(d.assignment) &&
    isPlainObject(d.params)
  )
}

/** 現在の盤面を上書き保存する。成功したら保存時刻（ISO）、失敗したら null。 */
export function saveCompareDraft(state: WorkbenchState): string | null {
  const savedAt = new Date().toISOString()
  const draft: CompareDraft = {
    savedAt,
    task: state.task,
    metric: state.metric,
    roster: state.roster,
    params: state.params,
    assignment: { ...state.assignment },
    baseline: state.baseline,
    lockedIds: state.lockedIds,
  }
  return write(COMPARE_KEY, draft) ? savedAt : null
}

/** 一時保存した #p4 の盤面。無い・壊れている・読めないときは null（いずれも「下書き無し」で同じ扱い）。 */
export function readCompareDraft(): CompareDraft | null {
  const d = read(COMPARE_KEY)
  if (!d || !looksLikeBoard(d) || !isPlainObject(d.baseline)) return null
  return d as unknown as CompareDraft
}

/** 下書きを作業机の状態へ戻す。profiles は保存対象外なので呼び出し側が現在のものを渡す。 */
export function toWorkbenchState(draft: CompareDraft, profiles?: ProfileMap): WorkbenchState {
  return {
    task: draft.task,
    metric: draft.metric,
    roster: draft.roster,
    params: draft.params,
    assignment: { ...draft.assignment },
    baseline: draft.baseline,
    history: [],
    profiles,
    lockedIds: draft.lockedIds,
  }
}

/** 現在の盤面を上書き保存する。成功したら保存時刻（ISO）、失敗したら null。 */
export function saveHiringDraft(state: HiringWorkbenchState): string | null {
  const savedAt = new Date().toISOString()
  const draft: HiringDraft = {
    savedAt,
    task: state.task,
    metric: state.metric,
    base: state.base,
    candidates: state.candidates,
    roster: state.roster,
    params: state.params,
    assignment: { ...state.assignment },
    beforeBaseline: state.beforeBaseline,
    afterBaseline: state.afterBaseline,
    lockBase: state.lockBase,
    branch: state.branch,
    lockedIds: state.lockedIds,
  }
  return write(HIRING_KEY, draft) ? savedAt : null
}

/** 一時保存した #p5 の盤面。無い・壊れている・読めないときは null。 */
export function readHiringDraft(): HiringDraft | null {
  const d = read(HIRING_KEY)
  if (!d || !looksLikeBoard(d) || !isPlainObject(d.beforeBaseline)) return null
  if (!Array.isArray(d.base) || !Array.isArray(d.candidates)) return null
  return d as unknown as HiringDraft
}

/** 下書きを採用判断の作業机の状態へ戻す。 */
export function toHiringWorkbenchState(draft: HiringDraft, profiles?: ProfileMap): HiringWorkbenchState {
  return {
    task: draft.task,
    metric: draft.metric,
    base: draft.base,
    candidates: draft.candidates,
    roster: draft.roster,
    params: draft.params,
    assignment: { ...draft.assignment },
    beforeBaseline: draft.beforeBaseline,
    // 採用後110名に実行可能解が無い状態で保存された下書きは null のまま戻す（§5.4 の「—」表示）
    afterBaseline: draft.afterBaseline ?? null,
    lockBase: draft.lockBase === true,
    branch: draft.branch === 'optimal' ? 'optimal' : 'existing',
    history: [],
    profiles,
    lockedIds: draft.lockedIds,
  }
}
