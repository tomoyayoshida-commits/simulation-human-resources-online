import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// 設計書§0/§1:
//  メインプロセスは BrowserWindow の生成のみを担う薄い層。
//  ファイルI/O・IPCは持たず、CSVの読み書きはレンダラーのブラウザ標準API側で完結させる。
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 起動時に無音でプロセスが終了した場合の最小限の保険。JS例外を userData 配下へ残す。
function logStartupError(label: string, err: unknown) {
  try {
    const logPath = path.join(app.getPath('userData'), 'startup-error.log')
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${label}\n${message}\n\n`)
  } catch {
    // ログ出力自体が失敗しても起動処理は継続する
  }
}

process.on('uncaughtException', (err) => logStartupError('uncaughtException', err))
process.on('unhandledRejection', (err) => logStartupError('unhandledRejection', err))

// 静的UIのため描画性能への依存はなく、環境依存のGPU初期化失敗を避ける保険として無効化する。
app.disableHardwareAcceleration()

process.env.APP_ROOT = path.join(__dirname, '..')

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: '侍の人材配置',
    webPreferences: {
      // レンダラーはブラウザ標準APIのみを使うため Node 連携は無効のまま
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // レンダラー/GPUのネイティブクラッシュはメインの例外ハンドラでは拾えないため、保険として記録する。
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartupError('render-process-gone', JSON.stringify(details))
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html')).catch((err) =>
      logStartupError('loadFile', err),
    )
  }
}

app.whenReady().then(createWindow).catch((err) => logStartupError('whenReady', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
