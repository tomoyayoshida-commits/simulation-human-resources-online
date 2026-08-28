# 侍の人材配置

100名（採用後110名）の社員を A/B/C 事業部に配置し、売上・利益を最適化するデスクトップアプリ。
Electron + TypeScript（レンダラーはブラウザ標準APIのみ）で実装する。外部API・ネットワーク通信は行わない。

設計書:
- `設計書_AI向け.md` … 型・数式・アルゴリズムの実装仕様
- `設計書_人間向け.md` … 要件・画面・前提の概要

## 開発コマンド

```bash
npm install       # 依存インストール
npm run dev       # Vite dev サーバ + Electron ウィンドウ起動
npm run build     # tsc 型チェック → vite build → electron-builder でパッケージング
npm run preview   # ビルド済みレンダラーのプレビュー
npm test          # node:test による単体テスト（52件）
npm run test:e2e  # Electron実機で dist/ を操作する結線テスト（21項目・要画面）
npm run snapshot  # 実データ4課題の結果が変わっていないかを基準ファイルと照合
npm run lint      # oxlint
```

## ディレクトリ構成（設計書§1）

```
src/
  main/
    main.ts        Electron エントリ。BrowserWindow 生成のみ
  renderer/
    index.html     モックの HTML 骨格（#p0〜#p5 パネル、.topbar 等）
    styles.css     モックのスタイル
    renderer.ts    画面初期化・遷移（go(id)）・イベントバインド
    （以降、後続手順で追加）
    types.ts / constants.ts        型・事業部別定数・表示定数（§2）
    format.ts / dom.ts             文字列整形（エスケープ含む）・DOMヘルパ
    csv.ts / validation.ts         CSV入出力・入力検証（§3,§7,§8）
    calcEngine.ts                  貢献度〜利益の計算（§4）
    assignment.ts / optimizer.ts   割当（min-cost flow）・最適化（§5）
    reasonText.ts                  配置方針テキスト生成（§9）
    importPanel.ts                 #p1/#p5 の取込UIと検証レポート（§10）
    dashboard.ts / gauge.ts / compareTasks.ts / compareHiring.ts  DOM更新（§10）
    whatif.ts / whatifController.ts / whatifPanel.ts  What-if分析（機能14）の計算・状態・DOM更新
```

## 実装状況

- [x] 手順0: Electron 雛形・モックの HTML/CSS 移植・ビルド設定（`npm run dev` で起動可能）
- [x] 手順1: データ取込・入力バリデーション（機能1, 13）… `csv.ts` / `validation.ts`
- [x] 手順2: 計算エンジン（機能2, 3）… `calcEngine.ts`
- [x] 手順3: 最適化エンジン＋制約チェック・実行不能原因表示（機能4, 5, 12）… `optimizer.ts` / `assignment.ts`
- [x] 手順4: 結果ダッシュボード（機能6, 10, 11）… `dashboard.ts` / `reasonText.ts`
- [x] 手順5: 4課題横断比較（機能9）… `compareTasks.ts`
- [x] 手順6: 採用前後比較（機能7）… `compareHiring.ts`
- [x] 手順7: CSV出力（機能8）… `csv.ts`
- [x] 手順8: electron-builder による Windows パッケージング（`npm run build`）
- [x] 手順9: What-if分析（機能14・製品カタログ未記載の追加機能。docs/whatif-plan.md）… `whatif.ts` / `whatifPanel.ts` / `#p6`
- [x] 手順10: 表示層のリファクタリング（v0.6・docs/refactor-plan.md）… 重複定義の集約と `renderer.ts` の分割

テストは `npm test`（Node 標準 `node:test` ＋型ストリップ、設計書§11 準拠）。全52件。
単体テストは純粋関数までしか触れないため、取込UI〜状態〜描画の配線は `npm run test:e2e`
（Electron実機で `dist/` を読み込み、CSVのdropを合成して①〜⑥を操作する21項目）で担保する。

## Windows 配布

WSL2 には wine が無いため、`package.json` の `build.win` は `zip` ターゲット＋`signAndEditExecutable: false`（PEリソース編集・署名をスキップ）で構成。`npx electron-builder --win zip` で `release/侍の人材配置-<version>-win.zip` を生成する。

- **zip はフォルダごと一括で展開する。** exe は同一フォルダの DLL 群・`resources/app.asar`・`locales/` を相対参照するため、ファイルを別々の場所（Local と Resources 等）に分けて展開すると、白ウィンドウのまま即クラッシュ・起動が異常に重い・2回目以降起動しない等の症状になる。
- 環境依存の GPU 初期化失敗を避けるため、`main.ts` で `app.disableHardwareAcceleration()` を有効化（静的UIのため描画性能への影響なし）。
- 起動時の JS 例外・レンダラークラッシュは `%APPDATA%/simulation-human-resources/startup-error.log` に記録される。
- 未署名のため初回起動時に SmartScreen 警告が出る場合がある（動作には支障なし）。NSIS インストーラは wine 必須のため未対応。

## 解決済み事項

