// 機能15／15b 作業机のドラッグ&ドロップ配線（両画面で共有・DOM操作あり）。
//
// workbenchPanel.ts と hiringWorkbenchPanel.ts が同じ処理を二重に持っていた層。
// 実際の差は「列の目印（data-unit / data-hslot）」「ルートid」「行き先の型」「置けるかの判定」
// 「バッジの文言」だけで、バッジの位置合わせ・列の強調・dragover での再計算抑制といった
// 込み入った部分は完全に同一だった。片方だけ直る事故を防ぐためここへ集約する。
//
// ドラッグ中だけ意味を持つ状態（掴んでいる社員・基準売上・強調中の列・バッジ寸法）は
// このコントローラが持つ。呼び出し側の view から消せるのは、これらを読むのがこの層だけのため。

import { round2 } from './constants.ts'
import { $ } from './dom.ts'

/** 行き先 T は #p4 が UnitId、#p5 が HiringSlot（'A'|'B'|'C'|'pool'）。 */
export interface DragConfig<T> {
  /** 作業机のルート要素id（wb-root / hwb-root） */
  rootId: string
  /** 列を指すセレクタ（[data-unit] / [data-hslot]） */
  slotSelector: string
  /** 列要素から行き先を取り出す */
  slotOf(colEl: HTMLElement): T
  /** 作業机が開かれているか（state を持っているか） */
  isReady(): boolean
  /** その社員を掴めるか。#p5 はロック中の既存社員を掴ませない（§5.5） */
  canGrab(id: string): boolean
  /** ドラッグ開始時点の全社売上。ドラッグ中は state が変わらないので1回だけ求める（§7） */
  baseRevenue(): number
  /**
   * その列を受け入れるか。#p5 のプールは追加採用候補の専用列（§5.5.1）。
   * false の列では preventDefault しない＝ブラウザ標準の「ドロップ不可」カーソルになるので、
   * 落としてから断られるより手前で止まる。
   */
  accept(id: string | null, slot: T): boolean
  /** その列へ移した場合の全社売上 */
  previewRevenue(id: string, slot: T): number
  /** カーソル追従バッジの文言 */
  badgeText(slot: T, delta: number): string
  /** ドロップ確定 */
  onDrop(id: string, slot: T): void
}

export interface DragController {
  /** 委譲リスナを1回だけ張る（呼び出し側の init*Panel から） */
  attach(root: HTMLElement): void
  /** 作業机を開き直したときにドラッグ状態を捨てる */
  reset(): void
}

