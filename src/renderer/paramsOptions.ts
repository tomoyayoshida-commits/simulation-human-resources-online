// 配置比較(#p4)・採用判断(#p5)「オプション」内の前提パラメータ編集。表示専用（CLAUDE.md §5の方針）。
// 検証は whatif.ts の validateParams をそのまま使う（判定ロジックの重複を作らない）。
// #p4/#p5 それぞれ独立した前提を持てるよう、DOM ID接頭辞ごとにインスタンスを作る。

import type { SimParams, UnitId } from './types.ts'
import { DEFAULT_PARAMS, UNIT_IDS } from './constants.ts'
import { validateParams } from './whatif.ts'
import { $ } from './dom.ts'
import { escapeHtml } from './format.ts'

function cloneParams(p: SimParams): SimParams {
  return {
    weights: { A: { ...p.weights.A }, B: { ...p.weights.B }, C: { ...p.weights.C } },
    baseRevenue: { ...p.baseRevenue },
    growth: { ...p.growth },
    optimalHeadcount: { ...p.optimalHeadcount },
    minHeadcount: { ...p.minHeadcount },
    shortageTable: {
      A: p.shortageTable.A.map((r) => ({ ...r })),
      B: p.shortageTable.B.map((r) => ({ ...r })),
      C: p.shortageTable.C.map((r) => ({ ...r })),
    },
    surplusTable: p.surplusTable.map((r) => ({ ...r })),
    prevYearRevenue: p.prevYearRevenue,
    costMultiplier: p.costMultiplier,
  }
}

function changedClass(current: number, standard: number): string {
  return current !== standard ? ' whatif-changed' : ''
}

type NumField = 'baseRevenue' | 'growth' | 'optimalHeadcount' | 'minHeadcount'
type ScalarField = 'prevYearRevenue' | 'costMultiplier'
type WeightField = keyof SimParams['weights']['A']

const WEIGHT_FIELDS: { key: WeightField; label: string }[] = [
  { key: 'sales', label: '営業' },
  { key: 'mgmt', label: '管理' },
  { key: 'dev', label: '開拓' },
  { key: 'training', label: '育成' },
]

/** Σ weights の許容誤差。whatif.ts の validateParams と揃える。 */
const WEIGHT_SUM_TOLERANCE = 0.001

export interface ParamsOptionsPanel {
  /** 現在の前提パラメータ（比較計算にそのまま渡す）。 */
  getParams: () => SimParams
  isValid: () => boolean
  /** フォームを描画し、変更のたびに onChange を呼ぶ（呼び出し側で「見る」ボタンの活性等を更新する用）。 */
  init: (onChange: () => void) => void
  /** セッション復元用：外部から前提パラメータを差し替えて再描画する。init前後どちらでも呼べる。 */
  setParams: (p: SimParams) => void
}

/**
 * idPrefix（'p4' | 'p5'）ごとに独立した前提パラメータ編集パネルを作る。
 * DOM側は `${idPrefix}-params-card` / `${idPrefix}-params-errors` / `${idPrefix}-params-reset` を参照する。
 */
