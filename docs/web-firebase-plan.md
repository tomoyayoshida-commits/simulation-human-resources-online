# Electron → Web(SPA) + Firebase 移植計画

このリポジトリはElectron版（`simulation-human-resources`、リモート: ローカルパス経由）から複製したWeb版専用リポジトリ。
リモート: https://github.com/tomoyayoshida-commits/simulation-human-resources-online.git

## 背景・方針転換

旧版はElectron製デスクトップアプリで、CLAUDE.md上「外部API・ネットワーク通信は行わない」ことを自主的な設計判断としていた。
社内の特定メンバー間でのデータ共有・履歴管理を要件化したため、以下を目的にWeb化する（2026-08-28 承認）。

- **利用者**: 社内の特定メンバー（少人数）
- **公開方法**: Firebase Hosting
- **アクセス制限**: Google認証（ログイン必須・許可リスト制）
- **データ永続化**: Firestore（CSV取込データ・配置結果を保存し、複数人・複数端末で共有・履歴管理）
- **機微情報の扱い**: 社員番号・人件費等をFirestoreに保存することは会社として許可済み

`src/renderer/`配下の全ロジック（`calcEngine.ts`, `optimizer.ts`, `assignment.ts`, `csv.ts`, `validation.ts`, `whatif.ts`等）は
既にブラウザ標準API（DOM/File API/Blob/URL）のみで実装済みのため、**アルゴリズム・数式は一切変更しない**。
今回はインフラ・配線層のみの変更。「数理最適化ライブラリ不使用」の方針は維持する。

## 段階的な実装ステップと進捗

### Phase 0: 前準備 — 完了（2026-08-28）
- CLAUDE.md §2 の「外部通信を行わない」方針を撤回する記述に更新

### Phase (a): Electron除去 → 静的Webアプリとして動作確認 — 完了（2026-08-28）
- `src/main/main.ts` および `src/main/` を削除
- `vite.config.ts` から `vite-plugin-electron` プラグインを削除
- `package.json`: `main`フィールド削除、`electron`/`electron-builder`/`vite-plugin-electron`のdevDependencies削除、
  `build`（electron-builder設定）ブロック削除、`scripts.build`を`tsc -b && vite build`に変更
- `tsconfig.node.json`: `include`から`src/main`を除去
- `npm run build` → `npx vite preview` で①〜⑥全画面・CSV取込出力の動作を確認済み（Electron版で確認後、本リポジトリに反映）
- `npm test`（65件）が無影響で通ることを確認済み
- `npm run test:e2e`は旧Electron実機E2E（`test/e2e/run.mjs`）がelectron依存除去により実行不可になったため、
  一時的に`exit 1`のプレースホルダに変更（Phase (e)でPlaywright移行するまでの既知の欠落）

### Phase (b): Firebase Hosting導入 — 完了（2026-08-28）
- Firebaseプロジェクトは既存の `summer011`（表示名: 26summer011）を流用（新規 `samurai-operation` は作成せず、ユーザー確認の上で決定）
- `firebase.json` / `.firebaserc`（`default: summer011`）/ `firestore.indexes.json`（空）/ `firestore.rules`（暫定：全拒否。Phase (d)で許可リスト方式に置き換え）を作成
- `firebase-tools` を devDependency として追加（`npx firebase` はキャッシュ未取得だと解決に失敗するため固定インストールが必要だった）
- `package.json` に `scripts.deploy`（`npm run build && firebase deploy --only hosting`）を追加
- `npx firebase login`（ユーザーが対話的に実施）→ `npx firebase deploy --only hosting` で公開確認済み
- 公開URL: https://summer011.web.app （**現時点は認証ガードなし。Phase (c)で速やかに認証必須化する**）

### Phase (c): Google Auth導入 — 未着手
- 要: OAuth同意画面の設定（社内Google Workspace利用なら「内部」に設定）
- `src/renderer/firebase.ts` / `src/renderer/auth.ts` の実装、ログイン画面・認証ガードの追加
- CSP変更の適用（`connect-src`/`frame-src`にFirebase/Google関連ドメインを追加）

### Phase (d): Firestore導入 — 未着手
- `firestore.rules` / `firestore.indexes.json` の作成・デプロイ
- `allowlist`コレクションへの社内メンバー登録
- `src/renderer/firestoreSync.ts` の実装、`renderer.ts`への保存/復元処理の追加
- Firebase Emulator Suiteでの開発フローへの切替

### Phase (e): E2Eテストのplaywright移行 — 未着手
- `test/e2e/run.mjs`（Electron実機E2E・21項目）をPlaywrightへ移植
- `playwright.config.ts`新規作成、Firebase Emulator Suiteのダミーアカウントで認証ガード後の画面を検証

## Phase (b)以降に着手するために必要な情報（ユーザー側で用意）

- Firebase/GCPプロジェクトID（新規作成 or 既存のものを利用するか）
- Google Workspace組織のドメイン（OAuth同意画面を「内部」に設定できるか）
- Firebase Hosting用のカスタムドメインの要否
- 許可リストに登録する社内メンバーのメールアドレス一覧

## データモデル（Firestore・Phase (d)で導入）

```
/allowlist/{emailLower}                     -- 許可ユーザー
/datasets/{datasetId}                       -- CSV取込1回分（Employee[]を埋め込み）
/simulationRuns/{runId}                     -- シミュレーション実行1回分（SimulationResultを埋め込み）
```

いずれも「追記のみ・更新削除不可」のSecurity Rulesとし、履歴の完全性を保つ。
詳細な設計判断・Security Rules全文・CSP変更案は実装時のコミットメッセージおよび該当コードのコメントを参照。
