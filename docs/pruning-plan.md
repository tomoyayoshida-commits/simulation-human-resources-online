# 最適化の枝刈り方針

枝刈りの具体手順を提案する。**アルゴリズム変更（§9で事前確認必須）**なので、実装前の合意用として書く。

## 方針：branch-and-bound（上界による探索打ち切り）

配分候補そのものを機械的に絞る（危険）のではなく、**各候補をMCMFで解く前に「最良候補を超えられない」と証明できたら解かずに捨てる**。安全性の根拠は「緩和問題の最適値は本問題の最適値以上＝有効な上界」であること。

### 前提（安全性の要）

1. MCMFが最大化する `Σ value(i,Xi)` は、`primaryMetric*1e6 + companyRevenue`（＝§7-1の辞書式スカラー）とアグリゲートで一致する（`buildValues`の合成そのもの）。
2. 外側の`isBetter`（primary→secondary→nA→nB）は、この合成スカラーと**単調**（`LEX_WEIGHT=1e6`がsecondaryの逆転を許さない設計のため）。
   → 合成スカラーの上界で枝刈りすれば、`isBetter`基準の最適解を落とさない。
3. **候補の反復順は結果に影響しない**（`isBetter`がnA/nBまで含む全順序で勝者を決めるため、iteration orderは無関係）。よって並べ替えは自由。

### 手順

**① 貢献度の事前計算（1回）**
`contribution(e,unit)` は配分に依存しないので全社員×3事業部を先に計算してキャッシュ。`revValue = (BASE*GROWTH/100 * eff[unit]) * contribution` と分離できる。

**② 候補ごとの上界 UB（MCMFの前、O(n) 程度）**
- 現行どおり `eff` と `buildValues`（＝各社員×事業部の合成値）を計算。
- **各事業部Xについて、合成値 `value(i,X)` の上位 `counts[X]` 件を単純合計**し、3事業部で足す。
- 「1社員は1事業部」という排他制約を外した緩和なので、実MCMF最適値 ≤ UB（有効な上界）。
- コストは選択（quickselect/部分ソート）でO(n)〜O(n log n)。MCMFの `N×V²` に比べ無視できる。

**③ 最良優先＋早期打ち切り**
- 全候補のUBを計算 → **UB降順にソート**して反復。
- 各候補で：`best !== null` かつ `UB < objectiveScalar(best) − EPS` なら、**以降の候補は全てUBが小さいので break**（枝刈りではなく探索終了）。
- そうでなければ従来どおり `solveAssignment → computeSimulationResult → isBetter` で更新。
- `objectiveScalar(result,task)` は`buildValues`と同じ基底で丸め後値から算出：
  - 課題1: `companyRevenue*1e6`
  - 課題2: `A.profit*1e6 + companyRevenue`
  - 課題3/4: `B|C.finalRevenue*1e6 + companyRevenue`

**④ 実行不能フォールバック（closest）の扱い**
- `closest`（全社売上最大）は `best===null` のときだけ使われる。
- **打ち切りは `best!==null` のときのみ発生**させる → `best` を返す局面なので `closest` は不使用、不整合は起きない。
- 全候補が実行不能な稀ケースは `best===null` のまま最後まで解く（＝この場合だけ高速化なし、正当性優先）。UB降順なので実行可能候補は通常すぐ見つかり `best` が立つ。

### EPS（丸め誤差マージン）

- 候補側UBは丸め前、`objectiveScalar(best)`は丸め後 → 差分を吸収する必要。
- 丸めによるprimaryの上振れ ≲ 0.02億 → スカラーで `0.02×1e6 = 2e4`。secondary上振れ ≲ 0.03。
- **`EPS = 1e5`（primary換算0.1億、実誤差の約5倍）を提案**。大きめでも「枝刈りが弱まるだけで誤答は起きない」側なので安全。緩和ギャップ（通常数億×1e6）に対しEPSは十分小さく、枝刈り効果はほぼ落ちない。

### 期待効果

- 最良優先で強い暫定解を即獲得 → 大多数の候補をbreakで飛ばせる。約10秒 → 体感数秒を見込む（確約はしない）。

### 検証計画（§9準拠・実装の必須ゲート）

1. 新旧実装を並走させ、**実データ `human_resources_100.csv` の4課題で配置・売上・利益が完全一致**を確認。
2. ランダム社員データ（採用後110名含む）で旧実装と全一致するプロパティテストを追加。
3. `npm test` 全通過後に差し替え。
