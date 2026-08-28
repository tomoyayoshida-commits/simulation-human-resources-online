// 設計書§2: 型定義

export type UnitId = 'A' | 'B' | 'C'

export interface Employee {
  id: string
  sales: number // 営業力 0-100
  mgmt: number // 管理力 0-100
  dev: number // 開拓力 0-100
  training: number // 育成力 0-100
  cost: number // 人件費 1-20
}

export interface Weights {
  sales: number
  mgmt: number
  dev: number
  training: number
}

export type TaskId = 1 | 2 | 3 | 4

export interface AllocationCounts {
  A: number
  B: number
  C: number
}

export interface UnitResult {
  unit: UnitId
  count: number
  ability: number // 事業部能力値
  fulfillmentRate: number
  shortageFactor: number
  surplusFactor: number
  baseRevenue: number
  finalRevenue: number
  costTotal: number
  profit: number
}

export interface SimulationResult {
  headcount: AllocationCounts
  units: Record<UnitId, UnitResult>
  companyRevenue: number
  companyProfit: number
  assignment: Record<string, UnitId> // employeeId -> unit
  feasible: boolean // 全社売上 > PREV_YEAR_REVENUE を満たすか
}

/** 実行不能の理由（設計書§5.4 / 機能12・B-3） */
export type InfeasibleReason = 'min_headcount' | 'revenue_floor'

export interface InfeasibleResult {
  infeasible: true
  reason: InfeasibleReason
  /** revenue_floor のとき、最も58億円に近い候補 */
  closestCandidate?: SimulationResult
}

/** 社員タイプ分類（設計書§4.1・機能6） */
export type EmployeeType = '営業型' | '管理型' | '開拓型' | '育成型'

/** 入力バリデーションエラー（設計書§7・機能13/D-2） */
export interface ValidationError {
  row: number
  column: string
  actual: unknown
  expected: string
}

/** 基準の割当から現在の割当への異動（機能14）。whatif.ts が生成し whatifPanel.ts が表示する。 */
export interface AssignmentDiff {
  from: UnitId
  to: UnitId
  count: number
}

/** What-if で差し替え可能な計算前提（機能14）。既定値は constants.DEFAULT_PARAMS。 */
export interface SimParams {
  weights: Record<UnitId, Weights>
  baseRevenue: Record<UnitId, number>
  growth: Record<UnitId, number>
  optimalHeadcount: Record<UnitId, number>
  minHeadcount: Record<UnitId, number>
  shortageTable: Record<UnitId, { minRate: number; factor: number }[]>
  surplusTable: { maxRate: number; factor: number }[]
  prevYearRevenue: number
  costMultiplier: number
}
