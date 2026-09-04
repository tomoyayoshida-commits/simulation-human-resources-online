// 設計書§4.3/§4.4（docs/export-plan.md）: 告知用・エグゼクティブサマリのHTML生成。
// 純粋関数・DOM非依存（テスト対象）。計算は持たない（CLAUDE.md §5）。
//
// この2つは読む人が違うので項目を共通化しない。とくに告知用は全社員が読むため、
// 人件費・能力値・貢献度を**構造として持たせない**（§7・受入基準5）。
// 引数の型に載っていない値は、実装を間違えても出しようがない、という形にしてある。

import type { Employee, ProfileMap, SimParams, SimulationResult, TaskId, UnitId } from './types.ts'
import type { TaskMetric } from './constants.ts'
import { taskLabel, UNIT_IDS, UNIT_LABEL, UNIT_VAR } from './constants.ts'
import { escapeHtml, oku, oku1, pct, signed } from './format.ts'
import { generateReasonText } from './reasonText.ts'

/** 文書ヘッダに出す日付。保存直後で serverTimestamp が未解決なら空にする。 */
function dateText(savedAt: Date | null): string {
  if (!savedAt) return ''
  return `${savedAt.getFullYear()}年${savedAt.getMonth() + 1}月${savedAt.getDate()}日`
}

/**
 * 告知用に渡せる社員情報。**能力値も人件費も含まない**（§4.3）。
 * 顔写真も持たない（§4.3.2）。掲示・回覧される事務文書なので、名簿としての体裁を優先する。
 */
export interface AnnouncementMember {
  id: string
  name: string
  /** 追加採用で入った人か（②46）。配置比較(#p4)由来の案では全員 false */
  isNew: boolean
}

/**
 * 事業部ごとの新規採用人数（②46）。assignment と採用者の社員番号だけで数えられる。
 * 能力値・人件費は見ないので、告知用の「持ち出さない」方針を崩さない。
 */
export function countNewHiresByUnit(
  assignment: Record<string, UnitId>,
  hiredIds: string[] = [],
): Record<UnitId, number> {
  const counts: Record<UnitId, number> = { A: 0, B: 0, C: 0 }
  for (const id of hiredIds) {
    const unit = assignment[id]
    if (unit) counts[unit]++
  }
  return counts
}

export interface AnnouncementData {
  title: string
  savedAt: Date | null
  task: TaskId
  metric: TaskMetric
  /** 事業部ごとの配属者。UNIT_IDS の順に並べる */
  members: Record<UnitId, AnnouncementMember[]>
}

/**
 * roster と assignment から告知用の入力を組む。
 * **ここが人件費・能力値を落とす唯一の関門**。`Employee` から id 以外を持ち出さない。
 */
export function buildAnnouncementMembers(
  roster: Employee[],
  assignment: Record<string, UnitId>,
  profiles: ProfileMap,
  hiredIds: string[] = [],
): Record<UnitId, AnnouncementMember[]> {
  const hired = new Set(hiredIds)
  const members: Record<UnitId, AnnouncementMember[]> = { A: [], B: [], C: [] }
  for (const e of roster) {
    const unit = assignment[e.id]
    if (!unit) continue
    const p = profiles[e.id]
    members[unit].push({ id: e.id, name: p?.name ?? '', isNew: hired.has(e.id) })
  }
  for (const u of UNIT_IDS) members[u].sort((a, b) => a.id.localeCompare(b.id))
  return members
}

/**
 * ②告知用：全100名の新体制表（§8-2・§4.3.2）。
 * **社員番号・氏名・配属先の3列**を1行1名で並べた名簿表。
 * 顔写真カードから、この形に変えた（ユーザー判断・2026-09-03）。
 *
 * 表は1つのまま、事業部ごとに区切り行を挟む（ユーザー判断・2026-09-03）。
 * 表を3つに割らないのは、列幅と見出し行を全事業部で共通にしておくため。
 * 区切りをまたいでも「配属先」列は各行に残す。改ページが区切りの途中に落ちたとき、
 * 見出しの見えないページでも1行だけで配属先が読めるようにするため。
 *
 * 「異動者に旧所属を併記する」当初案は採らない。本アプリの「異動」は最適解からの差分であって
 * 現在の実所属からの差分ではないため、全社員向けの文書に載せると意味の違う数字が独り歩きする（§9）。
 */