- **CSVカラムの実体**：`human_resources_100.csv` 入手済み。実ヘッダは `社員番号,営業力,管理力,開拓力,育成力,人件費`。`constants.ts` の `COLUMN_MAP.id` に `'社員番号'` を追加（primary）し確定。
- **コスト／利益の単位**：実データで検証した結果、人件費(1〜20)を売上と同じ「億円」とみなすと桁が2つずれ（コスト合計が売上の数十倍）、全社利益が常に大幅な赤字になる不整合が判明。人件費は「百万円」単位とみなし、コスト計算時に `COST_UNIT_DIVISOR = 100` で億円へ換算するよう `calcEngine.ts`（`unitCostTotal`）・`optimizer.ts`（`profitValue`）を修正済み。
- **最適化の枝刈り（`optimizer.ts`・`docs/pruning-plan.md`）**：4課題比較の体感速度改善のため、人数配分の候補ごとに割当(MCMF)を解く前に上界(緩和問題の最適値)を計算し、UB降順で処理・打ち切りする branch-and-bound を導入。導入時に「丸め前raw値と丸め後実測値のスケール不一致」による誤答（実際に最適でない候補を選ぶ／`closestCandidate`の同点タイブレークが反復順に依存する）をランダム110名データの検証で検出し、候補固有の定数項（`shiftConstant`）を上界に加算する形で修正。再発防止として `test/optimizer.test.ts` に総当たり実装との完全一致を検証する回帰テストを追加（該当シードを固定）。実データ4課題では旧実装比で体感数秒〜1桁ms台まで短縮を確認（ケースにより不可行判定のフォールバックが全候補走査になるため短縮幅は課題依存）。
- **割当(MCMF)の独立検証（`docs/solver-oracle-plan.md`）**：`assignment.ts`（自前MCMF実装）を守るテストが5名規模の1件しかなかったため、テスト専用依存として `highs`（HiGHSのWASM版、devDependency）を追加し、`test/assignment.oracle.test.ts` で完全単模な輸送問題としてMILP定式化した独立実装と目的関数値を比較する回帰テストを追加（`test/helpers/lpOracle.ts`）。本番コード（`src/`）には数理最適化ライブラリを一切importしていない（設計書_AI向け.md の制約を維持）。実データ4課題の結果に変化なし。
- **追加採用10名データ**：`~/development/資料/テストケース/採用01_正常10名.csv`（旧 `hire_test01_simple_normal.csv`。E101〜E110、既存100名データと同一フォーマット）を入手・検証済み（2026-08-28）。取込・マージ・110名での4課題最適化を実行し、100名側の結果が既存の実測値と完全一致すること、110名側も全課題 feasible であることを確認。#p5 採用前後比較の実データ検証が可能になった。

- **表示層のリファクタリング（v0.6・`docs/refactor-plan.md`）**：事業部名・色・億円表記・判定ピル・DOM取得・ゲージ描画が
  表示モジュールごとに重複定義されていたため、`constants.ts` / `format.ts` / `dom.ts` / `gauge.ts` に集約。
  573行あった `renderer.ts` を `importPanel.ts`（取込UI）・`whatifController.ts`（#p6の状態と配線）へ分割し170行にした。
  同時に3件の不具合を修正：①#p3 と #p6 でゲージのマーカー位置の式が違い、充足率1.4で10.7ポイントずれていた
  （`SURPLUS_TABLE` の1.6と対応が取れる #p3 側に統一）。②前提パラメータのエラーを直しても「再最適化」ボタンが
  無効のまま復帰しなかった。③CSV由来の社員番号を無エスケープで innerHTML に埋めていた。
  全工程で実データ4課題の結果ハッシュ（`docs/baseline-snapshot.txt`）が不変であることを確認している。

## 決着済み（旧・未決事項）

- **丸め桁数 `ROUND_DIGITS`**：小数第2位で確定（暫定運用を終了）。`constants.ts` のコメントも確定表記に更新済み。
- **CSV入出力のRFC4180準拠とフォーミュラインジェクション対策（`docs/refactor-plan.md` B-6）**：対応済み。
  `csv.ts` にRFC4180準拠のパーサ（`parseCsv`。クォート内のカンマ・改行・`""`エスケープに対応）を実装し、
  `=`/`+`/`-`/`@` 始まりの値は出力時に `'` を前置して数式評価を防止（`escapeCsvField`）、
  再取込時に前置した `'` を除去して元の値に戻す（`stripFormulaGuard`）ことで入出力の往復互換を維持。
  `採用03_CSV数式インジェクション.csv`（旧 `hire_test03`）で検証済み。`test/csv.test.ts` に回帰テストを追加。
- **社員番号の入力検証**：上記のRFC4180対応により `=1+1` 等が「正当な社員番号」として取込可能になっていたため、
  空の社員番号と `= + - @` 始まりの社員番号を入力検証で弾くようにした（`validation.ts`）。
  空は `assignment` のキー衝突で配置が壊れる実害があり、従来は重複チェックすら素通りしていた。
  数式始まりは取込事故として報告する方針（HTMLに見えるIDは弾かず、表示側のエスケープで無害化する）。
  併せてCSVガードを可逆にし、`'` 始まりの値が往復で欠けないようにした。
