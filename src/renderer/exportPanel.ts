// 設計書§4.1/§4.4（docs/export-plan.md）: #p7「保存した配置案」の一覧と出力。
// HTML生成は純粋関数に寄せ、このファイルは表示とDOM配線だけを持つ（CLAUDE.md §5）。
//
// 出力画面が見るのは SavedRun 1件だけで、#p4 の取込状態には一切依存しない（§4.1）。
// そのおかげで「作業机から保存した直後」と「後日に一覧から開いた」で同じコードが動く。

import type { RunSummary, SavedRun } from './runStore.ts'
import { listRuns, loadRun } from './runStore.ts'
import { computeSimulationResult } from './calcEngine.ts'
import { evaluateAssignment } from './whatif.ts'
import { round2 } from './constants.ts'
import { buildAssignmentCsv, downloadCsv } from './csv.ts'
import { buildAnnouncementHtml, buildAnnouncementMembers, buildExecSummaryHtml } from './exportDocs.ts'
import { getProfiles, loadProfiles } from './profileStore.ts'
import { taskLabel } from './constants.ts'
import { escapeHtml, oku, pill } from './format.ts'
import { $, setHtml } from './dom.ts'
import { withLoading } from './loading.ts'

type Step = 'list' | 'export'

let showStep: (step: Step) => void = () => {}
/** 出力画面がいま対象にしている1件。null なら出力ステップは空。 */
let current: SavedRun | null = null

// ---- 純粋関数：HTML生成 ----

