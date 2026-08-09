import { useReducer, useRef, useState } from 'react'

import { validateRoster } from '../../engine/deck'
import type { MemberId, Roster, RulesConfig } from '../../engine/types'
import { getAllImages, putImage, pruneImages } from '../../storage/assets'
import { parseAvatars, type AvatarMap } from '../avatars'
import { MemberRow } from '../components/MemberRow'
import { ValidationPanel } from '../components/ValidationPanel'
import { useAssetUrls } from '../hooks/useAssetUrls'
import { blobToDataUrl, dataUrlToBlob, fileToStoredImage } from '../imageResize'
import { buildBundle, bundleByteSize, formatByteSize, parseBundle } from '../rosterBundle'
import { groupSymbolOf } from '../labels'
import { nextId, rosterReducer, unassignedMembers, usedImageIds } from '../rosterEditor'
import '../settings.css'

export interface RosterEditorProps {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly defaultRoster: Roster
  /**
   * 座席アバター。**編集はしないが、画像の掃除・書き出し・ID 採番に必要。**
   * アバターとメンバー画像は同じ IndexedDB を共有しているため、
   * ここでアバターを数え落とすと保存のたびにアバターが全部消える。
   */
  readonly avatars: AvatarMap
  readonly onSave: (roster: Roster, avatars: AvatarMap) => void
  readonly onBack: () => void
}

/**
 * ロスター編集画面。
 *
 * 編集中は不正な状態を許し、**保存の可否だけを `validateRoster` で判定する**。
 * 途中経過を作れないと、グループを1つずつ組み立てる操作ができなくなる。
 */
