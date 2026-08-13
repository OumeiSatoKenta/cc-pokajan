import { useEffect, useMemo, useState } from 'react'

import { deployConfig } from '../../config/deploy'
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
import { DEFAULT_HUMAN_SEAT, useGameLoop } from '../hooks/useGameLoop'
import { useSelection } from '../hooks/useSelection'
import { winKey } from '../hooks/loopReducer'
import { createTransportFor } from '../transport/createTransport'
import type { OutcomeSummary } from '../transport/transport'
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

/** 精算に渡す情報。server モードはサーバー精算（`serverOutcome`）とサーバー財布（`serverWallet`）を添える。 */
export interface SettleResult {
  readonly ranking: readonly PlayerId[]
  readonly scores: readonly number[]
  readonly humanSeat: PlayerId
  /** サーバー精算内訳（server モードのみ非 null。local は `computePayout` を使うので null）。 */
  readonly serverOutcome: OutcomeSummary | null
  /** 精算後のサーバー財布（server モードのみ意味を持つ。local はダミー）。 */
  readonly serverWallet: number
}

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
  readonly onSettle: (result: SettleResult) => void
  /**
   * server モードで、対局中に得たサーバー財布を App へ同期する（BET 差引後・精算後など）。
   * local モードでは渡さない（財布は appReducer が権威）。
   */
  readonly onWalletSync?: (wallet: number) => void
}

/**
 * 対局画面。
 *
 * **`useGameLoop` を呼ぶのはこのコンポーネントだけ**にする。状態は props で配る。
 * transport（状態遷移の担い手）はここで `deployConfig` により生成して注入する
 * （local=ブラウザ内エンジン / remote=サーバー権威）。
 */
