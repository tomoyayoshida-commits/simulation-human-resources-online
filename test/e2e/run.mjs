// Electron 実機での結線テスト（`npm run test:e2e`）。
//
// node:test の単体テスト（`npm test`）は純粋関数までしか触れないため、
// 「取込UI → 状態 → 描画」の配線が壊れても気づけない。ここでは実際に dist/ を
// BrowserWindow に読み込み、CSVのdropを合成して①〜⑥を順に操作し、DOMを検証する。
// v0.6 のリファクタで renderer.ts を分割したときの退行検出と、B-2（再最適化ボタンの
// ゲートが復帰しない不具合）の再現に使った（docs/refactor-plan.md）。
//
// 前提:
//   - `npx vite build` 済みであること（dist/index.html を読む）
//   - 画面が使えること（WSL2 なら WSLg 経由。ヘッドレスCIでは xvfb が要る）
// データの場所は環境変数で差し替えられる:
//   E2E_CSV_100    既定 ~/development/資料/human_resources_100.csv
//   E2E_CSV_ADD10  既定 ~/development/資料/テストケース/採用01_正常10名.csv

import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DIST = path.join(ROOT, 'dist/index.html')

const CSV_100 = process.env.E2E_CSV_100 ?? path.join(os.homedir(), 'development/資料/human_resources_100.csv')
const CSV_ADD10 =
  process.env.E2E_CSV_ADD10 ?? path.join(os.homedir(), 'development/資料/テストケース/採用01_正常10名.csv')

for (const [label, p, hint] of [
  ['ビルド成果物', DIST, '先に `npx vite build` を実行してください'],
  ['100名データ', CSV_100, 'E2E_CSV_100 で場所を指定できます'],
  ['追加採用10名データ', CSV_ADD10, 'E2E_CSV_ADD10 で場所を指定できます'],
]) {
  if (!existsSync(p)) {
    console.error(`${label}が見つかりません: ${p}\n${hint}`)
    process.exit(2)
  }
}

const CSV = readFileSync(CSV_100, 'utf8')
const ADD10 = readFileSync(CSV_ADD10, 'utf8')

// 環境依存のGPU初期化失敗を避ける（main.ts と同じ理由）
app.disableHardwareAcceleration()

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
}

/** Electron 37以降の console-message は details オブジェクト1つを渡す。旧シグネチャも受ける。 */
function readConsoleMessage(args) {
  const first = args[0]
  if (first && typeof first === 'object' && 'message' in first) {
    return { level: first.level, message: first.message }
  }
  return { level: args[1], message: args[2] }
}

