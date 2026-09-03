# 作業机（機能15）設計・検討書

> 4課題横断ダッシュボード（#p4 結果ステップ）で方針を決めたあと、
> **各人員の配置をドラッグ&ドロップで微調整する画面**の設計。
> 実装着手前の検討書。§8 の未決点はユーザー判断を待つ。

作成: 2026-09-02

---

## 1. 結論

**作れる。しかも新規に作る部分は少ない。** 理由は3つ。

1. **状態モデルと計算はすでに存在する。** `src/renderer/whatif.ts` に
   `WhatIfState`（assignment を唯一の真実とする状態）・`evaluateAssignment`（再評価）・
   `headcountOf`（人数配分の導出）・`diffAssignment`（基準との差分集計）が実装済みで、
   `test/whatif.test.ts` が守っている。**ただし v0.8.0（705e763）の画面再構成で `#p6`
   What-if パネルが撤去され、現在この4関数は本番コードから1つも呼ばれていない**
   （`validateParams` だけ `paramsOptions.ts` が使用）。作業机はこの既存資産の再利用でよい。
2. **1名動かすたびの再計算が軽い。** 描画に必要なのは
   `calcEngine.computeSimulationResult(assignment, roster, params)` の1回だけ
   （`docs/whatif-plan.md` §4.1 の実測で1ms未満）。ドラッグ中に最適化は一切走らせない。
3. **数式・定数・アルゴリズムを一切変更しない。** 作業机は既存の計算関数を別の入力で呼ぶだけ。
   `npm run snapshot` のハッシュが不変であることが実装ゲートになる（§6）。

新規に要るのは「D&Dの操作層」「盤面のDOM生成」「#p4 からの遷移」の3つ。
`optimizer.ts` / `assignment.ts` / `calcEngine.ts` / `constants.ts` は**変更しない**。

### 1.1 この機能の価値（何のために作るか）

4課題比較が答えるのは「**どの方針を採るか**」まで。作業机が答えるのはその先の
「**この人をここに置いていいのか**」。人事部長の実務判断（相性・育成・本人の希望など
モデルに入っていない要素）は最適解には反映されないので、**最適解を出発点に人手で寄せ、
そのコストが何億円かをその場で見せる**のが作業机の役割。

もう1つ、この画面でしか見えないものがある。**1名動かすと充足率が動き、補正係数の帯を
跨いだ瞬間に売上が段差で落ちる**（`SURPLUS_TABLE` は 120%/140%/160% が境界）。
「1名の異動で0.01億円」ではなく「1名の異動で1.5億円」が起きる点がどこかは、
カードを並べた比較画面では絶対に見えない。§4.4 の充足率メーターはこのために置く。

---

## 2. 調査済みの事実（再調査不要・2026-09-02 時点）

### 2.1 現在の画面構成

`src/renderer/index.html` にあるパネルは **`#p0`（トップ）・`#p4`（配置比較）・`#p5`（採用判断）の3つだけ**。
各フローは `${panelId}-import-step` →（ボタン押下で）`${panelId}-result-step` の2ステップで、
`renderer.ts:37 showStep()` が hidden 属性を付け替える。`go(id)` はパネル間の切替のみ。
パンくず（`renderer.ts:54 renderBreadcrumb`）は `FLOW_LABEL` と result ステップの表示状態から組み立てている。

### 2.2 再利用できる既存関数

