# CLAUDE.md — 人材配置シミュレーター

> AIエージェント共通の作業規約。Claude Code / Cursor / Antigravity いずれも本ファイルを唯一の入口とする。
> ここに要約済みの内容は元資料を再読しない（`設計書_AI向け.md` は27KB）。

## 1. 応答スタイル

- 箇条書きで簡潔に。結論を先に書く。
- 前置き・言い換え・自明な補足を書かない。
- 根拠は判断に必要な分だけ。

## 2. 何を作っているか

100名（採用後110名）を A/B/C 事業部へ配置し、売上・利益を最適化するデスクトップアプリ。
Electron + TypeScript。**外部API・ネットワーク通信は行わない／数理最適化ライブラリは本番コードで使わない**。
※これは**課題の制約ではなく自主的な設計判断**（出典 `設計書_AI向け.md:11`「サイズが小さく自前実装で十分高速」）。
課題原文の「制約条件」は全社売上>58億と各事業部の最低人数の2つのみ。変更したい場合は禁止事項ではなく §9 の再合意対象。
「配置結果」に加え「配置方針とその理由」の出力が評価対象。

## 3. 開発環境

コードは WSL2 Ubuntu 上：`\\wsl.localhost\Ubuntu\home\tomoyayoshida\development\simulation-human-resources`

- PowerShell から実行するときは**ログインシェル経由が必須**（node は fnm 管理）：
  `wsl -d Ubuntu -- bash -lic "cd ~/development/simulation-human-resources && npm test"`
- `bash -c`（`-li` なし）は `node: command not found` になる。
- PowerShell は `2>/dev/null` を Windows パスと誤解するため使わない。

## 4. コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | Vite + Electron 起動（WSLg 経由で Windows 側に表示）。HMR あり |
| `npm test` | `node:test` + 型ストリップ。全52件・約18秒 |
| `npm run test:one -- --test-name-pattern='<正規表現>' <ファイル>` | 1件だけ実行。約0.1秒。例：`npm run test:one -- --test-name-pattern='境界は上側' test/calcEngine.test.ts`。注意は§8 |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` → `vite build` → `electron-builder`。Windows配布は `npx electron-builder --win zip`（README参照） |

## 5. ディレクトリ構成

```
src/
  main/main.ts          74行  Electronエントリ。BrowserWindow生成のみ。IPC・ファイルI/Oなし
  renderer/
    index.html         278行  画面骨格。#p0〜#p6 の7パネル（モック由来の静的サンプル値は撤去し「未実行」プレースホルダに置換済み）
    styles.css         126行  モック由来のスタイル＋What-if用の最小追加(§7)
    renderer.ts        170行  ★結線層。アプリ状態・画面遷移go()・実行/出力ボタン・取込の配線だけ
    types.ts            90行  型定義のみ（SimParams・AssignmentDiff含む・機能14）
    constants.ts       168行  ★全定数の単一の置き場。重み・売上・ペナルティ表・COLUMN_MAP・round2()・DEFAULT_PARAMS
                             ＋ UNIT_IDS / TASK_IDS / UNIT_LABEL / UNIT_NAME / UNIT_VAR / PROFIT_SCALE
    format.ts           64行  表示用の文字列整形（DOM非依存）。escapeHtml/escapeAttr/oku/oku1/signed/deltaText/pct/pill
    dom.ts              14行  $ / setHtml だけの薄いDOMヘルパ
    csv.ts             190行  CSVパース/エクスポート/採用データマージ
    validation.ts       88行  範囲・件数チェック。ValidationError[]を返す純粋関数
    calcEngine.ts      181行  ★貢献度→能力値→売上→コスト→利益。全て純粋関数
    assignment.ts      179行  最小費用流(SSP+Johnsonポテンシャル+Dijkstra)。内側の割当を厳密解
    optimizer.ts       281行  ★人数配分の全列挙×割当。課題1〜4の目的関数と辞書式合成。solveForHeadcount(機能14軸1)含む
    reasonText.ts       51行  配置方針テキスト生成
    importPanel.ts     123行  #p1/#p5 の取込UI（setupDropzone）と検証レポート描画
    dashboard.ts       210行  #p3 のDOM更新
    gauge.ts            93行  充足率ゲージ。#p3 と #p6 が共有する。帯ラベルは shortageTable から生成
    compareTasks.ts    183行  #p4 の4課題横断比較カード。事業部別バーは売上/利益の切替式
    compareHiring.ts    89行  #p5 の採用前後比較＋ROI表
    whatif.ts          118行  What-if分析（機能14）の純粋関数群。evaluateAssignment/validateParams/diffAssignment等。DOM非依存
    whatifController.ts 361行 #p6 の状態保持とイベント配線。①の取込結果は renderer.ts から getContext で参照する
    whatifPanel.ts     294行  #p6 のDOM更新。表示専用で計算を持たない
