import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// 設計書§0/§1: レンダラーは src/renderer をルートとし、ブラウザ標準API(File API/DOM)のみで完結する
// Web(SPA)化に伴い Electron 関連プラグインは撤去済み（旧 src/main/main.ts も削除済み）
export default defineConfig({
  root: path.join(rootDir, 'src/renderer'),
  build: {
    outDir: path.join(rootDir, 'dist'),
    emptyOutDir: true,
  },
})
