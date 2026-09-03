# 人材プロフィール（氏名・顔写真）設計・検討書

> 作業机（`#p4` bench ステップ）のカードに**氏名と顔写真**を出すための設計。
> プロフィールは Firestore のマスタに置き、**社員番号で自動的に紐づける**。
> 実装着手前の検討書。§8 の未決点はユーザー判断を待つ。

作成: 2026-09-03

---

## 1. 結論

**Firestore に `employees/{社員番号}` のマスタを置き、社員番号をドキュメントIDにする。紐づけ処理そのものを実装しない。**

1. **通常フローの入力は増えない。** 取込は今までどおりスキルCSV1本。氏名も写真もDBから来る。
2. **結合ロジックが存在しない。** カードは `profiles[employee.id]` を引くだけ。名簿CSV・ファイル名の突き合わせ・正規化はすべて管理画面側に閉じる。
3. **写真の登録は一度きり。** 初期登録と入社・退職時だけ管理画面（`#p6`）を使う。
4. **数式・定数・アルゴリズムを一切変更しない。** プロフィールは計算に入らない表示専用データ。`npm run snapshot` のハッシュ不変が実装ゲート（§5 Phase 0 / Phase 5）。

新規に要るのは「Firestore アクセス層」「画像の正規化」「管理画面」の3つ。
`optimizer.ts` / `assignment.ts` / `calcEngine.ts` / `constants.ts` は**変更しない**。

### 1.1 この機能の価値（何のために作るか）

作業机の役割は「最適解を出発点に人手で寄せ、そのコストが何億円かをその場で見せる」こと
（`docs/workbench-plan.md` §1.1）。持ち込む判断材料は相性・育成・本人の希望といった
**モデルに入っていない要素**であり、これは「その社員が誰か」が分からないと働かない。

`E037` という番号だけのカードを見て「この人は B 事業部の立ち上げに向いている」とは考えられない。
顔と名前が出て初めて、作業机は人事部長の道具になる。逆に言えば、この機能は計算精度に
1ミリも寄与しない。**評価対象（配置結果＋配置方針とその理由）の「理由」を人が作るための機能**である。

### 1.2 検討して捨てた案

| 案 | 却下理由 |
|---|---|
| `Employee` 型に `name`/`photo` を足す | `Employee` は `calcEngine`/`optimizer`/`csv` の往復と `docs/baseline-snapshot.txt` を通る計算用の型。表示専用の属性を混ぜると snapshot と CSV往復テストに無関係な差分が出る |
| 写真をCSVのBase64列に足す | 1枚100KBなら Base64 で133KB、100名で13MB。RFC4180準拠パーサに巨大クォート文字列を通すことになり、CSV往復テストも目視も実用外 |
| ZIP 1ファイル（CSV＋`photos/`） | JSZip が新規依存。マスタをDBに置けば取込が一度きりになるため「1ファイルで配布」の利点が消える |
| Firebase Storage `photos/{社員番号}.jpg` | Security Rules がもう一組・CORS設定・`img-src` 追加・`getDownloadURL()` の100往復。128px 縮小後は1枚8KBで Firestore に直接載るため割に合わない（人数が数千規模になれば再検討） |
| ファイル名規約 `photos/E001.jpg` | 元の写真ファイル名は `IMG_2043.jpg` 等。人手リネームを挟むと「**間違った顔が表示される**」という気づきにくい形で事故る |
| 毎回フォルダごと写真を取込む | 100枚の選択を毎セッション繰り返すことになる。マスタをDBに置けば不要（本計画の出発点） |

---

## 2. 調査済みの事実（再調査不要・2026-09-03 時点）

### 2.1 現在の取込経路と画面構成

- 取込UI は `dropzone-100` / `file-100`（`accept=".csv"`・`index.html:73-74`）。
- 配線は `renderer.ts:168` の `setupDropzone` → `importEmployees` → `state.employees100`。
- **`state.employees100` が `openWorkbench()` に `roster` として渡る唯一の経路**（`renderer.ts:196-207`）。
  プロフィールを作業机へ届けるには、この呼び出しに1引数足すだけでよい。
- `#p5`（採用判断）は roster を作業机に渡さない。**`#p5` にプロフィールは不要**。
- パネルは `#p0` / `#p4` / `#p5` の3つのみ（CLAUDE.md §5）。
  `#p6` は v0.8.0（`705e763`）の画面再構成で What-if パネルが撤去され**空き番**になっている。