| 関数 | 場所 | 作業机での用途 | 実測コスト |
|---|---|---|---|
| `computeSimulationResult(assignment, employees, params)` | `calcEngine.ts:118` | 1手ごとの再評価 | <1ms |
| `evaluateAssignment(state, baselineAssignment)` | `whatif.ts:37` | 上記＋最低人数違反＋基準との異動人数 | <1ms |
| `headcountOf(assignment, roster)` | `whatif.ts:24` | 人数配分の導出（状態として持たない） | <1ms |
| `diffAssignment(baseline, current)` | `whatif.ts:108` | 「A→C 3名」の異動サマリ | <1ms |
| `contribution(e, unit, params)` | `calcEngine.ts:15` | カードにA/B/C別の貢献度を出す | O(1) |
| `classifyType(e)` | `calcEngine.ts:165` | カードの型バッジ | O(1) |
| `solveForHeadcount(employees, task, counts, params, metric)` | `optimizer.ts:260` | 「この人数配分のまま最適に組み直す」 | 1.3ms |
| `buildAssignmentCsv(employees, result, params)` / `downloadCsv` | `csv.ts:232` / `csv.ts:253` | 調整後の配置を持ち帰る | — |
| `runOptimization(employees, task, params, metric)` | `optimizer.ts:278` | **作業机では呼ばない**（99〜1,175ms） | — |

> `buildAssignmentCsv` / `downloadCsv`（機能8）は実装済みだが、v0.8.0 の画面再構成以降
> **どのUIからも呼ばれていない**。作業机はこれを再び画面に載せる自然な置き場になる。

### 2.3 ドキュメントとの齟齬（要修正・実装とは別件）

`CLAUDE.md` §5 と `README.md` のディレクトリ構成が、**存在しないファイルを列挙している**。

| ドキュメント上の記載 | 実体 |
|---|---|
| `dashboard.ts` / `gauge.ts` | 無い（v0.8.0 で削除） |
| `whatifPanel.ts` / `whatifController.ts` | 無い（同上） |
| `#p1`〜`#p3` / `#p6` パネル | 無い（`#p0`・`#p4`・`#p5` のみ） |
| `types.ts:72` のコメント「whatifPanel.ts が表示する」 | 参照先が存在しない |
| `README.md`「全65件」／`CLAUDE.md`「全66件」 | 記載どうしが食い違っている |

作業机の実装で `CLAUDE.md` §5 を触ることになるので、そのとき**まとめて実体に合わせる**（§5 Phase 4）。
本書の設計判断はすべて実ファイルを読んで確認した内容に基づいており、上記記載には依存していない。

### 2.4 制約チェックの非対称（既存の設計判断・踏襲する）

`SimulationResult.feasible` は **全社売上 > `prevYearRevenue` しか見ない**（`calcEngine.ts:143`）。
最低人数制約は `optimizer.enumerateHeadcounts` が候補を弾く形でしか効いていないので、
手で組んだ配置では別途判定が要る。`whatif.evaluateAssignment` の `minHeadcountViolations` がそれ。
**手動配置では最低人数割れを禁止せず警告にとどめる**という判断は `docs/whatif-plan.md` §4.5 で
確定済み（理由：割ったらどうなるかを見ることも目的）。作業机もこれを踏襲する（§8-1 で再確認）。

---

## 3. スコープ

| | 対象 |
|---|---|
| やる | `#p4` に第3ステップ「作業机」を追加（§4.1） |
| やる | 3列（A/B/C）の盤面と社員カードのドラッグ&ドロップ（§4.3・§4.4） |
| やる | 1手ごとの再評価と、基準（＝遷移元カードの最適解）との Δ 表示（§4.5） |
| やる | 制約違反の警告表示（売上下限・最低人数の2種を区別して出す・§4.6） |
| やる | 補助操作：元に戻す／最適解に戻す／人数配分を保ったまま最適に組み直す／CSV出力（§4.7） |
| やる | `src/renderer/workbench.ts`（純粋関数）・`workbenchPanel.ts`（表示）・`test/workbench.test.ts` |
| やらない | **数式・定数・アルゴリズムの変更**（`calcEngine` / `optimizer` / `assignment` / `constants` は無変更） |
| やらない | 作業机からの再最適化（`runOptimization` の呼び出し）。方針の変更は #p4 に戻ってやる |
| やらない | Firestore への配置案の保存・共有（`docs/web-firebase-plan.md` の後続フェーズ） |
| やらない | 前提パラメータ（`SimParams`）の編集。#p4 の「オプション」で設定済みの値をそのまま引き継ぐ |
| やらない | `#p5`（採用判断）からの遷移。v1 は `#p4` からのみ |
| やらない | Desktop 配下の設計書・製品カタログの改訂（機能15はカタログ未記載。機能14と同じ扱い） |

