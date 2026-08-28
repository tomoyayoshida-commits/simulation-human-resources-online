# What-if 分析機能（機能14）設計・作業指示書

> **定数のパラメータ化を伴う横断リファクタを含む（CLAUDE.md §9 で事前確認必須）**ため、実装前の合意用として書く。
> 本書は調査済み・実測済みの事実を含む。**§2 は再調査しないこと**（コード確認と実測で確定済み）。
> 対象：Sonnet セッション。本書を上から順に実施する。

## 1. 結論

**What-if 専用パネル `#p6` を1枚追加し、4つの軸すべてを1画面で扱う。**

| 軸 | 何を変えるか | 実現手段 | 応答時間（実測） |
|---|---|---|---|
| 1 | 人数配分 nA/nB/nC を手動指定 | 内側の割当(MCMF)だけ解き直す | **1.3ms** → スライダー同期で即時 |
| 2 | 個別社員の異動 | 割当を直接書き換えて再集計するだけ（MCMF不要） | **1ms未満** → クリック同期で即時 |
| 3 | 前提パラメータの変更 | 全列挙からの再最適化 | **99〜515ms**（最悪1,175ms）→ **明示ボタンのみ** |
| 4 | 採用シナリオの変更 | 母集団を変えて再最適化 | **118〜447ms**（110名）→ **明示ボタンのみ** |

軸1・軸2は同期実行、軸3・軸4は「再最適化」ボタン実行。**この非対称性が本機能の設計上の骨格**であり、軸3のスライダーに再最適化を紐づけるとUIが固まる（§2.1）。

軸3を成立させるには `constants.ts` のハードコード定数を引数注入に変える横断リファクタが要る。これは計算コードに触るため、**振る舞い不変をハッシュ一致で証明する Phase 0 を先に完了させる**（§5 Phase 0）。

## 2. 調査済みの事実（再調査不要）

### 2.1 実測値（2026-08-27・実データ `human_resources_100.csv`・同一マシン）

```
[1] runOptimization（100名）※3回計測
  課題1: 308.4 / 235.6 / 247.1 ms   nA=40 nB=40 nC=20  rev=61.53 prof=39.70
  課題2: 104.6 / 109.9 / 110.5 ms   nA=47 nB=41 nC=12  rev=59.74 prof=37.92
  課題3:  99.4 /  94.6 /  98.6 ms   nA=41 nB=49 nC=10  rev=60.10 prof=38.28
  課題4: 515.1 / 508.9 / 510.6 ms   nA=40 nB=35 nC=25  rev=60.45 prof=38.64
  4課題一括: 858.2 ms

[2] 人数配分を固定して1候補だけ評価（solveAssignment + computeSimulationResult）
  nA=40 nB=35 nC=25: 1.3 / 1.3 / 1.2 ms   rev=61.45 prof=39.63 feasible=true
  nA=30 nB=20 nC=50: 1.3 / 1.3 / 1.3 ms   rev=34.02 prof=12.19 feasible=false
  nA=60 nB=20 nC=20: 1.4 / 1.3 / 1.3 ms   rev=46.29 prof=24.46 feasible=false

[3] 最悪ケース（能力値を全て0にして実行不能にし、枝刈りの打ち切りを無効化）
  候補数 861 / 課題1: 1174.7 ms / 課題4: 1141.7 ms

[4] 110名（採用後）候補数 1326
  課題1: 355.3ms / 課題2: 127.8ms / 課題3: 118.0ms / 課題4: 446.8ms
  4課題一括: 1033.2 ms
```

**[3] が設計上いちばん重要。** What-if で売上下限を上げる・最低人数を上げるなど制約を厳しくすると実行不能側に倒れ、枝刈りの打ち切り（`optimizer.ts:209` の `break`）が一度も効かずに全861候補を走査する。**再最適化の応答時間は「速いときで100ms、悪いときで1.2秒」と見積もること。** 4課題を一括で再計算する設計にすると最悪4.6秒になるので、**What-if パネルは選択中の1課題だけを再計算する**。

