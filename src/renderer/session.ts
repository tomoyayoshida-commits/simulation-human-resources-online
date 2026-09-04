// リロード耐性（タブを閉じるまでの範囲）。
//
// 復元対象は画面位置・取込データ・前提パラメータのみ。作業机(#p4-bench-step)の手動編集・undo履歴は対象外
// （その場のリロードに耐えれば十分という合意のため、複雑な履歴の直列化は行わない。bench保存時はresultへ読み替える）。
//
// 保存だけをここに置き、復元の段取り（どのモジュールに何を戻すか）は renderer.ts が持つ。
// 復元は取込UI・比較画面・各フローに跨る結線そのもので、結線層の仕事だと整理したため。

import type { Employee, SimParams, UnitId } from './types.ts'
import { p4Params, p5Params, state } from './appState.ts'
import { currentStep, type Step } from './navigation.ts'

const SESSION_KEY = 'hr-sim-session-v1'

export interface SessionSnapshot {
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

export function saveSnapshot(): void {
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

/** 直前のセッションの記録。無い・壊れている・読めないときは null（いずれも「復元しない」で同じ扱い）。 */
export function readSnapshot(): SessionSnapshot | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return JSON.parse(raw) as SessionSnapshot
  } catch {
    return null
  }
}
