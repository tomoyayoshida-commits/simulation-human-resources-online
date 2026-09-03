# 採用判断の作業机（機能15b）設計・検討書

> `#p5`（採用判断）に作業机を載せる。`docs/workbench-plan.md` §8-5 で
> 「処理自体が変わってくる」として v1 を見送った箇所の設計。
> 実装着手前の検討書。§3 の確定事項はユーザー判断済み。

作成: 2026-09-03
前提: `docs/workbench-plan.md`（機能15・`#p4` の作業机）を実装済みとする

---

## 1. 結論

**`#p4` の作業机との差は「4列目」1つに集約できる。** 計算コードは1行も変えずに済む。

`#p5` の盤面は A/B/C の3列ではなく、**A / B / C / 採用候補（未採用）の4列**になる。
カードを列に置く＝採ってそこに配属、プールに戻す＝採らない。これで採用判断の
「誰を採るか」と「どこに置くか」が1つの操作に統一される。

「未採用」は `assignment` からキーを削除するだけで表現でき、既存の計算関数が
そのまま正しく動く（§2.2）。人件費も自動で正しくなる。

新規に要るのは「プール列」「baseline 2本立て」「既存社員のロック」
「CSVの配置先列の取込」の4つ。
`optimizer.ts` / `assignment.ts` / `calcEngine.ts` / `whatif.ts` は**変更しない**。

### 1.1 この機能の価値

`#p5` の現状は「10名全員を採ったらどうなるか」しか答えていない。採用判断が本来
答えるべき問いは3段ある。

| 段 | 問い | 現状 | 本書 |
|---|---|---|---|
| ① | そもそも採るか | ✅ 対応済み | 維持 |
| ② | 何名採るか | ❌ 10名固定 | ✅ プールで表現 |
| ③ | 誰を採り、どこに置くか | ❌ | ✅ 作業机の本体 |

さらに、この画面でしか見えないものがある。**110名でも適正人数は100名基準を据え置く**
（`CLAUDE.md` §7-4 の確定事項）ため、採用は構造的に過剰補正へ入りやすい。
「10名採ると全社売上は増えるが、C事業部に4人以上入れた瞬間に120%の帯を跨いで落ちる」
は左右2枚のカードでは絶対に見えない。充足率メーターは `#p4` 以上に効く。

---

## 2. 調査済みの事実（再調査不要・2026-09-03 時点・実ファイルで確認）

### 2.1 現状の `#p5`

- `compareHiring.ts:51-52` が `runOptimization(base, 1, params)` と
  `runOptimization([...base, ...additional], 1, params)` を回して左右に並べるだけ
- **課題1（全社売上最大）固定**。`renderCompareHiring` の第3引数は既定値 `1` で、
  `renderer.ts:286` / `renderer.ts:355` の呼び出しはどちらも `1` を明示している
- 取込は左右2欄（`hiringBase100` / `hiringAdd10`・`renderer.ts:262-281`）。
  右欄は左欄が未取込だと保留になり、既存IDとの重複もそこで弾く
- 前提パラメータは `p5Params.getParams()`（`renderer.ts:285`）。`#p4` とは独立
- `#p5-result-step` の中身は `compare-hiring-grid` / `hiring-summary` / `hiring-roi` /
  `p5-result-back` の4つのみ（`index.html:221-232`）。**`#p5-bench-step` は存在しない**
- `renderer.ts:86-98` の `showStep` / `currentStep` は既に3値（`import`/`result`/`bench`）
  対応済みで、`#p5` に `bench-step` を足せばそのまま動く（`renderer.ts:85` のコメントが
  「#p5 では該当要素が無いため toggleAttribute は何もしない」と明記している）

### 2.2 「未採用」は assignment のキー削除で表現できる（最重要）

| 関数 | 場所 | 挙動 |
|---|---|---|
| `membersByUnit` | `calcEngine.ts:110-113` | `const unit = assignment[e.id]; if (unit) ...` — **キーが無い社員を黙って飛ばす** |
| `headcountOf` | `whatif.ts:26-29` | 同じく `if (u) counts[u]++` で飛ばす |

したがって roster に110名を入れたまま、未採用者の `assignment` キーを削除すれば

- 売上：未採用者は `computeUnitResult` に渡らないので寄与しない ✅
- 人件費：`unitCostTotal` は事業部メンバーから計算するので未採用者は加算されない ✅
- 人数・充足率：`headcount` に入らない ✅

が**すべて自動で正しくなる**。`calcEngine.ts` / `whatif.ts` の変更は不要。