- パネル遷移は `[data-go]` 属性（`renderer.ts:148`）、ステップ遷移は `showStep()`（`renderer.ts:82`）。

### 2.2 Firestore は未実装（CLAUDE.md との齟齬・要修正・実装とは別件）

CLAUDE.md:10 は「Firestore（永続化・履歴）を使い」と書いているが、**実装は存在しない**。

- `grep -rn 'getFirestore|firestore|getStorage' src/` → **0件**
- `firebase.ts:1-25` は `initializeApp` と `getAuth` のみ
- `firestore.rules` は「Phase (d)で許可リスト方式に置き換えるまでの暫定値」で全拒否（`allow read, write: if false`）
- `firestore.indexes.json` は空定義
- `workbench.ts:146` にも「永続化（Firestore等）自体は実装しない」と明記

したがって本計画は `docs/web-firebase-plan.md` の **Phase (d) の一部を先行実装する**ことになる。
CLAUDE.md:10 の文言修正は実装とは別件として扱う（本計画の完了時に §9 の手順で直す）。

### 2.3 CSP は変更不要

`index.html:12` の CSP は既に以下を持つ。

```
img-src   'self' data: https://*.googleusercontent.com
connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com
```

- **`img-src` に `data:` が既にある**（`index.html:7` のコメント「画像は CSV プレビュー等で data: を使う余地を残す」）。
  → data URI 直置きなら CSP 無変更で動く。Storage 案なら `https://firebasestorage.googleapis.com` の追加が必要になる。
- Firestore の通信先 `firestore.googleapis.com` は `connect-src` の `https://*.googleapis.com` に含まれる。
  → こちらも追加不要の見込み。**実機で要確認**（Phase 3 のゲート）。

### 2.4 sessionStorage には載せられない

`saveSnapshot()`（`renderer.ts:60-75`）は `state.employees100` を丸ごと `sessionStorage` に書いている。
ここに写真を含む `profiles` を足すと：

- 100名 × 約11KB（8KB の JPEG を Base64 化）＝ **約1.1〜1.5MB**。クォータ（5MB前後）を圧迫する。
- 失敗は `renderer.ts:75` の `catch {}` で握り潰されるため、**セッション復元が静かに丸ごと壊れる**。
  写真だけでなく `employees100` の復元も道連れになる。

→ **`SessionSnapshot`（`renderer.ts:49-58`）は変更しない。** プロフィールのキャッシュは §4.3 の方式で行う。

### 2.5 再利用できる既存資産

| 場所 | 使い方 |
|---|---|
| `csv.ts:20` `parseCsv` | RFC4180準拠。**非export**なので `csv.ts` 内に `importProfiles` を新設して同ファイルから呼ぶ（export を増やさない） |
| `csv.ts:99` `resolveColumns` / `constants.ts:120` `COLUMN_MAP` | 列名解決の単一参照点。プロフィール用の列表も `constants.ts` に置く |
| `importPanel.ts:65` `setupDropzone` | `onText(await file.text())` 固定でテキスト1ファイル専用。**既存は変更せず**、写真用に `setupFilesDropzone` を隣に足す |
| `format.ts` `escapeHtml` / `escapeAttr` | 氏名・data URI の埋め込みに使う（CLAUDE.md §8） |
| `auth.ts:5` `ALLOWED_DOMAIN` | Security Rules 側の判定と揃える（§4.7） |
| `validation.ts:68` 社員番号の重複検査 | 結合キーの一意性は既に強制済み。プロフィール側で再実装しない |

---

## 3. スコープ

**やる**

- `employees/{社員番号}` マスタ（氏名・顔写真）の Firestore 読み書き
- ログイン後の自動取得と、作業机カードへの氏名・顔写真の表示
- 管理画面 `#p6`：名簿CSV＋写真ファイル群からの一括登録・個別差し替え
- 画像の 128px 正規化（EXIF回転の吸収を含む）
- `employees` コレクションの Security Rules

**やらない**

- `datasets` / `simulationRuns` の永続化（`web-firebase-plan.md` Phase (d) の本体。別計画）
- `allowlist` コレクション化（`auth.ts:11` の暫定ドメイン判定のまま）
- Firebase Storage の導入
- `#p5`（採用判断）へのプロフィール表示
- CSV出力（`buildAssignmentCsv`）への氏名列追加 → §8-6
- Firebase Emulator Suite への開発フロー切替

---

## 4. 設計

