// 設計書§10: 画面初期化・各モジュールの結線
//
// このファイルが持つのは「どのモジュールをどう繋ぐか」だけ。DOM生成は各表示モジュールに任せる。
//   アプリ状態              → appState.ts
//   画面遷移・パンくず      → navigation.ts
//   リロード復元の保存      → session.ts（復元の段取りだけは結線なので下の restoreSession に置く）
//   #p4 配置比較の配線      → compareFlow.ts
//   #p5 採用判断の配線      → hiringFlow.ts
//   #p6 人材プロフィール管理 → 下の initProfileAdmin（profilePanel.ts が表示を持つ）
//   #p7 保存した配置案      → exportPanel.ts
//   認証ガード              → auth.ts と下の initAuthGuard

import type { ProfileRow } from './csv.ts'
import { importProfiles, matchProfilePhotos } from './csv.ts'
import { state } from './appState.ts'
import { go, initNavigation, renderBreadcrumb, setAfterNavigate, showStep, updateResumeButtons } from './navigation.ts'
import { readSnapshot, saveSnapshot } from './session.ts'
import { initCompareFlow, refreshDraftHint as refreshCompareDraftHint, restoreCompareFrom } from './compareFlow.ts'
import { initHiringFlow, refreshDraftHint as refreshHiringDraftHint, restoreHiringFrom } from './hiringFlow.ts'
import { initCompareModeToggle } from './compareTasks.ts'
import { initWorkbenchPanel } from './workbenchPanel.ts'
import { initHiringWorkbenchPanel } from './hiringWorkbenchPanel.ts'
import { initExportPanel, openExportFor, openRunsList } from './exportPanel.ts'
import { setupDropzone, setupFilesDropzone } from './importPanel.ts'
import { renderProfileCsvStatus, renderProfileDraft, renderProfilePhotosStatus, renderRegisteredProfiles, type ProfileEditing } from './profilePanel.ts'
import { normalizePhoto } from './photo.ts'
import { $ } from './dom.ts'
import { escapeHtml } from './format.ts'
import { completeRedirectSignIn, signInWithGoogle, signOutUser, watchAuthState } from './auth.ts'
import { deleteProfile, getProfiles, loadProfiles, saveProfiles } from './profileStore.ts'

// ---- セッション復元 ----
// リロード直後の取込データ・前提パラメータ・到達点を戻す。作業机(bench)の手動編集は対象外のため
// bench保存時はresultへ読み替える（openWorkbenchを呼ばないので編集内容そのものは復元されない）。
// 各画面への配り分けは各フローが持ち、ここは順番と画面位置だけを決める。
function restoreSession(): void {
  const snap = readSnapshot()
  if (!snap) return

  restoreCompareFrom(snap)
  restoreHiringFrom(snap)

  // #p4/#p5 は前回の到達点を各パネルのステップに戻すだけで、画面はトップに留める。
  // 勝手に前回位置へ飛ばすと「取込をやり直すつもりが作業机に着く」ため、入口は必ず利用者に選ばせる
  // （トップの「始める」＝取込から／「前回の続き」＝ここで戻した到達点から）。
  if (state.employees100 && snap.p4Step !== 'import') showStep('p4', 'result')
  if (state.hiringBase100 && state.hiringAdd10 && snap.p5Step !== 'import') showStep('p5', 'result')
  updateResumeButtons()

  // #p7 は出力対象の SavedRun をメモリにしか持たないため出力ステップは復元できない。
  // 一覧まで戻して読み直す（bench を result へ読み替えるのと同じ考え方）。
  if (snap.panelId === 'p7') {
    void go('p7')
    void openRunsList()
    return
  }

  renderBreadcrumb('p0')
}

// ---- 人材プロフィール管理(#p6)の配線（docs/profile-plan.md §4.4） ----

/** 縮小済みの顔写真1枚。matchProfilePhotos は `{ name }` だけを見るのでこの形で渡せる。 */
interface LoadedPhoto {
  name: string
  dataUrl: string
}

const profileState: { rows: ProfileRow[] | null; photos: LoadedPhoto[] } = { rows: null, photos: [] }