`evaluateAssignment` の `movedFromBaseline`（`whatif.ts:46-48`）も
`state.assignment[e.id] !== baselineAssignment[e.id]` の比較なので、
`undefined` 同士は一致・`undefined` vs `'A'` は不一致となり正しく数えられる。

### 2.3 `solveAssignment` は min-cost **max**-flow（採用枠を決めれば誰を採るかは厳密に解ける）

`assignment.ts:154-165` のグラフは

```
source →(cap 1 ずつ)→ 社員ノード →(cap 1・cost −value)→ 事業部ノード →(cap counts[u])→ sink
```

`counts` の合計が `employees.length` より小さい場合、最大フローは Σcounts で止まり、
**その中で費用最小＝価値最大の Σcounts 名だけが割り当てられる**。
つまり「k名採る枠を決めれば、誰を採ってどこに置くかは厳密に解ける」。
`solveForHeadcount(employees, task, counts, params, metric)`（`optimizer.ts:260-271`）に
合計 100+k の `counts` を渡すだけでよい。

`enumerateHeadcounts(totalCount, params)`（`optimizer.ts:45-58`）も総数を引数に取るため、
将来「何名採るのが最適か」を k=0..10 で探索する拡張も既存関数の組合せで書ける
（**本書のスコープ外**。数秒かかるためローディング必須）。

### 2.4 CSVの「配置先事業部」列は書き専用（帰り道が無い）

| 側 | 状態 |
|---|---|
| 出力 | `constants.ts:151` `EXPORT_HEADERS.assignedUnit = '配置先事業部'`、`csv.ts:349` のヘッダ配列に含まれる ✅ |
| 取込 | `COLUMN_MAP`（`constants.ts:120-127`）に対応エントリが**無い**。列は完全に無視される ❌ |

`COLUMN_MAP` は `Record<keyof Employee, string[]>` 型なので、`assignedUnit` は
`Employee` のフィールドではない以上そこには追加できない。**別定数＋別関数**にする（§5.7）。

`UNIT_LABEL`（`constants.ts:11`）は `{ A: 'A事業部', B: 'B事業部', C: 'C事業部' }`。
出力はこのラベルなので、取込もこれを逆引きの第一候補にする。

### 2.5 `diffAssignment` には採用/不採用が通らない穴が2つある

`whatif.ts:108-126`：

1. `if (to === undefined || to === from) continue`（:117）
   → 「A事業部 → 未採用」が異動内訳に出ない
2. `for (const id of Object.keys(baseline))`（:114）
   → baseline に無いID（分岐1で未採用スタートの追加10名）が採用されても拾われない

`docs/workbench-plan.md` §9 申し送りで **`whatif.ts` の4関数は仕様を変えない**と決めている。
`workbench.ts` 側にプール対応のラッパを新設する（§5.8）。

### 2.6 機能16（出力）が作業机からCSV出力を外している（2026-09-03 追記）

別セッションが実装中の `docs/export-plan.md`（機能16）は、作業机の「CSV出力」を
**「この案を保存」に置き換え**、出力を独立パネル `#p7`（保存した配置案 → 出力）へ移す。

- `export-plan.md:10-11` 作業机の上では一切出力しない。保存すると `/simulationRuns/{runId}` に1件追記
- `export-plan.md:17` **制約違反時は「保存は可・出力は不可」**。`workbench-plan.md` §8-2 の門は出力側へ移った
- `export-plan.md:93` **`#p5` からの保存・出力は機能16のスコープ外**（`#p4` 経路のみ）

本書は当初 `[CSV出力]` を前提に書かれていたが、**機能16に合わせて `[この案を保存]` に統一する**
（2026-09-03 ユーザー判断・§3-7）。採用提案こそ版(runId)を与えて配るべき文書であり、
`export-plan.md` §1.1 の論理がそのまま当てはまる。

### 2.7 `optimizer.ts` の内部関数は未 export

`buildValues` / `effectiveFactors` / `buildEmployeeBases` は `optimizer.ts` 内の
モジュール私有関数で、export されていない（`resolveMetric` のみ `constants.ts:186` で公開）。

このため「**既存100名を固定したまま追加採用者だけを厳密に組み直す**」を
`workbench.ts` から書くことはできない。§5.6 でこの制約を回避する。

---

## 3. 確定事項（2026-09-03 ユーザー判断済み）

