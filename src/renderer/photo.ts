// 設計書§4.5（docs/profile-plan.md）: 顔写真の正規化。File → 128px正方 JPEG の data URI。
//
// ブラウザAPIのみで完結させる（CLAUDE.md §9「レンダラーにNode APIを持ち込まない」）。
// Node側で縮小する案は sharp/jimp が新規依存になるため採らない。

/** サムネイルの一辺(px)。カード上の表示は40pxだが、表示密度と将来の拡大表示に余裕を持たせる。 */
export const PHOTO_SIZE = 128

/** JPEG品質。0.8で1枚3〜8KBに収まり、Firestoreの1ドキュメント1MiB制限に2桁の余裕がある。 */
export const PHOTO_QUALITY = 0.8

/** 元ファイルの上限。これを超えるものは縮小する前に弾く。 */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

/** 正規化できなかった理由を呼び出し側（管理画面）が件数と一緒に表示できるようにするための型。 */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoError'
  }
}

/**
 * 画像ファイルを 128×128 の JPEG data URI に正規化する。
 * 中央基準の正方クロップ（短辺を全部使う）。失敗時は PhotoError を投げる。
 */
export async function normalizePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoError(`画像ファイルではありません（${file.type || '種別不明'}）`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new PhotoError(`ファイルが大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB／上限10MB）`)
  }
  // imageOrientation:'from-image' は必須。省くとEXIFの回転情報が無視され、
  // スマートフォンで撮った縦位置の顔写真が横倒しのまま並ぶ（§4.5）。
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIZE
    canvas.height = PHOTO_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('canvasの2Dコンテキストを取得できませんでした')
    const side = Math.min(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY)
  } finally {
    bitmap.close()
  }
}

/**
 * Firestoreから読んだ photo をそのまま <img src> に入れてよいかの門番（§4.6）。
 * マスタの値は外部入力として扱う方針（CLAUDE.md §8）なので、書き込み側の正しさに依存せず
 * 読み出し側でも形を検査する。data:image 以外は表示しない（写真なし扱いにする）。
 */
export function isPhotoDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
}