/**
 * 登録済み一覧で編集中の1名（①37注記/②45）。null なら誰も編集していない。
 * 専用ページを作らず、この状態を持つだけで一覧のカードをフォームに切り替える。
 */
let profileEditing: ProfileEditing | null = null

function renderRegistered(): void {
  renderRegisteredProfiles(getProfiles(), profileEditing)
}

/** 警告文で列挙する名前の上限。全件出すと100件のリストで画面が埋まる。 */
const WARN_SAMPLE = 5

function sample(names: string[]): string {
  const head = names.slice(0, WARN_SAMPLE).join('、')
  return names.length > WARN_SAMPLE ? `${head} ほか${names.length - WARN_SAMPLE}件` : head
}

/**
 * 名簿・写真・（取込済みなら）スキルCSVを突き合わせて保存内容を組み立てる。
 * 片側欠落はすべて警告であり保存は止めない（§4.4）。プロフィールは計算に入らないため、
 * 欠けていても配置比較は正しく動く。
 */
function rebuildProfileDraft(): void {
  const rows = profileState.rows
  if (!rows) {
    renderProfileDraft(null)
    return
  }
  const match = matchProfilePhotos(rows, profileState.photos)
  const profiles = match.pairs.map(({ row, file }) => ({ id: row.id, name: row.name, photo: file?.dataUrl ?? '' }))

  const warnings: string[] = []
  if (match.missingFiles.length > 0) {
    warnings.push(`名簿が指定した写真が見つかりません（${match.missingFiles.length}件）：${sample(match.missingFiles)}`)
  }
  if (match.unusedFiles.length > 0) {
    warnings.push(`名簿から参照されていない写真があります（${match.unusedFiles.length}件）：${sample(match.unusedFiles)}`)
  }
  const employees = state.employees100
  if (employees) {
    const rosterIds = new Set(employees.map((e) => e.id))
    const profileIds = new Set(rows.map((r) => r.id))
    const notInRoster = rows.filter((r) => !rosterIds.has(r.id)).map((r) => r.id)
    const notInProfiles = employees.filter((e) => !profileIds.has(e.id)).map((e) => e.id)
    if (notInRoster.length > 0) {
      warnings.push(`取込済みの社員データに存在しない社員番号です（${notInRoster.length}件）：${sample(notInRoster)}`)
    }
    if (notInProfiles.length > 0) {
      warnings.push(`名簿に無いため番号のみで表示される社員がいます（${notInProfiles.length}件）：${sample(notInProfiles)}`)
    }
  }
  renderProfileDraft({ profiles, warnings })
}