なお `CLAUDE.md:102` は4課題合計を「約1.2秒（329/112/137/573ms）」と記載しているが、上記の再計測では858ms（308/105/99/515ms）。アルゴリズムは変わっていないので測定条件差と見る。
**ユーザー確認済み（2026-08-27）：CLAUDE.md は変更しない。** 本書の実測値と CLAUDE.md の記載が食い違ったままであることを承知のうえで、**性能の判断根拠には本書 §2.1 の数値を使うこと**。再提起は不要。

### 2.2 定数の参照元（パラメータ化の対象範囲）

`constants.ts` の export を、What-if 対象／対象外に切り分け済み。

**対象（＝`SimParams` に入れる）**

| 定数 | 現在値 | 参照している関数 |
|---|---|---|
| `WEIGHTS` | 事業部別4値 | `calcEngine.contribution` |
| `BASE_REVENUE` | A:10 B:7 C:2 | `calcEngine.baseRevenue` / `optimizer.revValue` / `optimizer.shiftConstant` |
| `GROWTH` | A:.06 B:.12 C:.25 | `calcEngine.baseRevenue` / `optimizer.revValue` |
| `OPTIMAL_HEADCOUNT` | A:40 B:35 C:25 | `calcEngine.fulfillmentRate` / `reasonText` |
| `MIN_HEADCOUNT` | A:30 B:20 C:10 | `optimizer.enumerateHeadcounts` |
| `SHORTAGE_TABLE` | 事業部別5行 | `calcEngine.shortageFactor` |
| `SURPLUS_TABLE` | 共通3行 | `calcEngine.surplusFactor` |
| `PREV_YEAR_REVENUE` | 58 | `calcEngine.computeSimulationResult` / `reasonText` / `dashboard` |
| `COST_MULTIPLIER` | 3 | `calcEngine.unitCostTotal` / `optimizer.profitValue` |

**対象外（＝定数のまま）**

| 定数 | 除外理由 |
|---|---|
| `COST_UNIT_DIVISOR` | 百万円→億円の**単位換算**であって経営前提ではない。触ると CLAUDE.md §8 の罠を再発させる |
| `ROUND_DIGITS` / `round2` | 表示仕様。全計算に一律適用される前提が崩れる |
| `TASK_SPEC` / `TASK_LABELS` | 課題の定義そのもの。変えたら別の課題になる |
| `COLUMN_MAP` / `EXPORT_HEADERS` | CSV入出力の仕様 |
| `UNIT_IDS` | 構造 |

**`assignment.ts` は `UNIT_IDS` しか import していない → 本リファクタで一切変更しない。** 最も繊細でテストが薄いファイル（`docs/solver-oracle-plan.md` §2.3）に触らずに済むのは大きい。

### 2.3 制約チェックの現状（手動モードで穴になる）

`computeSimulationResult`（`calcEngine.ts:147`）の `feasible` は **`companyRevenue > PREV_YEAR_REVENUE` しか見ていない**。最低人数制約は `enumerateHeadcounts`（`optimizer.ts:45`）が候補生成の段階で弾いているだけ。

したがって**軸1・軸2の手動モードでは最低人数割れが `feasible: true` のまま素通りする**。What-if パネル側で別途チェックして表示すること（§4.5）。

### 2.4 What-if は課題仕様にも製品カタログにも存在しない

課題原文・製品カタログの追加機能は機能9〜13まで。What-if 相当の記述はない。**本機能は新規の機能14**という位置づけになる。製品カタログ（`C:\Users\pluser1\Desktop\本課題　必要資料\26夏IS_製品カタログ_吉田智哉.md`）への追記が要るが、**Desktop 配下のドキュメントは本作業のスコープ外**（§7）。

## 3. スコープ