export function TableScreen({
  roster,
  rules,
  seed,
  bet,
  avatars,
  fast,
  onSettle,
  onWalletSync,
}: TableScreenProps) {
  /*
   * transport はこの対局のあいだ**安定**でなければならない（useGameLoop の reducer は初回に
   * transport.current() で seed し、内部に可変な対局状態を持つ）。`useMemo` は「捨てられうる」＝
   * 安定の意味論的保証が無いので、**`useState` の遅延初期化**（初回マウントで1度だけ生成）で安定させる。
   * `TableScreen` は App 側で `key={seed}` により対局ごとに作り直されるので、寿命 = マウントの寿命に一致する。
   */
  const [transport] = useState(() =>
    createTransportFor(deployConfig, {
      roster,
      rules,
      seed,
      bet,
      humanSeat: DEFAULT_HUMAN_SEAT,
      fast,
    }),
  )

  const loop = useGameLoop({ transport, rules })
  const view = loop.view

  // 画像は画面レベルで1度だけ読み、カードごとには読まない。
  const imageUrlById = useAssetUrls(roster)
  const avatarUrls = useAvatarUrls(avatars)

  const groupSymbolById = useMemo(
    () => (view === null ? new Map<MemberId, string>() : groupSymbolsByMember(view.activeGroups)),
    [view],
  )

  const memberNameById = useMemo(
    () =>
      view === null
        ? new Map<MemberId, string>()
        : new Map<MemberId, string>(view.activeMembers.map((m) => [m.id, m.name])),
    [view],
  )

  const seatLabels = useMemo(
    () =>
      view === null
        ? new Map<PlayerId, string>()
        : new Map<PlayerId, string>(
            view.players.map((p) => [p.id, seatName(p.id, loop.humanSeat, view.players.length)]),
          ),
    [view, loop.humanSeat],
  )

  /**
   * 他家を卓の向きつきで並べる。向きは `humanSeat` からの相対位置で決まる（`seatOrientation`）。
   */
  const opponents = useMemo(
    () =>
      view === null
        ? []
        : view.players
            .filter((player) => player.id !== loop.humanSeat)
            .map((player) => {
              const orientation = seatOrientation(player.id, loop.humanSeat, view.players.length)
              // 人間は除外済みなので `self` は来ないが、型では保証されないため明示的に畳む（キャストで嘘の型にしない）。
              const seat: OpponentOrientation = orientation === 'self' ? 'top' : orientation
              return { player, orientation: seat }
            }),
    [view, loop.humanSeat],
  )

  /**
   * 表示用に並べ替えた手札。**エンジンの `hand` は並べ替えない。** ここで作るのは表示のためのコピー。
   */
  const handCards = useMemo(
    () =>
      view === null
        ? []
        : sortHand(view.hand, {
            activeGroups: view.activeGroups,
            colors: rules.colors,
            drawnUid: loop.drawnUid,
          }),
    [view, rules.colors, loop.drawnUid],
  )

  /*
   * 絵札の組み替え（選択からのツモ／ロン）の配線。状態・`composed` 導出・局面変化でのリセット・確定・
   * おまかせプレフィルは `useSelection` に集約してある（ツモ／ロン共通）。ここは Hand と ActionBar へ結線するだけ。
   */
  const selection = useSelection(loop, rules)

  /*
   * server モードで、対局中に得たサーバー財布（BET 差引後・精算後）を App へ同期する。
   * local モードでは `onWalletSync` を渡さないので no-op（財布は appReducer が権威）。
   *
   * **`view !== null` で絞るのが要点**（[必須] 修正）。remote は create() 解決前 `loop.wallet` がダミー `0` で、
   * この effect が create() より先に走ると `SYNC_WALLET{wallet:0}` → App が localStorage に 0 を焼き込み、
   * 実サーバー残高と無関係に残高が 0 に破壊される。view が来る（＝サーバー snapshot が届く）まで同期しない。
   */
  useEffect(() => {
    if (view !== null) {
      onWalletSync?.(loop.wallet)
    }
  }, [view, loop.wallet, onWalletSync])

  /*
   * view 未取得（remote の create 待ち）は軽い loading を返す。**local は seed 済みで view が常に非 null**
   * なので、ここには来ない（Pages の挙動は完全に不変）。
   */
  if (view === null) {
    return <main className="table" data-testid="table-screen" aria-busy="true" />
  }

  const me = view.players[loop.humanSeat]

  /*
   * 順位はエンジンが `GameOver` で確定させた値を使う（点数から並べ直さない）。この順位がそのまま
   * 順位倍率＝精算額になるため、食い違いは金額の誤りになる。フォールバックも置かない。
   */
  const ranking = loop.ranking ?? []

  // 演出の長さ。`fast` は E2E 用で、**演出の待ち時間だけ**を消す（ルール値は変わらない）。
  const winTiming = fast === true ? NO_WIN_TIMING : WIN_TIMING

  /*
   * 閉じるときは**その和了の鍵を添える**。閉じる操作は自動クローズ・オーバーレイのクリック・パネル内の
   * ボタン・Escape の4経路から来るため二重に走りうるが、リデューサが鍵で照合するので今見せている和了以外は落ちない。
   */
  const pendingWin = loop.pendingWin
  const dismissPendingWin = () => {
    if (pendingWin !== null) {
      loop.dismissWin(winKey(pendingWin))
    }
  }

  /*
   * 和了演出中は盤面を凍結する。**手札タップ（`useSelection`）・操作バーのボタン（`ActionBar`）・
   * 案内文（`hintFor`）を同じ判定で止める**。演出中も view は連続宣言で次の局面へ進みうるため、
   * `pendingWin` を見ずに `phase` だけで affordance や文言を出すと「押せると言うのに押せない」矛盾になる。
   */
  const isPaused = pendingWin !== null

  return (
    <main
      className="table"
      data-testid="table-screen"
      data-phase={view.phase}
      data-pending-claims={loop.pendingCpuClaims}
      /*
       * 選択枚数を観測用に出す（局面をまたいだ選択リセットを直接検査するため）。
       * **ロンは捨て札を含まないため役の構成枚数より 1 小さい**。
       */
      data-selected-count={selection.selectedCount}
    >
      <TableHeader chainCount={view.chainCount} maxChain={rules.maxChainDeclare} bet={bet} />

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
              isTurn={view.turn === player.id}
              isDeclarer={view.declarer === player.id}
              /*
               * 直前の捨て札（ロン対象）を強調する。**`lastDiscard !== null` で絞るのが要点**。
               * `lastDiscardBy` はロン成立では消えず、その席の古い札を誤って光らせてしまう。
               * `lastDiscard` はロン消費と同時に null になるので、受付が開いている間だけに限定できる。
               */
              highlightLast={view.lastDiscard !== null && view.lastDiscardBy === player.id}
            />
          ))}

          <BoardCenter
            wallCount={view.wallCount}
            bonusMemberIds={view.bonusMemberIds}
            activeGroups={view.activeGroups}
            memberNameById={memberNameById}
            imageUrlById={imageUrlById}
            hand={view.hand}
          />

          {/*
            手札（`.table__mine`）と操作バー（`.actions`）を1つのラッパにまとめる。
            縦では縦積み、横向き（landscape.css）では [手札 | 操作] のレールにして縦の高さを詰める。
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
                    phase: view.phase,
                    declarable: loop.declarable,
                    claimable: loop.claimable,
                    canDiscard: loop.canDiscard,
                    isPaused,
                  })}
                </span>

                {/*
                  待ち一覧はテンパイのときだけ「待ち N件」トリガとして出る（`WaitPanel` が自分で判断する）。
                */}
                <WaitPanel
                  waits={loop.waits.waits}
                  unseen={loop.unseen}
                  memberNameById={memberNameById}
                />
              </header>

              {/* 自分の河も卓の一部として、手札のすぐ上に置く（直前札の強調は付けない）。 */}
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
                bonusMemberIds={view.bonusMemberIds}
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
              操作バーは唯一の操作の置き場。絵札の組み替えのライブプレビュー＋確定（緑ツモ／赤ロン）も**この中**に置く。
              `selection` は選択できる局面のときだけ `useSelection` が非 null を返す。
            */}
            <ActionBar
              phase={view.phase}
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
        和了の演出は結果画面より**先**に出す。**`key` に和了の鍵を渡す**（連続和了で鍵が同じだと
        段が進んだ状態のまま2件目が表示されカットインが飛ぶ）。
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
          bonusMemberIds={view.bonusMemberIds}
          timing={winTiming}
          onDismiss={dismissPendingWin}
        />
      )}

      {view.phase === 'gameOver' && pendingWin === null && (
        <ResultOverlay
          scores={view.players.map((player) => player.score)}
          reason={loop.gameOverReason}
          seatLabels={seatLabels}
          ranking={ranking}
          onSettle={() =>
            onSettle({
              ranking,
              scores: view.players.map((player) => player.score),
              humanSeat: loop.humanSeat,
              serverOutcome: loop.outcome,
              serverWallet: loop.wallet,
            })
          }
        />
      )}
    </main>
  )
}