export function buildAnnouncementHtml(d: AnnouncementData): string {
  const total = UNIT_IDS.reduce((n, u) => n + d.members[u].length, 0)
  const newTotal = UNIT_IDS.reduce((n, u) => n + d.members[u].filter((m) => m.isNew).length, 0)
  // ②46: 事業部ごとの内訳を「既存＋新規」の積み上げ帯で示す。人数だけの表より、
  // どの事業部に新しい人が入ったのかが一目で分かる。新規が0名なら帯も表記も出さない。
  const summary = UNIT_IDS.map((u) => {
    const count = d.members[u].length
    const newCount = d.members[u].filter((m) => m.isNew).length
    const newPct = count > 0 ? (newCount / count) * 100 : 0
    const bar =
      newTotal === 0
        ? ''
        : `<span class="doc-unit-bar"><span class="doc-unit-bar-new" style="width:${newPct.toFixed(1)}%;background:${UNIT_VAR[u]};"></span></span>`
    const newText = newTotal === 0 ? '' : `<span class="doc-unit-new">うち新規 ${newCount}名</span>`
    return `
      <li class="doc-unit-chip" style="border-left-color:${UNIT_VAR[u]};">
        <span>${escapeHtml(UNIT_LABEL[u])}</span><b>${count}名</b>${newText}${bar}
      </li>`
  }).join('')

  // 事業部の区切り行＋その事業部の全員（社員番号順は buildAnnouncementMembers が済ませている）
  const rows = UNIT_IDS.map((u) => {
    const group = `
        <tr class="doc-roster-group">
          <th colspan="3" style="border-left-color:${UNIT_VAR[u]};">
            ${escapeHtml(UNIT_LABEL[u])}<span>${d.members[u].length}名</span>
          </th>
        </tr>`
    const members = d.members[u]
      .map(
        (m) => `
        <tr${m.isNew ? ' class="doc-roster-new"' : ''}>
          <td class="doc-roster-id">${escapeHtml(m.id)}${m.isNew ? '<span class="doc-new-badge">新規</span>' : ''}</td>
          <td>${m.name ? escapeHtml(m.name) : '<span class="doc-roster-blank">（氏名未登録）</span>'}</td>
          <td class="doc-roster-unit" style="border-left-color:${UNIT_VAR[u]};">${escapeHtml(UNIT_LABEL[u])}</td>
        </tr>`,
      )
      .join('')
    return group + members
  }).join('')

  return `
    <article class="doc doc-announce">
      <header class="doc-head">
        <h2>${escapeHtml(d.title)}</h2>
        <p class="doc-meta">新体制のご案内（全${total}名${newTotal > 0 ? `・うち新規採用${newTotal}名` : ''}）　${escapeHtml(dateText(d.savedAt))}</p>
      </header>
      <ul class="doc-unit-summary">${summary}</ul>
      <table class="doc-table doc-roster">
        <thead><tr><th>社員番号</th><th>氏名</th><th>配属先</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="doc-foot">本表は「${escapeHtml(taskLabel(d.task, d.metric))}」に基づく配置です。</footer>
    </article>`
}

export interface ExecSummaryData {
  title: string
  savedAt: Date | null
  task: TaskId
  metric: TaskMetric
  result: SimulationResult
  params: SimParams
  /** 最適解から人手で動かした人数。経営層向けには「判断の量」を示す数字になる */
  movedFromBaseline: number
  /** 採用判断の案なら、採用した候補の社員番号（②46/②47）。配置比較の案では undefined */
  hiredIds?: string[]
  /** この案の配置。事業部ごとの新規採用人数を数えるのに使う（②46） */
  assignment?: Record<string, UnitId>
}

/**
 * ③エグゼクティブサマリ：A4縦1枚（§4.3）。
 * 個人名・社員番号は出さない。数字と判断根拠だけを載せる。
 * 体裁は mockup-exec-summary.html を移植したもの。
 *
 * params は保存済み配置案（Firestore）由来＝外部入力なので、型どおり数値とは限らない。
 * 直接埋める箇所は数値のつもりでも escapeHtml を通す（CLAUDE.md §8）。
 * verdict.body は下の描画側で escapeHtml しているため、ここでは通さない（二重エスケープになる）。
 */