| | 対象 |
|---|---|
| やる | `SimParams` の導入と全計算関数への引数注入（デフォルト値付き） |
| やる | What-if パネル `#p6` と4軸すべてのUI |
| やる | `src/renderer/whatif.ts`（計算）・`whatifPanel.ts`（表示）の新規追加 |
| やる | `test/whatif.test.ts` の新規追加 |
| やらない | 数式そのものの変更。**参照元を定数から引数に差し替えるだけ**（§7） |
| やらない | `assignment.ts` の変更 |
| やらない | `SHORTAGE_TABLE` / `SURPLUS_TABLE` の編集UI（型には入れるがv1では非公開・§4.3） |
| やらない | 最適化の高速化（`docs/pruning-plan.md` ②UBのquickselect化） |
| やらない | Desktop 配下の設計書・製品カタログの改訂 |

## 4. 設計

### 4.1 状態モデル：assignment が唯一の真実

What-if パネルの状態は次の4つだけ。**表示されるすべての数値はこの4つから導出される。**

```ts
interface WhatIfState {
  task: TaskId                        // 基準ケースを決める課題
  roster: Employee[]                  // 軸4の結果（100名 + 採用する候補者）
  params: SimParams                   // 軸3
  assignment: Record<string, UnitId>  // 軸1・軸2の結果
}
```

**人数配分 `nA/nB/nC` は状態として持たない。`assignment` の集計値として毎回導出する。**
理由：軸1（人数配分指定）と軸2（個別異動）は同じ `assignment` を別経路で作る操作であり、両方を独立した状態として持つと必ず食い違う。個別異動で1名をA→Cに移せば人数配分も連動して変わるのが正しい挙動なので、スライダーは「入力欄」であって「状態」ではない。

`assignment` を作る／変える操作は3つ。

| 操作 | 関数 | コスト |
|---|---|---|
| 最適化で決める（軸1オフ） | `optimizer.runOptimization(roster, task, params)` | 99〜1,175ms |
| 人数配分を指定して決める（軸1） | `optimizer.solveForHeadcount(roster, task, counts, params)`（**新規**） | 1.3ms |
| 個別に動かす（軸2） | `assignment[id] = unit` を直接書き換え | 0ms |

描画は常に `whatif.evaluateAssignment(assignment, roster, params)` の1経路（1ms未満）。

### 4.2 基準ケース（baseline）

What-if の値は単体では意味がない。**すべての数値に基準との差分 Δ を併記する。**

- 基準＝「標準パラメータ・100名（`state.employees100`）・選択中の課題の最適解」。
- 課題ごとに遅延計算してキャッシュする（4課題まとめて先読みしない。858ms かかるため）。
- パラメータや母集団を変えても**基準は動かない**。動くのは What-if 側だけ。
- 基準の値は §2.1 の表と一致するはずなので、受入時の照合に使える。

### 4.3 `SimParams` の型（`types.ts` に追加）

```ts
/** What-if で差し替え可能な計算前提（機能14）。既定値は constants.DEFAULT_PARAMS。 */
export interface SimParams {
  weights: Record<UnitId, Weights>
  baseRevenue: Record<UnitId, number>
  growth: Record<UnitId, number>
  optimalHeadcount: Record<UnitId, number>
  minHeadcount: Record<UnitId, number>
  shortageTable: Record<UnitId, { minRate: number; factor: number }[]>
  surplusTable: { maxRate: number; factor: number }[]
  prevYearRevenue: number
  costMultiplier: number
}
```

`constants.ts` に `DEFAULT_PARAMS: SimParams` を追加する。**既存の個別 export（`WEIGHTS` 等）は削除しない**（テスト・表示側が参照しているため）。`DEFAULT_PARAMS` は既存の export をそのまま束ねるだけにして、値の二重定義を作らないこと。

`shortageTable` / `surplusTable` は型には含めるが、**v1 では UI から編集できるようにしない**。理由：合計15行の表を編集させるUIは実装量に対して得られる知見が薄く、他の7項目で「補正帯を跨いだらどうなるか」は充足率経由で十分観察できる。型に入れておけば後から編集UIだけ足せる。

### 4.4 引数注入の規約（**最重要**）

