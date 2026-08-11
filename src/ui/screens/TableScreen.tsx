import { useMemo } from 'react'

import type { MemberId, PlayerId, Roster, RulesConfig } from '../../engine/types'
import { ActionBar } from '../components/ActionBar'
import { BoardCenter } from '../components/BoardCenter'
import { DiscardPile } from '../components/DiscardPile'
import { Hand } from '../components/Hand'
import { PlayerSeat } from '../components/PlayerSeat'
import type { OpponentOrientation } from '../components/PlayerSeat'
import { ResultOverlay } from '../components/ResultOverlay'
import { TableHeader } from '../components/TableHeader'
import { WaitPanel } from '../components/WaitPanel'
import { WinOverlay } from '../components/WinOverlay'
import type { AvatarMap } from '../avatars'
import { useAssetUrls } from '../hooks/useAssetUrls'
import { useAvatarUrls } from '../hooks/useAvatarUrls'
import { useGameLoop } from '../hooks/useGameLoop'
import { useSelection } from '../hooks/useSelection'
import { winKey } from '../hooks/loopReducer'
import { sortHand } from '../handOrder'
import { groupSymbolsByMember, seatName, seatOrientation } from '../labels'
import { hintFor } from '../components/actionBarItems'
import { NO_WIN_TIMING, WIN_TIMING } from '../../config/presentation'
import '../board.css'
import '../center.css'
import '../table.css'
import '../selection.css'
import '../win.css'
import '../hints.css'
// 横向きの上書きは最後に読み込み、他の定義に後勝ちさせる。
import '../landscape.css'

export interface TableScreenProps {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  /** この対局に賭けた額。ヘッダーに出す。BET を経由した対局のみ table 画面に来る。 */
  readonly bet: number
  /** 座席ごとのアバター。未設定でも対局できる。 */
  readonly avatars: AvatarMap
  readonly fast?: boolean
  /** 終局後に精算へ進む。順位はエンジンが確定させた値をそのまま渡す。 */
  readonly onSettle: (result: {
    ranking: readonly PlayerId[]
    scores: readonly number[]
    humanSeat: PlayerId
  }) => void
}

/**
 * 対局画面。
 *
 * **`useGameLoop` を呼ぶのはこのコンポーネントだけ**にする。
 * 複数箇所で呼ぶと別々の対局が並行して走ってしまうため、状態は props で配る。
 */
