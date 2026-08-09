import type { GroupId, MemberId, Roster } from '../../engine/types'

export interface MemberRowProps {
  readonly memberId: MemberId
  readonly roster: Roster
  readonly imageUrl?: string
  /** 画像の変換中。連打で多重にアップロードさせない。 */
  readonly busy: boolean
  readonly onRename: (name: string) => void
  readonly onDelete: () => void
  readonly onMove: (groupId: GroupId | null) => void
  readonly onPickImage: () => void
  readonly onClearImage: () => void
}

/** ロスター編集画面のメンバー1行。所属グループの変更はプルダウンで行う。 */
export function MemberRow({
  memberId,
  roster,
  imageUrl,
  busy,
  onRename,
  onDelete,
  onMove,
  onPickImage,
  onClearImage,
}: MemberRowProps) {
  const member = roster.members.find((candidate) => candidate.id === memberId)
  if (member === undefined) {
    return null
  }

  const currentGroup = roster.groups.find((group) => group.memberIds.includes(memberId))

  return (
    <li className="roster__member" data-testid="editor-member">
      <span className="roster__thumb">
        {imageUrl === undefined ? (
          member.name.slice(0, 1)
        ) : (
          <img src={imageUrl} alt="" className="roster__thumb-image" />
        )}
      </span>

      <input
        className="settings__input"
        value={member.name}
        onChange={(event) => onRename(event.target.value)}
        aria-label="メンバー名"
      />

      <select
        className="settings__input roster__select"
        value={currentGroup?.id ?? ''}
        onChange={(event) => onMove(event.target.value === '' ? null : event.target.value)}
        aria-label="所属グループ"
      >
        <option value="">未所属</option>
        {roster.groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="button button--small"
        onClick={onPickImage}
        disabled={busy}
        data-testid="pick-image"
      >
        画像
      </button>
      {member.imageId !== undefined && (
        <button type="button" className="button button--small button--ghost" onClick={onClearImage}>
          消す
        </button>
      )}
      <button type="button" className="button button--small button--ghost" onClick={onDelete}>
        削除
      </button>
    </li>
  )
}
