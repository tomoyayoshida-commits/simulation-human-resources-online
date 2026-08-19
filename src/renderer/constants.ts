// 設計書§2/§3: 事業部別定数・丸め処理・CSVカラムマップ

import type { UnitId, Weights } from './types.ts'

export const UNIT_IDS: readonly UnitId[] = ['A', 'B', 'C'] as const

export const WEIGHTS: Record<UnitId, Weights> = {
  A: { sales: 0.45, mgmt: 0.35, dev: 0.1, training: 0.1 },
  B: { sales: 0.35, mgmt: 0.2, dev: 0.3, training: 0.15 },
  C: { sales: 0.2, mgmt: 0.1, dev: 0.5, training: 0.2 },
}

export const BASE_REVENUE: Record<UnitId, number> = { A: 10, B: 7, C: 2 } // 億円
export const GROWTH: Record<UnitId, number> = { A: 0.06, B: 0.12, C: 0.25 }
export const OPTIMAL_HEADCOUNT: Record<UnitId, number> = { A: 40, B: 35, C: 25 }
export const MIN_HEADCOUNT: Record<UnitId, number> = { A: 30, B: 20, C: 10 }

// 充足率(rate = count/OPTIMAL_HEADCOUNT) -> 補正係数。
// 上から順に見て最初に rate >= minRate を満たした行を採用（境界は上側に含める）。
export const SHORTAGE_TABLE: Record<UnitId, { minRate: number; factor: number }[]> = {
  A: [
    { minRate: 1.0, factor: 1.0 },
    { minRate: 0.9, factor: 0.85 },
    { minRate: 0.8, factor: 0.7 },
    { minRate: 0.7, factor: 0.5 },
    { minRate: 0, factor: 0.3 },
  ],
  B: [
    { minRate: 1.0, factor: 1.0 },
    { minRate: 0.9, factor: 0.9 },
    { minRate: 0.8, factor: 0.8 },
    { minRate: 0.7, factor: 0.65 },
    { minRate: 0, factor: 0.5 },
  ],
  C: [
    { minRate: 1.0, factor: 1.0 },
    { minRate: 0.9, factor: 0.95 },
    { minRate: 0.8, factor: 0.9 },
    { minRate: 0.7, factor: 0.8 },
    { minRate: 0, factor: 0.7 },
  ],
}

// 充足率 >= 1.20 のときのみ適用（全事業部共通）。1.00〜1.20は不足・過剰いずれの補正も1.00。
// 上から順に見て最初に rate <= maxRate を満たした行を採用（下限含み上限含まず）。
export const SURPLUS_TABLE: { maxRate: number; factor: number }[] = [
  { maxRate: 1.4, factor: 0.95 },
  { maxRate: 1.6, factor: 0.9 },
  { maxRate: Infinity, factor: 0.8 },
]

export const PREV_YEAR_REVENUE = 58 // 億円
export const COST_MULTIPLIER = 3

// 【要確認】四捨五入の桁数。カタログ7.5で未規定のため暫定で小数第2位。
// 全計算の最終値・中間値に統一して適用する（設計書§3）。
export const ROUND_DIGITS = 2

/**
 * 丸め処理（設計書§3）。
 * 貢献度・事業部能力値・基本売上・最終売上・コスト・利益のすべての算出直後に通す。
 */
export function round2(x: number): number {
  const p = 10 ** ROUND_DIGITS
  return Math.round(x * p) / p
}

/**
 * CSVヘッダ→Employeeフィールドの対応（設計書§7）。
 *
 * 【要確認】human_resources_100.csv が未取得のため実ヘッダ名は未確定。
 * ここでは UIモックのプレビュー表ヘッダ（社員ID/営業力/…）を第一候補とし、
 * 実データ差異に備えて英語別名もフォールバックとして許容する。
 * 実CSV入手後、primary を実ヘッダ名に確定させること。
 */
export const COLUMN_MAP: Record<keyof import('./types.ts').Employee, string[]> = {
  id: ['社員ID', 'id', 'ID', 'employee_id'],
  sales: ['営業力', 'sales'],
  mgmt: ['管理力', 'mgmt', 'management'],
  dev: ['開拓力', 'dev', 'development'],
  training: ['育成力', 'training'],
  cost: ['人件費', 'cost'],
}

/** エクスポート時に使う正規のヘッダ名（COLUMN_MAP の第一候補） */
export const EXPORT_HEADERS = {
  id: COLUMN_MAP.id[0],
  sales: COLUMN_MAP.sales[0],
  mgmt: COLUMN_MAP.mgmt[0],
  dev: COLUMN_MAP.dev[0],
  training: COLUMN_MAP.training[0],
  cost: COLUMN_MAP.cost[0],
  assignedUnit: '配置先事業部',
} as const

export const TASK_LABELS: Record<import('./types.ts').TaskId, string> = {
  1: '全社売上最大化',
  2: 'A事業部利益最大化',
  3: 'B事業部売上最大化',
  4: 'C事業部売上最大化',
}
