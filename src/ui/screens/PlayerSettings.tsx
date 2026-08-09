import { useRef, useState } from 'react'

import type { PlayerId, Roster, RulesConfig } from '../../engine/types'
import { putImage, pruneImages } from '../../storage/assets'
import { avatarImageIdOf, setAvatar as setAvatarAt, type AvatarMap } from '../avatars'
import { useAvatarUrls } from '../hooks/useAvatarUrls'
import { DEFAULT_HUMAN_SEAT } from '../hooks/useGameLoop'
import { fileToStoredImage } from '../imageResize'
import { seatName } from '../labels'
import { nextId, usedImageIds } from '../rosterEditor'
import '../settings.css'

export interface PlayerSettingsProps {
  readonly avatars: AvatarMap
  /** 画像 ID の採番と掃除に使う。ロスターも同じ IndexedDB を使っている。 */
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly onSave: (avatars: AvatarMap) => void
  readonly onBack: () => void
}

/**
 * プレイヤー設定画面。座席ごとに画像を設定する。
 *
 * **画像は座席番号で保存する。** 席の呼び名（あなた / 下家 / …）は
 * 人間の席からの相対表示なので、そちらをキーにするとアバターが対局ごとに別人へ移る。
 * 画面に出す名前だけを `seatName` で相対に直す。
 *
 * `RosterEditor` と同じく**編集中は反映せず、保存で確定**する。
 */
export function PlayerSettings({
  avatars: saved,
  roster,
  rules,
  onSave,
  onBack,
}: PlayerSettingsProps) {
  const [avatars, setAvatars] = useState<AvatarMap>(saved)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<PlayerId | null>(null)
  const avatarUrls = useAvatarUrls(avatars)

  const seats = Array.from({ length: rules.playerCount }, (_, id) => id)

  async function handleFile(file: File): Promise<void> {
    const playerId = uploadTarget.current
    if (playerId === null) {
      return
    }

    setBusy(true)
    try {
      const blob = await fileToStoredImage(file)
      /*
       * **採番はロスターとアバターの両方を見る。** 片方だけだと、
       * 既にアバターが使っている ID を引き当てて別人の画像を上書きする。
       */
      const imageId = nextId('avt', usedImageIds(roster, avatars))

      if (!(await putImage(imageId, blob))) {
        setMessage('画像を保存できませんでした。ブラウザの空き容量を確認してください')
        return
      }
      setAvatars(setAvatarAt(avatars, playerId, imageId))
      setMessage(null)
    } catch {
      // 画像が壊れていることは利用者に伝えるべき情報なので黙って捨てない。
      setMessage('画像を読み込めませんでした。別のファイルを選んでください')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    // 差し替えで使われなくなった画像を消す。ロスターぶんを keep に含めるのが要点。
    await pruneImages(usedImageIds(roster, avatars))
    onSave(avatars)
  }

  return (
    <main className="settings" data-testid="player-settings">
      <header className="settings__head">
        <h2 className="settings__title">プレイヤー設定</h2>
        <button type="button" className="button button--ghost" onClick={onBack}>
          戻る
        </button>
      </header>

      <p className="settings__note">
        席ごとに画像を設定します。設定しなくても対局できます（席名だけで表示されます）。
      </p>

      {message !== null && (
        <p className="settings__message" data-testid="players-message">
          {message}
        </p>
      )}

      <ul className="avatars__list">
        {seats.map((id) => {
          const imageId = avatarImageIdOf(avatars, id)
          const url = avatarUrls.get(id)

          return (
            <li key={id} className="avatars__row" data-testid="avatar-row" data-seat={id}>
              <span className="avatars__thumb" data-testid="avatar-thumb">
                {url === undefined ? (
                  '—'
                ) : (
                  <img
                    src={url}
                    alt=""
                    className="avatars__thumb-image"
                    data-testid="avatar-image"
                  />
                )}
              </span>

              <span className="avatars__name">
                {seatName(id, DEFAULT_HUMAN_SEAT, rules.playerCount)}
              </span>

              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  uploadTarget.current = id
                  fileInput.current?.click()
                }}
                disabled={busy}
                data-testid="pick-avatar"
              >
                画像
              </button>
              {imageId !== undefined && (
                <button
                  type="button"
                  className="button button--small button--ghost"
                  onClick={() => setAvatars(setAvatarAt(avatars, id, undefined))}
                  data-testid="clear-avatar"
                >
                  消す
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        data-testid="avatar-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // 同じファイルを続けて選べるように値を戻す。
          event.target.value = ''
          if (file !== undefined) {
            void handleFile(file)
          }
        }}
      />

      <div className="settings__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void handleSave()}
          disabled={busy}
          data-testid="save-players"
        >
          保存する
        </button>
      </div>
    </main>
  )
}