export function TableScreen({
  roster,
  rules,
  seed,
  bet,
  avatars,
  fast,
  onSettle,
}: TableScreenProps) {
  const loop = useGameLoop({ roster, rules, seed, fast })
  const { state } = loop

  // 画像は画面レベルで1度だけ読み、カードごとには読まない。
  const imageUrlById = useAssetUrls(roster)
  const avatarUrls = useAvatarUrls(avatars)

  const groupSymbolById = useMemo(
    () => groupSymbolsByMember(state.activeGroups),
    [state.activeGroups],
  )

  const memberNameById = useMemo(
    () => new Map<MemberId, string>(state.activeMembers.map((m) => [m.id, m.name])),
    [state.activeMembers],
  )

  const seatLabels = useMemo(
    () =>
      new Map<PlayerId, string>(
        state.players.map((p) => [p.id, seatName(p.id, loop.humanSeat, state.players.length)]),
      ),
    [state.players, loop.humanSeat],
  )

  const me = state.players[loop.humanSeat]

  /**
   * 他家を卓の向きつきで並べる。
   *
   * 向きは `humanSeat` からの相対位置で決まる（`seatOrientation`）。`self` は
   * ここには現れないが、`playerCount` が 4 以外の対局では他家が `top` に落ちる。
   */
  const opponents = useMemo(
    () =>
      state.players
        .filter((player) => player.id !== loop.humanSeat)
        .map((player) => {
          const orientation = seatOrientation(player.id, loop.humanSeat, state.players.length)

          /*
           * 人間は除外済みなので `self` は来ない。ただしそれは型では保証されないため、
           * キャストで黙らせず明示的に畳む。キャストにすると、将来 `seatOrientation` の
           * 分岐が変わったときに**嘘の型のまま**通ってしまう。
           */
          const seat: OpponentOrientation = orientation === 'self' ? 'top' : orientation
          return { player, orientation: seat }
        }),
    [state.players, loop.humanSeat],
  )

  /**
   * 表示用に並べ替えた手札。**エンジンの `hand` は並べ替えない。**
   * ここで作るのは表示のためのコピーで、`GameState` の順序には手を触れない。
   */
  const handCards = useMemo(
    () =>
      sortHand(me.hand, {
        activeGroups: state.activeGroups,
        colors: rules.colors,
        drawnUid: loop.drawnUid,
      }),
    [me.hand, state.activeGroups, rules.colors, loop.drawnUid],
  )

  /*
   * 絵札の組み替え（選択からのツモ／ロン）の配線。状態・`composed` 導出・局面変化での
   * リセット・確定・おまかせプレフィルは `useSelection` に集約してある（ツモ／ロン共通）。
   * ここは Hand と ActionBar へ結線するだけ。
   */
  const selection = useSelection(loop, rules)

  /*
   * 順位はエンジンが `GameOver` で確定させた値を使う。
   *
   * 以前はここで点数から並べ直していたが、エンジンも同じ方針
   * （点数降順・同点はプレイヤー ID 昇順）を持っており二重実装だった。
   * Step 5 でこの順位がそのまま順位倍率＝**精算額**になるため、
   * 食い違いは金額の誤りになる。フォールバックも置かない
   * （置いた時点で二重実装が名前を変えて戻ってくる）。
   */
  const ranking = loop.ranking ?? []

  /*
   * 演出の長さ。`fast` は E2E 用で、**演出の待ち時間だけ**を消す（ルール値は変わらない）。
   * `useGameLoop` に渡している `fast` と同じ意味で使う。
   */
  const winTiming = fast === true ? NO_WIN_TIMING : WIN_TIMING

  /*
   * 閉じるときは**その和了の鍵を添える**。閉じる操作は自動クローズ・オーバーレイの
   * クリック・パネル内のボタン・Escape の4経路から来るため二重に走りうるが、
   * リデューサが鍵で照合するので、今見せている和了以外は落ちない。
   */
  const pendingWin = loop.pendingWin
  const dismissPendingWin = () => {
    if (pendingWin !== null) {
      loop.dismissWin(winKey(pendingWin))
    }
  }

  /*
   * 和了演出中は盤面を凍結する。**手札タップ（`useSelection`）・操作バーのボタン（`ActionBar`）・
   * 案内文（`hintFor`）を同じ判定で止める**。演出中も `game.state` は連続宣言で次の局面へ進みうるため、
   * `pendingWin` を見ずに `phase` だけで affordance や文言を出すと「押せると言うのに押せない」矛盾になる。
   * 1回だけ評価して各所へ配り、判定元がずれる余地を無くす。
   */
  const isPaused = pendingWin !== null

  return (
    <main
      className="table"
      data-testid="table-screen"
      data-phase={state.phase}
      data-pending-claims={loop.pendingCpuClaims}
      /*
       * 選択枚数を観測用に出す（`data-phase` / `data-pending-claims` と同じ E2E 観測フック）。
       * 局面をまたいだ選択リセット（`WaitPanel` pinned と同型の一時状態バグ）を、消費済み uid が
       * 手札から消える偶然に頼らず直接検査するために使う。**ロンは捨て札を含まないため役の
       * 構成枚数より 1 小さい**（`useSelection` の `selectedCount` 参照）。
       */
      data-selected-count={selection.selectedCount}
    >
      <TableHeader chainCount={state.chainCount} maxChain={rules.maxChainDeclare} bet={bet} />

      {/*
        卓は 3×3 のグリッド（対面=上 / 上家=左 / 下家=右 / 自分=下、中央が山とボーナス）。
        どの席がどこに入るかは `seat--top` などのクラスが決め、
        JSX 側は並び順を持たない（席の数が変わっても配置が壊れない）。
      */}
      {/* 羅紗（フェルト）。木縁（.table）の内側で盤面を1枚に包む。 */}
      <div className="table__felt">
        <div className="table__board">
          {opponents.map(({ player, orientation }) => (
            <PlayerSeat
              key={player.id}
              player={player}
              memberNameById={memberNameById}
              imageUrlById={imageUrlById}
              groupSymbolById={groupSymbolById}
              seatLabel={seatLabels.get(player.id) ?? `P${player.id}`}
              avatarUrl={avatarUrls.get(player.id)}
              orientation={orientation}
              isTurn={state.turn === player.id}
              isDeclarer={state.declarer === player.id}
              /*
               * 直前の捨て札（ロン対象）を強調する。**`lastDiscard !== null` で絞るのが要点**。
               * `lastDiscardBy` はロン成立では消えず（`advanceTurn` まで残る）、その席の
               * 「今の最後の札」＝ロンで消費された後の古い札を誤って光らせてしまう。
               * `lastDiscard` はロン消費と同時に null になるので、これで受付が開いている間だけに限定できる。
               */
              highlightLast={state.lastDiscard !== null && state.lastDiscardBy === player.id}
            />
          ))}

          <BoardCenter
            wallCount={state.wall.length}
            bonusMemberIds={state.bonusMemberIds}
            activeGroups={state.activeGroups}
            memberNameById={memberNameById}
            imageUrlById={imageUrlById}
            hand={me.hand}
          />

          {/*
            手札（`.table__mine`）と操作バー（`.actions`）を1つのラッパにまとめる。
            縦では従来どおり縦積み、横向き（landscape.css）では [手札 | 操作] のレールにして
            縦の高さを詰める（844×390 の縦 fit）。操作バーを felt 内へ入れるのは第2稿準拠
            （操作エリアは手札の右にある）。
          */}
          <div className="table__controls">
            <section className="table__mine" aria-label="あなたの手札">
              <header className="table__mine-head">
                <span className="table__mine-title">
                  {avatarUrls.get(loop.humanSeat) !== undefined && (
                    <img
                      src={avatarUrls.get(loop.humanSeat)}
                      alt=""
                      className="seat__avatar"
                      data-testid="seat-avatar"
                    />
                  )}
                  あなた（{me.score.toLocaleString('ja-JP')}点）
                </span>
                <span className="table__hint">
                  {hintFor({
                    phase: state.phase,
                    declarable: loop.declarable,
                    claimable: loop.claimable,
                    canDiscard: loop.canDiscard,
                    isPaused,
                  })}
                </span>

                {/*
                待ち一覧はテンパイのときだけ「待ち N件」トリガとして出る（`WaitPanel` が自分で判断する）。
                手札の上に常時パネルを置くと、テンパイの成立/崩れで手札が上下する。
                トリガは常時ある行（ヘッダー）に置き、一覧はホバー/タップでフロー外に開く。
              */}
                <WaitPanel
                  waits={loop.waits.waits}
                  unseen={loop.unseen}
                  memberNameById={memberNameById}
                />
              </header>

              {/*
              自分の河も卓の一部として、手札のすぐ上に置く。
              直前札の強調は付けない（自分の捨て札は自分のロン対象ではない。
              一次資料も自席の河は強調していない）。
            */}
              <DiscardPile
                cards={me.discards}
                memberNameById={memberNameById}
                imageUrlById={imageUrlById}
                groupSymbolById={groupSymbolById}
                label="あなたの河"
                testId="my-river"
              />

              <Hand
                cards={handCards}
                memberNameById={memberNameById}
                imageUrlById={imageUrlById}
                groupSymbolById={groupSymbolById}
                bonusMemberIds={state.bonusMemberIds}
                waitingUids={loop.waits.contributingUids}
                unseen={loop.unseen}
                drawnUid={loop.drawnUid}
                interaction={selection.interaction}
                selectedUids={selection.selectedSet}
                onDiscard={loop.discard}
                onSelect={selection.onSelect}
              />
            </section>

            {/*
              操作バーは唯一の操作の置き場（横向き 844×390 では高さ上限＋スクロールで保護される）。
              絵札の組み替えのライブプレビュー＋確定（緑ツモ／赤ロン）も**この中**に置く（`.table__mine` の
              grid を増やさず、既存の高さ保護に相乗りするため）。`selection` は選択できる局面（自分の
              宣言番＝ツモ／割り込める役を持つ受付＝ロン）のときだけ `useSelection` が非 null を返す。
            */}
            <ActionBar
              phase={state.phase}
              declarable={loop.declarable}
              claimable={loop.claimable}
              timerKind={loop.timerKind}
              timeLimitMs={loop.timeLimitMs}
              timerKey={loop.timerKey}
              selection={selection.selection}
              onPrefill={selection.onPrefill}
              onPass={loop.pass}
              /* 和了演出中はボタンを凍結する（手札タップ・案内文と同じ `isPaused` 判定）。 */
              isPaused={isPaused}
            />
          </div>
        </div>
      </div>

      {/*
        和了の演出は結果画面より**先**に出す。逆にすると、最後の和了を読む前に
        対局が終わってしまう（和了で終局した場合）。

        **`key` に和了の鍵を渡す。** 連続和了で鍵が同じだと、段が進んだ状態のまま
        2件目が表示され、カットインが飛ぶ。
      */}
      {pendingWin !== null && (
        <WinOverlay
          key={winKey(pendingWin)}
          win={pendingWin}
          seatLabels={seatLabels}
          avatarUrls={avatarUrls}
          memberNameById={memberNameById}
          imageUrlById={imageUrlById}
          groupSymbolById={groupSymbolById}
          bonusMemberIds={state.bonusMemberIds}
          timing={winTiming}
          onDismiss={dismissPendingWin}
        />
      )}

      {state.phase === 'gameOver' && pendingWin === null && (
        <ResultOverlay
          scores={state.players.map((player) => player.score)}
          reason={loop.gameOverReason}
          seatLabels={seatLabels}
          ranking={ranking}
          onSettle={() =>
            onSettle({
              ranking,
              scores: state.players.map((player) => player.score),
              humanSeat: loop.humanSeat,
            })
          }
        />
      )}
    </main>
  )
}