function isProblem(level) {
  if (typeof level === 'number') return level >= 2 // 旧API: 2=warning, 3=error
  return level === 'error' || level === 'warning'
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 860, show: false })

  let consoleSeen = 0
  const consoleProblems = []
  win.webContents.on('console-message', (...args) => {
    const { level, message } = readConsoleMessage(args)
    consoleSeen++
    // 開発時のみ出るCSP警告はアプリの不具合ではない（パッケージ後は出ない）
    if (isProblem(level) && !message.includes('Electron Security Warning')) consoleProblems.push(message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    consoleProblems.push(`render-process-gone: ${JSON.stringify(details)}`)
  })

  await win.loadFile(DIST)

  const run = (code) => win.webContents.executeJavaScript(code, true)

  // ページ内の未捕捉例外も拾う（読み込み後に起きるものが対象）
  await run(`window.__e2eErrors = []
    window.addEventListener('error', (e) => window.__e2eErrors.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => window.__e2eErrors.push(String(e.reason)))
    true`)

  /** dropイベントを合成してCSVを読み込ませる。File API 経由なので本番と同じ経路を通る。 */
  const dropCsv = (zoneId, text) => `
    (async () => {
      const dt = new DataTransfer()
      dt.items.add(new File([${JSON.stringify(text)}], 'x.csv', { type: 'text/csv' }))
      document.getElementById(${JSON.stringify(zoneId)})
        .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 400))
      return true
    })()`

  // ---- ① データ取込 ----
  await run(dropCsv('dropzone-100', CSV))
  check(
    '①取込OK・次へボタン活性',
    await run(`document.getElementById('validation-summary').textContent.includes('取込OK')
      && !document.getElementById('next-to-p2').disabled`),
  )
  check('①プレビュー5行', (await run(`document.querySelectorAll('#preview-100 tr').length`)) === 6)

  // ---- ② 課題3を選んで実行 → ③ ----
  await run(`document.querySelector('.phasebtn[data-tab="p2"]').click()
    ;document.querySelector('.taskcard[data-task="3"]').click()
    ;document.getElementById('run-simulation').click()`)
  const summary = await run(`document.getElementById('company-summary').textContent`)
  // 課題3の全社売上は docs/baseline-snapshot.txt の 60.1 と一致するはず
  check('③全社売上60.10億円（スナップショットと一致）', summary.includes('60.10億円'), summary.trim())
  check('③配置人数バー3本', (await run(`document.querySelectorAll('#headcount-bars .bar-row').length`)) === 3)
  const p3Markers = await run(
    `[...document.querySelectorAll('#fulfillment-gauges .marker')].map(m => m.style.left).join(',')`,
  )
  // 課題3のB事業部は 49/35 = 1.4。統一後の式で 86.7%（旧#p6の式なら 76.0%）
  check('③ゲージのB事業部が86.7%（B-1統一後）', p3Markers.split(',')[1] === '86.7%', p3Markers)
  check('③配置結果プレビュー100行', (await run(`document.querySelectorAll('#assignment-preview tr').length`)) === 101)
  check('③配置方針が生成される', await run(`document.querySelectorAll('#reason-box li').length >= 5`))

  // ---- ④ 4課題横断比較 ----
  await run(`document.querySelector('.phasebtn[data-tab="p4"]').click()`)
  check('④比較カード4枚', (await run(`document.querySelectorAll('#compare-tasks-grid .compare-card').length`)) === 4)
  await run(`document.getElementById('cmp-mode-revenue').click()`)
  check('④売上/利益の切替が効く', await run(`document.body.textContent.includes('事業部別売上')`))

  // ---- ⑥ What-if ----
  await run(`document.querySelector('.phasebtn[data-tab="p6"]').click()`)
  check(
    '⑥人数スライダー3本・社員一覧100行',
    (await run(`document.querySelectorAll('[data-whatif-headcount]').length`)) === 3 &&
      (await run(`document.querySelectorAll('[data-whatif-move]').length`)) === 100,
  )
  // #p6 の基準ケースは①取込時の選択課題（=課題1）で作られるため #p3 とは配置が異なる。
  // 課題1のB事業部は 40/35 = 1.1429。統一後の式なら 69.5%、旧#p6の式なら 65.7%。
  const wiMarkers = await run(
    `[...document.querySelectorAll('#whatif-gauges .marker')].map(m => m.style.left).join(',')`,
  )
  check('⑥B-1統一後の式で描かれている（69.5%・旧式なら65.7%）', wiMarkers.split(',')[1] === '69.5%', wiMarkers)

  const beforeSlide = await run(`document.getElementById('whatif-summary').textContent`)
  await run(`(async () => {
    const s = document.querySelector('[data-whatif-headcount="A"]')
    s.value = '55'
    s.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return true
  })()`)
  check('⑥スライダー操作で結果が再計算される', beforeSlide !== (await run(`document.getElementById('whatif-summary').textContent`)))
  // ドラッグ中に range 要素を作り直すとドラッグが中断するため、値だけ同期される実装になっている
  check(
    '⑥スライダー要素が再生成されずA=55を保つ',
    (await run(`document.querySelector('[data-whatif-headcount="A"]').value`)) === '55',
  )

  await run(`(async () => {
    const sel = document.querySelector('[data-whatif-move]')
    sel.value = sel.value === 'A' ? 'C' : 'A'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return true
  })()`)
  check(
    '⑥個別異動が配置差分に反映される',
    await run(`document.getElementById('whatif-diff-summary').textContent.includes('異動')`),
    await run(`document.getElementById('whatif-diff-summary').textContent.trim()`),
  )

  // B-2 の回帰: 適正人数を不正値にして戻したとき、再最適化ボタンが復帰すること
  const setOptimalA = (value) => `(async () => {
    const inp = document.querySelector('[data-whatif-param="optimalHeadcount"][data-whatif-unit="A"]')
    inp.value = ${JSON.stringify(value)}
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    return document.getElementById('whatif-params-reoptimize').disabled
  })()`
  check('B-2 パラメータが不正なら再最適化ボタンが無効', (await run(setOptimalA('0'))) === true)
  check('B-2 不正を直すと再最適化ボタンが復帰する', (await run(setOptimalA('40'))) === false)

  // ---- ⑤ 採用前後比較 ----
  const beforeLeave = await run(`document.querySelector('[data-whatif-headcount="A"]').value`)
  await run(`document.querySelector('.phasebtn[data-tab="p5"]').click()`)
  await run(dropCsv('dropzone-hiring-100', CSV))
  await run(dropCsv('dropzone-10', ADD10))
  check(
    '⑤採用前後カードとROI表が出る',
    (await run(
      `document.querySelectorAll('#compare-hiring-grid .compare-before, #compare-hiring-grid .compare-after').length`,
    )) === 2 && (await run(`document.getElementById('hiring-roi').textContent.includes('名採用の効果')`)),
  )

  // ---- #p6 に戻ってもWhat-ifの編集が保持されるか（go(p6) の ensureWhatIf 分岐） ----
  check('⑥編集後のA人数が既定40から動いている', beforeLeave !== '40', beforeLeave)
  await run(`document.querySelector('.phasebtn[data-tab="p6"]').click()`)
  const afterReturn = await run(`document.querySelector('[data-whatif-headcount="A"]').value`)
  check('⑥他画面から戻っても編集が保持される', afterReturn === beforeLeave, `離脱前=${beforeLeave} 復帰後=${afterReturn}`)

  // ---- エラーの取りこぼしが無いことの確認 ----
  const pageErrors = await run(`window.__e2eErrors`)
  // console-message を1件も受け取っていないなら、フックが効いておらず見逃している可能性がある
  check('コンソール監視が機能している（1件以上受信）', consoleSeen > 0, `受信 ${consoleSeen} 件`)
  check('レンダラーでエラーが発生していない', consoleProblems.length === 0 && pageErrors.length === 0,
    [...consoleProblems, ...pageErrors].join(' / '))

  let failed = 0
  for (const r of results) {
    if (!r.ok) failed++
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `\n        → ${r.detail}` : ''}`)
  }
  console.log(`\n${results.length - failed}/${results.length} PASS`)
  app.exit(failed > 0 ? 1 : 0)
})