### 4.1 データモデル

```
/employees/{社員番号}
  name       : string     -- 氏名（表示専用）
  photo      : string     -- data URI（image/jpeg・128×128）。未登録なら空文字
  updatedAt  : timestamp
```

**ドキュメントIDが社員番号であること自体が紐づけである。** 結合ではなく参照になるため、
照合コードもエラーハンドリングも発生しない。

`web-firebase-plan.md` の「いずれも追記のみ・更新削除不可」は**履歴コレクション
（`datasets` / `simulationRuns`）の原則**であり、`employees` はマスタなので対象外。
写真の差し替え・退職者の削除が必要なため更新を許可する。この例外は Rules のコメントに明記する。

### 4.2 型と状態

```ts
// types.ts に追加
/** 表示専用の人材プロフィール。計算には一切入らない（Employee とは社員番号で紐づく）。 */
export interface EmployeeProfile {
  id: string       // 社員番号 = Employee.id と同じ値。唯一の結合キー
  name: string
  photo: string    // data URI。空文字なら写真なし
}
export type ProfileMap = Record<string, EmployeeProfile>
```

- `WorkbenchState`（`workbench.ts:14`）に `profiles: ProfileMap` を追加。
- `WorkbenchCard`（`workbench.ts:93`）に `profile?: EmployeeProfile` を追加。
  `buildWorkbenchCards`（`workbench.ts:106`）が `state.profiles[e.id]` を焼き込む。
- **`undefined` を許すことが重要。** 未登録社員でもカードは番号のみで描画され、作業机は今までどおり動く。
  これにより Phase 1〜2 を Firestore 無しで完成させられる。
- `serializeWorkbenchState`（`workbench.ts:158`）は**変更しない**。保存対象は `assignment` のままで正しい
  （プロフィールはマスタ側にあり、配置案の一部ではない）。

### 4.3 取得タイミングとキャッシュ

1. **ログイン成功時**にバックグラウンドで `employees` コレクションを**1クエリ全件取得**（100〜110件）。
   結果は `profileStore.ts` のモジュール内キャッシュに置く。
2. ユーザーは CSV取込 → 4課題比較（実データで約0.95〜1.6秒）→ 作業机、と進むため、
   取得の待ち時間は体感されない。
3. 取得が間に合わなかった場合もカードは番号のみで描画される（§4.2）。完了後に再描画する。

**特定IDだけを引く形にはしない。** Firestore の `in` クエリは30件上限で、100名を引くには
分割が必要になる。全件1クエリのほうが単純かつ速い。

**2回目以降の読み取り**は Firestore SDK の永続キャッシュに任せる。

```ts
// firebase.ts
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache(),   // IndexedDB。sessionStorage のクォータ問題(§2.4)を回避する
})
```

SDK が IndexedDB に保持するため、`sessionStorage` を使わずに済み、
リロードのたびに100件を読み直すこともない。

### 4.4 管理画面 `#p6`（初期登録・差し替え）

**DBは自分では埋まらない。** ここだけは人が操作する。使用頻度は初期登録＋入社・退職時のみ。

- 新規パネル `#p6`（管理：人材プロフィール登録）。`#p0` から `data-go="p6"` で到達（導線は §8-2）。
- 入力は2つ：
  1. **名簿CSV** — `社員番号,氏名,写真ファイル名`（第3列は任意。氏名だけの運用も可）
  2. **写真ファイル群** — `<input type="file" accept="image/*" multiple>`
- 写真と社員番号の対応は名簿CSVの第3列で取る。ファイル名は**両側 `.normalize('NFC')` してから突き合わせる**
  （macOS 由来のファイル名は濁点が NFD になり、`吉田.jpg` が文字列一致しない）。拡張子の大文字小文字も吸収する。
- **件数検証はしない。** `importEmployees` の「100件ちょうど」検証は流用せず、
  追加採用10名も同じ画面で登録できるようにする。
- 保存前に**必ずプレビュー表を出す**（社員番号・氏名・サムネイル・状態）。
  誤った名簿CSVでマスタを全件上書きする事故を防ぐため、確認なしの即時書き込みにはしない。
- 書き込みは `writeBatch`。Firestore のバッチ上限500件に対し110件なので1バッチで収まる。
- 照合結果は4つの件数で表示する（**いずれも警告であり、登録は止めない**）：
  - 名簿にあってスキルCSV側に存在しない社員番号
  - スキルCSV側にあって名簿にない社員番号（番号のみ表示になる）
  - 名簿が参照するファイル名で、選択された写真に無いもの
  - 選択された写真で、名簿が参照していないもの