| # | 論点 | 決定 |
|---|---|---|
| 3-1 | v1 のスコープ | **候補プール入り**。4列目を置き「誰を採るか」も作業机で決める |
| 3-2 | Δ の基準 | **2段で両方出す**。上段＝採用の効果、下段＝最適解から譲った分 |
| 3-3 | 目的関数 | **分岐させる**。配置案が決まっていれば それを起点／決まっていなければ 課題1〜4×売上/利益 を選択 |
| 3-4 | 配置案の入口 | **CSVの「配置先事業部」列を取込側でも読めるようにする** |
| 3-5 | 既存100名の可動 | **ロック切替を置く**。既定は固定（追加10名だけ配る） |
| 3-6 | 分岐の選ばせ方 | **取込列の有無で自動判定**。追加UIは置かない |
| 3-7 | 出力導線 | **機能16に合わせ「この案を保存」**。CSV/PDFは `#p7` が出す（§2.6） |

「何名採るのが最適か」の自動探索（k=0..10）は v1 では**作らない**（§2.3 に道筋のみ記録）。

---

## 4. スコープ

| | 対象 |
|---|---|
| やる | `#p5` に第3ステップ「作業机」を追加（`#p5-bench-step`） |
| やる | 4列（A/B/C/採用候補プール）の盤面とD&D・クリック操作（§5.3） |
| やる | baseline 2本立てと2段Δ表示（§5.4） |
| やる | 既存100名のロック切替（§5.5） |
| やる | CSVの「配置先事業部」列の取込と分岐の自動判定（§5.7・§5.1） |
| やる | プール対応の異動内訳ラッパ（§5.8） |
| やる | 採用人数・追加人件費・利益増分の live 表示（§5.9） |
| やる | 操作列に [この案を保存]（機能16 の `#p7` へ合流。§2.6・§5.11） |
| やらない | **数式・定数・アルゴリズムの変更**（`calcEngine`/`optimizer`/`assignment`/`whatif` は無変更） |
| やらない | 「何名採るのが最適か」の自動探索（§2.3） |
| やらない | `compareHiring.ts` の結果ステップの作り替え（10名全員前提のまま維持。作業机は別ステップ） |
| やらない | 出力そのもの（CSV/PDFの生成）。機能16 の `#p7` に任せる |
| やらない | `#p7` 一覧・出力画面の改修。採用判断の文脈を出す拡張は機能16 完了後に別途（§5.11） |
| やらない | 製品カタログ・設計書（Desktop配下）の改訂（機能14/15と同じ扱い） |

---

## 5. 設計

### 5.1 分岐の自動判定（確定事項 3-6）

`#p5` の**左欄（採用前100名）CSV**に「配置先事業部」列があるかで決まる。

| 判定 | 分岐 | 起点となる配置 | 目的関数 |
|---|---|---|---|
| 列あり・全行に有効値 | **分岐1（配置案あり）** | 取り込んだ配置そのもの | 課題1を既定・折りたたみで変更可 |
| 列なし | **分岐2（配置案なし）** | `runOptimization(100名, 選んだ課題×指標)` | 課題1〜4 × 売上/利益 を明示的に選ばせる |

- 取込レポートに一言出す：「配置案を検出しました（100名分）。現行配置を起点に採用を検討します」
- **列はあるが一部の行が空・不正**な場合は分岐2に落とし、取込レポートに警告を出す
  （部分的な配置案を勝手に補完しない。どう補完しても嘘になるため）
- 右欄（追加10名）の配置先列は**読まない**。採用候補は必ずプールから始まる

### 5.2 状態モデル

```ts
// hiringWorkbench.ts
export interface HiringWorkbenchState {
  task: TaskId
  metric: TaskMetric
  /** 採用前100名（ロック対象） */
  base: Employee[]
  /** 追加採用候補10名 */
  candidates: Employee[]
  /** base + candidates。計算に渡す唯一の名簿 */
  roster: Employee[]
  params: SimParams
  /** 唯一の可変状態。キーが無い社員＝未採用（§2.2） */
  assignment: Record<string, UnitId>
  /** 上段Δの基準＝採用の効果を測る相手（§5.4） */
  beforeBaseline: SimulationResult
  /** 下段Δの基準＝採用後110名の最適解（§5.4） */
  afterBaseline: SimulationResult
  /** true のあいだ base の社員は動かせない（確定事項 3-5・既定 true） */
  lockBase: boolean
  history: Record<string, UnitId>[]
  profiles?: ProfileMap
}
```

- **人数配分は状態に持たない。** `headcountOf(assignment, roster)` で毎回導出する
  （`docs/workbench-plan.md` §4.2 と同じ理由）
- `WorkbenchState` を継承・拡張しない。**別の型として新設する**。
  `#p4` の作業机は「母集団固定・3列」という前提でテストが書かれており、
  そこにプールとロックを持ち込むと既存テストの意味が変わる
