import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// 設計書§0/§1:
//  - レンダラーは src/renderer をルートとし、ブラウザ標準API(File API/DOM)のみで完結
//  - メインは src/main/main.ts で BrowserWindow を生成するのみ（preload不要）
export default defineConfig({
  root: path.join(rootDir, 'src/renderer'),
  build: {
    outDir: path.join(rootDir, 'dist'),
    emptyOutDir: true,
  },
  plugins: [
    electron({
      main: {
        entry: path.join(rootDir, 'src/main/main.ts'),
        // レンダラールートが src/renderer のため、メイン成果物の出力先を
        // プロジェクトルートの dist-electron に固定する（package.json の main と一致させる）。
        vite: {
          build: {
            outDir: path.join(rootDir, 'dist-electron'),
          },
        },
        // 既定では vite ルート(src/renderer)をアプリパスとして electron が起動され
        // package.json を見つけられないため、プロジェクトルートを明示して起動する。
        onstart({ startup }) {
          startup([rootDir, '--no-sandbox'])
        },
      },
    }),
  ],
})
