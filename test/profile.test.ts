// docs/profile-plan.md §4.4: 名簿CSV取込とファイル名突き合わせのテスト（node:test）。
//
// 対象は純粋関数のみ。Firestoreアクセス(profileStore.ts)と画像縮小(photo.ts)は
// ブラウザAPI依存のためここでは扱わない（動作確認は本番URLで作業者が行う・CLAUDE.md §9）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importProfiles, matchProfilePhotos } from '../src/renderer/csv.ts'

const HEADER = '社員番号,氏名,写真ファイル名'

test('importProfiles: 正常な名簿CSVを取り込める', () => {
  const csv = [HEADER, 'E001,吉田智哉,IMG_2043.jpg', 'E002,田中一郎,IMG_2044.jpg'].join('\n')
  const { rows, errors } = importProfiles(csv)
  assert.equal(errors.length, 0)
  assert.deepEqual(rows, [
    { id: 'E001', name: '吉田智哉', photoFile: 'IMG_2043.jpg' },
    { id: 'E002', name: '田中一郎', photoFile: 'IMG_2044.jpg' },
  ])
})

test('importProfiles: 写真ファイル名列は省略できる（氏名だけの登録運用）', () => {
  const { rows, errors } = importProfiles(['社員番号,氏名', 'E001,吉田智哉'].join('\n'))
  assert.equal(errors.length, 0)
  assert.deepEqual(rows, [{ id: 'E001', name: '吉田智哉', photoFile: '' }])
})

test('importProfiles: BOM付き・社員ID表記のヘッダも取り込める', () => {
  const { rows, errors } = importProfiles('﻿' + ['社員ID,氏名', 'E001,吉田智哉'].join('\n'))
  assert.equal(errors.length, 0)
  assert.equal(rows?.[0].id, 'E001')
})

test('importProfiles: 件数検証をしない（追加採用10名だけでも取り込める）', () => {
  const lines = ['社員番号,氏名']
  for (let i = 1; i <= 10; i++) lines.push(`E${String(i).padStart(3, '0')},社員${i}`)
  const { rows, errors } = importProfiles(lines.join('\n'))
  assert.equal(errors.length, 0)
  assert.equal(rows?.length, 10)
})

test('importProfiles: 氏名の空を検出し取り込みを止める', () => {
  const { rows, errors } = importProfiles([HEADER, 'E001,,IMG_1.jpg'].join('\n'))
  assert.equal(rows, null)
  assert.ok(errors.some((e) => e.column === '氏名' && e.row === 1))
})

test('importProfiles: 社員番号の重複を検出する', () => {
  const csv = [HEADER, 'E001,吉田智哉,a.jpg', 'E001,田中一郎,b.jpg'].join('\n')
  const { rows, errors } = importProfiles(csv)
  assert.equal(rows, null)
  assert.ok(errors.some((e) => e.row === 2 && String(e.expected).includes('重複')))
})

test('importProfiles: 数式始まりの社員番号を検出する', () => {
  const { rows, errors } = importProfiles([HEADER, '=cmd,吉田智哉,a.jpg'].join('\n'))
  assert.equal(rows, null)
  assert.ok(errors.some((e) => String(e.expected).includes('数式')))
})

test('importProfiles: ヘッダのみ・空ファイルを検出する', () => {
  assert.equal(importProfiles(HEADER).rows, null)
  assert.equal(importProfiles('').rows, null)
})

test('importProfiles: 列数不揃いの行を検出する', () => {
  const { rows, errors } = importProfiles([HEADER, 'E001,吉田智哉'].join('\n'))
  assert.equal(rows, null)
  assert.ok(errors.some((e) => e.column === '(行全体)'))
})

test('matchProfilePhotos: ファイル名で写真を紐づける', () => {
  const rows = [
    { id: 'E001', name: '吉田智哉', photoFile: 'IMG_2043.jpg' },
    { id: 'E002', name: '田中一郎', photoFile: 'IMG_2044.jpg' },
  ]
  const match = matchProfilePhotos(rows, [{ name: 'IMG_2043.jpg' }, { name: 'IMG_2044.jpg' }])
  assert.deepEqual(
    match.pairs.map((p) => p.file?.name),
    ['IMG_2043.jpg', 'IMG_2044.jpg'],
  )
  assert.deepEqual(match.missingFiles, [])
  assert.deepEqual(match.unusedFiles, [])
})

test('matchProfilePhotos: 拡張子の大文字小文字が違っても一致する', () => {
  const match = matchProfilePhotos([{ id: 'E001', name: '吉田智哉', photoFile: 'IMG_2043.JPG' }], [{ name: 'img_2043.jpg' }])
  assert.equal(match.pairs[0].file?.name, 'img_2043.jpg')
  assert.deepEqual(match.unusedFiles, [])
})

test('matchProfilePhotos: NFD（macOS由来）の濁点でも一致する', () => {
  // macOSは濁点を結合文字に分解して保存する。分解の対象になるのは仮名なので、
  // 濁点を含む仮名のファイル名（わたなべ）で再現する（漢字はNFDでも分解されない）。
  const nfd = 'わたなべ.jpg'.normalize('NFD')
  const nfc = 'わたなべ.jpg'.normalize('NFC')
  assert.notEqual(nfd, nfc) // 前提：この2つは素の文字列比較では一致しない
  const match = matchProfilePhotos([{ id: 'E001', name: '吉田智哉', photoFile: nfd }], [{ name: nfc }])
  assert.equal(match.pairs[0].file?.name, nfc)
  assert.deepEqual(match.missingFiles, [])
})

test('matchProfilePhotos: 見つからない写真・使われない写真を両方報告する', () => {
  const rows = [
    { id: 'E001', name: '吉田智哉', photoFile: 'missing.jpg' },
    { id: 'E002', name: '田中一郎', photoFile: 'found.jpg' },
  ]
  const match = matchProfilePhotos(rows, [{ name: 'found.jpg' }, { name: 'extra.jpg' }])
  assert.deepEqual(match.missingFiles, ['missing.jpg'])
  assert.deepEqual(match.unusedFiles, ['extra.jpg'])
  assert.equal(match.pairs[0].file, null)
})

test('matchProfilePhotos: 写真ファイル名が空の行は欠落として報告しない', () => {
  const match = matchProfilePhotos([{ id: 'E001', name: '吉田智哉', photoFile: '' }], [])
  assert.equal(match.pairs[0].file, null)
  assert.deepEqual(match.missingFiles, [])
})
