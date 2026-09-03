// 設計書§4.2/§4.7（docs/export-plan.md）: simulationRuns の追記と読み出し。
// DOM操作・計算は持たない（CLAUDE.md §5）。
//
// profileStore.ts が employees「マスタ」の参照なのに対し、こちらは配置案「履歴」の追記。
// Security Rules 側で update/delete を禁じてあるため、このファイルにも更新・削除の関数は置かない
// （置けてしまうと「消せるはず」という誤解を生む）。

import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where } from 'firebase/firestore'
import type { Employee, SimParams, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import { auth, db } from './firebase.ts'

const COLLECTION = 'simulationRuns'

/** 一覧に出す上限。これを超えたぶんは表示しない（ページングはv1では作らない）。 */
const LIST_LIMIT = 100

/** 保存された配置案1件。roster と params を自分で持つので、単体で出力を再現できる（§4.2.1）。 */
export interface SavedRun extends RunSummary {
  assignment: Record<string, UnitId>
  params: SimParams
  roster: Employee[]
}

/**
 * 採用判断の作業机（機能15b・docs/hiring-workbench-plan.md §5.11）から保存された案に付く文脈。
 * #p4 の作業机から保存された案には付かないので、すべて任意フィールドにしてある
 * （既存の保存ドキュメントを読み直したときに undefined になるのが正しい）。
 */
export interface HiringContext {
  kind: 'hiring'
  /** 採用した候補の社員番号。roster と突き合わせずに「10名中8名」と書けるように持つ */
  hiredIds: string[]
  declinedIds: string[]
  /** 'existing'＝現行配置を起点、'optimal'＝採用前の最適解を起点 */
  branch: 'existing' | 'optimal'
  lockBase: boolean
}

/** 一覧用。roster/params/assignment を含まないので100件読んでも軽い。 */
export interface RunSummary {
  id: string
  title: string
  task: TaskId
  metric: TaskMetric
  savedBy: string
  /** serverTimestamp() の解決前・欠損時は null（一覧では「保存中」と出す） */
  savedAt: Date | null
  feasible: boolean
  companyRevenue: number
  companyProfit: number
  movedFromBaseline: number
  /** 採用判断の作業机から保存されたときだけ付く（機能15b §5.11）。#p4 由来なら undefined */
  kind?: HiringContext['kind']
  hiredIds?: string[]
  declinedIds?: string[]
  branch?: HiringContext['branch']
  lockBase?: boolean
}

/** 保存に必要な入力。runId・savedBy・savedAt はこのモジュールが決めるので受け取らない。 */
export interface SaveRunInput {
  title: string
  task: TaskId
  metric: TaskMetric
  assignment: Record<string, UnitId>
  params: SimParams
  roster: Employee[]
  feasible: boolean
  companyRevenue: number
  companyProfit: number
  movedFromBaseline: number
  /** 採用判断の作業机から保存されたときだけ付く（機能15b §5.11）。#p4 由来なら undefined */
  kind?: HiringContext['kind']
  hiredIds?: string[]
  declinedIds?: string[]
  branch?: HiringContext['branch']
  lockBase?: boolean
}

/**
 * 配置案を1件追記し、runId を返す。
 *
 * profileStore.loadProfiles と違って**失敗を握り潰さない**。あちらは「写真が出ないだけで
 * 主動線は動く」のが正しい挙動だが、保存は失敗したら利用者に伝えないと
 * 「保存できたつもりで出力画面に進めない」という無言の行き止まりになる。
 */
export async function saveRun(input: SaveRunInput): Promise<SavedRun> {
  const savedBy = auth.currentUser?.email ?? ''
  if (!savedBy) throw new Error('ログイン情報を取得できませんでした。再読み込みしてください。')
  // savedBy は Security Rules が request.auth.token.email との一致を検査する。
  // クライアントが詐称した値を書けないようにするための冗長な保存であり、表示用ではない。
  const ref = await addDoc(collection(db, COLLECTION), { ...input, savedBy, savedAt: serverTimestamp() })
  // 保存直後の出力に使うぶんは読み直さず組み立てる。serverTimestamp() は書き込み直後に
  // 読み直しても未解決の null が返りうるため、文書の日付にはクライアント時刻を使う。
  return { ...input, id: ref.id, savedBy, savedAt: new Date() }
}

/** Firestore の Timestamp を Date に均す。serverTimestamp() が未解決の間は null が入る。 */
function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

/** 読み出したドキュメントを RunSummary に均す。型を信用せず既定値で埋める（外部入力として扱う）。 */
function toSummary(id: string, data: Record<string, unknown>): RunSummary {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '（無題）',
    task: (data.task as TaskId) ?? 1,
    metric: (data.metric as TaskMetric) ?? 'revenue',
    savedBy: typeof data.savedBy === 'string' ? data.savedBy : '',
    savedAt: toDate(data.savedAt),
    feasible: data.feasible === true,
    companyRevenue: typeof data.companyRevenue === 'number' ? data.companyRevenue : 0,
    companyProfit: typeof data.companyProfit === 'number' ? data.companyProfit : 0,
    movedFromBaseline: typeof data.movedFromBaseline === 'number' ? data.movedFromBaseline : 0,
    // 採用判断由来の文脈（機能15b §5.11）。#p4 由来のドキュメントには無いので undefined のままにする
    ...(data.kind === 'hiring'
      ? {
          kind: 'hiring' as const,
          hiredIds: Array.isArray(data.hiredIds) ? (data.hiredIds as string[]) : [],
          declinedIds: Array.isArray(data.declinedIds) ? (data.declinedIds as string[]) : [],
          branch: data.branch === 'optimal' ? ('optimal' as const) : ('existing' as const),
          lockBase: data.lockBase === true,
        }
      : {}),
  }
}

/**
 * 保存済みの配置案を新しい順に取得する（#p7 一覧）。
 * savedAt 単一フィールドの並べ替えなので複合インデックスは要らない。
 */
export async function listRuns(): Promise<RunSummary[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('savedAt', 'desc'), limit(LIST_LIMIT)))
  return snap.docs.map((d) => toSummary(d.id, d.data() as Record<string, unknown>))
}

/** 1件を出力に足りる形（roster・params 込み）で取得する。存在しなければ null。 */
export async function loadRun(runId: string): Promise<SavedRun | null> {
  const snap = await getDoc(doc(db, COLLECTION, runId))
  if (!snap.exists()) return null
  const data = snap.data() as Record<string, unknown>
  return {
    ...toSummary(snap.id, data),
    assignment: (data.assignment as Record<string, UnitId>) ?? {},
    params: data.params as SimParams,
    roster: Array.isArray(data.roster) ? (data.roster as Employee[]) : [],
  }
}
