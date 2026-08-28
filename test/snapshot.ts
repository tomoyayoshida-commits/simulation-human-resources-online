// 実データ4課題の結果スナップショット（`npm run snapshot`）。
//
// リファクタが計算結果を変えていないことを証明するための道具。
// 単体テストは関数単位でしか見ないため、「最適化の出口の数字が1つも動いていない」ことは
// これでしか担保できない。v0.6の表示層リファクタでは全8ステップでこれを回し、
// SHA256 が不変であることを各コミットの根拠にした（docs/refactor-plan.md）。
//
//   npm run snapshot            docs/baseline-snapshot.txt と照合し、差があれば exit 1
//   npm run snapshot -- --write 基準ファイルを現在の結果で上書きする
//
// 上書きしてよいのは「仕様変更で結果が変わるのが正しい」と合意できたときだけ。
// 迷ったら CLAUDE.md §9（数式・定数・アルゴリズムの変更は要確認）に従うこと。
//
// データの場所は環境変数で差し替えられる:
//   SNAPSHOT_CSV  既定 ~/development/資料/human_resources_100.csv
//                 （デスクトップの `本課題　必要資料/human_resources_100.csv` と同一内容）

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importEmployees, buildAssignmentCsv } from '../src/renderer/csv.ts'
import { runOptimization } from '../src/renderer/optimizer.ts'
import { generateReasonText } from '../src/renderer/reasonText.ts'
import { TASK_IDS, UNIT_IDS } from '../src/renderer/constants.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'docs/baseline-snapshot.txt')
const CSV = process.env.SNAPSHOT_CSV ?? path.join(os.homedir(), 'development/資料/human_resources_100.csv')
const WRITE = process.argv.includes('--write')

if (!existsSync(CSV)) {
  console.error(`社員データが見つかりません: ${CSV}\nSNAPSHOT_CSV で場所を指定できます。`)
  process.exit(2)
}

const { employees, errors } = importEmployees(readFileSync(CSV, 'utf8'), 100)
if (!employees) {
  console.error('取込に失敗しました:\n' + errors.map((e) => `  行${e.row} ${e.column}: ${e.expected}`).join('\n'))
  process.exit(2)
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * 出力する行の作り方を変えると過去の基準ファイルと比較できなくなる。
 * 項目を足したいときは末尾に足し、既存行の書式は変えないこと。
 */
const lines: string[] = []
const timings: string[] = []
for (const task of TASK_IDS) {
  const t0 = performance.now()
  const r = runOptimization(employees, task)
  timings.push(`課題${task} ${(performance.now() - t0).toFixed(0)}ms`)

  if ('infeasible' in r) {
    lines.push(`task${task} INFEASIBLE ${r.reason}`)
    continue
  }
  lines.push(
    `task${task} rev=${r.companyRevenue} profit=${r.companyProfit} hc=${r.headcount.A}/${r.headcount.B}/${r.headcount.C} feasible=${r.feasible}`,
  )
  for (const u of UNIT_IDS) {
    const x = r.units[u]
    lines.push(
      `  ${u} n=${x.count} ability=${x.ability} rate=${x.fulfillmentRate} sf=${x.shortageFactor} xf=${x.surplusFactor} base=${x.baseRevenue} final=${x.finalRevenue} cost=${x.costTotal} profit=${x.profit}`,
    )
  }
  // 配置そのものと配置方針テキストもハッシュで固定する（数値が同じでも顔ぶれが変われば動く）
  lines.push('  csv=' + sha(buildAssignmentCsv(employees, r)))
  lines.push('  reason=' + sha(generateReasonText(r, task)))
}

const body = lines.join('\n')
const snapshot = `${body}\n\nSHA256(all)=${sha(body)}`

console.error(timings.join(' / '))

if (WRITE) {
  writeFileSync(BASELINE, snapshot + '\n', 'utf8')
  console.log(`基準ファイルを更新しました: ${path.relative(ROOT, BASELINE)}`)
  console.log(snapshot)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(`基準ファイルがありません: ${path.relative(ROOT, BASELINE)}\n--write で作成できます。`)
  process.exit(2)
}

const baseline = readFileSync(BASELINE, 'utf8').trimEnd()
if (snapshot === baseline) {
  console.log(`一致: ${path.relative(ROOT, BASELINE)} と同じ結果です。`)
  process.exit(0)
}

console.error('★ 基準と一致しません。計算結果が変わっています。\n')
const a = baseline.split('\n')
const b = snapshot.split('\n')
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    console.error(`  行${i + 1}`)
    console.error(`    基準: ${a[i] ?? '(なし)'}`)
    console.error(`    現在: ${b[i] ?? '(なし)'}`)
  }
}
console.error('\n意図した変更なら `npm run snapshot -- --write` で基準を更新してください。')
process.exit(1)