export function createDragController<T>(cfg: DragConfig<T>): DragController {
  let dragEmployeeId: string | null = null
  let dragBaseRevenue = 0
  /** いまプレビューを出している列。同じ列の中で動いている間は再計算しないための番人（§7） */
  let hoverSlot: T | null = null
  /** カーソル追従バッジの寸法。持っておくと画面端でのはみ出し補正を計測なしで済ませられる */
  let badgeSize = { w: 0, h: 0 }

  /** イベント発生位置の列。ドラッグ系4ハンドラが同じ探索をしていたのを1箇所に。 */
  function columnAt(e: Event): HTMLElement | null {
    return (e.target as HTMLElement | null)?.closest<HTMLElement>(cfg.slotSelector) ?? null
  }

  function badgeEl(): HTMLElement | null {
    return $(cfg.rootId)?.querySelector<HTMLElement>('.wb-drag-badge') ?? null
  }

  /** バッジをカーソルの右下に置く。画面右端・下端では内側へ折り返す。 */
  function moveBadge(x: number, y: number): void {
    const el = badgeEl()
    if (!el || el.hidden) return
    const gap = 14
    const edge = 8
    el.style.left = `${Math.max(edge, Math.min(x + gap, window.innerWidth - badgeSize.w - edge))}px`
    el.style.top = `${Math.max(edge, Math.min(y + gap, window.innerHeight - badgeSize.h - edge))}px`
  }

  /** 列のドロップ強調を消す。 */
  function clearDropHint(colEl: Element | null | undefined): void {
    colEl?.classList.remove('drop-hover')
  }

  /** どの列にもプレビューが出ていない状態へ戻す。 */
  function clearAllDropHints(): void {
    if (hoverSlot === null) return
    $(cfg.rootId)?.querySelectorAll<HTMLElement>(cfg.slotSelector).forEach((el) => clearDropHint(el))
    const el = badgeEl()
    if (el) el.hidden = true
    hoverSlot = null
  }

  /** その列へ移した場合の全社売上差をバッジに出し、列を強調する。 */
  function showDropHint(colEl: HTMLElement, slot: T): void {
    if (dragEmployeeId === null || !cfg.isReady()) return
    const d = round2(cfg.previewRevenue(dragEmployeeId, slot) - dragBaseRevenue)
    const el = badgeEl()
    if (el) {
      // バッジは列から離れて浮くので、どこへ移す話なのかを行き先の名前で示す
      el.textContent = cfg.badgeText(slot, d)
      el.hidden = false
      badgeSize = { w: el.offsetWidth, h: el.offsetHeight }
    }
    colEl.classList.add('drop-hover')
    hoverSlot = slot
  }

  function handleDragStart(e: DragEvent): void {
    const cardEl = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-emp]')
    if (!cardEl || !cfg.isReady()) return
    const id = cardEl.dataset.emp ?? ''
    if (!cfg.canGrab(id)) {
      e.preventDefault()
      return
    }
    dragEmployeeId = id
    hoverSlot = null
    dragBaseRevenue = cfg.baseRevenue()
    e.dataTransfer?.setData('text/plain', id)
  }

  /**
   * プレビューの表示位置判定はここに一本化する（機能15の判定幅拡張）。
   * dragenter/dragleave は列の中の社員カードをまたぐたびに発火し、しかも
   * 「新しい要素へenter → 古い要素をleave」の順で来るため、enterで出した吹き出しを
   * 直後のleaveが消してしまい、実質ヘッダ周辺でしか見えなかった。
   * dragoverなら列の全域（社員カードの上を含む）で毎フレーム位置が取れる。
   * 重い previewRevenue は列が変わったときだけ呼ぶので、毎フレームの計算にはならない（§7）。
   */
  function handleDragOver(e: DragEvent): void {
    const colEl = columnAt(e)
    if (!colEl) {
      clearAllDropHints()
      return
    }
    const slot = cfg.slotOf(colEl)
    if (!cfg.accept(dragEmployeeId, slot)) {
      clearAllDropHints()
      return
    }
    e.preventDefault()
    if (slot !== hoverSlot) {
      clearAllDropHints()
      showDropHint(colEl, slot)
    }
    // 位置合わせだけは毎フレーム。計算は伴わない
    moveBadge(e.clientX, e.clientY)
  }

  function handleDragEnter(e: DragEvent): void {
    // 表示はdragover側の担当。ここはドロップ先として認めるpreventDefaultのみ。
    // 無条件にpreventDefaultすると、受け入れない列でも一瞬だけ「置ける」表示になる（§5.5.1）。
    const colEl = columnAt(e)
    if (colEl && cfg.accept(dragEmployeeId, cfg.slotOf(colEl))) e.preventDefault()
  }

  function handleDragLeave(e: DragEvent): void {
    // 作業机の外へ出たときだけ消す。列や社員カードをまたぐdragleaveでは消さない。
    // relatedTargetを返さないブラウザでは何もせず、dragend側の全消しに任せる。
    const root = $(cfg.rootId)
    const to = e.relatedTarget as Node | null
    if (root && to && !root.contains(to)) clearAllDropHints()
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    const colEl = columnAt(e)
    clearAllDropHints()
    const id = e.dataTransfer?.getData('text/plain') || dragEmployeeId
    dragEmployeeId = null
    if (colEl && id) cfg.onDrop(id, cfg.slotOf(colEl))
  }

  function handleDragEnd(): void {
    dragEmployeeId = null
    clearAllDropHints()
  }

  return {
    attach(root: HTMLElement): void {
      root.addEventListener('dragstart', handleDragStart)
      root.addEventListener('dragover', handleDragOver)
      root.addEventListener('dragenter', handleDragEnter)
      root.addEventListener('dragleave', handleDragLeave)
      root.addEventListener('drop', handleDrop)
      root.addEventListener('dragend', handleDragEnd)
    },
    reset(): void {
      dragEmployeeId = null
      hoverSlot = null
      dragBaseRevenue = 0
    },
  }
}