function initProfileAdmin(): void {
  setupDropzone('dropzone-profile-csv', 'file-profile-csv', (text) => {
    const { rows, errors } = importProfiles(text)
    profileState.rows = rows
    renderProfileCsvStatus(rows, errors)
    rebuildProfileDraft()
  })

  setupFilesDropzone('dropzone-profile-photos', 'file-profile-photos', (files) => {
    // 選択された時点で128pxへ縮小する（§4.5）。元のまま保持すると100名で数百MBになる。
    void (async () => {
      const loaded: LoadedPhoto[] = []
      const errors: string[] = []
      for (const f of files) {
        try {
          loaded.push({ name: f.name, dataUrl: await normalizePhoto(f) })
        } catch (e) {
          errors.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      profileState.photos = loaded
      renderProfilePhotosStatus(loaded.length, errors)
      rebuildProfileDraft()
    })()
  })

  const saveBtn = $('profile-save') as HTMLButtonElement | null
  saveBtn?.addEventListener('click', () => {
    const rows = profileState.rows
    if (!rows) return
    const match = matchProfilePhotos(rows, profileState.photos)
    const profiles = match.pairs.map(({ row, file }) => ({ id: row.id, name: row.name, photo: file?.dataUrl ?? '' }))
    const label = saveBtn.textContent
    saveBtn.disabled = true
    saveBtn.textContent = '保存しています…'
    void saveProfiles(profiles)
      .then(() => {
        profileEditing = null
        renderRegistered()
        saveBtn.textContent = `保存しました（${profiles.length}件）`
      })
      .catch((e: unknown) => {
        saveBtn.textContent = label ?? 'マスタに保存する'
        saveBtn.disabled = false
        window.alert(`保存に失敗しました。${e instanceof Error ? e.message : String(e)}`)
      })
  })

  // 登録済み一覧の削除（§8-8で物理削除と決定）と、1名ずつの編集（①37注記/②45）
  $('profile-registered')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return

    const editBtn = target.closest<HTMLElement>('[data-profile-edit]')
    if (editBtn?.dataset.profileEdit) {
      profileEditing = { id: editBtn.dataset.profileEdit, photo: null }
      renderRegistered()
      return
    }
    if (target.closest('[data-profile-edit-cancel]')) {
      profileEditing = null
      renderRegistered()
      return
    }
    const saveEditBtn = target.closest<HTMLElement>('[data-profile-edit-save]')
    const editId = saveEditBtn?.dataset.profileEditSave
    if (editId) {
      const name = ($('profile-edit-name') as HTMLInputElement | null)?.value.trim() ?? ''
      // 写真を差し替えていなければ現在の写真をそのまま書き戻す（saveProfiles は上書きのため）
      const photo = profileEditing?.photo ?? getProfiles()[editId]?.photo ?? ''
      void saveProfiles([{ id: editId, name, photo }])
        .then(() => {
          profileEditing = null
          renderRegistered()
        })
        .catch((err: unknown) => window.alert(`更新に失敗しました。${err instanceof Error ? err.message : String(err)}`))
      return
    }

    const btn = target.closest<HTMLElement>('[data-profile-del]')
    const id = btn?.dataset.profileDel
    if (!id) return
    if (!window.confirm(`${id} のプロフィールを削除します。よろしいですか？`)) return
    void deleteProfile(id)
      .then(() => {
        if (profileEditing?.id === id) profileEditing = null
        renderRegistered()
      })
      .catch((err: unknown) => window.alert(`削除に失敗しました。${err instanceof Error ? err.message : String(err)}`))
  })

  // 編集フォームの写真差し替え。登録時と同じく選んだ時点で128pxへ縮小する（§4.5）
  $('profile-registered')?.addEventListener('change', (e) => {
    const input = e.target
    if (!(input instanceof HTMLInputElement) || input.id !== 'profile-edit-photo') return
    const file = input.files?.[0]
    if (!file || !profileEditing) return
    const id = profileEditing.id
    void normalizePhoto(file)
      .then((dataUrl) => {
        profileEditing = { id, photo: dataUrl }
        renderRegistered()
      })
      .catch((err: unknown) => window.alert(`写真を読み込めませんでした。${err instanceof Error ? err.message : String(err)}`))
  })

  // #p6 に入るたびに最新のマスタを出す（他の人が別ブラウザで登録した分を拾う）
  document.querySelectorAll<HTMLElement>('[data-go="p6"]').forEach((el) => {
    el.addEventListener('click', () => {
      profileEditing = null
      void loadProfiles(true).then(() => renderRegistered())
    })
  })
}

// ---- 保存した配置案(#p7)の配線（docs/export-plan.md §4.1） ----
function initExportFlow(): void {
  initExportPanel((step) => showStep('p7', step))
  // #p6 と同じく、入るたびに読み直す（他の人が保存した案を拾う）
  document.querySelectorAll<HTMLElement>('[data-go="p7"]').forEach((el) => {
    el.addEventListener('click', () => void openRunsList())
  })
}

// ---- 初期化 ----
function main(): void {
  // 画面が動くたびにセッションへ書き戻す。navigation.ts から session.ts を直接呼ぶと
  // 相互参照になるため、結線はここで行う。
  setAfterNavigate(saveSnapshot)
  initNavigation()
  initCompareModeToggle()
  // 保存に成功したら #p7 の出力画面へ直行する（export-plan.md §4.1）。
  // 作業机は保存の成否だけを知り、遷移は renderer 側の責務にしてある。
  initWorkbenchPanel((run) => {
    void go('p7')
    openExportFor(run, true)
  })
  // 採用判断の作業机も同じ経路で #p7 へ渡す（機能15b §5.11）
  initHiringWorkbenchPanel((run) => {
    void go('p7')
    openExportFor(run, true)
  })
  initProfileAdmin()
  initExportFlow()
  initCompareFlow()
  initHiringFlow()
  restoreSession() // 必要なら復元した画面のbreadcrumbまで描画する

  // 作りかけ(localStorage)はタブを閉じても残るが、その存在通知は従来 restoreSession()
  // → restoreCompareFrom() 経由でしか更新されず、sessionStorage スナップショットが無い起動
  //（タブを閉じて開き直した・別タブで開いた）ではトップの「作りかけを開く」ボタンが出なかった。
  // スナップショットの有無に関わらずここで必ず引き直す。
  refreshCompareDraftHint()
  refreshHiringDraftHint()
}