test/                          node:test。calcEngine / csv / optimizer / assignment.oracle / whatif / gauge / format の7ファイル・52テスト
  helpers/lpOracle.ts          assignment.oracle 用のHiGHS(MILP)ラッパー（テスト専用。src/からimportしない）
```

- ★＝ロジックの中核。仕様変更時はまずこの4ファイルを見る。
- `importPanel.ts` / `dashboard.ts` / `gauge.ts` / `compareTasks.ts` / `compareHiring.ts` / `whatifPanel.ts` は表示専用で計算を持たない（例外は §8 の単位換算）。
- 表示の重複を作らないこと。事業部名・色・億円表記・判定ピル・エスケープは `constants.ts` と `format.ts` に既にある。各モジュールで定義し直さない（v0.6のリファクタで一度解消済み・`docs/refactor-plan.md`）。
- What-if分析（機能14・製品カタログ未記載の追加機能）の設計・作業指示は `docs/whatif-plan.md`。`calcEngine.ts`/`optimizer.ts`の主要関数は`SimParams`（既定値`DEFAULT_PARAMS`）を末尾引数として受け取れる（式の形は変更していない）。`assignment.ts`はこのリファクタで無変更。

## 6. ドメイン定数（`constants.ts` に実装済み・再読不要）

| 事業部 | 特性 | 重み(営/管/開/育) | 基準売上 | 成長係数 | 適正 | 最低 |
|---|---|---|---|---|---|---|
| A | 飽和 | .45/.35/.10/.10 | 10億 | 0.06 | 40 | 30 |
| B | 成長 | .35/.20/.30/.15 | 7億 | 0.12 | 35 | 20 |
| C | 新規 | .20/.10/.50/.20 | 2億 | 0.25 | 25 | 10 |

- 貢献度 = Σ(能力値×重み)　事業部能力値 = Σ貢献度
- 基本売上 = 基準売上 ×(1 + 能力値/100 × 成長係数)　最終売上 = 基本売上 × 不足補正 × 過剰補正
- 充足率 = 配置人数/適正人数。不足補正は事業部別3表、過剰補正は全社共通1表（120%未満は1.00）
- コスト = Σ人件費 × 3 **÷100**（→§8）　利益 = 売上 − コスト
- 制約：全社売上 > 58億円（前年度実績）／各事業部が最低人数以上
- 課題1=全社売上最大 / 2=A利益最大 / 3=B売上最大 / 4=C売上最大

## 7. 確定済みの設計判断（**勝手に変えない**）

課題仕様に明記がなく、本プロジェクトで解釈を固定した事項。変更は仕様の再合意が必要。

1. **課題2〜4は辞書式目的関数**：primary＝目的指標、secondary＝全社売上。
   目的外を価値0で放置すると顔ぶれが無差別になり制約判定がブレるため。
   実装は `value = primary * 1e6 + secondary` の単一スカラー合成。
2. **境界の帰属**：不足補正は境界を上側に含める（rate=0.90 → 0.85帯）。過剰補正は下限含み上限含まず（rate=1.20 → 0.95帯）。
3. **丸め**：`ROUND_DIGITS = 2`、算出直後に `round2()`。ただし**最適化の価値関数は丸め前の生値**で解き、表示・制約判定は丸め後。
4. **採用後110名でも適正人数は100名基準を据え置く**（A:40/B:35/C:25）。過剰ペナルティ帯に入りやすくなるのは意図的。
5. **社員タイプ分類**は本アプリ独自の派生表示。同点時は 営業→管理→開拓→育成。
6. **決定性**：割当のタイブレークは社員を入力順・事業部をA→B→C順。同着候補は (nA昇順→nB昇順)。

## 8. 既知の罠

- **コストの単位換算**：人件費(1〜20)は百万円、売上は億円。`COST_UNIT_DIVISOR = 100` で換算する。
  忘れると全社利益が -2000億円級の赤字になる（実データで発生済み）。
  適用箇所は `calcEngine.unitCostTotal` / `optimizer.profitValue` / `compareHiring` のROI表の3つ。
  （`optimizer.profitValue` は事前計算した `EmployeeBase.cost`（生の人件費）を受け取り、除算はこの関数内で行う）
  **人件費に触るコードを書くときは必ずこの除算を通す。**
- **CSVヘッダは「社員番号」**（「社員ID」ではない）。`COLUMN_MAP` が単一の参照点。
- **CSV由来の文字列を innerHTML に埋めるときは必ず `format.escapeHtml`（属性なら `escapeAttr`）を通す。**
  社員番号と `ValidationError.actual` は利用者のCSVがそのまま入る。
  `テストケース/hire_test04_xss_script_injection.csv` は社員番号に `<script>` や `<img onerror>` を持つ。
  `contextIsolation: true` はレンダラー自身が innerHTML に書いたHTMLの実行までは防がない。
  検証済みの数値（能力値・人件費）と自前の定数は対象外。
- **CSV出力（`buildAssignmentCsv`）はフォーミュラインジェクション未対策。**
  `=1+1` や `@SUM(...)` で始まる社員番号がそのまま出力に載る（`hire_test03_csv_formula_injection.csv`）。
  入力パーサもクォート付きフィールド非対応（RFC4180非準拠）で、両者は同時に直す必要がある。
  対応可否は未合意のまま保留中（`docs/refactor-plan.md` B-6）。
- **最適化の速度は解決済み**：実データ4課題で**約1.2秒**（課題1 329ms / 2 112ms / 3 137ms / 4 573ms、110名の課題1 449ms）。
  `docs/pruning-plan.md` の branch-and-bound で約10秒から短縮済み。「10秒かかる」は枝刈り導入前の古い情報。
  `npm test` の18秒はアプリではなく `枝刈り…完全一致` テスト1本（**15.5秒**）が占める。基準実装 `bruteForceOptimize` が枝刈りなしで861候補×MCMFを回すため。
  CPUプロファイル内訳：`MinCostFlow.run` 60% / `upperBoundRawTotal` 11% / `buildValues` 10% / GC 6%。
  **pruning-plan.md の①貢献度の事前計算は実装済み**（`optimizer.buildEmployeeBases`）。**②UBのquickselect化は未実装**（`upperBoundRawTotal` は今も全ソート）。さらに縮めるならここ。
- **`--test-name-pattern` はマッチ0件でも exit 0**（§4 `test:one`）。1件も実行されていないのに成功に見える。
  出力の `✔ <テスト名>` で狙ったテストが実際に走ったことを毎回確認する。
  - パターンは**正規表現**。テスト名の**半角**括弧はエスケープが要る：`全探索\(5名` か `全探索.5名`。
    全角（）はメタ文字でないためそのままでよい（例：`境界は上側`）。
  - `--test-reporter=dot` は成功を `.` 1文字にするが、マッチ0件のときも `.` になり区別できないので使わない。
- **追加採用10名のCSVは入手済み**：`~/development/資料/テストケース/採用01_正常10名.csv`（E101〜E110、既存CSVと同一フォーマット）。
  取込・マージ・110名最適化（4課題）を実行して検証済み（2026-08-28）。100名側の4課題結果は本ファイルの実測値と完全一致、110名側も全課題 feasible。
  同フォルダには ID衝突・CSVインジェクション・XSS・ゼロコスト・5000名規模等の異常系CSV（`採用02〜07`）と、CSV形状の異常系（`形状01〜09`）・計算ロジックの極端ケース（`計算01〜10`）・基本的な入力不正（`基本01〜10`）も揃っており、#p5・バリデーションの堅牢性テストに使える。
  （ファイル名は2026-08-28に英語スラッグから日本語へ改名済み。旧 `hire_test*`→`採用*`、`hr_testcase*`→`基本*`、`hr_shape*`→`形状*`、`hr_calclogic*`→`計算*`。番号は据え置き。）

## 9. 作業規約

- **数式・定数・アルゴリズムの変更前に必ず確認を取る**。「動かすため」の独断の調整は不可。齟齬を見つけたら直す前に報告する。
- 変更後は `npm test`。計算ロジックを触ったら実データでの4課題の売上・利益も確認する。
  実データ：`/mnt/c/Users/pluser1/Desktop/本課題　必要資料/human_resources_100.csv`
- コメントは既存の `// 設計書§N: ...` 形式に合わせ、**なぜそうしたか**を書く。
- レンダラーに Node API を持ち込まない（`contextIsolation: true` / `nodeIntegration: false` を維持）。
- 一時スクリプトはプロジェクト直下に作って使用後に削除する（相対 import 解決のため `/tmp` 不可）。
- 実装状況・未決事項は本ファイルに書かず `README.md` を更新する。

## 10. 参照ドキュメント（必要時のみ開く）

`C:\Users\pluser1\Desktop\` 配下：

| ファイル | 開く場面 |
|---|---|
| `本課題　必要資料\人材配置による事業成長シミュレーション課題.md` | 課題原文。計算仕様の一次情報 |
| `本課題　必要資料\26夏IS_製品カタログ_吉田智哉.md` | 機能番号(機能1〜13)の定義 |
| `設計書_AI向け.md` | 型・数式・アルゴリズムの実装仕様。§番号でピンポイントに引く |
| `設計書_人間向け.md` | 要件・画面・受入基準 |
| `人材配置シミュレーター_UIモック_v2.html` | UIの正。見た目・クラス名の変更時 |
| `仕様理解度確認20問_回答.txt` | 曖昧仕様のチーム解釈。§7の判断根拠 |
