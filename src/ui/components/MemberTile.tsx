import { useState } from 'react'

export interface MemberTileProps {
  readonly name: string
  readonly imageUrl?: string
  /** 「ボーナス」など、タイルの上に出す短い見出し。 */
  readonly label?: string
  readonly testId?: string
}

/**
 * メンバー1人をカード型で見せるタイル。ボーナス表示（麻雀のドラ表示牌にあたる）に使う。
 *
 * **合成した `Card` を作らない。** `Card` は `color` と `uid` を必須で持つが、
 * ボーナスは**メンバー単位**の情報で色を持たない。表示のために偽のカードを作ると、
 * 実在しないカードがドメイン型として生まれ、`uid` の衝突やカード保存則の検査に
 * 紛れ込む余地ができる。表示に必要な値だけを受け取る。
 *
 * 見た目は `.card` を再利用し、色の代わりに中立色の `.card--tile` を当てる。
 */
export function MemberTile({ name, imageUrl, label, testId = 'member-tile' }: MemberTileProps) {
  const [failed, setFailed] = useState(false)
  const showImage = imageUrl !== undefined && !failed

  return (
    <div className="member-tile" data-testid={testId}>
      {label !== undefined && <span className="member-tile__label">{label}</span>}

      <div className={showImage ? 'card card--tile card--image' : 'card card--tile'}>
        {showImage && (
          <img
            className="card__image"
            src={imageUrl}
            alt=""
            // 画像が壊れていても対局は続く。名前表示へ戻すだけにする。
            onError={() => setFailed(true)}
          />
        )}
        <span className="card__name">{name}</span>
      </div>
    </div>
  )
}