- ただし `HiringWorkbenchState` は `WhatIfState`（`task`/`roster`/`params`/`assignment`）を
  構造的部分型として満たすので、`evaluateAssignment(state, baselineAssignment)` は
  **そのまま呼べる**（`#p4` と同じ扱い）

### 5.3 盤面：4列目「採用候補（未採用）」

```
┌ ① ヘッダ ────────────────────────────────────────────────┐
│ 採用判断の作業机：現行配置を起点（課題1・全社売上最大）  [← 比較に戻る] │
│ 全社売上 60.42億   採用前比 +2.31億 ↑   最適解比 −0.18億 ↓            │
│ 全社利益 52.68億   採用前比 +1.13億 ↑   最適解比 −0.09億 ↓            │
│ 採用 8/10名   追加人件費 0.42億   ● 制約を満たす                      │
│ ☑ 既存100名を固定する                                                 │
└──────────────────────────────────────────────────────────┘
┌ ② 列ヘッダ（4列）────────────────────────────────────────┐
│ A 41名 102.5%    B 49名 140.0% ⚠    C 20名 80.0%    採用候補 2名      │
│ [====|====]      [========|=]        [===|    ]      （未採用）        │
│ 売上25.14(+0.0)  売上32.33(+1.2)     売上2.95(+1.1)  —                │
└──────────────────────────────────────────────────────────┘
┌ ③ 盤面（4列・D&D）──────────────────────────────────────┐
│ [E001🔒]         [E014🔒]            [E077🔒]        [E103]            │
│ [E101]           [E105]              [E110]          [E107]            │
└──────────────────────────────────────────────────────────┘
┌ ④ 操作列 ────────────────────────────────────────────────┐
│ [元に戻す][最適解に戻す][この人数配分のまま最適に組み直す][この案を保存]│
│ 採用：A 1名／B 1名／C 2名 ／ 見送り 2名                                │
└──────────────────────────────────────────────────────────┘
```

- プール列は **`UnitId` ではない**。列の `data-unit` に `pool` を入れ、
  drop 時は `delete assignment[id]` に振り分ける
- プール列には充足率メーター・売上を出さない（意味が無い）。人数と「未採用」のみ
- ロック中の既存社員カードには 🔒 を出し、`draggable="false"` にする
- カードの中身は `#p4` と同じ4項目（社員番号・型バッジ・現所属の貢献度・移動先2事業部の貢献度）。
  **プールにいる候補は所属が無いので、A/B/C 3つの貢献度を並べる**
- 既定の並び順は社員番号順（`docs/workbench-plan.md` §8-3 を踏襲）

### 5.4 baseline は2本（確定事項 3-2）

```ts
beforeBaseline // 採用の効果を測る相手
afterBaseline  // 手で譲った分を測る相手 ＝ runOptimization(110名, task, params, metric)
```

| 分岐 | `beforeBaseline` |
|---|---|
| 分岐1 | **取り込んだ現行配置**を `computeSimulationResult(取込配置, base, params)` で評価したもの（最適解ではない） |
| 分岐2 | `runOptimization(base, task, params, metric)` の結果 |

- `afterBaseline` は**どちらの分岐でも** `runOptimization(roster, task, params, metric)`。
  分岐1で `task` の指定が要るのはこのため（既定 課題1・折りたたみUIで変更可）
- **どちらの baseline も作業机の操作では絶対に上書きしない**
- 上段Δは正が緑（採用の効果は増えるのが普通）、下段Δは負が赤（最適解から譲る）
- `afterBaseline` が infeasible の場合は下段Δを「—（採用後の実行可能解なし）」と出し、
  作業机自体は開ける（分岐1で現行配置を見る目的が残るため）

### 5.5 既存100名のロック（確定事項 3-5）

- 既定 **ON**。`state.base` の社員はドラッグ不可・クリック選択不可
- OFF にすると `#p4` の作業机と同じく全員可動になる
- ロックの切替で `assignment` は変えない（表示と操作可否だけが変わる）
- **分岐2ではロックのチェックボックスを出さない。** 起点が最適解であって
  「現行配置」ではないので、固定する意味が無い

### 5.5.1 プール列は候補専用（解雇は扱わない）＝ 2026-09-03 追加

**既存社員は `lockBase` の値に関わらずプール列に入れられない。** `canPlace()` が禁じる。

理由：既存社員をプールへ落とすことは「その人を雇わない」＝解雇を意味するが、
このアプリが扱うのは**配置と採用の判断**であって雇用の終了ではない。モデルには
退職金も引継ぎコストも士気への影響も無く、落とせば「1名減らすと売上がいくら減るか」だけが
出てしまう。その数字だけを根拠に人員削減を論じる道具として誤用されうるため、
盤面の操作として最初から不可能にしておく。

