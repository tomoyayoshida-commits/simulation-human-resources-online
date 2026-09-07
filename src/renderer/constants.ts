// 設計書§2/§3: 事業部別定数・丸め処理・CSVカラムマップ

import type { Employee, SimParams, TaskId, UnitId, Weights } from './types.ts'

export const UNIT_IDS: readonly UnitId[] = ['A', 'B', 'C'] as const

/** 課題の反復順（§5.1）。`[1,2,3,4] as TaskId[]` の散在を防ぐ単一の参照点。 */
export const TASK_IDS: readonly TaskId[] = [1, 2, 3, 4] as const

/** 事業部の表示名。表・バー・文章のいずれからも引く。 */
export const UNIT_LABEL: Record<UnitId, string> = { A: 'A事業部', B: 'B事業部', C: 'C事業部' }

/** 事業部の表示名（特性付き）。ゲージ見出しなど、事業部の性格が判断に効く箇所で使う。 */
export const UNIT_NAME: Record<UnitId, string> = {
  A: 'A事業部（飽和）',
  B: 'B事業部（成長）',
  C: 'C事業部（新規）',
}

/** 事業部の系統色（styles.css の :root で定義）。バー・バッジの塗りに使う。 */
export const UNIT_VAR: Record<UnitId, string> = { A: 'var(--a)', B: 'var(--b)', C: 'var(--c)' }

/** 事業部別利益バーの共通スケール（億円）。#p4 と #p5 でカードを横に見比べるため同じ値を使う。 */
export const PROFIT_SCALE = 30

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

/**
 * What-if（機能14）が差し替え可能な計算前提の既定値（docs/whatif-plan.md §4.3）。
 * 既存の個別 export をそのまま束ねただけで、値の二重定義は作らない。
 */
export const DEFAULT_PARAMS: SimParams = {
  weights: WEIGHTS,
  baseRevenue: BASE_REVENUE,
  growth: GROWTH,
  optimalHeadcount: OPTIMAL_HEADCOUNT,
  minHeadcount: MIN_HEADCOUNT,
  shortageTable: SHORTAGE_TABLE,
  surplusTable: SURPLUS_TABLE,
  prevYearRevenue: PREV_YEAR_REVENUE,
  costMultiplier: COST_MULTIPLIER,
}

/**
 * 適正人数・最低人数の基準になる名簿人数。§6の A40/B35/C25・A30/B20/C10 は
 * 「100名のときの値」であって絶対値ではない、というのが standardParamsFor の前提。
 */
export const BASE_HEADCOUNT = 100

/** 取込の上限件数（2026-09-07 合意で「ちょうどN件」から「1件以上・上限以下」へ変更）。 */
export const MAX_EMPLOYEE_COUNT = 200
export const MAX_HIRING_COUNT = 20

/**
 * 名簿人数に合わせて適正人数・最低人数を比例配分した「標準の前提パラメータ」を返す（2026-09-07 合意）。
 *
 * 比例配分にしないと、200名を100名基準の適正人数で流したとき全事業部が常時2倍の充足率になり、
 * 過剰補正0.8に張り付いて配分の良し悪しが見えなくなる（候補数も3321→10011に増える）。
 *
 * totalCount=100 では round(40×1)=40 のように現行値と完全に一致するため、既存の結果は動かない。
 * 適正人数は充足率の分母なので0にできず、下限1で丸める。
 *
 * 採用判断(#p5)では**採用前の人数**を渡す。§7-4「採用後110名でも適正人数は100名基準で据え置き」を
 * 人数によらず成り立たせるため、採用ぶんは基準に含めない。
 */
export function standardParamsFor(totalCount: number): SimParams {
  const ratio = totalCount / BASE_HEADCOUNT
  const scale = (v: Record<UnitId, number>, floor: number): Record<UnitId, number> => ({
    A: Math.max(floor, Math.round(v.A * ratio)),
    B: Math.max(floor, Math.round(v.B * ratio)),
    C: Math.max(floor, Math.round(v.C * ratio)),
  })
  return {
    ...DEFAULT_PARAMS,
    optimalHeadcount: scale(OPTIMAL_HEADCOUNT, 1),
    minHeadcount: scale(MIN_HEADCOUNT, 0),
  }
}

// 人件費(1〜20)は百万円単位、売上は億円単位のため、コスト計算時に百万円→億円へ換算する。
// 実データ検証で判明：この換算なしだとコスト合計が売上の2桁上になり、利益が常に大幅な赤字になる
// （例：人件費合計727.4×3=2182.2 vs 全社売上60前後）。÷100すれば桁が揃い、利益が現実的な値になる。
export const COST_UNIT_DIVISOR = 100

// 四捨五入の桁数。カタログ7.5で未規定だったため小数第2位で確定した（README「決着済み」）。
// 全計算の最終値・中間値に統一して適用する（設計書§3）。
export const ROUND_DIGITS = 2

/**
 * 表計算ソフトが数式として評価してしまう先頭文字。
 * CSV出力時のガード（`csv.escapeCsvField`）と、社員番号の入力検証（`validation`）が同じ規則を使う。
 */