---

## 4. 設計

### 4.1 遷移設計：`#p4` の第3ステップにする（別パネルにしない）

**推奨案**：`p4-import-step` → `p4-result-step` → **`p4-bench-step`** の3ステップ構成。

理由：作業机は「配置比較フローの続き」であって独立した入口ではない。既存の
`showStep(panelId, step)` とパンくずの仕組み（`renderer.ts:37`/`:54`）がそのまま使え、
`state.employees100` と `p4Params.getParams()` を再取得せずに引き継げる。
別パネル（`#p6` 等）にすると `go()` 経由になり、パンくずが「トップ ▸ 作業机」となって
どの課題から来たのか消える。

必要な変更は2箇所だけ。

```ts
// renderer.ts:37 — 2値から3値へ
type Step = 'import' | 'result' | 'bench'
function showStep(panelId: string, step: Step): void {
  for (const s of ['import', 'result', 'bench'] as const) {
    $(`${panelId}-${s}-step`)?.toggleAttribute('hidden', s !== step)
  }
  renderBreadcrumb(panelId)
}
```

パンくずは「トップ ▸ データ取込 ▸ 配置比較 ▸ 作業机」。`配置比較` をクリックで結果ステップに戻る。
`renderBreadcrumb` は現在 `resultVisible` の真偽2分岐なので、表示中のステップを見る形に直す。

**遷移の入口**：`#p4` の各カード下部に「この配置を作業机で調整する ▶」ボタンを1つ置く。
カードは `compareTasks.ts:191 card()` が innerHTML で作り直すため、ボタンのクリックは
既存の `data-cmp-metric` と同じく **`#compare-tasks-grid` への委譲リスナ**で拾う
（`compareTasks.ts:310` と同じ方式）。実行不能カード（`infeasibleCard`）にはボタンを出さない
（持ち込む配置が無いため）。

**引き渡す情報**（遷移元カードの文脈をすべて持っていく）:

| 項目 | 取得元 |
|---|---|
| `roster: Employee[]` | `state.employees100` |
| `params: SimParams` | `p4Params.getParams()` |
| `task: TaskId` | 押されたカードの課題 |
| `metric: TaskMetric` | そのカードで選択中の最適化指標（`view.metrics[task]`） |
| `baseline: SimulationResult` | そのカードが表示している最適解（`view.all[task][metric]`） |

### 4.2 状態モデル：`assignment` が唯一の真実（機能14の設計をそのまま踏襲）

```ts
// workbench.ts
export interface WorkbenchState {
  task: TaskId
  metric: TaskMetric
  roster: Employee[]
  params: SimParams
  assignment: Record<string, UnitId>   // ← 唯一の可変状態
  baseline: SimulationResult           // 遷移元カードの最適解（不変）
  history: Record<string, UnitId>[]    // 元に戻す用（上限50手）
}
```

**人数配分は状態として持たない。** `headcountOf(assignment, roster)` で毎回導出する
（`docs/whatif-plan.md` §4.1 と同じ理由：2つ持つと必ず食い違う）。
D&D は `assignment[id] = unit` の1行を書き換えるだけの操作になる。

`WhatIfState` との差は `metric` / `baseline` / `history` の3フィールド。
**`whatif.ts` の `WhatIfState` は変更せず、`WorkbenchState` を新設して
`evaluateAssignment` には `{ task, roster, params, assignment }` を渡す**
（`WhatIfState` は構造的部分型として満たされる）。既存テストを壊さないため。

### 4.3 画面構成