ロック（§5.5）とは別の制約であることに注意：

| | ロック（`lockBase`） | プール制限（本節） |
|---|---|---|
| 何を止めるか | 既存社員の**異動**（A→B等） | 既存社員を**未採用にすること** |
| 切り替え | チェックボックスで可 | **不可。常時禁止** |
| 目的 | 純増採用の検討 | 解雇判断の道具にしない |

実装：

- `canPlace(state, employeeId, slot)` を新設し、`moveEmployeeTo` / `withMoveTo` はこれで判定する
  （`canMove` は「動かせるか」だけを見る従来どおりの関数として残す）
- D&D では `dragover` / `dragenter` で `preventDefault` しない＝ブラウザ標準の「ドロップ不可」カーソルになる
- クリック操作では黙って無視せず、理由を警告バナーに出す（無反応だと掴み損ねたと思って繰り返すため）
- プール列の見出しに「候補のみ」バッジと「既存社員はこの列に入れられません」を常時表示する

**ロックの既定値も分岐で変える**（同日修正）。分岐1は現実の組織図が起点なので異動が重く既定ON、
分岐2は最適解が起点で「現実の異動」という概念が無いため既定OFF。
チェックボックス自体は**両方の分岐で出す**——分岐2で出さないと `lockBase` を切り替える手段が無くなり、
既存100名が一切動かせない盤面になってしまう。

### 5.6 「この人数配分のまま最適に組み直す」のロック時の扱い

§2.7 のとおり、既存を固定したまま追加分だけを厳密に解くには `optimizer.ts` の
内部関数（`buildValues`/`effectiveFactors`/`buildEmployeeBases`）が要る。
`optimizer.ts` は無変更が原則なので、**関数を export させにいかない**。

代わりにこうする：

| ロック | ボタンの挙動 |
|---|---|
| OFF | `solveForHeadcount(採用者のみ, task, headcountOf(assignment, roster), params, metric)` をそのまま呼ぶ（`#p4` と同じ） |
| ON | ボタンを `disabled`。`title="既存100名の固定を外すと実行できます"` を添える |

`solveForHeadcount` には **採用者だけ**を渡す（未採用者を渡すと §2.3 のとおり
ソルバが「誰を採るか」まで決め直してしまい、ユーザーの採否判断を勝手に上書きする）。
`counts` は現在の `headcountOf` なので合計＝採用者数となり、全員が割り当てられる。

> 将来 `optimizer.ts` に `solveForHeadcountWithFixed` のような export を足す判断をするなら、
> それは本書とは別の合意（`CLAUDE.md` §9）。v1では踏み込まない。

### 5.7 CSVの「配置先事業部」列の取込（確定事項 3-4）

**既存のパーサは1行も変えない。** `parseEmployeesCsv` の戻り値型を変えると `#p4` にも波及するため。

```ts
// constants.ts に追加（新規定数・既存の COLUMN_MAP には触らない）
export const ASSIGNMENT_COLUMN = ['配置先事業部', '配置先', '事業部', 'unit', 'assigned_unit'] as const

// csv.ts に追加（新規関数）
/** CSVから配置先事業部列だけを読む。列が無ければ null（＝分岐2）。 */
export function parseAssignmentColumn(text: string): {
  assignment: Record<string, UnitId> | null
  errors: ValidationError[]
}
```

- 値の解釈は `UNIT_LABEL` の逆引き（`'A事業部'`）を第一候補、`'A'` 単独も許容。
  前後の空白は落とす。大文字小文字は区別しない
- 出力時の `'` ガードは `stripFormulaGuard` で剥がす（`csv.ts:239` と同じ往復対称の扱い・`CLAUDE.md` §8）
- **一部の行だけ空・不正 → `assignment: null` を返し `errors` に行番号を積む**（§5.1）。
  部分的な配置案は採用しない
- 取込済みの100名の `Employee[]` と突き合わせ、ID が一致しない行はエラーに含める

### 5.8 プール対応の異動内訳（§2.5 の穴をふさぐ）

`whatif.diffAssignment` は変更しない。`hiringWorkbench.ts` に新設する。

```ts
export type HiringDiff =
  | { kind: 'move'; from: UnitId; to: UnitId; count: number }   // 既存社員の異動
  | { kind: 'hire'; to: UnitId; count: number }                 // 採用してその事業部へ
  | { kind: 'decline'; from: UnitId; count: number }             // いったん配属→見送りに戻した

export function diffWithPool(
  baseline: Record<string, UnitId>,
  current: Record<string, UnitId>,
  roster: Employee[],
): HiringDiff[]
```