**末尾にデフォルト値付きの引数として足す。既存の呼び出し側は一切変更しない。**

```ts
// before
export function contribution(e: Employee, unit: UnitId): number {
  const w = WEIGHTS[unit]
  return round2(e.sales * w.sales + e.mgmt * w.mgmt + e.dev * w.dev + e.training * w.training)
}
// after
export function contribution(e: Employee, unit: UnitId, params: SimParams = DEFAULT_PARAMS): number {
  const w = params.weights[unit]
  return round2(e.sales * w.sales + e.mgmt * w.mgmt + e.dev * w.dev + e.training * w.training)
}
```

**式の形を一切変えないこと。** 参照元を `WEIGHTS` → `params.weights` に差し替えるだけ。「ついでに」の整理・変数のくくり出し・ループ不変式のホイストは**禁止**。

理由：`docs/pruning-plan.md` の作業時、ループ不変な乗算をくくり出したことで `(a*b)*c` と `(a*c)*b` の結合順が変わり、最下位ビットが動いて最適化の同点判定が反転した実績がある。本リファクタのゲートは**ハッシュ完全一致**なので、1 ULP でも動けば失敗する。

対象ファイルと関数：

| ファイル | params を足す関数 |
|---|---|
| `calcEngine.ts` | `contribution` / `unitAbility` / `fulfillmentRate` / `shortageFactor` / `surplusFactor` / `baseRevenue` / `unitCostTotal` / `computeUnitResult` / `computeSimulationResult` |
| `optimizer.ts` | `enumerateHeadcounts` / `runOptimization`（内部の `buildEmployeeBases` / `revValue` / `profitValue` / `effectiveFactors` / `buildValues` / `shiftConstant` にも伝播） |
| `reasonText.ts` | `generateReasonText` |
| `dashboard.ts` | `renderDashboard`（`PREV_YEAR_REVENUE` / `OPTIMAL_HEADCOUNT` を参照している箇所） |
| `compareTasks.ts` / `compareHiring.ts` | 定数を参照している関数（grep で確認すること） |
| `csv.ts` | `buildAssignmentCsv`（`contribution` を呼ぶため） |

`calcEngine.ts` の `finalRevenue` / `membersByUnit` / `taskPrimaryValue` / `classifyType` / `typeBreakdown` は定数を参照しないので**変更しない**。
`assignment.ts` は**変更しない**。

### 4.5 手動モードでの制約判定

§2.3 のとおり `SimulationResult.feasible` は売上下限しか見ない。`whatif.ts` で最低人数を別途判定し、両方をパネルに出す。

```ts
export interface WhatIfEvaluation {
  result: SimulationResult
  /** params.minHeadcount を下回っている事業部 */
  minHeadcountViolations: UnitId[]
  /** 基準の割当と所属が異なる社員数 */
  movedFromBaseline: number
}
```

**手動モードでは最低人数割れを禁止しない（警告表示にとどめる）。**
理由：「最低人数を割ったら売上がどれだけ落ちるか」を見ることも What-if の目的だから。禁止すると問いそのものが立てられない。
一方、**自動最適化（`runOptimization`）では従来どおり hard constraint のまま**（`enumerateHeadcounts` が弾く）。この非対称は意図的なので、パネル上に一言明記すること。

### 4.6 入力値の検証（軸3）

UIから任意の数値が入るため、計算が壊れる値を弾く。**入力欄の直下にインライン表示**し、1つでも違反があれば「再最適化」ボタンを `disabled` にする（`#p1` の `next-to-p2` と同じ方式。`alert()` は使わない — `renderer.ts:67` のコメント参照）。