- 登録済み一覧を同画面に出し、1名だけの差し替え・削除も可能にする。

**登録を止めるのは氏名の空と社員番号の重複だけ。** プロフィールは計算に入らないため、
欠けていても配置比較は正しく動く。

### 4.5 画像の正規化（`photo.ts`）

```
File
 → createImageBitmap(file, { imageOrientation: 'from-image' })   -- EXIF回転を吸収
 → 中央基準の正方クロップ → canvas 128×128
 → toDataURL('image/jpeg', 0.8)                                   -- 1枚 3〜8KB
```

- **`imageOrientation: 'from-image'` は必須。** 省くとスマホで撮った縦位置の顔写真が横倒しで並ぶ。
- カード上の表示は 40px なので 128px で十分。等倍ではない理由は Retina 相当の表示密度と
  将来の拡大表示（§8-4）に余裕を持たせるため。
- 縮小後は Firestore の1ドキュメント1MiB制限に対し2桁の余裕がある。
- 入力側のガード：MIME が `image/` で始まること、元ファイルが 10MB 以下であること。
- ブラウザAPIのみを使う（CLAUDE.md §9「レンダラーにNode APIを持ち込まない」に適合）。
  Node 側で縮小する案は `sharp`/`jimp` が新規依存になるため採らない。

### 4.6 カードUI（`workbenchPanel.ts` / `styles.css`）

現状のカードは `workbenchPanel.ts:92-97`、スタイルは `styles.css:185-192`。

```
現在: [E001] [営業型]        変更後: [写真] [E001 吉田智哉] [営業型]
      12.34                        40px  12.34  A:12.3 B:10.1 C:8.7
      A:12.3 B:10.1 C:8.7
```

- 40px サムネイルを左、右に番号・氏名・型・貢献度の横並び。カード高さは 48px 程度。
- **一覧性は確実に落ちる。** `.wb-cards` は `max-height:520px`（`styles.css:185`）のスクロール1列なので、
  同時に見える枚数が約1/3になる。`buildActionsHtml`（`workbenchPanel.ts:131`）の操作列に
  **サムネイル表示ON/OFFトグル**を足し、俯瞰したいときは現在の密度に戻せるようにする（既定値は §8-5）。
- 写真なしのときはプレースホルダ（型バッジ色の丸＋番号下2桁）を出す。レイアウトを崩さないため。
- **氏名は `escapeHtml`、`img src` は `escapeAttr` を通す。** Firestore 由来＝外部入力として扱う
  （CLAUDE.md §8「CSV由来文字列を innerHTML に埋めるときは必ずエスケープ」と同じ方針）。
- ソートキー（`workbench.ts:114` `WorkbenchSortKey`）に氏名順を足すかは §8-3。

### 4.7 Security Rules

現状は全拒否のため、**このままでは1件も読めない**。`employees` の許可を追記する。

```
match /employees/{employeeId} {
  // employees は履歴ではなくマスタ。web-firebase-plan.md の「追記のみ・更新削除不可」原則の
  // 対象外とし、写真の差し替え・退職者の削除のため更新を許可する。
  allow read: if isMember();
  allow write: if isMember();
}

function isMember() {
  return request.auth != null
    && request.auth.token.email_verified == true
    && request.auth.token.email.matches('.*@pathoslogos[.]co[.]jp$');
}
```

- 既存の `match /{document=**} { allow read, write: if false; }` は**残してよい**。
  Firestore のルールは許可の論理和で評価されるため、`if false` は他の match の許可を打ち消さない。
- 判定条件が `auth.ts:5` の `ALLOWED_DOMAIN` と Rules の2箇所に分かれる。
  **片方だけ直すと食い違う**ため、両方に相互参照コメントを置く。
- 書き込みを全許可ユーザーに開くか管理者だけに絞るかは §8-1。

### 4.8 新規ファイルと責務

| ファイル | 責務 | 持たないもの |
|---|---|---|
| `photo.ts`（新規） | `File` → 128px JPEG data URI への正規化 | DOMツリー操作・Firestore |
| `profileStore.ts`（新規） | `employees` の読み書き＋メモリキャッシュ | DOM・計算 |
| `profilePanel.ts`（新規） | `#p6` の表示更新（CLAUDE.md §5 の「表示専用」群） | 計算・Firestore直呼び |