export function createParamsOptionsPanel(idPrefix: string): ParamsOptionsPanel {
  let params: SimParams = cloneParams(DEFAULT_PARAMS)
  const dataAttr = `data-${idPrefix}-param`
  const dataUnitAttr = `data-${idPrefix}-unit`
  const dataScalarAttr = `data-${idPrefix}-scalar`
  const dataWeightAttr = `data-${idPrefix}-weight`

  function weightRow(label: string, field: WeightField, step: string): string {
    return (
      `<div class="bar-row"><span class="label">${label}</span>` +
      UNIT_IDS.map((u: UnitId) => {
        const v = params.weights[u][field]
        return `<input type="number" step="${step}" ${dataWeightAttr}="${field}" ${dataUnitAttr}="${u}" value="${v}" class="${changedClass(v, DEFAULT_PARAMS.weights[u][field]).trim()}" title="標準値 ${DEFAULT_PARAMS.weights[u][field]}">`
      }).join('') +
      '</div>'
    )
  }

  function weightSumRow(): string {
    return (
      `<div class="bar-row"><span class="label">合計</span>` +
      UNIT_IDS.map((u: UnitId) => {
        const sum = WEIGHT_FIELDS.reduce((s, { key }) => s + params.weights[u][key], 0)
        const ok = Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE
        return `<span class="unit-head" style="color:${ok ? 'inherit' : 'var(--critical)'};">${sum.toFixed(2)}</span>`
      }).join('') +
      '</div>'
    )
  }

  function numRow(label: string, field: NumField, step: string): string {
    return (
      `<div class="bar-row"><span class="label">${label}</span>` +
      UNIT_IDS.map(
        (u: UnitId) =>
          `<input type="number" step="${step}" ${dataAttr}="${field}" ${dataUnitAttr}="${u}" value="${params[field][u]}" class="${changedClass(params[field][u], DEFAULT_PARAMS[field][u]).trim()}" title="標準値 ${DEFAULT_PARAMS[field][u]}">`,
      ).join('') +
      '</div>'
    )
  }

  function scalarRow(label: string, field: ScalarField, step: string): string {
    return `<div class="bar-row scalar">
        <span class="label">${label}</span>
        <input type="number" step="${step}" ${dataScalarAttr}="${field}" value="${params[field]}" class="${changedClass(params[field], DEFAULT_PARAMS[field]).trim()}" title="標準値 ${DEFAULT_PARAMS[field]}">
      </div>`
  }

  function renderErrors(): void {
    const el = $(`${idPrefix}-params-errors`)
    if (!el) return
    const errors = validateParams(params)
    el.innerHTML = errors.length
      ? `<p class="warn-text">前提パラメータが不正です：${errors
          .map((e) => `${escapeHtml(e.column)}（実測 ${escapeHtml(e.actual)}／期待 ${escapeHtml(e.expected)}）`)
          .join('、')}</p>`
      : ''
  }

  function renderForm(): void {
    const el = $(`${idPrefix}-params-card`)
    if (el) {
      el.innerHTML = `
        <div class="bar-row"><span class="label"></span>${UNIT_IDS.map((u) => `<span class="unit-head">${u}事業部</span>`).join('')}</div>
        ${WEIGHT_FIELDS.map(({ key, label }) => weightRow(`重み・${label}`, key, '0.01')).join('')}
        ${weightSumRow()}
        <p class="note" style="margin-top:0;">重みの合計は事業部ごとに1.00である必要がある（貢献度の意味が崩れるため）。</p>
        ${numRow('基準売上(億円)', 'baseRevenue', '0.1')}
        ${numRow('成長係数', 'growth', '0.01')}
        ${numRow('適正人数', 'optimalHeadcount', '1')}
        ${numRow('最低人数', 'minHeadcount', '1')}
        ${scalarRow('全社売上下限(億円)', 'prevYearRevenue', '0.1')}
        ${scalarRow('コスト係数', 'costMultiplier', '0.1')}`
    }
    renderErrors()
  }

  return {
    getParams: () => params,
    isValid: () => validateParams(params).length === 0,
    init(onChange: () => void): void {
      renderForm()
      $(`${idPrefix}-params-card`)?.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        const unit = target.getAttribute(dataUnitAttr) as UnitId | null
        const field = target.getAttribute(dataAttr) as NumField | null
        const scalar = target.getAttribute(dataScalarAttr) as ScalarField | null
        const weight = target.getAttribute(dataWeightAttr) as WeightField | null
        const value = Number(target.value)
        if (field && unit) params[field][unit] = value
        else if (weight && unit) params.weights[unit][weight] = value
        else if (scalar) params[scalar] = value
        else return
        renderForm()
        onChange()
      })
      $(`${idPrefix}-params-reset`)?.addEventListener('click', () => {
        params = cloneParams(DEFAULT_PARAMS)
        renderForm()
        onChange()
      })
    },
    setParams(p: SimParams): void {
      params = cloneParams(p)
      renderForm()
    },
  }
}
