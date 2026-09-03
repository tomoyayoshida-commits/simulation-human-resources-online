# CLAUDE.md — 人材配置シミュレーター

> AIエージェント共通の作業規約。要約済み内容は元資料（`設計書_AI向け.md`等）を再読しない。

## 1. 応答スタイル
箇条書き・結論優先。前置き/言い換え/自明な補足は書かない。

## 2. 何を作っているか
100名（採用後110名）をA/B/C事業部へ配置し売上・利益を最適化するアプリ。Web(SPA)+TypeScript+Firebase。
社内限定公開のためFirebase Auth（Google認証・許可リスト）＋Firestore（永続化・履歴）を使い、外部通信あり。
**数理最適化ライブラリは不使用**（自前実装で十分高速）。
旧方針「Electron・外部通信なし」は2026-08-28に撤回（社内共有・履歴要件のため。`docs/web-firebase-plan.md`）。
Electron版`simulation-human-resources`から複製した専用リポジトリ。
制約は「全社売上>58億」「各事業部の最低人数」の2つのみ（変更は§9で再合意）。
評価対象は「配置結果」＋「配置方針とその理由」。

## 3. 開発環境
**作業ディレクトリはこのリポジトリ**（2026-09-02 以降）。セッション開始時にまずここへ移動する：
`\\wsl.localhost\Ubuntu\home\tomoyayoshida\development\simulation-human-resources-online`
`Desktop\8月28日B` および `Desktop\本課題　必要資料` は**参照資料の置き場**であり作業場所ではない（§10）。
PowerShellツールは呼び出しごとにcwdが`C:\Users\pluser1`へ戻るため、`Set-Location`に頼らず毎回明示的にcdする。

WSL2 Ubuntu。PowerShellから実行時は**ログインシェル経由必須**（node管理はfnm）：
`wsl -d Ubuntu -- bash -lic "cd ~/development/simulation-human-resources-online && npm test"`
（`bash -c`のみだと`node: command not found`。PowerShellは`2>/dev/null`をパス誤解するため使わない）

## 4. コマンド
| コマンド | 内容 |
|---|---|
| `npm run dev` | Vite起動・HMR（localhost:5173） |
| `npm run preview` | `dist/`を本番相当でローカル配信 |
| `npm test` | node:test全66件・約37秒 |
| `npm run test:one -- --test-name-pattern='<正規表現>' <file>` | 1件だけ実行。マッチ0件でもexit 0なので`✔`表示で確認必須（§8） |
| `npm run test:e2e` | Playwright移行待ちで無効 |
| `npm run snapshot` | 実データ4課題を`docs/baseline-snapshot.txt`と照合。`-- --write`で更新 |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b`→`vite build`。続けて`firebase deploy`まで実行する（§9） |

## 5. ディレクトリ構成（src/renderer/）
- ★=中核。仕様変更時はまずここ
- `renderer.ts`★ 結線層（状態・画面遷移・イベント配線）
- `constants.ts`★ 全定数（重み・売上・COLUMN_MAP・round2・DEFAULT_PARAMS等）
- `calcEngine.ts`★ 貢献度→能力値→売上→コスト→利益（純粋関数）
- `optimizer.ts`★ 人数配分の全列挙×割当。課題1〜4の目的関数・辞書式合成・solveForHeadcount
- `assignment.ts` 最小費用流(SSP+Johnson+Dijkstra)で内側割当を厳密解
- `types.ts` / `format.ts`（escapeHtml等）/ `dom.ts` / `csv.ts` / `validation.ts` / `reasonText.ts`
- `importPanel.ts` / `compareTasks.ts` / `compareHiring.ts` / `workbenchPanel.ts` — 表示専用（計算持たない）
- `whatif.ts` What-if(機能14)の純粋関数群。現在は本番からは呼ばれず`workbenchPanel.ts`が唯一の利用者
- `workbench.ts` 作業机(機能15)の純粋関数群（`docs/workbench-plan.md`）
- `firebase.ts` / `auth.ts` Firebase初期化・Google認証（Phase (c)）
- 画面パネルは `#p0`（トップ）／`#p4`（配置比較：`import`→`result`→`bench`の3ステップ）／`#p5`（採用判断：`import`→`result`の2ステップ）の3つのみ
- `test/` node:test 9ファイル93件。`helpers/lpOracle.ts`はHiGHSラッパー（テスト専用）。`e2e/run.mjs`は実行不可。`snapshot.ts`は別枠
- 表示の重複を作らない（事業部名・色・億円表記・エスケープ等は`constants.ts`/`format.ts`に集約済み）
- What-if設計は`docs/whatif-plan.md`。作業机設計は`docs/workbench-plan.md`。主要関数は`SimParams`を末尾引数で受け取れる（式は不変）