export const FORMULA_TRIGGER = /^[=+\-@]/

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
 * 実データ（human_resources_100.csv）のヘッダは「社員番号」を採用しているため primary とする。
 * UIモックのプレビュー表記「社員ID」やその他の別名は後方互換のためフォールバックとして許容する。
 */
export const COLUMN_MAP: Record<keyof Employee, string[]> = {
  id: ['社員番号', '社員ID', 'id', 'ID', 'employee_id'],
  sales: ['営業力', 'sales'],
  mgmt: ['管理力', 'mgmt', 'management'],
  dev: ['開拓力', 'dev', 'development'],
  training: ['育成力', 'training'],
  cost: ['人件費', 'cost'],
}

/**
 * 名簿CSVのヘッダ→プロフィール項目の対応（docs/profile-plan.md §4.4）。
 * 社員番号の別名は COLUMN_MAP.id をそのまま使う（列名の解釈がスキルCSVと食い違わないようにするため）。
 * photoFile（写真ファイル名）は任意列。氏名だけを登録する運用でも取り込める。
 */
export const PROFILE_COLUMN_MAP = {
  id: COLUMN_MAP.id,
  name: ['氏名', '名前', 'name'],
  photoFile: ['写真ファイル名', '写真', 'photo', 'photo_file'],
} as const

/** 名簿CSVで省略を許す列（存在しなくてもエラーにしない） */
export const PROFILE_OPTIONAL_COLUMNS = ['photoFile'] as const

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

/**
 * 配置先事業部列の取込時に許すヘッダ名（docs/hiring-workbench-plan.md §5.7）。
 * COLUMN_MAP は Record<keyof Employee, string[]> のため assignedUnit を入れられない
 * （Employee のフィールドではない）ので別定数にしてある。
 * 先頭は EXPORT_HEADERS.assignedUnit と同じ値＝出力したCSVをそのまま読み戻せる。
 */
export const ASSIGNMENT_COLUMN: string[] = ['配置先事業部', '配置先', '事業部', 'assigned_unit', 'unit']

/**
 * 課題ごとの「何を最大化するか」の定義（設計書§5.1）。
 *
 * この情報は従来 optimizer.ts の buildValues／shiftConstant／primaryMetric の3つの switch と、
 * 表示側（compareTasks・reasonText）に分散していた。4箇所が独立に課題番号を分岐しており、
 * 課題の意味を変えるとすべてを揃えて直す必要がある＝食い違いが混入しうる状態だった。
 * 定義をこの表1つに集約し、各所はここを引くだけにする。
 */
export interface TaskSpec {
  /** 最大化対象の事業部。null は全社（＝課題1） */
  targetUnit: UnitId | null
  /** 最大化対象の指標 */
  metric: 'revenue' | 'profit'
}

export const TASK_SPEC: Record<TaskId, TaskSpec> = {
  1: { targetUnit: null, metric: 'revenue' },
  2: { targetUnit: 'A', metric: 'profit' },
  3: { targetUnit: 'B', metric: 'revenue' },
  4: { targetUnit: 'C', metric: 'revenue' },
}

/**
 * 最大化対象の指標。
 *
 * 課題原文は指標が混在している（課題2だけ利益）。#p4のカード内「最適化：売上／利益」で
 * 課題ごとに指標を切り替えて対照比較するため、TASK_SPEC の既定を呼び出し側から上書きできる。
 * 省略時は必ず原文どおり（＝TASK_SPEC）に落ちるので、既存の呼び出しの挙動は変わらない。
 */
export type TaskMetric = TaskSpec['metric']

/** 指標の解決。未指定なら原文どおり。 */
export function resolveMetric(task: TaskId, metric?: TaskMetric): TaskMetric {
  return metric ?? TASK_SPEC[task].metric
}

/** 最大化対象の範囲の呼称（「全社」「A事業部」）。指標によらず課題で決まる。 */
function scopeLabel(task: TaskId): string {
  const { targetUnit } = TASK_SPEC[task]
  return targetUnit === null ? '全社' : `${targetUnit}事業部`
}

/** 課題名（例：「A事業部利益最大化」）。指標を上書きすると名前も追随する。 */
export function taskLabel(task: TaskId, metric?: TaskMetric): string {
  return `${scopeLabel(task)}${resolveMetric(task, metric) === 'profit' ? '利益' : '売上'}最大化`
}

/** 最大化対象の呼称（例：「A事業部の利益」「全社売上」）。表示・説明文で使う。 */
export function taskTargetLabel(task: TaskId, metric?: TaskMetric): string {
  const { targetUnit } = TASK_SPEC[task]
  const metricLabel = resolveMetric(task, metric) === 'profit' ? '利益' : '売上'
  return targetUnit === null ? `全社${metricLabel}` : `${targetUnit}事業部の${metricLabel}`
}

/** 課題名（原文どおりの指標）。指標を切り替える箇所では taskLabel() を使う。 */
export const TASK_LABELS: Record<TaskId, string> = {
  1: taskLabel(1),
  2: taskLabel(2),
  3: taskLabel(3),
  4: taskLabel(4),
}