`web-firebase-plan.md` が予定する `firestoreSync.ts`（`datasets`/`simulationRuns` の同期）とは
**責務が異なるため別ファイルにする**。あちらは履歴の追記、こちらはマスタの参照。

**変更するファイル**

| ファイル | 変更内容 |
|---|---|
| `types.ts` | `EmployeeProfile` / `ProfileMap` 追加 |
| `firebase.ts` | `initializeFirestore` + `persistentLocalCache` で `db` を export |
| `constants.ts` | プロフィール用の列名表（`COLUMN_MAP` と同じ形） |
| `csv.ts` | `importProfiles` 追加（内部の `parseCsv` を同ファイルから利用） |
| `importPanel.ts` | `setupFilesDropzone` 追加（`setupDropzone` は変更しない） |
| `workbench.ts` | `WorkbenchState.profiles` / `WorkbenchCard.profile` |
| `workbenchPanel.ts` | カード描画・サムネイルトグル |
| `renderer.ts` | `#p6` 配線、ログイン後の取得、`openWorkbench` への `profiles` 受け渡し |
| `index.html` | `#p6` パネル追加。**CSPは変更しない**（§2.3） |
| `styles.css` | カードの横並び・サムネイル・`#p6` |
| `firestore.rules` | `employees` の許可（§4.7） |

---

## 5. 実装手順

各 Phase の終わりにゲートを満たすこと。**Phase 1〜2 は Firestore に触れない**ため、
Firebase 側の設定を待たずに着手できる。

### Phase 0：着手前の確認（ゲート：git状態の確認とハッシュ取得）

- `git status` / `git log --oneline -3` で他セッションの作業中でないことを確認
- `npm run snapshot` を実行し、実データ4課題のハッシュを控える（Phase 5 で不変を確認する）

### Phase 1：型と受け渡し（ゲート：`tsc -b` 通過・挙動不変）

- `types.ts` に `EmployeeProfile` / `ProfileMap`
- `workbench.ts` に `profiles` / `profile` を追加。`buildWorkbenchCards` で焼き込む
- `renderer.ts:199` の `openWorkbench` に空の `profiles: {}` を渡す
- **この時点で画面の見た目は一切変わらない**こと（`profile` は `undefined` のまま）

### Phase 2：カード表示（ゲート：`npm run dev` でダミーデータを流して目視）

- `workbenchPanel.ts` のカード描画に写真・氏名・プレースホルダ
- `styles.css` の横並び、サムネイルON/OFFトグル
- ダミーの `ProfileMap` をハードコードで流し込んで確認し、確認後に必ず削除する

### Phase 3：Firestore 読み取り（ゲート：手で入れた1件が作業机に出る）

- `firebase.ts` に `db`、`profileStore.ts` の取得＋キャッシュ
- `firestore.rules` を更新して `firebase deploy --only firestore:rules`
- Firebase コンソールで `employees/E001` を手動作成し、本番URLで表示を確認
- **CSP の `connect-src` が Firestore 通信を通すことをここで実機確認する**（§2.3）

### Phase 4：管理画面（ゲート：110名を登録し、再ログイン後も表示される）

- `index.html` に `#p6`、`profilePanel.ts`、`csv.ts` の `importProfiles`、`photo.ts`
- `importPanel.ts` に `setupFilesDropzone`
- プレビュー → `writeBatch` 保存 → 一覧・個別差し替え
- 実データで一括登録し、ログアウト→再ログインで復元されることを確認

### Phase 5：仕上げ（ゲート：全ゲート再走＋公開）

- `npm run snapshot` が Phase 0 のハッシュと**一致**すること（計算を触っていない証明）
- `tsc -b` / `npm run lint` / `npm test`（計算は触っていないため §9 の規約上は任意だが1回は通す）
- `npm run build` → `firebase deploy` まで実行し、公開URLを作業者に伝える（CLAUDE.md §9）
- `README.md` の実装状況を更新
- CLAUDE.md:10 の Firestore 記述を実態に合わせて修正（§2.2）

---

## 6. 受入基準