## 6. ドメイン定数（`constants.ts`に実装済み）
| 事業部 | 特性 | 重み(営/管/開/育) | 基準売上 | 成長係数 | 適正 | 最低 |
|---|---|---|---|---|---|---|
| A | 飽和 | .45/.35/.10/.10 | 10億 | 0.06 | 40 | 30 |
| B | 成長 | .35/.20/.30/.15 | 7億 | 0.12 | 35 | 20 |
| C | 新規 | .20/.10/.50/.20 | 2億 | 0.25 | 25 | 10 |

貢献度=Σ(能力値×重み)／事業部能力値=Σ貢献度／基本売上=基準売上×(1+能力値/100×成長係数)／最終売上=基本売上×不足補正×過剰補正
充足率=配置人数/適正人数（不足補正は事業部別3表・過剰補正は全社共通1表、120%未満は1.00）
コスト=Σ人件費×3÷100（§8）／利益=売上−コスト
課題1=全社売上最大／2=A利益最大／3=B売上最大／4=C売上最大

## 7. 確定済みの設計判断（勝手に変えない・変更は再合意）
1. 課題2〜4は辞書式目的関数：`value = primary*1e6 + secondary`（primary=目的指標, secondary=全社売上）
2. 境界の帰属：不足補正は上側含む（0.90→0.85帯）／過剰補正は下限含み上限含まず（1.20→0.95帯）
3. 丸め：`ROUND_DIGITS=2`。最適化の価値関数は丸め前の生値、表示・制約判定は丸め後
4. 採用後110名でも適正人数は100名基準を据え置く（過剰ペナルティに入りやすいのは意図的）
5. 社員タイプ分類は独自派生表示。同点時は営業→管理→開拓→育成
6. 決定性：タイブレークは社員=入力順、事業部=A→B→C順。同着候補は(nA昇順→nB昇順)

## 8. 既知の罠
- **コスト単位換算**：人件費(1〜20)は百万円、売上は億円。`COST_UNIT_DIVISOR=100`で換算。忘れると利益が-2000億円級に。適用箇所は`calcEngine.unitCostTotal`/`optimizer.profitValue`/`compareHiring`のROI表
- CSVヘッダは「社員番号」（`COLUMN_MAP`が単一参照点）
- CSV由来文字列をinnerHTMLに埋めるときは必ず`escapeHtml`/`escapeAttr`を通す（XSS混入CSVも取込は通し、表示側で無害化する方針）
- 社員番号は空と`= + - @`始まりを入力検証で弾く（空はキー衝突、数式始まりは取込事故として報告。`constants.FORMULA_TRIGGER`がCSV出力ガードと共有）
- CSV入出力はフォーミュラインジェクション対策・RFC4180準拠済み。`'`始まりもガード対象（片方だけ直すと非対称になり往復不可に戻るので対で扱う）
- 上界の並べ替えは候補ループ外に巻き上げ済み（`optimizer.buildValueOrders`）。例外は**利益がprimaryになる事業部**（コスト項がありeffに依存）。判定は`buildValues`の`isTarget`と同形＝課題1（targetUnit=null）は利益指標だと3事業部すべてが例外。総当たり比較テストではこの退行は検出できない（`upperBoundsForCandidates`のビット一致テストが唯一の守り）
- #p4はカードごとの「最適化：売上／利益」で(課題×指標)8通りから選ぶため、`runOptimization`等は第4引数`metric`で`TASK_SPEC`の指標を上書きできる。省略時は原文どおりで挙動不変。テストは8通り全部を総当たりと突き合わせる
- 最適化速度は解決済み：実データ4課題で約0.95秒、8通り先読みでも約1.6秒（枝刈り導入前は約10秒という情報は古い）。`npm test`の37秒は枝刈り無し基準実装のテスト1本(32秒・8通り)が占める。詳細`docs/pruning-plan.md`
- E2Eは画面が要る（WSL2はWSLg経由）。期待値は`docs/baseline-snapshot.txt`と紐づくため計算仕様変更時は要更新
- `--test-name-pattern`はマッチ0件でもexit 0。`✔`表示で実行確認必須。正規表現なので半角括弧はエスケープ要（全角は不要）
- 追加採用10名CSV入手済み：`~/development/資料/テストケース/採用01_正常10名.csv`。異常系CSV（採用02〜07・形状01〜09・計算01〜10・基本01〜10）も同フォルダにあり堅牢性テストに使える

