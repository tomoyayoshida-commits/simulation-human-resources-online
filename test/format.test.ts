// 表示整形（format.ts）のテスト。
// 重点は escapeHtml：CSV由来の社員番号を innerHTML にそのまま埋めていた回帰を防ぐ
// （docs/refactor-plan.md B-5）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deltaText, escapeAttr, escapeHtml, oku, oku1, pct, pill, signed } from '../src/renderer/format.ts'

// テストケース `hire_test04_xss_script_injection.csv` が社員番号に持つ4パターン
const XSS_IDS = [
  `<script>alert('xss')</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><svg onload=alert(1)>`,
  `javascript:alert(1)`,
]

test('escapeHtml: 異常系CSVの社員番号がタグとして解釈されない', () => {
  for (const id of XSS_IDS) {
    const out = escapeHtml(id)
    assert.ok(!out.includes('<'), `< が残っている: ${out}`)
    assert.ok(!out.includes('>'), `> が残っている: ${out}`)
  }
  assert.equal(escapeHtml(XSS_IDS[0]), '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;')
  assert.equal(escapeHtml(XSS_IDS[1]), '&lt;img src=x onerror=alert(1)&gt;')
})

test('escapeHtml: & を最初に置換するため二重エスケープにならない', () => {
  assert.equal(escapeHtml('a&b'), 'a&amp;b')
  assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

test('escapeAttr: 属性値を閉じる引用符を無効化する', () => {
  // data-whatif-move="..." の中に " が入ると属性から抜け出せてしまう
  const out = escapeAttr(`" onmouseover="alert(1)`)
  assert.ok(!out.includes('"'), `" が残っている: ${out}`)
  assert.equal(out, '&quot; onmouseover=&quot;alert(1)')
})

test('escapeHtml: 数値・非文字列も文字列化して扱える', () => {
  assert.equal(escapeHtml(108), '108')
  assert.equal(escapeHtml(undefined), 'undefined')
})

test('oku / oku1: 小数第2位で揃える', () => {
  assert.equal(oku(61.5), '61.50億円')
  assert.equal(oku1(61.5), '61.50億')
})

test('signed: 0以上は + を付ける', () => {
  assert.equal(signed(1.5), '+1.50')
  assert.equal(signed(0), '+0.00')
  assert.equal(signed(-1.5), '-1.50')
})

test('deltaText: 丸め後に0なら「基準と同じ」を明示する', () => {
  assert.equal(deltaText(61.53, 60), '+1.53億円')
  assert.equal(deltaText(60, 61.53), '-1.53億円')
  assert.equal(deltaText(60, 60), '±0.00億円（基準と同じ）')
  // 差が丸めで消える場合も「基準と同じ」に倒す
  assert.equal(deltaText(60.001, 60), '±0.00億円（基準と同じ）')
})

test('pct: 充足率を整数%にする', () => {
  assert.equal(pct(0.8), '80%')
  assert.equal(pct(1.1428571428571428), '114%')
})

test('pill: styles.css のクラスに対応する', () => {
  assert.equal(pill('good', '● 満たす'), '<span class="pill good">● 満たす</span>')
})
