// 設計書§4.4（docs/profile-plan.md）: 管理画面 #p6 の表示更新。
// 表示専用で計算を持たない（CLAUDE.md §5）。取り込んだ内容の保持と保存は renderer.ts 側。
//
// 氏名・ファイル名はいずれも外部入力（CSV／Firestore由来）なので、
// innerHTML に埋めるものはすべて escapeHtml/escapeAttr を通す（CLAUDE.md §8）。

import type { EmployeeProfile, ProfileMap, ValidationError } from './types.ts'
import type { ProfileRow } from './csv.ts'
import { escapeAttr, escapeHtml, pill } from './format.ts'
import { $, setHtml } from './dom.ts'

/** 保存ボタンを押したときに書き込まれる内容と、その過程で出た警告（§4.4）。 */
export interface ProfileDraft {
  profiles: EmployeeProfile[]
  /** 片側欠落など。登録は止めない警告（§4.4） */
  warnings: string[]
}

/** ①名簿CSVの取込結果。 */
export function renderProfileCsvStatus(rows: ProfileRow[] | null, errors: ValidationError[]): void {
  if (rows === null && errors.length === 0) {
    setHtml('profile-csv-status', '')
    return
  }
  if (rows === null) {
    const list = errors
      .map((e) => `<li>${e.row === 0 ? '全体' : `${e.row}行目`}：${escapeHtml(e.column)}「${escapeHtml(e.actual)}」（期待：${escapeHtml(e.expected)}）</li>`)
      .join('')
    setHtml('profile-csv-status', `${pill('crit', `取込を保留（エラー${errors.length}件）`)}<ul class="profile-errors">${list}</ul>`)
    return
  }
  const withPhoto = rows.filter((r) => r.photoFile !== '').length
  setHtml('profile-csv-status', `${pill('good', `取込OK（${rows.length}件）`)}<span class="note">うち写真ファイル名の指定あり ${withPhoto}件</span>`)
}

/** ②顔写真の取込結果。縮小に失敗したファイルは件数と理由を出す（無視して黙らせない）。 */
export function renderProfilePhotosStatus(okCount: number, errors: string[]): void {
  if (okCount === 0 && errors.length === 0) {
    setHtml('profile-photos-status', '')
    return
  }
  const errorHtml =
    errors.length === 0 ? '' : `<ul class="profile-errors">${errors.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`
  const kind = errors.length === 0 ? 'good' : 'warn'
  setHtml('profile-photos-status', `${pill(kind, `読込${okCount}件${errors.length > 0 ? `／失敗${errors.length}件` : ''}`)}${errorHtml}`)
}

function profileCardHtml(p: EmployeeProfile, deletable: boolean): string {
  const face = p.photo
    ? `<img class="profile-face" src="${escapeAttr(p.photo)}" alt="">`
    : '<span class="profile-face profile-face-none">写真なし</span>'
  const del = deletable
    ? `<button type="button" class="profile-del" data-profile-del="${escapeAttr(p.id)}" aria-label="${escapeAttr(p.id)}を削除">✕</button>`
    : ''
  return `
    <div class="profile-item">
      ${face}
      <div class="profile-meta">
        <div class="profile-id">${escapeHtml(p.id)}</div>
        <div class="profile-name">${escapeHtml(p.name)}</div>
      </div>
      ${del}
    </div>`
}

/** 保存前のプレビューとサマリー。誤った名簿CSVでマスタを全件上書きする事故を防ぐため必ず通す（§4.4）。 */
export function renderProfileDraft(draft: ProfileDraft | null): void {
  const saveBtn = $('profile-save') as HTMLButtonElement | null
  const previewCard = $('profile-preview-card')

  if (!draft) {
    setHtml(
      'profile-summary',
      `<div class="stat"><div class="k">登録件数</div><div class="v">0</div></div>
       <div class="stat"><div class="k">写真あり</div><div class="v">0</div></div>
       <div class="stat"><div class="k">判定</div><div class="v">${pill('warn', '未取込')}</div></div>`,
    )
    setHtml('profile-warnings', '')
    setHtml('profile-preview', '')
    previewCard?.setAttribute('hidden', '')
    if (saveBtn) saveBtn.disabled = true
    return
  }

  const photoCount = draft.profiles.filter((p) => p.photo !== '').length
  setHtml(
    'profile-summary',
    `<div class="stat"><div class="k">登録件数</div><div class="v">${draft.profiles.length}</div></div>
     <div class="stat"><div class="k">写真あり</div><div class="v">${photoCount}</div></div>
     <div class="stat"><div class="k">判定</div><div class="v">${pill('good', '保存できます')}</div></div>`,
  )
  setHtml(
    'profile-warnings',
    draft.warnings.length === 0
      ? ''
      : `<div class="card profile-warn"><div class="section-title">確認（保存は可能です）</div><ul>${draft.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join('')}</ul></div>`,
  )
  setHtml('profile-preview', draft.profiles.map((p) => profileCardHtml(p, false)).join(''))
  previewCard?.removeAttribute('hidden')
  if (saveBtn) saveBtn.disabled = draft.profiles.length === 0
}

/** マスタに登録済みの一覧（1名だけの差し替え・削除の起点）。 */
export function renderRegisteredProfiles(profiles: ProfileMap): void {
  const list = Object.values(profiles).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  setHtml(
    'profile-registered',
    list.length === 0
      ? '<p class="note">まだ登録がありません。上の①②から登録してください。</p>'
      : list.map((p) => profileCardHtml(p, true)).join(''),
  )
}