## 9. 作業規約
- **Agentツール（サブエージェント委任）は使用禁止**。得られる見返りに対してコストが釣り合わない。調査・実装は自分（メインエージェント）で直接行う
- **数式・定数・アルゴリズムの変更前に必ず確認を取る**。齟齬を見つけたら直す前に報告
- **閲覧はGrep優先でトークンを節約する**。ファイル全体のReadは最後の手段。まず`Grep`で該当箇所を絞り、
  `Read`は`offset`/`limit`で必要な範囲だけ読む（`git diff --stat`・`wc -l`で当たりを付けてから開く）
- **必要な部分以外は書き換えない**。`Write`による全文上書きではなく`Edit`で最小限の差分を当てる。
  ついでの整形・リネーム・import並べ替え・コメント調整はしない（別セッションが同じツリーを編集するため衝突する）
- **`npm test`は毎回実行しなくてよい**。計算ロジック（`calcEngine.ts`/`optimizer.ts`/`assignment.ts`等）を触ったときだけ実行する。表示専用ファイル（§5の「表示専用」群）やドキュメントのみの変更では不要
- **計算ロジックを触ったら`npm run snapshot`**で差分確認。結果を変えるなら先に確認→`-- --write`で更新（実データ：`~/development/資料/human_resources_100.csv`）
- **Playwright・Chromium等を使った実ブラウザでの探査的動作確認は不要（実施禁止ではなく不要）**。本アプリはGoogle認証（許可ドメイン限定）でゲートされておりこの環境では実ログインできず、無理に用意した確認は形だけになる。動作確認は作業者（ユーザー）が本番URLで行うため、`tsc -b`・`npm test`・`npm run build`が通ることの確認に留める
- **作業者は本番環境で確認するため、上記確認が済んだら`npm run build`→`firebase deploy`まで実行して公開状態にする**（`dist/`を作るだけで止めない。ローカルの`npm run dev`/`preview`確認では代用しない）。デプロイ後は公開URLを伝える
- コメントは`// 設計書§N: ...`形式でなぜそうしたかを書く
- レンダラーにNode APIを持ち込まない
- 一時スクリプトはプロジェクト直下に作り使用後削除（`/tmp`不可）
- 実装状況・未決事項は本ファイルでなく`README.md`を更新

## 10. 参照ドキュメント（必要時のみ）
`C:\Users\pluser1\Desktop\`配下：課題原文（`本課題　必要資料\...課題.md`）／製品カタログ（機能1〜13定義）／`設計書_AI向け.md`（型・数式・アルゴリズム仕様）／`設計書_人間向け.md`（要件・受入基準）／UIモックhtml（見た目の正）／`仕様理解度確認20問_回答.txt`（§7の判断根拠）
