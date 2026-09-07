# Movez ロゴアセット（案1：クラシック、枠線なし）

## ファイル

| ファイル | 用途 |
|---|---|
| `movez-logo-light-bg.svg` | 明背景用。ov＝ダークグレー(`#1A1A1A`) |
| `movez-logo-dark-bg.svg` | 暗背景用。ov＝白(`#FFFFFF`) |
| `png/movez-logo-{light,dark}-bg-{200,400,800,1600}.png` | 上記2種のラスター書き出し（透過背景・幅px指定） |

SVGが原本。PNGは表示崩れ確認用・SVG非対応箇所用の書き出し。

## カラー

| 文字 | 色 | 用途 |
|---|---|---|
| M | `#8B2FE8`（紫） | スポーティさ |
| ov | 明背景=`#1A1A1A` / 暗背景=`#FFFFFF` | 背景に応じて切替 |
| ez | `#22C55E`（緑） | さわやかさ |

## フォント

`Poppins` ExtraBold(800) 指定。未導入環境では太字sans-serifへフォールバックする
（`docs/logo-proposals.html` はGoogle Fonts経由でPoppinsを読み込む。アプリ本体に組み込む際は
`@fonts-face`でのセルフホスト、またはCSSで別途Poppinsを読み込むこと）。

## 使い分け

- ヘッダー（濃色背景）・ダークモード → `dark-bg`版
- 白背景の資料・印刷物 → `light-bg`版
- ブランドカラーのグラデーション背景上では、コントラストを見てどちらか選ぶ（`docs/logo-proposals.html`で確認可）
