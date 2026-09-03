// 設計書§4.1/§4.3（docs/profile-plan.md）: employees マスタの読み書きとメモリキャッシュ。
// DOM操作・計算は持たない（CLAUDE.md §5）。
//
// ドキュメントIDが社員番号そのものなので、Employee との紐づけは結合ではなく参照になる。
// このファイルに「照合ロジック」は存在しない（それが本設計の要点）。
//
// web-firebase-plan.md が予定する firestoreSync.ts（datasets/simulationRuns の履歴追記）とは
// 責務が異なるため別ファイルにしてある。あちらは履歴の追記、こちらはマスタの参照。

import { collection, deleteDoc, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { EmployeeProfile, ProfileMap } from './types.ts'
import { db } from './firebase.ts'
import { isPhotoDataUrl } from './photo.ts'

const COLLECTION = 'employees'

/** Firestoreのバッチ上限は500件。110名なら1バッチで収まるが、将来の人数増に備えて分割する。 */
const BATCH_SIZE = 400

let cache: ProfileMap = {}
let loaded = false

/** 取得済みのプロフィール。未取得なら空オブジェクト（＝全員が番号のみのカードになる）。 */
export function getProfiles(): ProfileMap {
  return cache
}

/** 取得済みかどうか。再描画が要るかの判断に使う。 */
export function isLoaded(): boolean {
  return loaded
}

/**
 * employees を全件1クエリで取得する（§4.3）。
 * 特定IDだけを引く形にしないのは、Firestoreの `in` クエリが30件上限で
 * 100名を引くには分割が必要になるため。全件1クエリのほうが単純かつ速い。
 *
 * 失敗しても throw しない。Rules未デプロイ・オフライン・権限なしのいずれの場合も
 * 「氏名・顔写真なしで作業机は正常に動く」（受入基準2）のが正しい挙動であり、
 * ここで例外を投げると取込〜比較という主動線まで巻き添えで止まる。
 */
export async function loadProfiles(force = false): Promise<ProfileMap> {
  if (loaded && !force) return cache
  try {
    const snap = await getDocs(collection(db, COLLECTION))
    const next: ProfileMap = {}
    snap.forEach((d) => {
      const data = d.data() as { name?: unknown; photo?: unknown }
      next[d.id] = {
        id: d.id,
        name: typeof data.name === 'string' ? data.name : '',
        // 書き込み側の正しさに依存せず、読み出し側でも data:image かを検査する（§4.6）
        photo: isPhotoDataUrl(data.photo) ? data.photo : '',
      }
    })
    cache = next
    loaded = true
  } catch (e) {
    console.warn('人材プロフィールの取得に失敗しました。氏名・顔写真なしで続行します。', e)
  }
  return cache
}

/**
 * プロフィールを一括保存する（管理画面 #p6・§4.4）。
 * 保存後はキャッシュにも反映するので、作業机を開き直せば即座に新しい写真が出る。
 */
export async function saveProfiles(profiles: EmployeeProfile[]): Promise<void> {
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const p of profiles.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(db, COLLECTION, p.id), { name: p.name, photo: p.photo, updatedAt: serverTimestamp() })
    }
    await batch.commit()
  }
  const next: ProfileMap = { ...cache }
  for (const p of profiles) next[p.id] = p
  cache = next
  loaded = true
}

/**
 * 1名を削除する（退職者・§8-8で物理削除と決定）。
 * プロフィールは表示専用でありマスタに履歴の役割はない。配置履歴は simulationRuns 側が正。
 */
export async function deleteProfile(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
  const next = { ...cache }
  delete next[id]
  cache = next
}
