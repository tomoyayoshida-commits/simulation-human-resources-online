// docs/export-plan.md §4.3 受入基準5/6: 出力文書のHTML生成テスト（node:test）。
// 最重要は「告知用に人件費・能力値が載らないこと」。ここが崩れると全社員に給与情報が配られる。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAnnouncementHtml,
  buildAnnouncementMembers,
  buildExecSummaryHtml,
} from '../src/renderer/exportDocs.ts'
import { computeSimulationResult } from '../src/renderer/calcEngine.ts'
import { DEFAULT_PARAMS } from '../src/renderer/constants.ts'
import type { Employee, ProfileMap, UnitId } from '../src/renderer/types.ts'

/** 人件費・能力値に他所へ紛れ込みにくい値を入れた6名。値が出力に現れたら混入の証拠になる。 */
const COST = 13
const SALES = 71
const MGMT = 72
const DEV = 73
const TRAINING = 74

function makeRoster(): Employee[] {
  return ['E001', 'E002', 'E003', 'E004', 'E005', 'E006'].map((id) => ({
    id,
    sales: SALES,
    mgmt: MGMT,
    dev: DEV,
    training: TRAINING,
    cost: COST,
  }))
}

function makeAssignment(): Record<string, UnitId> {
  return { E001: 'A', E002: 'A', E003: 'B', E004: 'B', E005: 'C', E006: 'C' }
}

const profiles: ProfileMap = {
  E001: { id: 'E001', name: '山田 太郎', photo: '' },
  E002: { id: 'E002', name: '鈴木 花子', photo: 'data:image/jpeg;base64,AAAA' },
}

test('buildAnnouncementMembers: id・name 以外を持ち出さない（受入基準5の構造的な担保）', () => {
  const members = buildAnnouncementMembers(makeRoster(), makeAssignment(), profiles)
  const all = [...members.A, ...members.B, ...members.C]
  assert.equal(all.length, 6)
  for (const m of all) {
    assert.deepEqual(Object.keys(m).sort(), ['id', 'name'])
  }
})

test('buildAnnouncementMembers: 顔写真を持ち出さない（§4.3.2）', () => {
  const members = buildAnnouncementMembers(makeRoster(), makeAssignment(), profiles)
  const html = buildAnnouncementHtml({
    title: '課題1 配置案',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    members,
  })
  // E002 の photo は data URI。名簿表に画像は一切載らない
  assert.ok(!html.includes('data:image'))
  assert.ok(!html.includes('<img'))
})

test('buildAnnouncementHtml: 人件費・能力値が一切現れない（受入基準5）', () => {
  const html = buildAnnouncementHtml({
    title: '課題1 配置案',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    members: buildAnnouncementMembers(makeRoster(), makeAssignment(), profiles),
  })
  for (const forbidden of [COST, SALES, MGMT, DEV, TRAINING]) {
    assert.ok(!html.includes(String(forbidden)), `告知用に ${forbidden} が現れてはいけない`)
  }
  assert.ok(!html.includes('人件費'))
  assert.ok(!html.includes('貢献度'))
})

test('buildAnnouncementHtml: 全員が社員番号・氏名・配属先の3列で載る（受入基準6）', () => {
  const html = buildAnnouncementHtml({
    title: '課題1 配置案',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    members: buildAnnouncementMembers(makeRoster(), makeAssignment(), profiles),
  })
  assert.ok(html.includes('山田 太郎'))
  for (const id of ['E003', 'E004', 'E005', 'E006']) assert.ok(html.includes(id), `${id} が載っていない`)
  assert.ok(html.includes('全6名'))
  for (const head of ['社員番号', '氏名', '配属先']) assert.ok(html.includes(head), `見出し ${head} がない`)
  // プロフィール未登録の4名は氏名欄がプレースホルダになる（行は消えない）
  assert.ok(html.includes('（氏名未登録）'))
})

