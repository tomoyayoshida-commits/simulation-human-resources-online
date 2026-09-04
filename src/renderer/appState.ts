// アプリ全体で共有する状態（設計書§10）。
//
// 画面ごとの配線（compareFlow.ts / hiringFlow.ts）とセッション復元（session.ts）が同じ値を読むため、
// renderer.ts の中に閉じ込めず独立させてある。可変状態はこの1オブジェクトだけに集め、参照点を増やさない。

import type { Employee, UnitId } from './types.ts'
import { createParamsOptionsPanel } from './paramsOptions.ts'

export const state: {
  employees100: Employee[] | null
  // 採用判断(#p5)は配置比較(#p4)の取込データを再利用しない独立画面のため、専用の取込状態を持つ
  hiringBase100: Employee[] | null
  hiringAdd10: Employee[] | null
  /**
   * 採用前100名CSVに「配置先事業部」列があったときの現行配置（機能15b §5.1）。
   * null なら配置案なし＝作業机は採用前の最適解を起点にする（分岐2）。
   */
  hiringBaseAssignment: Record<string, UnitId> | null
} = {
  employees100: null,
  hiringBase100: null,
  hiringAdd10: null,
  hiringBaseAssignment: null,
}

// #p4 / #p5 の「オプション」で編集する前提パラメータ（paramsOptions.ts）。
// 画面の部品だが保持しているのは前提条件そのもので、セッション復元の対象でもあるためここに置く。
export const p4Params = createParamsOptionsPanel('p4')
export const p5Params = createParamsOptionsPanel('p5')
