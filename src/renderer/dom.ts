// DOM取得の薄いヘルパ。表示モジュールが各自で持っていた $() を集約したもの。
// index.html のパネルは常に存在するが、要素IDの綴り違いで静かに何も描画されない事故を避けるため、
// 取得できなかった場合は「何もしない」で揃える（例外は投げない）。

/** getElementById の短縮形。 */
export function $(id: string): HTMLElement | null {
  return document.getElementById(id)
}

/** 指定IDの要素に innerHTML を流し込む。要素が無ければ何もしない。 */
export function setHtml(id: string, html: string): void {
  const el = $(id)
  if (el) el.innerHTML = html
}

/** 指定IDの要素に textContent を設定する。要素が無ければ何もしない。 */
export function setText(id: string, text: string): void {
  const el = $(id)
  if (el) el.textContent = text
}
