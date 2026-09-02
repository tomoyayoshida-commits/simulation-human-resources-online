// 設計書: ログイン状態の監視とアクセス許可判定のみを担う。DOM操作は持たない（docs/web-firebase-plan.md Phase (c)）。
import { GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { auth } from './firebase.ts'

const ALLOWED_DOMAIN = 'pathoslogos.co.jp'

export type AuthUser = { email: string; displayName: string | null }

// Phase (d)でFirestoreのallowlistコレクション参照に差し替える予定（差し替え可能な形に切り出し済み）。
// 現状は許可リストが未整備のため、社内ドメイン一致のみで暫定判定する。
async function isAllowedMember(user: User): Promise<boolean> {
  const email = user.email?.toLowerCase() ?? ''
  return email.endsWith(`@${ALLOWED_DOMAIN}`)
}

// signInWithPopup はCOOP(Cross-Origin-Opener-Policy)によりポップアップ側のwindow.closed監視が
// ブロックされ、SDKが誤って「ユーザーがポップアップを閉じた」と判定し即座にキャンセルする既知の不具合がある
// （実機検証で再現）。リダイレクト方式（signInWithRedirect + getRedirectResult）はこの問題を回避できる。
export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider()
  // hd はUI上のヒントに過ぎず強制力がない。ブラウザが既に別アカウントでログイン済みだと
  // アカウント選択画面自体が出ずそのアカウントで無言サインインされてしまう不具合が実機で発生したため、
  // prompt: 'select_account' で毎回アカウント選択画面を強制表示する。
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' })
  await signInWithRedirect(auth, provider)
}

export type RedirectOutcome = { redirected: boolean; errorCode?: string }

// リダイレクト復帰後に一度だけ呼び、保留中のログイン結果を確定する。
// 通常のページ読み込み（リダイレクト経由でない）時は redirected=false で解決する。
// エラー時も例外を投げず errorCode に理由を詰めて返す（呼び出し側で表示・原因切り分けに使う）。
export async function completeRedirectSignIn(): Promise<RedirectOutcome> {
  try {
    const result = await getRedirectResult(auth)
    return { redirected: result !== null }
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : String(e)
    return { redirected: true, errorCode: code }
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth)
}

export type AuthChangeReason = 'disallowed' | undefined

// 許可されたユーザーのみ state=AuthUser で通知し、許可外は強制サインアウトしてnullを通知する。
// reason='disallowed' は「サインイン自体は成功したがドメイン外だった」ことを呼び出し側に区別させるための印。
// 単なる未ログイン(reason=undefined)と区別できないと、無言でログイン画面に戻ったように見えてしまう
// （signInWithRedirectがブラウザの既存セッションで無言サインインし、直後に弾かれる事故で実際に発生）。
export function watchAuthState(onChange: (user: AuthUser | null, reason?: AuthChangeReason) => void): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      onChange(null)
      return
    }
    void isAllowedMember(user).then((allowed) => {
      if (!allowed) {
        void signOut(auth).then(() => onChange(null, 'disallowed'))
        return
      }
      onChange({ email: user.email ?? '', displayName: user.displayName })
    })
  })
}
