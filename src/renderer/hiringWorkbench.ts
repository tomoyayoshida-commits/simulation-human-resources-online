// 機能15b 採用判断の作業机（docs/hiring-workbench-plan.md §5・Phase2）。純粋関数のみ・DOMに触らない。
//
// #p4 の作業机（workbench.ts）との違いは「4列目＝採用候補プール」と「既存100名のロック」の2点。
// 未採用は assignment からキーを削除して表現する。calcEngine.membersByUnit と whatif.headcountOf が
// キーの無い社員を飛ばすため、売上・人件費・充足率がすべて自動で正しくなる（§2.2）。
// このため calcEngine.ts / optimizer.ts / assignment.ts / whatif.ts は一切変更していない。

import type { Employee, EmployeeProfile, EmployeeType, ProfileMap, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import type { WhatIfEvaluation } from './whatif.ts'
import { COST_UNIT_DIVISOR, UNIT_IDS, round2 } from './constants.ts'
import { classifyType, computeSimulationResult, contribution } from './calcEngine.ts'
import { evaluateAssignment } from './whatif.ts'
import { MAX_HISTORY } from './workbench.ts'

/** 盤面の列。3事業部に「採用候補（未採用）」を加えた4つ（§5.3）。 */
export type HiringSlot = UnitId | 'pool'

/** 起点をどう決めたか（§5.1）。'existing'＝取り込んだ現行配置、'optimal'＝採用前100名の最適解。 */
export type HiringBranch = 'existing' | 'optimal'

/** 採用判断の作業机の状態（§5.2）。assignment が唯一の可変状態。 */
export interface HiringWorkbenchState {
  task: TaskId
  metric: TaskMetric
  /** 採用前100名（lockBase が true のあいだ動かせない） */
  base: Employee[]
  /** 追加採用候補10名。開始時は全員プールにいる */
  candidates: Employee[]
  /** base + candidates。計算に渡す唯一の名簿 */
  roster: Employee[]
  params: SimParams
  /** 唯一の可変状態。**キーが無い社員＝未採用**（§2.2） */
  assignment: Record<string, UnitId>
  /** 上段Δの基準＝採用の効果を測る相手。分岐1では取り込んだ現行配置そのもの（§5.4） */
  beforeBaseline: SimulationResult
  /** 下段Δの基準＝採用後110名の最適解（§5.4）。infeasible なら null */
  afterBaseline: SimulationResult | null
  /** 既存100名を固定するか（確定事項 3-5・既定 true） */
  lockBase: boolean
  branch: HiringBranch
  history: Record<string, UnitId>[]
  /** 氏名・顔写真（docs/profile-plan.md §4.2）。計算には使わない表示専用データ */
  profiles?: ProfileMap
}

/** いまその社員がいる列。assignment にキーが無ければプール（＝未採用）。 */
export function currentSlot(state: HiringWorkbenchState, employeeId: string): HiringSlot {
  return state.assignment[employeeId] ?? 'pool'
}

/** 追加採用候補か（既存社員なら false）。 */
export function isCandidate(state: HiringWorkbenchState, employeeId: string): boolean {
  return state.candidates.some((e) => e.id === employeeId)
}

/**
 * その社員を動かせるか（§5.5）。ロック中は base の社員を動かせない。
 * roster にいない社員は常に動かせない。
 *
 * これは「動かせるか」だけの判定で、行き先の可否は canPlace が見る。
 */
export function canMove(state: HiringWorkbenchState, employeeId: string): boolean {
  if (!state.roster.some((e) => e.id === employeeId)) return false
  if (!state.lockBase) return true
  // ロック中に動かせるのは候補だけ（roster = base + candidates なので候補でない＝既存社員）
  return isCandidate(state, employeeId)
}

/**
 * その社員をその列に置けるか（§5.5.1）。
 *
 * **プール列は追加採用候補の専用列**であり、既存社員は lockBase の値に関わらず入れられない。
 * 既存社員をプールへ落とすことは「その人を雇わない」＝解雇を意味するが、このアプリが扱うのは
 * 配置と採用の判断であって雇用の終了ではない（モデルに退職金も引継ぎコストも無く、
 * 「1名減らすと売上がいくら減るか」だけが出てしまうため、解雇の是非を論じる道具として誤用されうる）。
 * ロックはあくまで「既存の異動を伴わない純増採用を検討する」ためのもので、この禁止とは別の話。
 */
export function canPlace(state: HiringWorkbenchState, employeeId: string, slot: HiringSlot): boolean {
  if (!canMove(state, employeeId)) return false
  if (slot === 'pool' && !isCandidate(state, employeeId)) return false
  return true
}

/**
 * assignment 上で1名を動かした新しい assignment を返す（元は破壊しない）。
 * 'pool' へ動かす場合はキーを削除する（§2.2）。
 * 置けない組み合わせ（ロック中の既存社員／既存社員→プール）のときは元をそのまま返す。
 */
export function moveEmployeeTo(
  state: HiringWorkbenchState,
  employeeId: string,
  slot: HiringSlot,
): Record<string, UnitId> {
  if (!canPlace(state, employeeId, slot)) return state.assignment
  const next = { ...state.assignment }
  if (slot === 'pool') delete next[employeeId]
  else next[employeeId] = slot
  return next
}

/**
 * 1名を動かした場合の再評価結果だけを返す（drop確定前のプレビュー用）。
 * 確定させたい場合は withMoveTo を使う。
 */
export function previewMoveTo(
  state: HiringWorkbenchState,
  employeeId: string,
  slot: HiringSlot,
): SimulationResult {
  return computeSimulationResult(moveEmployeeTo(state, employeeId, slot), state.roster, state.params)
}

/** 履歴に1手積む（上限 MAX_HISTORY）。workbench.ts と同じ上限を使う。 */
function pushHistory(state: HiringWorkbenchState, nextAssignment: Record<string, UnitId>): HiringWorkbenchState {
  const nextHistory = [...state.history, state.assignment]
  if (nextHistory.length > MAX_HISTORY) nextHistory.shift()
  return { ...state, assignment: nextAssignment, history: nextHistory }
}

/**
 * 1名を動かして確定させる（履歴に積む）。すでにその列にいるなら何もしない
 * （無意味な履歴エントリでUndoを汚さないため）。動かせない社員のときも状態は変わらない。
 */
export function withMoveTo(
  state: HiringWorkbenchState,
  employeeId: string,
  slot: HiringSlot,
): HiringWorkbenchState {
  if (!canPlace(state, employeeId, slot)) return state
  if (currentSlot(state, employeeId) === slot) return state
  return pushHistory(state, moveEmployeeTo(state, employeeId, slot))
}

/** 1手戻す。履歴が空なら何もしない。 */
export function undo(state: HiringWorkbenchState): HiringWorkbenchState {
  if (state.history.length === 0) return state
  return {
    ...state,
    assignment: state.history[state.history.length - 1],
    history: state.history.slice(0, -1),
  }
}

/**
 * 起点（＝作業机を開いた直後の状態）に戻す。候補は全員プールへ帰る。
 * beforeBaseline は100名ぶんの配置しか持たないので、候補のキーが無い状態＝プールになる（§5.4）。
 */
export function resetToStart(state: HiringWorkbenchState): HiringWorkbenchState {
  return { ...state, assignment: { ...state.beforeBaseline.assignment }, history: [] }
}

/**
 * 採用後110名の最適解を盤面に持ち込む（＝候補を全員採ったうえでの最適配置）。
 * afterBaseline が無い（採用後に実行可能解が無い）ときは何もしない。
 * ロック中でも既存社員が動くため、呼び出し側はロックを外してから使う（§5.6と同じ扱い）。
 */
export function resetToAfterOptimum(state: HiringWorkbenchState): HiringWorkbenchState {
  if (!state.afterBaseline) return state
  return pushHistory(state, { ...state.afterBaseline.assignment })
}

/**
 * assignment を丸ごと差し替えて履歴に積む（「この人数配分のまま最適に組み直す」用・§5.6）。
 * solveForHeadcount の結果をそのまま受け取る。
 */
export function withAssignment(
  state: HiringWorkbenchState,
  nextAssignment: Record<string, UnitId>,
): HiringWorkbenchState {
  return pushHistory(state, nextAssignment)
}

/**
 * 現在の配置を評価する。whatif.evaluateAssignment をそのまま使う
 * （HiringWorkbenchState は WhatIfState を構造的部分型として満たす・§5.2）。
 * 異動人数の基準は起点＝beforeBaseline。
 */
export function evaluateHiring(state: HiringWorkbenchState): WhatIfEvaluation {
  return evaluateAssignment(state, state.beforeBaseline.assignment)
}

/** 採用した候補（assignment にキーがある候補）。入力順を保つ。 */
export function hiredCandidates(state: HiringWorkbenchState): Employee[] {
  return state.candidates.filter((e) => state.assignment[e.id] !== undefined)
}

/** 見送った候補（プールに残っている候補）。入力順を保つ。 */
export function declinedCandidates(state: HiringWorkbenchState): Employee[] {
  return state.candidates.filter((e) => state.assignment[e.id] === undefined)
}

/**
 * 採用した候補ぶんの追加人件費（億円）。
 * 人件費は百万円・売上は億円なので COST_UNIT_DIVISOR で換算する
 * （compareHiring.ts:68-70 と同じ式・CLAUDE.md §8。忘れると桁が2つずれる）。
 */
export function addedCost(state: HiringWorkbenchState): number {
  const sum = hiredCandidates(state).reduce((s, e) => s + e.cost * state.params.costMultiplier, 0)
  return round2(sum / COST_UNIT_DIVISOR)
}

/** 異動の内訳1件（§5.8）。採用・見送りを事業部間の異動と区別する。 */
export type HiringDiff =
  | { kind: 'move'; from: UnitId; to: UnitId; count: number }
  | { kind: 'hire'; to: UnitId; count: number }
  | { kind: 'decline'; from: UnitId; count: number }

/**
 * 起点から現在への差分を集計する（§5.8）。
 *
 * whatif.diffAssignment は使えない。`to === undefined` を捨てるうえに baseline のキーしか
 * 走査しないため、採用（undefined→UnitId）と見送り（UnitId→undefined）がどちらも落ちる
 * （§2.5）。whatif.ts の4関数は変えない約束なので、ここに専用の実装を置く。
 */
export function diffWithPool(
  baseline: Record<string, UnitId>,
  current: Record<string, UnitId>,
  roster: Employee[],
): HiringDiff[] {
  const order: string[] = []
  const counts = new Map<string, number>()
  // baseline のキーではなく roster を走査する（§2.5 の穴2）
  for (const e of roster) {
    const from = baseline[e.id]
    const to = current[e.id]
    if (from === to) continue
    const key = from === undefined ? `hire:${to}` : to === undefined ? `decline:${from}` : `move:${from}->${to}`
    if (!counts.has(key)) order.push(key)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return order.map((key) => {
    const count = counts.get(key)!
    const [kind, rest] = key.split(':') as ['hire' | 'decline' | 'move', string]
    if (kind === 'hire') return { kind, to: rest as UnitId, count }
    if (kind === 'decline') return { kind, from: rest as UnitId, count }
    const [from, to] = rest.split('->') as [UnitId, UnitId]
    return { kind, from, to, count }
  })
}

/** カード1枚ぶんの表示用データ。プールにいる社員は unit が null になる。 */
export interface HiringCard {
  employee: Employee
  /** 現在の所属。プール（未採用）なら null */
  unit: UnitId | null
  /** 追加採用候補か（既存100名なら false） */
  isCandidate: boolean
  /** ロックにより動かせないか */
  locked: boolean
  type: EmployeeType
  /** (社員, 事業部, params) だけで決まる貢献度。所属に依存しないので一度だけ焼き込む */
  contributions: Record<UnitId, number>
  profile?: EmployeeProfile
}

/**
 * 全社員ぶんのカード表示用データを組み立てる。
 * 110名×3事業部 = 330回の contribution 呼び出しをここで一度に行う（O(1)×330・再計算不要）。
 */
export function buildHiringCards(state: HiringWorkbenchState): HiringCard[] {
  const candidateIds = new Set(state.candidates.map((e) => e.id))
  return state.roster.map((e) => {
    const contributions = {} as Record<UnitId, number>
    for (const u of UNIT_IDS) contributions[u] = contribution(e, u, state.params)
    return {
      employee: e,
      unit: state.assignment[e.id] ?? null,
      isCandidate: candidateIds.has(e.id),
      locked: !canMove(state, e.id),
      type: classifyType(e),
      contributions,
      profile: state.profiles?.[e.id],
    }
  })
}

/**
 * 保存フォーマット（§5.11）。機能16（docs/export-plan.md）の #p7 へ渡すための素。
 * workbench.ts の WorkbenchExport は変更せず、採用判断版としてここに新設する。
 */
export interface HiringWorkbenchExport {
  /** #p4 由来の案と区別する識別子 */
  kind: 'hiring'
  task: TaskId
  metric: TaskMetric
  /** 未採用者はキーが無い */
  assignment: Record<string, UnitId>
  /** 採用した候補。assignment から導出できるが、出力画面が roster と突き合わせずに済むよう明示する */
  hiredIds: string[]
  declinedIds: string[]
  /** どちらの検討をしたのかが後から分かるように残す */
  lockBase: boolean
  branch: HiringBranch
  updatedAt: string
}

/**
 * 現在の状態をプレーンオブジェクトとして取り出す（§5.11）。
 * Firestore への書き込みそのものは Phase 3 以降（機能16 の完了待ち）。
 */
export function serializeHiringWorkbenchState(state: HiringWorkbenchState): HiringWorkbenchExport {
  return {
    kind: 'hiring',
    task: state.task,
    metric: state.metric,
    assignment: { ...state.assignment },
    hiredIds: hiredCandidates(state).map((e) => e.id),
    declinedIds: declinedCandidates(state).map((e) => e.id),
    lockBase: state.lockBase,
    branch: state.branch,
    updatedAt: new Date().toISOString(),
  }
}