| 項目 | 許容範囲 | 弾かないと起きること |
|---|---|---|
| `optimalHeadcount[u]` | 1以上の整数 | 0で `fulfillmentRate` が `Infinity`／`NaN` になり充足率表示が壊れる |
| `minHeadcount[u]` | 0以上の整数 | 負値で候補列挙が壊れる |
| `Σ minHeadcount` | `roster.length` 以下 | 超えると候補0件。**これは弾かず**「最低人数制約がボトルネック」と表示する（機能12の既存挙動が正しく働く） |
| `baseRevenue[u]` | 0以上 | 負の売上 |
| `growth[u]` | 0以上 | — |
| `prevYearRevenue` | 0以上 | — |
| `costMultiplier` | 0以上 | — |
| `weights[u]` 各値 | 0以上 | — |
| `Σ weights[u]` | 1.0（±0.001） | **弾かず警告のみ**。合計を変えたときの影響を見るのも What-if の目的 |

### 4.7 パネル構成（`#p6`）

既存パネルの慣習に合わせ**単一カラムの縦スクロール**。`.section-title` / `.card` / `.stat-row` / `.bar-row` / `.pill` など既存クラスを使い、新規CSSは最小限にとどめる。

```
topbar: [🏠][1 データ取込][2 課題選択・実行][3 結果ダッシュボード] ... [A-1 4課題を比較する][7 採用前後を比較する][14 What-if 分析]
```

```
── #p6 ────────────────────────────────────────────
<span class="addon-tag">追加機能 14</span>
h2  What-if 分析
subtitle  前提・母集団・配置を変えたときに結果がどう動くかを、基準ケースとの差分で確認する

hint  💡 人数配分と個別異動は動かした瞬間に再計算される。前提パラメータと採用シナリオは
      最適配置の解き直しが必要なため「再最適化」ボタンで実行する（最大約1.2秒）。

[基準ケース]  課題セレクタ（課題1〜4）  →  基準：全社売上 61.53億 / 全社利益 39.70億

[結果サマリー]  ← position:sticky で上部に固定（新規CSS 1クラス）
  stat-row 3枚：全社売上（Δ併記）／全社利益（Δ併記）／制約判定
  制約判定は「売上下限」と「最低人数」の2つを別々のピルで出す（§4.5）

── ① 母集団（軸4）
  card: 採用候補10名のチェックリスト（#p5 で取込済みの hiringAdd10 を流用）
        「全員採用／誰も採用しない」ショートカット
        合計 N 名 の表示
        [この母集団で再最適化 ▶]

── ② 前提パラメータ（軸3）
  card: 基準売上 A/B/C・成長係数 A/B/C・適正人数 A/B/C・最低人数 A/B/C
        重み（4能力×3事業部の表・合計を各行に表示）
        全社売上下限・コスト係数
        各欄に「標準値」を薄字で併記し、変更済みの欄は枠を強調
        [標準に戻す] [この前提で再最適化 ▶]

── ③ 配置（軸1・軸2）
  card: nA/nB/nC のスライダー＋数値入力（合計は常に roster.length に固定）
        → input で即時再計算（1.3ms）
        [最適化に任せる ▶]（= runOptimization。押すと個別異動はクリアされる）
  card: 社員一覧テーブル（社員ID／タイプ／貢献度A・B・C／基準の所属／現在の所属セレクタ）
        セレクタ変更で即時再計算。基準から動いた行はハイライト
        [基準の配置に戻す]

── 結果詳細
  card: 事業部別テーブル（基準 → What-if → Δ を売上・利益・人数・充足率で）
  card: 充足率・ペナルティ帯（#p3 の fulfillment-gauges と同じ見せ方）
  card: 配置差分サマリー（「基準から N 名が異動：A→B 3名、B→C 1名 …」）
  reason-box: generateReasonText(result, task, params) ＋ 前提を変えている場合はその旨を先頭に付す
  [この What-if 配置をCSV出力 ⭳]
```

**再最適化の実行中表示**：ボタンを `disabled` にしてラベルを「再最適化中…」に変える。同期実行で最大1.2秒ブロックするため、`requestAnimationFrame` を1回挟んでからブロッキング計算に入り、ラベル変更が確実に描画されるようにすること（そうしないとフリーズしたように見える）。Web Worker は導入しない（スコープ外・`nodeIntegration: false` の維持を優先）。