単一カラムの縦スクロール（既存パネルの慣習）。上から4段。

```
┌ ① ヘッダ ─────────────────────────────────────────┐
│ 作業机：課題3（B事業部売上最大化）の配置を調整   [← 比較に戻る] │
│ 全社売上 60.10億 (Δ 0.00)  B売上 32.33億 (Δ 0.00)  異動 0名     │
│ ● 制約を満たす                                                  │
└──────────────────────────────────────────────────┘
┌ ② 事業部ヘッダ（3列・盤面の上に固定）───────────────┐
│  A 41名 充足率102.5%          B 49名 140.0% ⚠     C 10名 40.0% ⚠│
│  [====|====]                  [========|=]        [==|      ]   │
│  売上25.14 (Δ0.00)            売上32.33 (Δ0.00)   売上2.62(Δ0.00)│
└──────────────────────────────────────────────────┘
┌ ③ 盤面（3列・D&Dの本体・列内はスクロール）─────────┐
│ [E001 営業型 貢/A 78.4]      [E014 ...]           [E077 ...]    │
│ [E002 管理型 貢/A 71.2]      ...                  ...           │
└──────────────────────────────────────────────────┘
┌ ④ 操作列 ────────────────────────────────────────┐
│ [元に戻す] [最適解に戻す] [この人数配分のまま最適に組み直す] [CSV出力] │
│ 異動の内訳：A→C 3名 ／ B→A 1名                                  │
└──────────────────────────────────────────────────┘
```

**社員カードに載せる情報**（1枚あたり4項目まで。多いと100枚並べたとき読めない）:

- 社員番号（`escapeHtml` 必須。CSV由来文字列・`CLAUDE.md` §8）
- 型バッジ（`classifyType`）
- **現在の所属事業部での貢献度**（大きく表示）
- **移動先2事業部での貢献度**（小さく併記）← これが作業机の主役

3つ目・4つ目が要点。「E014 を A に置くと 78.4、C に置くと 41.2」が各カードに出ていれば、
**どれを動かすと効くかがドラッグする前に分かる**。`contribution` は O(1) なので
100名 × 3事業部 = 300回を初回に1度だけ計算してカードに焼き込めばよい（再計算不要。
貢献度は所属に依存せず `(社員, 事業部, params)` だけで決まる）。

**並び順**：既定は「社員番号順」（CSVと同じ順で探しやすい・§8-3）。ソート切替
（社員番号順／型別／人件費順／現在の所属事業部での貢献度の降順）はセレクタ1つで足す。

### 4.4 ドラッグ&ドロップの実装方式

**HTML5 Drag and Drop API（`draggable` 属性＋`dragstart`/`dragover`/`drop`）を使う。**
外部ライブラリは入れない（CSP `default-src 'none'; script-src 'self'`、および
`CLAUDE.md` §2「数理最適化ライブラリは不使用」と同じくブラウザ標準API完結の方針）。

```ts
// カード側（列の innerHTML 生成時に draggable="true" と data-emp="<id>" を付与）
// 列側（3列に1つずつリスナ。カード100枚に個別のリスナは張らない）
col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-hover') })
col.addEventListener('drop', (e) => {
  e.preventDefault()
  const id = e.dataTransfer?.getData('text/plain')
  if (id) moveEmployee(id, col.dataset.unit as UnitId)
})
```

**カード側のリスナも列への委譲で張る**（`dragstart` は bubble するため列で拾える）。
100枚それぞれに addEventListener しない — 並べ替え・再描画のたびに張り直しになるため。

**クリック操作のフォールバックを必ず同時に用意する。**
「カードをクリックで選択 → 移動先の列ヘッダをクリックで移動」。理由は3つ:

1. HTML5 D&D は**タッチデバイスで動かない**（`touchstart` が dragstart を起こさない）
2. キーボード操作の経路が D&D だけでは無い（社内ツールでも操作不能な人が出る）
3. 100枚から1枚を掴む操作は、細かい調整では**クリック2回のほうが速い**

