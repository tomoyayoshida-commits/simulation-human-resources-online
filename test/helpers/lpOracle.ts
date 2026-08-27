// docs/solver-oracle-plan.md §5 Phase0/1
// assignment.ts（自前MCMF）を検証するためのテスト専用オラクル。HiGHSはdevDependencyであり、
// src/ からは import しない（本番コードに数理最適化ライブラリを持ち込まない制約は維持する）。

import highsLoader from 'highs'
import type { Employee, UnitId } from '../../src/renderer/types.ts'
import { UNIT_IDS } from '../../src/renderer/constants.ts'

type Highs = Awaited<ReturnType<typeof highsLoader>>

// WASM初期化は重いため、プロセス内で1回だけ行い使い回す（テストごとに初期化しない）
let highsPromise: Promise<Highs> | null = null

function getHighs(): Promise<Highs> {
  if (!highsPromise) highsPromise = highsLoader()
  return highsPromise
}

function varName(i: number, u: UnitId): string {
  return `x_${i}_${u}`
}

/**
 * 輸送問題（割当）をCPLEX LP形式のMILPとして定式化し solve する。
 * 制約行列は完全単模だがLP緩和は内点法で分数解が返り得るため、変数はBinaryとして宣言する
 * （docs/solver-oracle-plan.md §5 Phase1）。
 *
 * 割当そのものではなく目的関数の最大値のみを信頼できる比較対象として返す
 * （同値解が複数存在し、MCMFとHiGHSでどちらを返すかは一致しないため）。
 */
export async function solveAssignmentObjectiveLP(
  employees: Employee[],
  values: Record<string, Record<UnitId, number>>,
  counts: Record<UnitId, number>,
): Promise<number> {
  const highs = await getHighs()
  const n = employees.length

  const objTerms: string[] = []
  for (let i = 0; i < n; i++) {
    for (const u of UNIT_IDS) {
      objTerms.push(`${values[employees[i].id][u]} ${varName(i, u)}`)
    }
  }

  const personCons = Array.from(
    { length: n },
    (_, i) => `p${i}: ${UNIT_IDS.map((u) => varName(i, u)).join(' + ')} = 1`,
  )

  const unitCons = UNIT_IDS.map((u) => {
    const terms = Array.from({ length: n }, (_, i) => varName(i, u)).join(' + ')
    return `u_${u}: ${terms} = ${counts[u]}`
  })

  const binaryVars: string[] = []
  for (let i = 0; i < n; i++) for (const u of UNIT_IDS) binaryVars.push(varName(i, u))

  const problem = [
    'Maximize',
    ` obj: ${objTerms.join(' + ')}`,
    'Subject To',
    ...personCons,
    ...unitCons,
    'Binary',
    ...binaryVars,
    'End',
  ].join('\n')

  const sol = highs.solve(problem)
  if (sol.Status !== 'Optimal') {
    throw new Error(`HiGHS did not reach an optimal solution: ${sol.Status}`)
  }
  return sol.ObjectiveValue
}

/** 相対誤差での比較（値のスケールが最大1e7程度になるため絶対誤差は使わない） */
export function assertRelativelyClose(a: number, b: number, rel = 1e-9): void {
  const tol = rel * Math.max(1, Math.abs(a), Math.abs(b))
  if (Math.abs(a - b) > tol) {
    throw new Error(`値が一致しない: a=${a} b=${b} diff=${Math.abs(a - b)} tol=${tol}`)
  }
}