test('buildAnnouncementHtml: 事業部ごとに区切られ、区切りの中は社員番号の昇順（§4.3.2）', () => {
  // 社員番号順と事業部順が食い違う配置。区切っていなければ E001,E002,… の順に並んでしまう
  const crossing: Record<string, UnitId> = {
    E001: 'A', E002: 'B', E003: 'C', E004: 'A', E005: 'B', E006: 'C',
  }
  const html = buildAnnouncementHtml({
    title: '課題1 配置案',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    // 逆順の roster を渡し、区切りの中で並べ替えているかも同時に見る
    members: buildAnnouncementMembers(makeRoster().reverse(), crossing, profiles),
  })
  const at = (id: string): number => html.indexOf(`>${id}<`)
  for (const id of ['E001', 'E002', 'E003', 'E004', 'E005', 'E006']) {
    assert.ok(at(id) >= 0, `${id} の社員番号セルがない`)
  }
  // 区切り行が3つ出る（各事業部の人数付き）
  assert.equal(html.match(/doc-roster-group/g)?.length, 3)
  for (const label of ['A事業部', 'B事業部', 'C事業部']) assert.ok(html.includes(label))
  // A(E001,E004) → B(E002,E005) → C(E003,E006) の順で、各事業部内は昇順
  assert.ok(at('E001') < at('E004'), 'A事業部の中が社員番号の昇順でない')
  assert.ok(at('E004') < at('E002'), 'A事業部の全員がB事業部より前に来ていない')
  assert.ok(at('E002') < at('E005'), 'B事業部の中が社員番号の昇順でない')
  assert.ok(at('E005') < at('E003'), 'B事業部の全員がC事業部より前に来ていない')
  assert.ok(at('E003') < at('E006'), 'C事業部の中が社員番号の昇順でない')
})

test('buildAnnouncementHtml: 氏名の<script>がタグとして解釈されない（CLAUDE.md §8）', () => {
  const evil: ProfileMap = { E001: { id: 'E001', name: '<script>alert(1)</script>', photo: '' } }
  const html = buildAnnouncementHtml({
    title: '<img src=x onerror=alert(1)>',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    members: buildAnnouncementMembers(makeRoster(), makeAssignment(), evil),
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('buildExecSummaryHtml: 個人が特定できる情報を載せない', () => {
  const roster = makeRoster()
  const result = computeSimulationResult(makeAssignment(), roster)
  const html = buildExecSummaryHtml({
    title: '課題1 配置案',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    result,
    params: DEFAULT_PARAMS,
    movedFromBaseline: 3,
  })
  for (const id of ['E001', 'E002', 'E003']) assert.ok(!html.includes(id), `${id} が載ってはいけない`)
  assert.ok(!html.includes('山田'))
  assert.ok(html.includes('3名'), '最適解からの調整人数は載る')
})

test('buildExecSummaryHtml: 前提条件を満たすかどうかで判定文が変わる', () => {
  const roster = makeRoster()
  const result = computeSimulationResult(makeAssignment(), roster)
  const html = buildExecSummaryHtml({
    title: 't',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    result,
    params: DEFAULT_PARAMS,
    movedFromBaseline: 0,
  })
  const expected = result.feasible ? '前提条件を満たしています' : '前提条件を満たしていません'
  assert.ok(html.includes(expected))
})

test('buildExecSummaryHtml: params の値がタグとして解釈されない（CLAUDE.md §8）', () => {
  // #p7 の params は保存済み配置案（Firestore）由来＝外部入力で、型どおり数値とは限らない。
  // runStore.loadRun は params を検証せずキャストするため（保存された数値を既定値で
  // 捏造しないための意図的な素通し）、防波堤は描画側のエスケープだけになる。
  const result = computeSimulationResult(makeAssignment(), makeRoster())
  const evilParams = {
    ...DEFAULT_PARAMS,
    prevYearRevenue: '<script>alert(1)</script>' as unknown as number,
    optimalHeadcount: { A: '<img src=x onerror=alert(1)>', B: 30, C: 30 } as unknown as Record<UnitId, number>,
  }
  const html = buildExecSummaryHtml({
    title: 't',
    savedAt: null,
    task: 1,
    metric: 'revenue',
    result,
    params: evilParams,
    movedFromBaseline: 0,
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;script&gt;'))
})