- **`baseline` のキーではなく `roster` を走査する**（§2.5 の穴2）
- `undefined → UnitId` を `hire`、`UnitId → undefined` を `decline`、
  `UnitId → 別UnitId` を `move` に分類（§2.5 の穴1）
- 表示は「採用：A 1名／B 1名／C 2名 ／ 見送り 2名」。分岐1でロックONなら `move` は必ず0件

### 5.9 ヘッダの live 表示

1手ごとに再計算するのは `computeSimulationResult` 1回のみ（<1ms）。
`runOptimization` は作業机では**絶対に呼ばない**。

| 表示 | 計算 |
|---|---|
| 採用 k/10名 | `candidates.filter((e) => assignment[e.id] !== undefined).length` |
| 追加人件費 | `Σ(採用した候補の cost × params.costMultiplier) / COST_UNIT_DIVISOR`（`compareHiring.ts:68-70` と同じ換算・`CLAUDE.md` §8） |
| 全社売上・利益とΔ×2段 | `evaluateAssignment` の結果と2つの baseline |
| 充足率 | `headcount[u] / params.optimalHeadcount[u]`。**110名でも適正人数は100名基準**（`CLAUDE.md` §7-4） |

制約違反の扱いは `docs/workbench-plan.md` §4.6／§8-1 を踏襲する
（警告のみでドロップは拒否しない・feasible→infeasible の瞬間に一過性の警告）。
**§8-2 の「違反中は出力を `disabled`」は踏襲しない。** 機能16 が門を出力側へ移し
「保存は可・出力は不可」としたため（§2.6・`export-plan.md:17`）、作業机の
[この案を保存] は違反中も押せる。

### 5.10 新規ファイルと責務

| ファイル | 責務 | 行数目安 |
|---|---|---|
| `src/renderer/hiringWorkbench.ts` | 純粋関数のみ。`HiringWorkbenchState`、プールへの出し入れ、`diffWithPool`、採用人数・追加人件費の集計、カード組み立て | 180 |
| `src/renderer/hiringWorkbenchPanel.ts` | 表示専用。4列盤面・2段Δヘッダ・ロックUI。**計算を書かない** | 250 |
| `test/hiringWorkbench.test.ts` | 純粋関数の単体テスト | 120 |
| `csv.ts` に `parseAssignmentColumn` を**追加**（既存関数は無変更） | 配置先列の取込 | 60 |
| `constants.ts` に `ASSIGNMENT_COLUMN` を**追加**（既存定数は無変更） | 列名の単一参照点 | 3 |

`renderer.ts` は「`#p5-bench-step` への遷移配線」「分岐判定の結線」の追加のみ。
`index.html` に `#p5-bench-step` の骨格、`styles.css` に4列グリッドを追加。

`#p4` の `workbench.ts` / `workbenchPanel.ts` は**変更しない**。共通化は
2つが動いてから検討する（先に共通化すると、プール・ロックという `#p4` に無い概念が
`#p4` 側の型に漏れる）。

### 5.11 「この案を保存」と機能16 への合流（確定事項 3-7）

作業机は保存までを担い、CSV/PDF の生成には一切関与しない（§2.6）。

```ts
// hiringWorkbench.ts — workbench.ts の WorkbenchExport を拡張した採用判断版
export interface HiringWorkbenchExport {
  kind: 'hiring'                    // #p4 由来の案と区別する識別子
  task: TaskId
  metric: TaskMetric
  assignment: Record<string, UnitId>  // 未採用者はキーが無い
  hiredIds: string[]                  // 採用した候補の社員番号（assignment から導出できるが明示する）
  declinedIds: string[]               // 見送った候補
  lockBase: boolean                   // どちらの検討をしたのかが後から分かる
  branch: 'existing' | 'optimal'      // 分岐1／分岐2（§5.1）
}
```

- `workbench.ts` の `WorkbenchExport` / `serializeWorkbenchState`（`workbench.ts:155,166`）は**変更しない**。
  採用判断版を `hiringWorkbench.ts` に新設する
- `hiredIds` は `assignment` から導出できるが**保存ドキュメントには明示的に持たせる**。
  出力画面が「10名中8名を採用」と書くために roster と突き合わせる必要をなくすため
- **Firestore への書き込み（`runStore.ts`）と `#p7` への遷移は Phase 3 以降**。
  機能16 の `SavedRun` は採用判断の文脈（候補・採否）を想定していないため、
  `kind: 'hiring'` を受けられるようにする拡張は**機能16 の完了後に別途合意する**