// ---- 認証ガード ----
// 未ログイン・許可外アカウントの間は #login-screen のみを表示し、
// アプリ本体（#app-topbar/#app-wrap）は隠す（auth.ts参照）。
let appInitialized = false

function initAuthGuard(): void {
  $('login-google')?.addEventListener('click', () => {
    const errEl = $('login-error')
    errEl?.setAttribute('hidden', '')
    void signInWithGoogle().catch(() => {
      if (errEl) {
        errEl.textContent = 'ログインに失敗しました。社内のGoogleアカウントで再度お試しください。'
        errEl.removeAttribute('hidden')
      }
    })
  })
  $('logout-button')?.addEventListener('click', () => {
    void signOutUser()
  })

  // getRedirectResult() の解決を待ってから onAuthStateChanged を登録すると、
  // 何らかの理由で前者のPromiseが解決しない（実機で発生：identitytoolkitへの通信は
  // 200で成功しているのにgetRedirectResult自体が完了しない）場合、認証状態の反映処理が
  // 一切走らず無言でログイン画面のまま固まる。onAuthStateChangedはそれ単体で認証状態を
  // 反映できるため、待ち合わせず独立に登録する。redirectInfoはエラーメッセージの補助情報として
  // 解決でき次第使う（間に合わなければ redirected=false のまま扱う）。
  const redirectInfo: { redirected: boolean; errorCode?: string } = { redirected: false }
  void completeRedirectSignIn().then((info) => {
    redirectInfo.redirected = info.redirected
    redirectInfo.errorCode = info.errorCode
    if (info.errorCode) console.error('[auth] redirect sign-in failed:', info.errorCode)
  })

  watchAuthState((user, reason) => {
    const loginScreen = $('login-screen')
    const topbar = $('app-topbar')
    const wrap = $('app-wrap')
    const userLabel = $('login-user')
    const errEl = $('login-error')

    // 認証状態の復元が完了した（=初回コールバックが来た）ので中立画面を退場させる。
    $('auth-loading')?.setAttribute('hidden', '')

    if (!user) {
      loginScreen?.removeAttribute('hidden')
      topbar?.setAttribute('hidden', '')
      wrap?.setAttribute('hidden', '')
      // reason='disallowed' はサインイン自体は成功しドメイン外で弾かれたケース。
      // redirected(=このページ読み込みでgetRedirectResultが非nullを返したか)に関係なく必ず表示する
      // （ブラウザの既存Googleセッションで無言サインインされ即弾かれる場合、redirectedはfalseになる）。
      if (errEl && (redirectInfo.redirected || reason === 'disallowed')) {
        errEl.textContent = redirectInfo.errorCode
          ? `ログインに失敗しました（${redirectInfo.errorCode}）。社内のGoogleアカウントで再度お試しください。`
          : '許可されていないアカウントです。社内の会社アカウントでログインしてください。'
        errEl.removeAttribute('hidden')
      }
      return
    }

    loginScreen?.setAttribute('hidden', '')
    topbar?.removeAttribute('hidden')
    wrap?.removeAttribute('hidden')
    if (userLabel) userLabel.innerHTML = escapeHtml(user.email)

    if (!appInitialized) {
      appInitialized = true
      main()
      // docs/profile-plan.md §4.3: 人材プロフィールはログイン直後にバックグラウンドで取り込む。
      // ユーザーはこの後CSV取込→4課題比較（実データで約0.95〜1.6秒）と進むため、
      // 作業机に着くころには揃っている。await しないのは主動線をこの取得で待たせないため。
      void loadProfiles()
    }
  })
}

document.addEventListener('DOMContentLoaded', initAuthGuard)