export function RosterEditor({
  roster: saved,
  rules,
  defaultRoster,
  avatars: savedAvatars,
  onSave,
  onBack,
}: RosterEditorProps) {
  const [roster, dispatch] = useReducer(rosterReducer, saved)
  // 読み込み（import）でだけ差し替わる。この画面にアバターの編集 UI は無い。
  const [avatars, setAvatars] = useState<AvatarMap>(savedAvatars)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<MemberId | null>(null)
  const imageUrls = useAssetUrls(roster)

  const validation = validateRoster(roster, rules)
  const orphans = unassignedMembers(roster)

  async function handleFile(file: File): Promise<void> {
    const memberId = uploadTarget.current
    if (memberId === null) {
      return
    }

    setBusy(true)
    try {
      const blob = await fileToStoredImage(file)
      const imageId = nextId('img', usedImageIds(roster, avatars))

      if (!(await putImage(imageId, blob))) {
        setMessage('画像を保存できませんでした。ブラウザの空き容量を確認してください')
        return
      }
      dispatch({ type: 'SET_MEMBER_IMAGE', memberId, imageId })
      setMessage(null)
    } catch {
      // 画像が壊れていることは利用者に伝えるべき情報なので黙って捨てない。
      setMessage('画像を読み込めませんでした。別のファイルを選んでください')
    } finally {
      setBusy(false)
    }
  }

  async function handleExport(): Promise<void> {
    const stored = await getAllImages()
    const images: Record<string, string> = {}

    for (const imageId of usedImageIds(roster, avatars)) {
      const blob = stored.get(imageId)
      if (blob !== undefined) {
        images[imageId] = await blobToDataUrl(blob)
      }
    }

    const json = buildBundle(roster, images, avatars)
    download(json, 'pokajan-roster.json')
    setMessage(`書き出しました（${formatByteSize(bundleByteSize(json))}）`)
  }

  async function handleImport(file: File): Promise<void> {
    setBusy(true)
    try {
      const result = parseBundle(await file.text())
      if (!result.ok) {
        setMessage(result.errors.join(' / '))
        return
      }

      // 検証に通らないロスターは適用しない。既存の内容を壊さないことを優先する。
      const check = validateRoster(result.bundle.roster, rules)
      if (!check.ok) {
        setMessage(`このロスターは使えません: ${check.errors[0]}`)
        return
      }

      for (const [imageId, dataUrl] of Object.entries(result.bundle.images)) {
        await putImage(imageId, await dataUrlToBlob(dataUrl))
      }
      dispatch({ type: 'REPLACE', roster: result.bundle.roster })
      setAvatars(parseAvatars(result.bundle.avatars))
      setMessage('読み込みました。保存すると反映されます')
    } catch {
      setMessage('ファイルを読み込めませんでした')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    // 使われなくなった画像を消してから保存する。放置すると IndexedDB に溜まり続ける。
    await pruneImages(usedImageIds(roster, avatars))
    onSave(roster, avatars)
  }

  return (
    <main className="settings" data-testid="roster-editor">
      <header className="settings__head">
        <h2 className="settings__title">ロスター設定</h2>
        <button type="button" className="button button--ghost" onClick={onBack}>
          戻る
        </button>
      </header>

      <ValidationPanel
        errors={validation.errors}
        warnings={validation.warnings}
        okMessage="この構成で対局できます"
        testIdPrefix="roster"
      />
      {message !== null && (
        <p className="settings__message" data-testid="roster-message">
          {message}
        </p>
      )}

      <ul className="roster__groups">
        {roster.groups.map((group) => (
          <li key={group.id} className="roster__group" data-testid="editor-group">
            <div className="roster__group-head">
              <input
                className="settings__input roster__group-name"
                value={group.name}
                onChange={(event) =>
                  dispatch({ type: 'RENAME_GROUP', groupId: group.id, name: event.target.value })
                }
                aria-label="グループ名"
              />
              <input
                className="settings__input roster__symbol"
                value={group.symbol ?? ''}
                placeholder={groupSymbolOf(group)}
                maxLength={2}
                onChange={(event) =>
                  dispatch({
                    type: 'SET_GROUP_SYMBOL',
                    groupId: group.id,
                    symbol: event.target.value,
                  })
                }
                aria-label="グループの記号"
                title="カードの角に出す記号。空にすると名前の1文字目を使います"
                data-testid="group-symbol"
              />
              <span className="roster__count">{group.memberIds.length}人</span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => dispatch({ type: 'DELETE_GROUP', groupId: group.id })}
              >
                削除
              </button>
            </div>

            <ul className="roster__members">
              {group.memberIds.map((memberId) => (
                <MemberRow
                  key={memberId}
                  memberId={memberId}
                  roster={roster}
                  imageUrl={imageUrls.get(memberId)}
                  busy={busy}
                  onRename={(name) => dispatch({ type: 'RENAME_MEMBER', memberId, name })}
                  onDelete={() => dispatch({ type: 'DELETE_MEMBER', memberId })}
                  onMove={(groupId) => dispatch({ type: 'SET_MEMBER_GROUP', memberId, groupId })}
                  onPickImage={() => {
                    uploadTarget.current = memberId
                    fileInput.current?.click()
                  }}
                  onClearImage={() =>
                    dispatch({ type: 'SET_MEMBER_IMAGE', memberId, imageId: undefined })
                  }
                />
              ))}
            </ul>

            <button
              type="button"
              className="button button--small"
              onClick={() => dispatch({ type: 'ADD_MEMBER', groupId: group.id })}
              data-testid="add-member"
            >
              メンバーを追加
            </button>
          </li>
        ))}
      </ul>

      {orphans.length > 0 && (
        <section className="roster__group" data-testid="unassigned">
          <h3 className="roster__orphan-title">未所属のメンバー</h3>
          <ul className="roster__members">
            {orphans.map((member) => (
              <MemberRow
                key={member.id}
                memberId={member.id}
                roster={roster}
                imageUrl={imageUrls.get(member.id)}
                busy={busy}
                onRename={(name) => dispatch({ type: 'RENAME_MEMBER', memberId: member.id, name })}
                onDelete={() => dispatch({ type: 'DELETE_MEMBER', memberId: member.id })}
                onMove={(groupId) =>
                  dispatch({ type: 'SET_MEMBER_GROUP', memberId: member.id, groupId })
                }
                onPickImage={() => {
                  uploadTarget.current = member.id
                  fileInput.current?.click()
                }}
                onClearImage={() =>
                  dispatch({ type: 'SET_MEMBER_IMAGE', memberId: member.id, imageId: undefined })
                }
              />
            ))}
          </ul>
        </section>
      )}

      <div className="settings__actions">
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'ADD_GROUP' })}
          data-testid="add-group"
        >
          グループを追加
        </button>
        <button
          type="button"
          className="button"
          onClick={() => dispatch({ type: 'REPLACE', roster: defaultRoster })}
          data-testid="reset-roster"
        >
          デフォルトに戻す
        </button>
        <button type="button" className="button" onClick={() => void handleExport()}>
          書き出す
        </button>
        <label className="button settings__file">
          読み込む
          <input
            type="file"
            accept="application/json"
            data-testid="import-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined) {
                void handleImport(file)
              }
            }}
          />
        </label>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void handleSave()}
          disabled={!validation.ok || busy}
          data-testid="save-roster"
        >
          保存する
        </button>
      </div>

      {/* 画像の選択はメンバー行のボタンから開く。入力欄自体は1つで足りる。 */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="settings__hidden-file"
        data-testid="image-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) {
            void handleFile(file)
          }
        }}
      />
    </main>
  )
}

/** JSON をファイルとして保存させる。ライブラリを使わずに済む最小の実装。 */
function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()

  URL.revokeObjectURL(url)
}
