# 人材配置シミュレーター

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
    types.ts / constants.ts        型・事業部別定数（§2）
    csv.ts / validation.ts         CSV入出力・入力検証（§3,§7,§8）
    calcEngine.ts                  貢献度〜利益の計算（§4）
    assignment.ts / optimizer.ts   割当（min-cost flow）・最適化（§5）
    reasonText.ts                  配置方針テキスト生成（§9）
    dashboard.ts / compareTasks.ts / compareHiring.ts  DOM更新（§10）
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
- [ ] 手順8: electron-builder によるパッケージング（`npm run build`。設定済み・未実行）

テストは `npm test`（Node 標準 `node:test` ＋型ストリップ、設計書§11 準拠）。

## 未決事項（設計書§12）

- **CSVカラムの実体**：`human_resources_100.csv` が未取得のため、`constants.ts` の `COLUMN_MAP` は暫定（モックのヘッダ「社員ID/営業力/…」＋英語別名フォールバック）。実データ入手後に確定すること。
- **丸め桁数 `ROUND_DIGITS`**（暫定：小数第2位）。
- **コスト／利益の単位**：カタログの式どおり「コスト = Σ人件費 × 3」「利益 = 売上 − コスト」を実装。人件費(1〜20)と売上(億円)の単位関係はカタログに明記がなく、データ次第で利益が大きく負になりうる。実データで妥当性を確認すること。