- Phase 2 では `HiringWorkbenchExport` を組み立てる純粋関数までを実装し、
  呼び出し側（保存ボタン）は Phase 3 以降に置く

---

## 6. 実装手順

各 Phase の末尾がゲート。通らなければ次に進まない。

### Phase 0：着手前（ゲート：ハッシュ取得）

1. `git status --short` で別セッションの未コミット変更を確認
   （2026-09-03 時点で `profilePanel.ts` / `profileStore.ts` / `photo.ts` が未コミット）
2. `npm test` と `npm run snapshot` を実行し、**着手前のハッシュを記録**

### Phase 1：`parseAssignmentColumn` と分岐判定（ゲート：`npm test` 通過・UIなし）

`constants.ts` の定数追加、`csv.ts` の新関数、`test/csv.test.ts` に往復テスト追加。
- `buildAssignmentCsv` の出力を `parseAssignmentColumn` に戻すと元の配置に一致すること
- 列が無いCSVで `assignment: null` を返すこと
- 一部の行が空のCSVで `null` ＋ エラー行番号を返すこと
- `'` ガード付きの値を剥がせること

### Phase 2：`hiringWorkbench.ts`（ゲート：`npm test` 通過・UIなし）

純粋関数と `test/hiringWorkbench.test.ts` を同時に書く。
- プールへ出すと `assignment` からキーが消え、`computeSimulationResult` の全社売上が下がること
- プールへ出した社員の人件費が `companyProfit` に含まれなくなること
- `diffWithPool` が `hire` / `decline` / `move` を正しく分類すること
- `lockBase: true` のとき base の社員を動かそうとしても状態が変わらないこと
- 採用人数・追加人件費の集計が `compareHiring.ts` と同じ換算になること
- `HiringWorkbenchExport` の `hiredIds` / `declinedIds` が `assignment` と整合すること（§5.11）

### Phase 3：遷移とステップ骨格（ゲート：`npm run dev` で往復できる）

`#p5-bench-step` の骨格、`#p5-result-step` からの遷移ボタン、`p5-bench-back` の配線。
`showStep`/`currentStep` は §2.1 のとおり既に3値対応済みなので**変更不要**。
パンくずが「トップ ▸ データ取込 ▸ 採用判断 ▸ 作業机」になることを確認。

### Phase 4：盤面と操作（ゲート：`npm run dev` で手動確認）

`hiringWorkbenchPanel.ts`。**クリック操作を先に作り、動いてから D&D を上に乗せる**
（`docs/workbench-plan.md` §4.4 と同じ順序）。ロック・2段Δ・4ボタンまで含める。

### Phase 5：仕上げ（ゲート：全ゲート再走＋ドキュメント）

1. `npm test` / `npm run lint` / `npm run snapshot`（**Phase 0 のハッシュと完全一致**）
2. `npm run build` → `firebase deploy`（`CLAUDE.md` §9）。デプロイ後に公開URLを伝える
3. `README.md` の実装状況に追記
4. `CLAUDE.md` §5 に `hiringWorkbench.ts` / `hiringWorkbenchPanel.ts` を追加し、
   `#p5` を「`import`→`result`→`bench` の3ステップ」に直す。テスト件数も実数に揃える

---

## 7. 受入基準

1. `npm test` 全通過・`npm run lint` クリーン
2. **`npm run snapshot` のハッシュが着手前と完全一致**
3. `git diff` に `calcEngine.ts` / `optimizer.ts` / `assignment.ts` / `whatif.ts` の変更が**含まれない**
   （`constants.ts` は `ASSIGNMENT_COLUMN` の追加のみ、`csv.ts` は新関数の追加のみ）
4. 配置先事業部列**なし**のCSVで `#p5` に入ると分岐2になり、課題×指標の選択が出る
5. 配置先事業部列**あり**のCSVで `#p5` に入ると分岐1になり、取込レポートに検出の旨が出る
6. 作業机を開いた直後、候補10名が**全員プール列にいる**
7. 分岐1で開いた直後、上段Δ（採用前比）が全項目 0.00（＝起点が取り込んだ現行配置そのもの）
8. 候補を1名A列にドラッグすると、採用人数・追加人件費・全社売上・全社利益・A列の充足率が同時に更新される
9. その候補をプールに戻すと、追加人件費が元に戻り、全社利益が採用前の値に戻る
10. 同じ操作をクリック（カード選択→列ヘッダ）でも実行でき、D&Dと結果が一致する
11. ロックON時、既存100名のカードはドラッグできず「組み直す」が `disabled`
12. ロックOFFにすると既存社員が動かせるようになり、「組み直す」が押せる
13. 10名全員を採用した状態の全社売上が、`#p5` 結果ステップの「採用後」カードの値と一致する
     （分岐2・同じ課題×指標のとき）
