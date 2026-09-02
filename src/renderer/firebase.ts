// 設計書: Firebaseの初期化のみを担う。計算・DOM操作は持たない（docs/web-firebase-plan.md Phase (c)）。
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

// Firebaseプロジェクト summer011 の専用Webアプリ(samurai-hr-placement)の設定値。
// Web SDKのAPIキーはクライアント埋め込み前提の識別子でありシークレットではない。
// アクセス制御はGoogle Cloud OAuth同意画面の「内部」設定・auth.tsのドメイン判定・
// Firestore Security Rules（Phase (d)）の多層で行う。
//
// authDomain は既定値(*.firebaseapp.com)ではなく実際にホスティングしているドメイン
// (summer011.web.app)に合わせる。異なるドメインのままだとsignInWithRedirect復帰後の
// ストレージ受け渡しがブラウザのサードパーティストレージ制限でブロックされ、
// ログイン画面が一瞬表示されずに戻ってくる不具合が起きる（実機検証で再現・Firebase Hostingは
// 同一ドメインで /__/auth/ を自動プロキシするためこの設定で解消する）。
const firebaseConfig = {
  apiKey: 'AIzaSyAra3z37d6_MuAhRQmkLgke2HBNeqkYvCI',
  authDomain: 'summer011.web.app',
  projectId: 'summer011',
  storageBucket: 'summer011.firebasestorage.app',
  messagingSenderId: '1088647875972',
  appId: '1:1088647875972:web:ce380af90d7f6cdc54a1d1',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