D&D はクリック操作の上に乗せる糖衣であって、唯一の経路にはしない。

**ドラッグ中のプレビュー**：`dragenter` で移動先列に「この1名を動かすと全社売上 −1.52億」を出す。
仮の assignment を作って `computeSimulationResult` を1回呼ぶだけ（<1ms）。
`dragover` は毎フレーム発火するので**ここでは計算しない**（`dragenter`/`dragleave` のみ）。

### 4.5 再計算のタイミングと Δ 表示

| 契機 | 処理 | コスト |
|---|---|---|
| `drop`（1名確定） | `evaluateAssignment` → 全域再描画 | <1ms |
| `dragenter`（プレビュー） | `computeSimulationResult` のみ・数値1つ更新 | <1ms |
| 「人数配分のまま組み直す」 | `solveForHeadcount` → `evaluateAssignment` | 約1.3ms |
| **再最適化** | **作業机では発生しない** | — |

**表示するすべての数値に基準との Δ を併記する**（`docs/whatif-plan.md` §4.2 の歯止めを踏襲）。
基準は §4.1 で受け取った `baseline`＝遷移元カードの最適解で、**作業机の操作では動かさない**。
Δ が負なら赤、正なら緑。作業机は最適解より良くはならないのが普通なので、
「どれだけ譲ったか」が主要な読み値になる。

> 例外：目的指標そのものは最適解が上限だが、**目的指標以外**（全社利益や他事業部の売上）は
> 手で動かせば上がりうる。だから Δ は全指標に出す価値がある。「B売上を0.3億諦めると
> C売上が1.1億増える」がこの画面で読めるようにする。

### 4.6 制約違反の扱い

**2種類を区別して出す**（`SimulationResult.feasible` は売上下限しか見ない・§2.4）。

| 違反 | 判定 | 表示 | ブロックするか |
|---|---|---|---|
| 全社売上 ≤ `params.prevYearRevenue` | `!result.feasible` | ヘッダに赤ピル「● 全社売上58億円を下回る（現在 57.82億）」 | **しない**（§8-1） |
| 事業部人数 < `params.minHeadcount[u]` | `minHeadcountViolations` | 該当列のヘッダを赤枠＋「最低30名（現在28名）」 | **しない**（§8-1） |

`whatif-plan.md` §4.5 の判断を踏襲し、警告にとどめる（ドロップは拒否しない）。ただし作業机は
「提出する配置案を作る場」でもあるため、**制約違反がある間は CSV 出力ボタンを `disabled` にする**（§8-2）。
また、feasible → infeasible に変わった操作の直後には警告アラートを出す（§8-1）。

自動最適化では最低人数が hard constraint のままである非対称は意図的なので、画面に一言明記する。

### 4.7 補助操作（④の操作列）

| ボタン | 動作 | 意味 |
|---|---|---|
| 元に戻す | `history.pop()` で1手戻す（上限50手） | D&D は誤操作が起きやすい。必須 |
| 最適解に戻す | `assignment = { ...baseline.assignment }`、`history` を空に | いつでも出発点に帰れる保証 |
| **この人数配分のまま最適に組み直す** | `solveForHeadcount(roster, task, headcountOf(assignment), params, metric)` | §4.7.1 |
| CSV出力 | `downloadCsv(名前, buildAssignmentCsv(roster, 現在の result, params))`。制約違反中は `disabled`（§8-2） | 機能8の再利用 |

#### 4.7.1 「人数配分のまま組み直す」が効く理由

作業机の操作は2種類に分かれる。

- **人数の形を決める**（A を1名減らして C を1名増やす）＝ 充足率と補正係数が動く判断
- **誰を置くかを決める**（A の中で E014 と E052 を入れ替える）＝ 貢献度の割当だけの話