14. C事業部を9名まで減らすと最低人数の警告が列ヘッダに出る（操作はブロックされない）
14b. **ロックを外しても既存社員はプール列に入らない**（D&Dはドロップ不可カーソル、
    クリックでは理由が警告に出る）。全員をプールへ落とそうとしても既存100名は事業部に残る（§5.5.1）
15. 全社売上が58億を下回るとヘッダに赤ピルが出る。**[この案を保存] は押せるまま**（§5.9・機能16 §4.5）
16. 社員番号に `<script>` を含むCSVを取り込んでも、カードに生のHTMLが混入しない（`escapeHtml`）
17. `#p7` が出力したデータCSV（`buildAssignmentCsv` 由来）を `#p5` の左欄に戻すと、
    分岐1として配置ごと復元できる（往復。Phase 1 の `parseAssignmentColumn` はこれを単体で守る）

---

## 8. やってはいけないこと

- **`calcEngine.ts` / `optimizer.ts` / `assignment.ts` / `whatif.ts` を変更すること。**
  未採用はキー削除で表現でき、既存関数がそのまま正しく動く（§2.2）
- **`whatif.diffAssignment` を「直す」こと。** 穴（§2.5）は承知のうえで、
  `hiringWorkbench.ts` 側にラッパを新設する（`docs/workbench-plan.md` §9 の申し送り）
- **`optimizer.ts` の内部関数を export させること。** ロック時は `disabled` で逃げる（§5.6）
- **`solveForHeadcount` に未採用者を渡すこと。** ソルバが採否まで決め直してしまう（§5.6）
- **作業机から `runOptimization` を呼ぶこと。** 最悪1.2秒UIが固まる
- **`#p4` の `workbench.ts` / `workbenchPanel.ts` にプール・ロックを持ち込むこと。**
  共通化は2つが動いてから（§5.10）
- **作業机から直接 CSV / PDF を出すこと。** 出力は機能16 の `#p7` に任せる（§2.6・§5.11）
- **`workbench.ts` の `WorkbenchExport` / `serializeWorkbenchState` を書き換えること。**
  採用判断版を新設する（§5.11）
- **部分的な配置案を補完すること。** 一部の行が空なら分岐2に落とす（§5.7）
- **右欄（追加10名）の配置先列を読むこと。** 候補は必ずプールから始まる（§5.1）
- **既存社員をプール列へ落とせるようにすること。** 解雇の判断はこのアプリの守備範囲外（§5.5.1）
- **人数配分を独立した状態として持つこと。** `assignment` から毎回導出する
- **baseline を作業机の操作で上書きすること。** 2本ともタッチしない
- **外部ライブラリを追加すること。** CSP とブラウザ標準API完結の方針に反する
- **Desktop 配下の設計書・製品カタログを編集すること**

---

## 9. 未決事項・申し送り

- **`compareHiring.ts` の結果ステップは10名全員前提のまま維持する。** 作業机で
  8名採用に絞っても、`#p5` の左右2枚のカードは「100名 vs 110名」を表示し続ける。
  ここを連動させるかは v1 の後に判断する（連動させると「比較」の基準が動いてしまう）
- **「何名採るのが最適か」の自動探索**（§2.3）は道筋だけ記録済み。実装する場合は
  k=0..10 で `enumerateHeadcounts(100+k, params)` を回す形になり、数秒かかるため
  ローディング演出が要る
- 別セッションが同じツリーを触っている。`Edit` が「ファイルが変更されている」で
  失敗したら読み直すこと（2026-09-03 時点で `profilePanel.ts` 系と、機能16 の
  `exportDocs.ts` / `exportPanel.ts` / `runStore.ts` が未コミット）
- **Phase 3 以降は機能16 の完了待ち。** `renderer.ts` の `Step` 型に機能16 が
  `'list' | 'export'` を追加中（`export-plan.md:127`）で、本書は `#p5-bench-step` の
  ために同じ箇所を触る。`index.html` / `styles.css` も同様。
  Phase 1・2 は追加のみ・新規ファイルのみで衝突しないため先行してよい
- **2026-09-03 の Phase 0 実測**：`npm test` 115件全通過・`npm run snapshot` 一致。
  これが受入基準1・2 の照合相手