## 5. 実装手順

### Phase 0：`SimParams` 導入（ゲート：**ハッシュ完全一致** ＋ `npm test` 全通過）

計算コードに触るため、振る舞い不変を証明してから次へ進む。手順は `docs/` の既存作業と同じ方式。

1. **リファクタ前に**スナップショットを取る。プロジェクト直下に `_snapshot.ts` を作る（相対 import 解決のため `/tmp` 不可・CLAUDE.md §9）。
   - 実データ `/mnt/c/Users/pluser1/Desktop/本課題　必要資料/human_resources_100.csv` の4課題
   - 110名（シード固定の乱数10名を追加）の4課題
   - 能力値を一律0にした実行不能ケース（課題1・4）
   - `enumerateHeadcounts(100)` から等間隔に20候補を取り、各候補で `computeUnitResult` / `computeSimulationResult` を直接呼んだ結果（`solveForHeadcount` は Phase 1 で作るのでここではまだ使わない。`assignment` は候補の人数どおりに社員を入力順で機械的に割り振って作れば十分 — 目的は割当の質ではなく計算経路の網羅）
   - 各ケースで `JSON.stringify(result)` を**丸めずに全部**出力（`assignment` 含む）
   - 連結して SHA-256 を出し、ログファイルに書く
2. `types.ts` に `SimParams` を追加、`constants.ts` に `DEFAULT_PARAMS` を追加。
3. §4.4 の規約に従って引数を足す。**式の形を変えない。**
4. スナップショットを再実行し、**SHA-256 が1文字も変わっていないこと**を確認する。
   - 変わったら：どのケースで変わったかを二分して特定し、**直す前に報告する**（CLAUDE.md §9）。原因はほぼ確実に式の形の変化。
5. `npm test` 全通過。`npm run lint` 通過。
6. `_snapshot.ts` とログを削除。

**このPhaseではUIを一切触らない。** `#p6` も `whatif.ts` もまだ作らない。

### Phase 1：`solveForHeadcount` の追加（ゲート：新規テスト通過）

`optimizer.ts` に追加して export する。`runOptimization` の候補ループ1回分を切り出したもの。

```ts
/**
 * 人数配分を固定して内側の割当だけを厳密に解く（機能14 What-if 軸1）。
 * runOptimization の候補ループ1回分に相当する。最低人数制約は課さない
 * （手動 What-if では制約割れの影響を見ることも目的のため・docs/whatif-plan.md §4.5）。
 */
export function solveForHeadcount(
  employees: Employee[],
  task: TaskId,
  counts: AllocationCounts,
  params: SimParams = DEFAULT_PARAMS,
): Record<string, UnitId>
```

**実装は `runOptimization` 内の既存コード（`buildEmployeeBases` → `effectiveFactors` → `buildValues` → `solveAssignment`）を関数に切り出して両方から呼ぶ形にする。ロジックを複製しないこと。** 複製すると `constants.ts` の `TASK_SPEC` 集約（CLAUDE.md §7 の1）と同じ食い違いのリスクを作る。

テスト（`test/whatif.test.ts`）：
- `runOptimization(emp, task)` が返した `headcount` を `solveForHeadcount` に渡すと、**同じ `companyRevenue` / `companyProfit` が得られる**こと（4課題すべて）。これがこの関数の契約。
- 5名の小規模ケースで、全割当を総当たりした最適値と一致すること。

### Phase 2：`whatif.ts`（ゲート：テスト通過・UIなし）

純粋関数のみ。DOM に触らない。

```ts
export interface WhatIfState { task, roster, params, assignment }
export interface WhatIfEvaluation { result, minHeadcountViolations, movedFromBaseline }

export function evaluateAssignment(state, baselineAssignment): WhatIfEvaluation
export function headcountOf(assignment, roster): AllocationCounts
export function validateParams(params, rosterSize): ValidationError[]   // §4.6
export function diffAssignment(baseline, current): { from: UnitId; to: UnitId; count: number }[]
```