後者は人間がやると必ず最適解に負ける（内側の割当は最小費用流で厳密に解けるため）。
**「人数の形は人が決め、中身の詰めはソルバに任せる」**という分業がこのボタン。
1.3ms なので押した瞬間に返る。手で動かした結果との差額がそのまま「手作業のコスト」になる。

### 4.8 新規ファイルと責務

| ファイル | 責務 | 行数目安 |
|---|---|---|
| `src/renderer/workbench.ts` | 純粋関数のみ。`WorkbenchState` 型、`moveEmployee`（新しい assignment を返す）、`previewMove`（仮移動の評価）、`sortCards`、カード表示用データの組み立て | 120 |
| `src/renderer/workbenchPanel.ts` | 表示専用。盤面・列ヘッダ・カードのHTML生成と再描画。**計算を書かない**（`CLAUDE.md` §5） | 200 |
| `src/renderer/workbenchController.ts` | `WorkbenchState` の保持、D&D／クリックのイベント配線、`#p4` からの起動 | 150 |
| `test/workbench.test.ts` | `workbench.ts` の純粋関数の単体テスト | 100 |

`renderer.ts` への追加は「`showStep` の3値化」「パンくずの3段化」「起動関数の呼び出し1行」のみ。
`index.html` に `#p4-bench-step` の骨格を追加。`styles.css` に盤面の3列グリッドとカードのスタイル。

> **注意**：`styles.css` と `compareTasks.ts` は 2026-09-02 18時台に別セッションが編集中で未コミット。
> 着手前に `git status --short` を確認し、コンフリクトする場合は先にそちらの完了を待つこと。

---

## 5. 実装手順

各 Phase の末尾がゲート。通らなければ次に進まない。

### Phase 0：着手前の確認（ゲート：ハッシュ取得とgit状態の確認）

1. `git status --short` で別セッションの未コミット変更を確認
2. `npm test` と `npm run snapshot` を実行し、**着手前のハッシュを記録**
3. §8 の未決点についてユーザーの判断を得る（**この確認前に実装を始めない**）

### Phase 1：`workbench.ts`（ゲート：`npm test` 通過・UIなし）

`WorkbenchState` 型と純粋関数のみ。`test/workbench.test.ts` を同時に書く。
- `moveEmployee` が新しいオブジェクトを返す（元を破壊しない）こと
- 存在しない社員IDでは状態が変わらないこと
- `previewMove` の結果が「実際に動かしてから `computeSimulationResult`」と一致すること
- 最低人数を割る移動で `minHeadcountViolations` に該当事業部が出ること

### Phase 2：遷移とステップ骨格（ゲート：`npm run dev` で往復できる）

`showStep` の3値化、パンくずの3段化、`#p4` カードへのボタン追加（委譲リスナ）、
`#p4-bench-step` の空の骨格。この時点で「比較 → 作業机 → 比較」を往復できること。
**`compareTasks.ts` の既存の再描画とボタン委譲を壊していないこと**を手で確認する。

### Phase 3：盤面と D&D（ゲート：`npm run dev` で手動確認）

`workbenchPanel.ts` / `workbenchController.ts`。クリック操作を先に作り、
**動いてから D&D を上に乗せる**（順序を逆にすると、フォールバックが後回しになって
結局入らない）。§4.6 の警告表示、§4.7 の4ボタンまで含める。

### Phase 4：仕上げ（ゲート：全ゲート再走＋ドキュメント）

1. `npm test` / `npm run lint` / `npm run snapshot`（**Phase 0 のハッシュと完全一致**）
2. `npm run build` → `firebase deploy` まで実行して公開状態にする（`CLAUDE.md` §9）
3. `README.md` の実装状況に「手順11: 作業机（機能15）」を追加
4. `CLAUDE.md` §5 のディレクトリ構成を**実体に合わせて修正**（§2.3 の齟齬をここで解消。
   存在しない `dashboard.ts` / `gauge.ts` / `whatifPanel.ts` / `whatifController.ts` の行を削除し、
   パネル構成を `#p0`/`#p4`/`#p5` + 作業机ステップに直す。テスト件数も実数に揃える）
