// 充足率ゲージ（機能10/B-1）のテスト。
// #p3 と #p6 でマーカー位置の式が食い違っていた回帰を防ぐ（docs/refactor-plan.md B-1）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandLabels, ratePosition } from '../src/renderer/gauge.ts'
import { DEFAULT_PARAMS, UNIT_IDS } from '../src/renderer/constants.ts'
import type { SimParams } from '../src/renderer/types.ts'

test('ratePosition: 帯の区切りが SEG_WIDTHS の累積幅と一致する', () => {
  // 20 / 15 / 10 / 15 / 40 の境界に、充足率 70% / 80% / 90% / 100% がぴたりと乗ること
  assert.equal(ratePosition(0), 0)
  assert.equal(ratePosition(0.7), 20)
  assert.equal(ratePosition(0.8), 35)
  assert.equal(ratePosition(0.9), 45)
  assert.equal(ratePosition(1.0), 60)
})

test('ratePosition: 100%超は RATE_MAX=1.6 で右端に到達する（#p3側の式に統一）', () => {
  // 旧 whatifPanel は 1.0〜2.0 を右40%に割り当てており、同じ充足率1.4で
  // #p3=86.7% / #p6=76.0% と10.7ポイントずれていた。1.6を右端とする側に統一済み。
  assert.equal(Number(ratePosition(1.4).toFixed(1)), 86.7)
  assert.equal(ratePosition(1.6), 100)
})

test('ratePosition: 定義域外でも 0〜100 に収まる', () => {
  assert.equal(ratePosition(-1), 0)
  assert.equal(ratePosition(99), 100)
})

test('bandLabels: 不足補正表から生成した帯ラベルが表の値と一致する', () => {
  // 旧実装は表と同じ数値をラベル文字列にも直書きしていた（二重定義）。
  // 表を単一の出典にしたうえで、標準パラメータでの出力が従来どおりであることを固定する。
  assert.deepEqual(bandLabels('A'), [
    '&lt;70%（0.30）',
    '70%（0.50）',
    '80%（0.70）',
    '90%（0.85）',
    '100%以上（1.00）',
  ])
  assert.deepEqual(bandLabels('B'), [
    '&lt;70%（0.50）',
    '70%（0.65）',
    '80%（0.80）',
    '90%（0.90）',
    '100%以上（1.00）',
  ])
  assert.deepEqual(bandLabels('C'), [
    '&lt;70%（0.70）',
    '70%（0.80）',
    '80%（0.90）',
    '90%（0.95）',
    '100%以上（1.00）',
  ])
})

test('bandLabels: 不足補正表を変えるとラベルも追従する', () => {
  const params: SimParams = {
    ...DEFAULT_PARAMS,
    shortageTable: {
      ...DEFAULT_PARAMS.shortageTable,
      A: [
        { minRate: 1.0, factor: 1.0 },
        { minRate: 0.75, factor: 0.6 },
        { minRate: 0, factor: 0.2 },
      ],
    },
  }
  assert.deepEqual(bandLabels('A', params), ['&lt;75%（0.20）', '75%（0.60）', '100%以上（1.00）'])
})

test('bandLabels: 帯の数は各事業部で SEG_WIDTHS と同数（5本）', () => {
  for (const u of UNIT_IDS) {
    assert.equal(bandLabels(u).length, 5, `${u}事業部の帯数`)
  }
})