function dateTimeText(d: Date | null): string {
  if (!d) return '保存中…'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 一覧の中身（§4.1）。0件のときは説明文を出す。 */
export function buildRunListHtml(runs: RunSummary[]): string {
  if (runs.length === 0) {
    return `<p class="note">保存された配置案はまだありません。「配置比較」または「採用判断」→作業机で調整し、「この案を保存」から保存すると、ここに並びます。</p>`
  }
  const rows = runs
    .map(
      (r) => `
      <tr>
        <td><button type="button" class="link-button" data-run="${escapeHtml(r.id)}">${escapeHtml(r.title)}</button></td>
        <td>${escapeHtml(runKindText(r))}</td>
        <td>${escapeHtml(taskLabel(r.task, r.metric))}</td>
        <td class="num">${escapeHtml(oku(r.companyRevenue))}</td>
        <td class="num">${escapeHtml(oku(r.companyProfit))}</td>
        <td class="num">${r.movedFromBaseline}名</td>
        <td>${r.feasible ? pill('good', '● 制約を満たす') : pill('crit', '● 制約違反')}</td>
        <td>${escapeHtml(dateTimeText(r.savedAt))}</td>
        <td>${escapeHtml(r.savedBy)}</td>
      </tr>`,
    )
    .join('')
  return `
    <table>
      <thead><tr><th>名前</th><th>種別</th><th>課題</th><th class="num">全社売上</th><th class="num">全社利益</th><th class="num">調整</th><th>状態</th><th>保存日時</th><th>保存者</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">「種別」は保存元の画面です。配置比較は100名、採用判断は既存100名＋採用した候補の人数で計算されているため、全社売上をそのまま見比べることはできません。</p>`
}

/**
 * 一覧の「種別」列（①34/②42）。100名の配置案と110名の採用案が同じ表に並ぶと、
 * 人数の前提が違うことに気づかないまま全社売上を見比べてしまうため列で示す。
 * 採用人数は RunSummary.hiredIds から出せる（保存形式は変えない・手順書 §2.2）。
 */
function runKindText(r: RunSummary): string {
  if (r.kind !== 'hiring') return '配置（100名）'
  const hired = r.hiredIds?.length
  return hired === undefined ? '採用判断' : `採用判断（100＋${hired}名）`
}

/** 保存直後だけ出す簡単なチュートリアル（3つの出力の違いを説明する）。一覧から開いたときは出さない。 */
function buildExportTutorialHtml(): string {
  return `
    <div class="hint" id="p7-tutorial">
      保存できました。このあと3つの出力から選べます：
      <b>CSV</b>は全項目の明細（100名ちょうどの案なら取り込み直して再計算できます）、
      <b>告知用PDF</b>は社員に配る新体制表、
      <b>エグゼクティブサマリPDF</b>は経営層向けの数字だけの1枚です。
      <button type="button" class="btn secondary" data-export="dismiss-tutorial" style="margin-left:10px;">閉じる</button>
    </div>`
}

/**
 * 出力できない理由の内訳（①35/②43）。
 *
 * 保存時に持っているのは `feasible: boolean` だけだが、SavedRun は roster/assignment/params を
 * 持つので、開いた時点で評価し直せば「どの制約をどれだけ割っているか」まで出せる
 * （保存形式の変更は不要・手順書 §2.2）。値は保存済みの配置に対する固定値なので、
 * 作業机のバナー（Phase 4-4）と違って具体値を書いてよい。
 */
export function buildBlockedDetailHtml(run: SavedRun): string {
  const { result, minHeadcountViolations } = evaluateAssignment(
    { task: run.task, roster: run.roster, params: run.params, assignment: run.assignment },
    run.assignment,
  )
  const items: string[] = []
  if (!result.feasible) {
    const short = round2(run.params.prevYearRevenue - result.companyRevenue)
    items.push(
      `全社売上が下限（${run.params.prevYearRevenue}億円）に <b>${short.toFixed(2)}億円</b> 足りません（この案は ${oku(result.companyRevenue)}）。`,
    )
  }
  for (const u of minHeadcountViolations) {
    const now = result.headcount[u]
    const min = run.params.minHeadcount[u]
    items.push(`${u}事業部が最低人数 ${min}名に <b>${min - now}名</b> 足りません（この案は ${now}名）。`)
  }
  if (items.length === 0) return ''
  return `
    <div class="export-blocked">
      <p class="export-blocked-head">この配置案は制約を満たしていないため、記録としては保存されていますが出力はできません。</p>
      <ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>
      <p class="note">作業机で上の不足を解消して保存し直すと出力できます。保存済みの案は書き換えられません（追記のみ）。</p>
    </div>`
}

/** 出力ステップの中身。制約違反のときは3つとも押せない（§4.5）。 */
export function buildExportHtml(run: SavedRun, justSaved = false): string {
  const blocked = !run.feasible
  const disabled = blocked ? ' disabled title="制約違反があるため出力できません"' : ''
  return `
    <h2>${escapeHtml(run.title)}</h2>
    <p class="subtitle">${escapeHtml(taskLabel(run.task, run.metric))}　保存者 ${escapeHtml(run.savedBy)}　${escapeHtml(dateTimeText(run.savedAt))}</p>
    ${justSaved ? buildExportTutorialHtml() : ''}
    ${blocked ? buildBlockedDetailHtml(run) : ''}
    <div class="export-grid">
      <div class="export-card">
        <h3>データ（CSV）</h3>
        <p>全項目を含む明細。100名ちょうどの案はそのまま取り込み直して再計算できます（採用後110名の案は取込の件数検証に合わないため読み戻せません）。</p>
        <p class="note">社員番号・能力値4項目・人件費・配置先・貢献度・タイプ</p>
        <button type="button" class="btn" data-export="csv"${disabled}>CSVを保存</button>
      </div>
      <div class="export-card">
        <h3>告知用（PDF）</h3>
        <p>全社員に配る新体制表。社員番号・氏名・配属先を社員番号順に並べます。</p>
        <p class="note">顔写真・人件費・能力値・貢献度は含みません</p>
        <button type="button" class="btn" data-export="announce"${disabled}>印刷してPDFに保存</button>
      </div>
      <div class="export-card">
        <h3>エグゼクティブサマリ（PDF）</h3>
        <p>経営層向けのA4一枚。数字と配置の根拠だけを載せます。</p>
        <p class="note">個人名・社員番号は含みません</p>
        <button type="button" class="btn" data-export="exec"${disabled}>印刷してPDFに保存</button>
      </div>
    </div>
    <!-- ①31/②39: PDFは印刷ダイアログ経由なので、保存の仕方と環境差をここに書いておく -->
    <div class="export-print-note">
      <b>PDFで保存するときは</b>
      <ul>
        <li>印刷ダイアログの「送信先」（Safari は「PDF」メニュー）で <b>PDFに保存</b> を選びます。</li>
        <li>用紙は <b>A4・縦</b>、拡大縮小は「既定」のままにしてください。</li>
        <li>色の付いた見出しや帯を残すには <b>背景のグラフィック</b>（Chrome）／<b>背景を印刷</b>（Firefox）をONにします。</li>
        <li>ヘッダーとフッター（URL・日付）は不要ならOFFにしてください。</li>
      </ul>
      <p class="note">ブラウザとOSによって既定値や余白の扱いが異なります。上の設定で出したPDFが崩れる場合は、
        別のブラウザ（Chrome推奨）でもう一度お試しください。</p>
    </div>
    <div class="actions" style="margin-top:18px;">
      <button type="button" class="btn secondary" data-export="back-list">← 保存した配置案の一覧へ</button>
    </div>`
}

// ---- DOM配線 ----

/**
 * 文書を1枚だけ印刷する（§4.4）。
 * 常時DOMに置かず、押された時点で差し込み、印刷が終わったら取り除く。
 */
function printDocument(html: string): void {
  const holder = document.createElement('div')
  holder.className = 'print-doc'
  holder.innerHTML = html
  document.body.appendChild(holder)
  document.body.classList.add('printing')

  let done = false
  const cleanup = (): void => {
    if (done) return
    done = true
    document.body.classList.remove('printing')
    holder.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  // afterprint が発火しないブラウザに当たっても画面が隠れたままにならないための保険。
  // 通常は上のリスナが先に片付ける。
  setTimeout(cleanup, 60_000)
  window.print()
}

function runResult(run: SavedRun) {
  return computeSimulationResult(run.assignment, run.roster, run.params)
}

async function handleExportAction(action: string): Promise<void> {
  const run = current
  if (!run) return
  if (action === 'back-list') {
    await openRunsList()
    return
  }
  if (action === 'dismiss-tutorial') {
    $('p7-tutorial')?.remove()
    return
  }
  if (!run.feasible) return
  if (action === 'csv') {
    const date = run.savedAt ? run.savedAt.toISOString().slice(0, 10) : ''
    downloadCsv(`配置案_課題${run.task}_${date}.csv`, buildAssignmentCsv(run.roster, runResult(run), run.params))
    return
  }
  if (action === 'announce') {
    // 一覧から開いた直後はプロフィールが未取得のことがある。未取得なら氏名欄が全員「（氏名未登録）」
    // になってしまうため、ここでは待つ（作業机と違い主動線を止めない配慮は不要）。
    await withLoading('氏名を読み込んでいます…', async () => loadProfiles())
    printDocument(
      buildAnnouncementHtml({
        title: run.title,
        savedAt: run.savedAt,
        task: run.task,
        metric: run.metric,
        members: buildAnnouncementMembers(run.roster, run.assignment, getProfiles()),
      }),
    )
    return
  }
  if (action === 'exec') {
    printDocument(
      buildExecSummaryHtml({
        title: run.title,
        savedAt: run.savedAt,
        task: run.task,
        metric: run.metric,
        result: runResult(run),
        params: run.params,
        movedFromBaseline: run.movedFromBaseline,
      }),
    )
  }
}

/** 一覧を読み込んで描画し、一覧ステップを表示する。 */
export async function openRunsList(): Promise<void> {
  showStep('list')
  setHtml('p7-list', '<p class="note">読み込んでいます…</p>')
  try {
    setHtml('p7-list', buildRunListHtml(await listRuns()))
  } catch (e) {
    console.warn('保存した配置案の取得に失敗しました。', e)
    setHtml('p7-list', '<p class="warn-text">保存した配置案を取得できませんでした。通信状態を確認して開き直してください。</p>')
  }
}

/**
 * 1件を出力ステップで開く。作業机からの保存直後と、一覧からの選択の両方がここへ来る。
 * justSaved は保存直後だけ true にする（チュートリアル表示の判定に使う。§4.1）。
 */
export function openExportFor(run: SavedRun, justSaved = false): void {
  current = run
  setHtml('p7-export', buildExportHtml(run, justSaved))
  showStep('export')
}

export function initExportPanel(onShowStep: (step: Step) => void): void {
  showStep = onShowStep

  $('p7-list')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-run]')
    const runId = btn?.dataset.run
    if (!runId) return
    void withLoading('配置案を読み込んでいます…', async () => {
      const run = await loadRun(runId)
      if (run) openExportFor(run)
    })
  })

  $('p7-export')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-export]')
    if (btn?.dataset.export) void handleExportAction(btn.dataset.export)
  })
}