5. `types.ts:72` のコメントの参照先（`whatifPanel.ts`）を直す

---

## 6. 受入基準

1. `npm test` 全通過・`npm run lint` クリーン
2. **`npm run snapshot` のハッシュが着手前と完全一致**（数式・定数・アルゴリズムに触れていない証明）
3. `git diff` に `calcEngine.ts` / `optimizer.ts` / `assignment.ts` / `constants.ts` の変更が**含まれない**
4. #p4 の各カードから作業机へ入り、比較画面へ戻れる。パンくずが3段で出る
5. 作業机を開いた直後、**全指標の Δ がすべて 0.00**（遷移元カードの最適解と完全一致）
6. 1名を D&D で動かすと、全社売上・事業部売上・充足率・人数がすべて即座に更新される（体感の引っかかりなし）
7. 同じ移動を**クリック操作**（カード選択 → 列ヘッダ）でも実行でき、結果が D&D と一致する
8. C事業部を9名まで減らすと、売上下限とは別に最低人数の警告が列ヘッダに出る
9. 全社売上が58億を下回る配置を作ると、ヘッダに赤ピルが出る（操作はブロックされない）
10. 「最適解に戻す」で Δ が全項目 0.00 に戻る
11. 手で崩した配置に「この人数配分のまま最適に組み直す」を押すと、目的指標が改善するか同値になる（悪化しない）
12. CSV出力したファイルを #p4 の取込に戻すと、社員データとして往復できる（`csv.ts` の既存往復互換）
13. 社員番号に `<script>` を含むCSVを取り込んでも、カードに生のHTMLが混入しない（`escapeHtml`）

---

## 7. やってはいけないこと

- **`calcEngine.ts` / `optimizer.ts` / `assignment.ts` / `constants.ts` を変更すること。**
  作業机は既存の計算関数を別の入力で呼ぶだけ。式・定数・アルゴリズムに触る理由が1つも無い
  （`CLAUDE.md` §9：変更前に必ず確認を取る）
- **作業机から `runOptimization` を呼ぶこと。** 最悪1.2秒UIが固まる。方針の変更は #p4 に戻ってやる
- **`dragover` の中で計算すること。** 毎フレーム発火する。プレビューは `dragenter` のみ
- **人数配分を独立した状態として持つこと。** `assignment` から毎回導出する（§4.2）
- **`workbenchPanel.ts` に計算を書くこと。** 表示専用（`CLAUDE.md` §5）
- **D&D だけを唯一の操作経路にすること。** クリック操作を必ず併設する（§4.4）
- **社員番号を無エスケープで innerHTML に埋めること**（`CLAUDE.md` §8。過去に実際に混入した）
- **`baseline` を作業机の操作で上書きすること。** Δ の基準が動くと画面が意味を失う
- **外部ライブラリ（D&Dライブラリ等）を追加すること。** CSP とブラウザ標準API完結の方針に反する
- **Desktop 配下の設計書・製品カタログを編集すること**（機能14と同じくユーザー判断の領域）

---

## 8. 未決事項（2026-09-03 ユーザー判断済み・確定）

### 8-1. 制約違反の配置を作れるようにするか → **許容。ドロップは拒否しない。警告アラートを出す**

推奨案（警告のみで踏襲）を採用。ドロップ拒否（対案）はしない。§4.6 の赤ピル／赤枠表示に加えて、
**違反が新たに発生した瞬間（drop確定時）に警告アラート（トースト/バナーなど画面内の明示的な警告表示）を出す**
ことを明記する。既存の「ヘッダに赤ピル」「列ヘッダ赤枠」は常時表示の状態表示、それとは別に
**状態が feasible → infeasible に変わった操作の直後に一過性の警告を出す**のがここでの追加要件。
モーダルで操作を止める（ブロッキング alert()）ことはしない——D&D/クリックのその後の操作を妨げない形にする。

