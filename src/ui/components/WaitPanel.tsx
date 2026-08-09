import { useEffect, useId, useRef, useState } from 'react'

import type { MemberId } from '../../engine/types'
import { unseenOf, type UnseenCounts } from '../../engine/unseen'
import type { WaitEntry } from '../../engine/yaku'
import { COLOR_LABELS, YAKU_LABELS, nameOf } from '../labels'

export interface WaitPanelProps {
  /** `computeWaits` の結果をそのまま渡す。**待ちの算出をここで作り直さない。** */
  readonly waits: readonly WaitEntry[]
  readonly unseen: UnseenCounts
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 一覧に出す最大件数。超えた分は件数だけを示す。 */
  readonly maxRows?: number
}

/**
 * 待ちは理論上 `groupsPerGame × maxGroupSize × colors.length` = 60 件まで出る。
 * 全部並べると手札より背が高くなり、卓が読めなくなる。
 */
const DEFAULT_MAX_ROWS = 6

interface Row {
  readonly entry: WaitEntry
  readonly unseen: number
}

/**
 * 並び順は**残っている待ちが先、その中で点数降順**。
 *
 * 点数だけで並べると、高い役の待ちが全部死んでいる局面で
 * **生きている待ちが打ち切りの下に隠れる**。それでは「上がれそうか」を
 * 確かめるというこの機能の目的を果たさない。
 *
 * 同点・同状態のときの順序は `computeWaits` の並び（メンバー順 × 色順）のまま。
 * `Array.prototype.sort` は安定なので、これは仕様として決まっている。
 */
function sortRows(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const aAlive = a.unseen > 0 ? 1 : 0
    const bAlive = b.unseen > 0 ? 1 : 0
    return bAlive - aAlive || b.entry.best.score - a.entry.best.score
  })
}

/**
 * テンパイ時の待ち一覧。
 *
 * **手札の位置を動かさないため、一覧はフローを占有しない。**
 * 常時はコンパクトな「待ち N件」トリガだけを出し、ホバー（PC）/タップ（タッチ）で
 * フロー外オーバーレイとして開く。テンパイの成立/崩れでトリガは出入りするが、
 * 置き場所（`.table__mine-head`）は常にあり、オーバーレイは絶対配置なので、
 * その下の河・手札は動かない。
 *
 * **残0 の行を淡く落とすのがこの部品の中心的な価値。**
 * 役はできるのに、その札はもう場に無い——という状況が目で分かる。
 * ただし淡さ（色）だけで伝えず `data-unseen` にも数を出す。
 */
export function WaitPanel({
  waits,
  unseen,
  memberNameById,
  maxRows = DEFAULT_MAX_ROWS,
}: WaitPanelProps) {
  /*
   * クリック/タップでの「ピン留め」。ホバーの覗き見は CSS（`.wait:hover`）が受け持ち、
   * こちらは touch とキーボードの経路。`aria-expanded` はこの明示状態を反映する。
   */
  const [pinned, setPinned] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const overlayId = useId()

  /*
   * ピン留め中だけ Escape と外側クリックで閉じる導線を張る。
   * **リスナはピン留め中に限る。** 常時張ると、閉じているときも無関係な
   * クリック/キー入力を毎回拾うことになる。クリーンアップで必ず外す。
   */
  useEffect(() => {
    if (!pinned) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(false)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      // トリガ・オーバーレイを含む `.wait` 内のクリックは外側扱いにしない。
      // `target` は `EventTarget | null`。`Node` と言い切らず、null は `contains(null)=false` に委ねる。
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node | null)) {
        setPinned(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [pinned])

  /*
   * テンパイが崩れたらピン留めを解除する。
   *
   * **この部品は局をまたいで同じインスタンスのまま使い回される**（`TableScreen` は
   * `WaitPanel` に `key` を切らない）。テンパイが崩れると下の早期 return で `null` を
   * 返すが、コンポーネントはアンマウントされず `pinned` は生き残る。これを消さないと、
   * 再テンパイのときに**ユーザーが何もしていないのにオーバーレイが開いた状態で復活する**。
   * 隠れている間は `.wait` の DOM が無く外側クリックの受け口も消えるので、ここで明示的に戻す。
   */
  useEffect(() => {
    if (waits.length === 0) {
      setPinned(false)
    }
  }, [waits.length])

  // 上がれそうなときだけ出す。待ちが無い間はトリガも出さない（テンパイの合図になる）。
  if (waits.length === 0) {
    return null
  }

  const rows = sortRows(
    waits.map((entry) => ({ entry, unseen: unseenOf(unseen, entry.memberId, entry.color) })),
  )
  const shown = rows.slice(0, maxRows)
  const hidden = rows.length - shown.length

  return (
    <div className="wait" ref={rootRef} data-testid="wait-panel" data-count={rows.length}>
      <button
        type="button"
        className="wait__trigger"
        aria-expanded={pinned}
        aria-controls={overlayId}
        data-testid="wait-trigger"
        onClick={() => setPinned((open) => !open)}
      >
        待ち{rows.length}件
      </button>

      {/*
        オーバーレイはフロー外（絶対配置）。CSS で `.wait:hover` の覗き見と
        `data-open` のピン留めのときだけ可視になる（`hints.css`）。
        中身は従来の一覧そのままで、並び・残0・件数上限の振る舞いは変えない。
      */}
      <div
        className="wait__overlay"
        id={overlayId}
        role="group"
        aria-label="待ち一覧"
        data-testid="wait-overlay"
        data-open={pinned}
      >
        <ul className="wait__list">
          {shown.map(({ entry, unseen: remaining }) => (
            <li
              key={`${entry.memberId}:${entry.color}`}
              className={remaining === 0 ? 'wait__row wait__row--dead' : 'wait__row'}
              data-testid="wait-row"
              data-unseen={remaining}
            >
              <span className={`wait__card wait__card--${entry.color}`}>
                {nameOf(memberNameById, entry.memberId)}
                <span className="wait__color">（{COLOR_LABELS[entry.color]}）</span>
              </span>

              <span className="wait__remaining">残{remaining}</span>

              <span className="wait__yaku">
                {YAKU_LABELS[entry.best.kind]}
                {entry.best.sameColor && <span className="wait__same">同色</span>}
              </span>

              <span className="wait__score">{entry.best.score.toLocaleString('ja-JP')}</span>
            </li>
          ))}
        </ul>

        {hidden > 0 && (
          <p className="wait__more" data-testid="wait-more">
            他{hidden}件
          </p>
        )}
      </div>
    </div>
  )
}