1. スキルCSVを取り込んで作業机を開くと、**追加操作なしで**カードに氏名と顔写真が出る
2. マスタ未登録の社員は番号のみのカードで表示され、ドラッグ&ドロップも再計算も正常に動く
3. サムネイルOFFにすると現在（v0.8.0）と同じ密度のカード一覧に戻る
4. `npm run snapshot` のハッシュが Phase 0 と一致する
5. 管理画面で110名を登録でき、ログアウト→再ログイン後も表示される
6. 縦位置で撮影した写真が正しい向きで表示される
7. 許可ドメイン外のアカウントでは `employees` を読めない（Rules の拒否を確認）
8. 氏名に `<script>` を含む名簿CSVを登録しても、カード上でスクリプトが実行されない

---

## 7. やってはいけないこと

- `Employee` 型に氏名・写真を足す（§1.2）
- `SessionSnapshot` に `profiles` を足す（§2.4・セッション復元が静かに壊れる）
- `calcEngine.ts` / `optimizer.ts` / `assignment.ts` / `constants.ts` のロジック変更
- `setupDropzone`（`importPanel.ts:65`）の signature 変更（`#p4`・`#p5` の4箇所が依存）
- 写真の縮小をせずに保存する（1ドキュメント1MiB制限に当たる・転送量が2桁増える）
- 名簿CSVのプレビューを飛ばして即書き込む（マスタ全件を誤って上書きする）
- `img src` / 氏名のエスケープ省略（CLAUDE.md §8）
- ついでの整形・リネーム・import並べ替え（CLAUDE.md §9・別セッションと衝突する）

---

## 8. 未決事項（ユーザー判断待ち）

### 8-1. `employees` への書き込み権限
許可ドメインのユーザー全員に開くか、管理者アカウントのみに絞るか。
推奨：**全員に開く**。社内100名規模のツールで運用者と利用者が同一集団であり、
管理者判定のために `allowlist` コレクションを先行実装するのは過剰。

### 8-2. `#p6` への導線
`#p0`（トップ）にカードとして並べるか、目立たない小さなリンクにするか。
推奨：**小さなリンク**。使用頻度が初期登録＋入社・退職時のみで、トップの3カード
（配置比較・採用判断）と並べると主動線を薄めるため。

### 8-3. カードのソートに氏名順を足すか
現在のキーは `id` / `type` / `cost` / `contribution`（`workbench.ts:114`）。
推奨：**足さない**。既定は社員番号順（`workbench-plan.md` §8-3 で確定済み）であり、
氏名の五十音順は姓名の区切りが名簿CSVにない以上、正しく並ばない。

### 8-4. カードの写真をクリックしたときの拡大表示
推奨：**v1では実装しない**。40pxで顔が判別できるかを実データで確認してから決める。

### 8-5. サムネイル表示の既定値
ON（顔が見える状態で開く）か、OFF（現在と同じ密度で開く）か。
推奨：**ON**。この機能の目的が「誰かを分かるようにする」ことなので、
既定でOFFだと機能に気づかれない。

### 8-6. 配置結果CSV（`buildAssignmentCsv`）に氏名列を足すか
推奨：**足さない（別途判断）**。氏名があれば人が読めるようになるが、
RFC4180とフォーミュラガードの往復対称性テスト（CLAUDE.md §8）に追加が要る。
本計画のスコープ外とし、必要になった時点で単独の変更として扱う。

### 8-7. 社員番号の体系が一致するか【**着手前に要確認**】
テストケース（`~/development/資料/テストケース/`）のCSVは `E001` 連番。
マスタに実在社員を登録する場合、**この番号体系と一致していないと開発中は全員が
「プロフィール未登録」になる**（動作は壊れないが、写真が一切出ない状態で開発することになる）。
一致しない場合は、開発用に `E001` 連番のダミープロフィールを別途登録する。

### 8-8. 退職者の扱い
物理削除するか、`active: false` の論理削除にするか。
推奨：**物理削除**。プロフィールは表示専用でありマスタに履歴の役割はない。
配置履歴（`simulationRuns`）は別コレクションで保持される予定であり、そちらが正である。

---

## 9. 申し送り

- 本計画は `web-firebase-plan.md` Phase (d) の**一部先行実装**にあたる。
  `datasets` / `simulationRuns` の永続化に着手する際、`firebase.ts` の `db` 初期化と
  `firestore.rules` の `isMember()` は本計画で作ったものを再利用すること。
- `persistentLocalCache`（§4.3）は `datasets` / `simulationRuns` にも効く。
  あちらの設計時に「毎回読み直す」前提で組まないこと。
- CLAUDE.md:10 の Firestore 記述と実装の齟齬（§2.2）は Phase 5 で解消する。
  それまでは**ドキュメントを信じず `grep` で実態を確認する**こと。