export function buildExecSummaryHtml(d: ExecSummaryData): string {
  const { result, params } = d
  const feasible = result.feasible
  const verdict = feasible
    ? {
        cls: 'ok',
        head: '前提条件を満たしています',
        body: `全社売上は前年 ${params.prevYearRevenue}億円 を上回る ${oku(result.companyRevenue)} です。`,
      }
    : {
        cls: 'ng',
        head: '前提条件を満たしていません',
        body: `全社売上 ${oku(result.companyRevenue)} が前年 ${params.prevYearRevenue}億円 を下回ります。`,
      }

  // ②47: 「いまいくらか」ではなく「基準からどれだけ動いたか」を主役にする。
  // 基準はすべて params と result の中にある値（前年度実績・適正人数・最低人数・最適解）なので、
  // 追加の最適化計算を回さずに変化を出せる。
  const total = result.headcount.A + result.headcount.B + result.headcount.C
  const newByUnit = countNewHiresByUnit(d.assignment ?? {}, d.hiredIds)
  const newTotal = UNIT_IDS.reduce((n, u) => n + newByUnit[u], 0)
  const revenueDelta = result.companyRevenue - params.prevYearRevenue
  const costTotal = result.companyRevenue - result.companyProfit

  const stats = [
    {
      k: '全社売上',
      v: oku(result.companyRevenue),
      d: `前年度実績 ${params.prevYearRevenue}億円 比 ${signed(revenueDelta)}億円`,
      good: feasible,
    },
    { k: '全社利益', v: oku(result.companyProfit), d: `人件費 ${oku1(costTotal)}`, good: false },
    {
      k: '人数',
      v: `${total}名`,
      d: d.hiredIds === undefined ? '配置比較（採用なし）' : `採用前 ${total - newTotal}名 → ${signed(newTotal)}名`,
      good: false,
    },
    { k: '最適解からの調整', v: `${d.movedFromBaseline}名`, d: '人手で動かした人数', good: false },
  ]
    .map(
      (s) =>
        `<div class="doc-stat"><span class="k">${escapeHtml(s.k)}</span><span class="v${s.good ? ' good' : ''}">${escapeHtml(s.v)}</span><span class="doc-stat-d">${escapeHtml(s.d)}</span></div>`,
    )
    .join('')

  const rows = UNIT_IDS.map((u) => {
    const r = result.units[u]
    const short = r.count < params.minHeadcount[u]
    const optimalDelta = r.count - params.optimalHeadcount[u]
    return `
      <tr>
        <td><span class="doc-dot" style="background:${UNIT_VAR[u]};"></span>${escapeHtml(UNIT_LABEL[u])}</td>
        <td class="num">${r.count}名${short ? `<span class="doc-warn">最低${escapeHtml(params.minHeadcount[u])}名</span>` : ''}</td>
        <td class="num">${signed(optimalDelta)}名</td>
        ${newTotal > 0 ? `<td class="num">${newByUnit[u]}名</td>` : ''}
        <td class="num">${pct(r.fulfillmentRate)}</td>
        <td class="num">${oku1(r.finalRevenue)}</td>
        <td class="num">${oku1(r.profit)}</td>
      </tr>`
  }).join('')

  return `
    <article class="doc doc-exec">
      <header class="doc-head">
        <h2>${escapeHtml(d.title)}</h2>
        <p class="doc-meta">${escapeHtml(taskLabel(d.task, d.metric))}　${escapeHtml(dateText(d.savedAt))}</p>
      </header>
      <div class="doc-verdict ${verdict.cls}">
        <h3>${escapeHtml(verdict.head)}</h3>
        <p>${escapeHtml(verdict.body)}</p>
      </div>
      <div class="doc-stats">${stats}</div>
      <h3 class="doc-section">事業部別（適正人数との差・${newTotal > 0 ? '新規採用の配属・' : ''}充足率）</h3>
      <table class="doc-table">
        <thead><tr><th>事業部</th><th class="num">人数</th><th class="num">適正比</th>${newTotal > 0 ? '<th class="num">うち新規</th>' : ''}<th class="num">充足率</th><th class="num">売上</th><th class="num">利益</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 class="doc-section">配置の根拠</h3>
      <div class="doc-reason">${generateReasonText(result, d.task, params, d.metric)}</div>
    </article>`
}