`validateParams` は既存の `ValidationError` 型（`types.ts:65`）を再利用すること。新しいエラー型を作らない。

テスト：
- `headcountOf` が `assignment` の集計と一致
- 最低人数割れを `minHeadcountViolations` が検出し、かつ `result.feasible` は売上下限だけを見ている（§2.3 の挙動が変わっていないことの確認）
- `validateParams` が §4.6 の表の各行を検出する
- `params` を標準値にしたとき `evaluateAssignment` の結果が `computeSimulationResult` と一致する

### Phase 3：パネル骨格＋軸1・軸2（ゲート：`npm run dev` で手動確認）

1. `index.html` に topbar ボタンと `#p6` を追加（§4.7 の構成）。
2. `styles.css` に sticky サマリー用の1クラスと、変更済み入力欄の強調用クラスを追加。既存クラスで足りるものは足さない。
3. `whatifPanel.ts` を新規作成。`dashboard.ts` と同じ「DOM更新専用・計算を持たない」方針を守る。
4. `renderer.ts` の `go()` に `#p6` の遷移時再描画を足す（`p4` / `p5` と同じ形）。
5. 軸1（スライダー）・軸2（社員セレクタ）を配線し、`oninput` / `onchange` で同期再計算。

**この時点でパラメータ欄は表示するが読み取り専用にしておく。** 軸3の配線は Phase 4。

### Phase 4：軸3（前提パラメータ）

1. 入力欄を編集可能にし、`validateParams` をインライン表示に配線。
2. 「再最適化」ボタン。押下時のみ `runOptimization(roster, task, params)`。
3. §4.7 の実行中表示（`requestAnimationFrame` を1回挟む）。
4. 「標準に戻す」で `DEFAULT_PARAMS` に戻し、基準の配置も復元。

### Phase 5：軸4（採用シナリオ）

1. `#p5` の `hiringAdd10` を `#p6` からも参照できるよう `renderer.ts` の `state` を共有する。未取込なら `#p6` の①に「先に採用前後比較で追加採用データを取り込む」旨と `data-go="p5"` のリンクを出す。
2. 候補者ごとのチェックボックスで `roster` を組み立て、`mergeEmployees` で ID 重複を検証してから再最適化。
3. 採用人数が変わると `roster.length` が変わる → **人数配分スライダーの合計上限も追随させること**。

### Phase 6：仕上げ

1. What-if 配置の CSV 出力（`buildAssignmentCsv(roster, result, params)`）。ファイル名は `whatif_assignment.csv` として通常の配置結果と区別する。
2. `#p0` トップページに4枚目の入口カードを追加（「前提を変えて試す」→ `data-go="p6"`）。
3. `README.md` の実装状況に手順9として追記。
4. `CLAUDE.md` の §5 ディレクトリ構成に `whatif.ts` / `whatifPanel.ts` を追記し、行数・テスト件数を**実測して**更新する。
5. `npm test` / `npm run lint` / `npm run build`（型チェックまで）を通す。

## 6. 受入基準

1. `npm test` が全通過し、`npm run lint` がクリーン。
2. **Phase 0 のハッシュが完全一致**していること（ログを残して報告する）。
3. 実データ100名の基準値が §2.1 と一致：
   - 課題1 `A:40 B:40 C:20` / 売上 61.53 / 利益 39.70
   - 課題2 `A:47 B:41 C:12` / 売上 59.74 / 利益 37.92
   - 課題3 `A:41 B:49 C:10` / 売上 60.10 / 利益 38.28
   - 課題4 `A:40 B:35 C:25` / 売上 60.45 / 利益 38.64
4. `#p6` でパラメータを標準のまま「再最適化」すると、基準ケースと**完全に同じ結果**が出る（Δ が全項目0）。
5. **課題1** を選んだうえで人数配分スライダーを `A:40 B:35 C:25` にすると 売上 61.45 / 利益 39.63 / feasible=true になる（§2.1 [2]）。
   ※この照合が成立するのは課題1のこの配分だけ。§2.1 [2] は充足率がちょうど 100%/100%/100% で補正が全て1.00になる点を選んで測っており、他の課題・他の配分では価値関数も補正係数も変わるため同じ値にはならない。