### 8-2. 制約違反のままCSV出力できるようにするか → **対案1を採用：させない**

推奨案（確認ダイアログを挟んで出力は可能）ではなく、**対案1：違反時はCSV出力ボタンを `disabled` にする**。
確認ダイアログは実装しない。ボタンには理由が分かるテキスト（`title` 属性または直下に赤字で
「制約違反があるため出力できません」等）を添える。

### 8-3. 100枚のカードの既定の並び順 → **対案を採用：社員番号順**

推奨案（貢献度降順）ではなく**対案：社員番号順**（CSVと同じ順で探しやすい）を既定にする。
ソート切替セレクタ（社員番号順／型別／人件費順／貢献度順）は §4.3 のとおり用意し、
そこに「貢献度順」も選択肢として残す。

### 8-4. 調整した配置案を保存・共有できるようにするか → **v1はCSV出力のみ。ただし将来の保存機能を見越した余裕のある作りにする**

Firestore 保存の実装は引き続きスコープ外（v1では作らない）。ただし、
**後続フェーズで保存機能を足すときに書き直しにならないよう、設計段階で拡張点を用意しておく**。
具体的には：

- `WorkbenchState` の `assignment` はそのままシリアライズ可能な形（`Record<string, UnitId>`）に保つ
  （既にそうなっている＝変更不要。JSON化してFirestoreドキュメントにそのまま入れられる）
- `workbench.ts` に「現在の作業机状態をプレーンオブジェクトとして取り出す」ための
  エクスポート関数（例：`serializeWorkbenchState(state): WorkbenchExport`）を用意し、
  UI側の保存ボタン実装時に呼ぶだけで済む形にしておく。**永続化そのもの（Firestore書き込み）は実装しない**。
  `WorkbenchExport` は `{ task, metric, assignment, updatedAt }` 程度の最小形で定義する。
- ④操作列に「保存」ボタンの**置き場だけ**は空けておかない（v1でCSV出力ボタンの隣に未実装の
  保存ボタンを出すと誤操作を招くため、ボタン自体は追加しない）。関数だけ用意して、
  呼び出し側（ボタン）は後続フェーズで追加する。

### 8-5. `#p5`（採用判断）からも作業机に入れるようにするか → **将来対応。v1では未着手**

方向性としては将来 `#p5` からも入れるようにしたいが、**「処理自体が変わってくると思われる」**
（110名・採用前後比較という文脈が `#p4` の4課題比較とは異なるため、遷移時に渡す情報や
baseline の定義が単純な流用にならない見込み）という認識のもと、**v1では実装しない**。
`#p4` からの起動経路のみを実装する。§4.1 の「引き渡す情報」テーブルは `#p4` 前提のまま。

### 8-6. 「作業机」という機能名の扱い → **推奨どおり：カタログ改訂ナシ**

機能14（What-if）と同じ扱い。製品カタログ（Desktop配下）は一切編集しない。

---

## 9. 申し送り

- **2026-09-03：§8 の判断を得た。実装フェーズに移る。**
- `whatif.ts` の4関数（`headcountOf` / `evaluateAssignment` / `diffAssignment` / `WhatIfState`）は
  現在テストからしか呼ばれていない。作業机が本番の唯一の利用者になるので、
  **実装時にこの4関数の仕様を勝手に変えない**（変えるとテストが守っている意味が消える）。
- `docs/whatif-plan.md` は撤去された `#p6` を前提にした記述を含むが、**設計判断（§4.1 状態モデル、
  §4.2 Δ併記、§4.5 制約の扱い）は生きている**。本書はそれを引き継いでいる。
- 別セッションが同じツリーを触っている。`Edit` が「ファイルが変更されている」で失敗したら読み直すこと。
