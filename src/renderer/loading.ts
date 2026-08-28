// 設計書§10: 重い同期処理（最適化計算・最大3秒程度）の間、画面が固まって見えないようにする共通の演出。
// JSは単一スレッドのため、表示を切り替えた直後に重い同期処理を始めると描画が間に合わない。
// 二重 requestAnimationFrame で1フレーム分の描画を確定させてから fn を実行する。

import { $ } from './dom.ts'

// 非表示・バックグラウンドのウィンドウ（例：E2Eテストの show:false）では
// requestAnimationFrame が間引かれる／発火しないことがあり、rAF だけに頼ると
// withLoading が永久に解決せず、以降の操作が固まったまま戻らなくなる（実際に発生した）。
// rAFは表示中の通常利用で1フレーム描画を保証するために使い、タイムアウトを保険として併用する。
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(() => requestAnimationFrame(finish))
    setTimeout(finish, 50)
  })
}

let depth = 0

/**
 * 重い同期処理を実行する共通ラッパー。#run-simulation・#p4・#p5・#p6 の各計算箇所で使う。
 * オーバーレイが画面全体のクリックを塞ぐため、処理中の多重実行を防げる。
 * ネストして呼ばれても、最も外側の呼び出しが終わるまで表示を維持する。
 */
export async function withLoading<T>(message: string, fn: () => T): Promise<T> {
  const overlay = $('loading-overlay')
  const label = document.querySelector<HTMLElement>('#loading-overlay .loading-text')
  depth += 1
  if (label) label.textContent = message
  overlay?.classList.add('active')
  await nextPaint()
  try {
    return fn()
  } finally {
    depth -= 1
    if (depth === 0) overlay?.classList.remove('active')
  }
}