6. 人数配分スライダー操作・個別異動セレクタ操作で**体感の引っかかりがない**（実測1.3ms）。
7. 最低人数を割る手動配置で、売上下限の判定とは別に最低人数の警告が出る。
8. 適正人数に 0 を入れると再最適化ボタンが `disabled` になり、インラインにエラーが出る（`alert()` ではない）。
9. 全社売上下限を 70 に上げて再最適化すると、実行不能として機能12の原因表示（「全社売上下限がボトルネック」＋最も近い候補）が出る。所要時間は約1.2秒。
10. `assignment.ts` の差分が **0行**。
11. `git diff` に `COST_UNIT_DIVISOR` / `ROUND_DIGITS` の変更が含まれていない。

## 7. やってはいけないこと

- **式の形を変えること。** params 化は参照元の差し替えのみ。くくり出し・順序変更・「ついでの整理」は一切しない（§4.4）。
- **`assignment.ts` を変更すること。** 本機能で触る理由はない。
- **`COST_UNIT_DIVISOR` / `ROUND_DIGITS` / `TASK_SPEC` / `COLUMN_MAP` をパラメータ化すること**（§2.2）。
- **`runOptimization` のロジックを `solveForHeadcount` に複製すること。** 共通部分を切り出して両方から呼ぶ（§5 Phase 1）。
- **スライダーの `oninput` で `runOptimization` を呼ぶこと。** 最悪1.2秒ブロックしてUIが固まる（§2.1）。
- **4課題を一括で再最適化すること。** 最悪4.6秒。What-if は選択中の1課題だけ。
- **`alert()` で検証エラーを出すこと。** Electron では同期IPCを介するため描画が止まる（`renderer.ts:67`）。
- **`whatifPanel.ts` に計算を書くこと。** 表示専用（CLAUDE.md §5 の方針）。
- **既存の `#p3` ダッシュボードの挙動を変えること。** What-if は独立パネル。`state.currentResult` を What-if の結果で上書きしない。
- **Desktop 配下の設計書・製品カタログを編集すること**（§7 の対象外・ユーザー判断）。
- **`CLAUDE.md:102` の性能値を書き換えること**（§2.1 末尾・ユーザー確認済み）。本書 §5 Phase 6 の手順4で CLAUDE.md に触れてよいのは §5「ディレクトリ構成」の行数・テスト件数だけ。§8「既知の罠」の性能値には触れない。
- **`26夏IS_製品カタログ_吉田智哉.md` を編集すること**（§8・ユーザー確認済み）。

## 8. 申し送り

- **本機能は製品カタログ未記載の機能14になる**（§2.4）。**ユーザー確認済み（2026-08-27）：カタログは変更しない。** 実装完了時の報告でも再提起は不要。UI上の `addon-tag` は「追加機能 14」と表示するが、これはカタログの採番規則に倣った本アプリ内の呼称であってカタログ改訂を前提としない。
- 作業開始前に `git status --short` を確認すること。本書執筆時点で `src/renderer/` の大半と `CLAUDE.md` / `README.md` が未コミット（v0.2.0 以降の作業）。**Phase 0 のハッシュ比較は、この未コミット状態を起点として取る。**別セッションが同じツリーを触っている可能性があるので、`Edit` が「ファイルが変更されている」で失敗したら読み直すこと。
- `SHORTAGE_TABLE` / `SURPLUS_TABLE` の編集UIは v1 では作らない（§4.3）。要望が出たら型は既にあるので UI だけ足せる。
- 軸3を入れると「前提を変えれば売上はいくらでも上がる」画面になりうる。**基準ケースとの Δ を常に併記する**設計（§4.2）はそれへの歯止めなので、Δ表示を省略しないこと。
