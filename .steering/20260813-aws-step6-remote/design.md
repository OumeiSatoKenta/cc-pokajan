# Step 6 remote化 — 設計（doc-review 反映版 v2）

> 2026-08-13 doc-reviewer の指摘（[必須]×2・[高]×1・[中]×4・[低]×2）を反映。主な変更:
> ① transport seam の配置を `src/net/` → **`src/ui/transport/`**（oxlint の net→engine/ui 禁止と衝突するため）。
> ② `apply` の型を `ClientAction` → **engine `Action`**（claim 時間切れの `TICK` が `ClientAction` に無い問題を解消。
>    `ClientAction` への変換と `TICK→PASS` は remoteTransport 内に閉じる）。
> ③ 409 は**レスポンス本体の snapshot をそのまま使う**（追加 GET をしない）。
> ④ 派生ヘルパに `canDiscard`/`isClaimWindowOpen`/`pendingCpuClaims` を追加。
> ⑤ `useSelection` 移行を明文化。⑥ wallet の server モードは**楽観控除しない**（create 失敗の残高固着を構造的に排除）。

## 全体像: seam の位置

```
useGameLoop ── useReducer(loopReducer)   ← transport が出した event 列を UI 状態へ折り込むだけ（reduce を import しない）
     │  timers (auto / timeout / drain)
     │  導出値 = PlayerView 派生ヘルパ（viewDerive）
     └── GameTransport（注入）
            ├─ localTransport   : 内部に full GameState、reduce + decideAutoAction + toPlayerView + redactEvents
            └─ remoteTransport  : apiClient で POST/GET、engine Action → ClientAction 変換、409=body 再同期
```

**責務の分離が要点**:
- **transport** = 権威ある状態遷移（engine `reduce` か HTTP）→ `GameSnapshot{ id, version, view, events, wallet, outcome }` を出す。
- **useGameLoop / loopReducer** = transport が出した **event 列**から UI 状態を折り込む（トースト待ち行列・和了演出・
  `drawnUid`・持ち時間）＋タイマー駆動＋transport 呼び出し。

この分離で `loopReducer` の不変条件ロジック（`collectWins` / `trackDrawnUid` / `isPaused` / `DISMISS_WIN`）は
**中身を変えずに再利用**でき、`reduce` の所在だけが loopReducer → localTransport へ移る。

## 配置（[必須] 問題1 反映）

`.oxlintrc.json` の `src/net/**` override は `**/engine/**` と `**/ui/**` からの import を **error で禁止**する
（実プローブで確認済み）。transport は engine のロジック・型に依存するため **`src/net/` には置けない**。
→ **`src/ui/transport/` に置く**（`src/ui/**` に import 制限は無く、engine/net/config を import できる）。

- `src/ui/transport/transport.ts`: 型（`GameTransport` / `GameSnapshot` / `OutcomeSummary` / `AutoStep` / `ApplyResult` / `ClientAction`）
- `src/ui/transport/localTransport.ts`: engine 直駆動（Pages/オフライン）
- `src/ui/transport/remoteTransport.ts`: `apiClient`（net）経由の HTTP クライアント（依存の向き ui→net を保つ）
- `src/net/` は認証付き fetch プリミティブ `apiClient.ts` のまま（engine/ui 非依存を維持）。**oxlint 変更なし**。

## 型（src/ui/transport/transport.ts）

```ts
// backend/src/dto.ts の GameSnapshot / OutcomeSummary と同形（同じ JSON を消費）。
export interface OutcomeSummary {
  readonly payout: PayoutBreakdown
  readonly ranking: readonly PlayerId[]
  readonly scores: readonly number[]
}
export interface GameSnapshot {
  readonly id: string
  readonly version: number
  readonly view: PlayerView
  readonly events: readonly GameEvent[]   // redact 済み・この apply の差分
  readonly wallet: number                 // server 権威。local ではダミー（walletSource=local で未使用）
  readonly outcome: OutcomeSummary | null
}
export interface AutoStep { readonly action: Action; readonly delayMs: number; readonly key: string }
export interface ApplyResult { readonly snapshot: GameSnapshot; readonly accepted: boolean }

export interface GameTransport {
  current(): GameSnapshot | null // ※実装で追加: 直近 snapshot を同期で返す（useReducer seed 用。local 非 null / remote は create 前 null）
  create(): Promise<GameSnapshot>
  /** engine Action を1手適用する。人間操作・時間切れ・（local の）CPU 手すべてこの1経路。**必ず async（同期 throw 禁止）**。 */
  apply(action: Action, expectedVersion: number): Promise<ApplyResult>
  get(): Promise<GameSnapshot>
  /** local: 次に自動で進める CPU 手＋演出遅延＋同一性キー。remote: 常に null（サーバーが解決済み）。 */
  nextAuto(): AutoStep | null
}
// ※実装で追加: transport 選択は純関数 createTransportFor(deployConfig, options)。TableScreen は useState 遅延初期化で
//   安定保持（useMemo は「捨てられうる」ので可変状態を持つ transport の安定保証には使わない）。

// remoteTransport が「サーバーへ送るときだけ」使う DTO。engine Action → これへ変換する。
export type ClientAction =
  | { readonly type: 'DISCARD'; readonly uid: number }
  | { readonly type: 'DECLARE'; readonly candidate: YakuCandidate }
  | { readonly type: 'SKIP_DECLARE' }
  | { readonly type: 'CLAIM'; readonly candidate: YakuCandidate }
  | { readonly type: 'PASS' }
```

**なぜ `apply` は engine `Action`（`ClientAction` でなく）か**（[必須] 問題2 反映）:
`decideTimeout` の `claimWindow` 分岐は `TICK`（受付を閉じる内部アクション）を返す。`TICK` は `ClientAction` に無い
（backend も「DRAW/TICK はサーバー内部専用」と明言）。`apply` を `ClientAction` 型にすると、local の time-out で
`TICK` を渡せず typecheck が落ちる。**`apply` を engine `Action` 型にし、`ClientAction` への変換（`TICK→PASS`・
`DRAW` は不達で例外・`playerId` 除去）は remoteTransport 内に閉じる**。`useGameLoop` は今日どおり `humanSeat` 付きの
engine `Action` を組む（`declare` は `{type:'DECLARE',playerId:humanSeat,candidate}`）ので**フックの手組みは不変**。

## localTransport（src/ui/transport/localTransport.ts）

- `createLocalTransport({ roster, rules, seed, humanSeat, ai, fast })`。内部に可変 `state: GameState` と `version` を閉じ込める。
- `create()`: `createGame(...)`（**今日の `createInitialLoopState` と同じく create では進めない**。最初の DRAW から
  `nextAuto` 逐次で進む）→ snapshot（version=1・events=[]・wallet=0 ダミー）。
- `apply(action, _expectedVersion)`: `reduce(state, action, rules)`。`IllegalActionError` は握って `accepted:false`
  （現行 loopReducer と同じ競合の見送り）。成功時 version+1。events は **`redactEvents(events, humanSeat)`** を通す
  （local でも redact して remote と描画パスを一致させる）。local は単一クライアントなので expectedVersion は無視（409 を出さない）。
- `nextAuto()`: `decideAutoAction(state, rules, ai, humanSeat, delays)`（既存 UI アダプタ）＋ `autoActionKey(state, action)`
  を使い `{action, delayMs, key}` を返す。CPU 手は full state からしか決まらないため transport が持つ。`fast`→NO_DELAYS。
- `get()`: 現 state の snapshot。

## remoteTransport（src/ui/transport/remoteTransport.ts）

- `createRemoteTransport({ bet, fetchImpl = authorizedFetch })`。`fetchImpl(path, init) => Promise<Response>`（テストで注入）。
- `create()`: `POST /games` body `{ bet }` → 201 → `parseSnapshot`。`this.id` を保持。
- `apply(action, expectedVersion)`:
  - `toClientAction(action)` で DTO 化（`DISCARD/DECLARE/SKIP_DECLARE/CLAIM/PASS`。**`TICK`→`{type:'PASS'}`**・
    `DRAW`→例外〔remote では nextAuto が null なので不達〕・`playerId` は落とす〔サーバーが humanSeat を強制〕）。
    ※ `TICK→PASS` の等価性は **`HUMAN_SEATS=[0]`**（human が claimWindow の時計に乗る時点で CPU は全員表明済み＝
    残る pending は human だけ）に依る。この前提は backend `normalizeHumanAction` のコメントと同水準で明記する。
  - `POST /games/{id}/actions` body `{ action, expectedVersion }`。
    - 200 → snapshot（accepted:true）。
    - **409 → レスポンス本体を `parseSnapshot` して accepted:false で返す**（追加 GET をしない。backend は 409 body に
      現在 snapshot を載せる＝[高] 問題3）。
    - 402/404/401/5xx → 型付き例外（UI は ErrorBoundary で受ける）。
  - **create 失敗時の残高**（[中] 問題7）: server モードは PLACE_BET で楽観控除しない（後述 wallet 節）ので、
    create 失敗＝控除も無し。UI は BET 画面へ戻すだけ（残高固着が起きない）。
- `get()`: `GET /games/{id}` → snapshot。
- `nextAuto()`: 常に null。
- `parseSnapshot(json)`: `view`/`version`/`events`/`wallet`/`outcome` の存在と型を最小検査。candidate 詳細・redaction は
  サーバー責務なのでフロントは形だけ見る。

## engine 派生ヘルパ（src/engine/viewDerive.ts・新規）

`GameState` 版のシグネチャは温存（`nextCpuAction` 等が使い続ける）。UI 用に **PlayerView から導く薄い関数**を追加し、
重い部分は共有プリミティブ（`findYaku`/`computeWaits`/`countUnseen`）に委ねる（二重実装しない）。

```ts
yakuContextFromView(view, rules): YakuContext            // { activeGroups, bonusMemberIds, rules }
declarableFromView(view, rules): YakuCandidate[]         // phase==='selfDeclare' && declarer===selfId → findYaku(view.hand, ctx)
claimableFromView(view, rules): YakuCandidate[]          // phase==='claimWindow' && lastDiscard && claims[selfId]==='pending' → findYaku([...hand,lastDiscard], ctx, lastDiscard)
visibleCardsFromView(view): VisibleCards                 // { hand, discardsByPlayer, declaredByPlayer } from view
waitsFromView(view, rules): WaitInfo                     // computeWaits(view.hand, ctxFromView)
unseenFromView(view, rules): UnseenCounts                // countUnseen(visibleFromView, view.activeMembers.map(id), rules)
canDiscardFromView(view): boolean                        // phase==='discard' && turn===selfId
isClaimWindowOpenFromView(view): boolean                 // phase==='claimWindow' && claims[selfId]==='pending'
pendingCpuClaimsFromView(view): number                   // claims の key で id!==selfId かつ status==='pending' の数
```

**根拠（全フィールドが PlayerView にある）**:
- `yakuContextOf` は `activeGroups`/`bonusMemberIds`/`rules` のみ使用 → view に全部ある。
- `declarableFor`/`claimableFor` は self hand（`view.hand`）＋ phase/declarer/lastDiscard/claims → view にある。
  claims は redact 済み `ClaimStatus`。GameState 版の「未表明で割り込み対象」`claims[id] !== null` は、view では
  `claims[id] === 'pending'` と**等価**（passed/claimed=表明済み・キー不在=対象外なら view にも 'pending' で入らない）。
- `toVisibleCards` は self hand ＋ 全員の discards/declared → `PlayerSummary` に両方ある。
- `pendingCpuClaimIds(state,[human])` は「id≠human かつ claims[id]===null」の数 → view では
  「id≠selfId かつ status==='pending'」。単一 human では非 human＝全 CPU なので等価。
- **local もこの view 版を通す**（`toPlayerView(state)` してから派生）ことで、local e2e/gate が view 版を検証する
  ＝実装は1つ・検証済み。GameState 版 `declarableFor` 等は engine 内部（`nextCpuAction`）専用に残る。

## useGameLoop 再構成（src/ui/hooks/useGameLoop.ts）

- 引数に `transport: GameTransport` を追加。transport 生成は呼び出し側（TableScreen）に寄せ、フックは注入を受ける。
- reducer state（`LoopState` 改）:
  ```
  view: PlayerView | null        // null=create 未完（軽い loading）
  version: number                // apply の expectedVersion 源（3経路とも loop.version を渡す＝[低]提案2）
  pending: GameEvent[]           // トースト待ち行列（役割不変）
  pendingWins: WinPresentation[] // 役割不変
  gameOverReason, ranking        // GameOver event から捕捉（不変）
  timeLimitMs                    // 不変
  drawnUid                       // 不変（redact 後 self の CardDrawn だけ残る＝trackDrawnUid が欲しい humanSeat 分）
  outcome: OutcomeSummary | null // サーバー精算（server モードの settle 用）
  ```
- reducer actions:
  - `INGEST { snapshot, isTimeout, accepted }`: `pending += snapshot.events`、
    `collectWins(snapshot.events, prevView.players[].score)` を pendingWins へ、`trackDrawnUid(prevDrawn, events, humanSeat)`、
    `gameOverReason/ranking` 捕捉、`isTimeout && accepted` のとき `timeLimitMs = nextTimeLimitMs(...)`。view/version/outcome 差し替え。
    **`scoresBefore` は INGEST 前の view の score**（Paid event で前進＝現行と同一出力・[必須] 保存）。
  - `INGEST_CREATE { snapshot }`: 初期 view/version をセット（events=[] なので wins 無し）。
  - `EVENTS_CONSUMED` / `DISMISS_WIN`: 役割不変。
- タイマー3種（現行構造を保持）:
  - **auto**: `transport.nextAuto()` が非 null かつ `!isPaused` なら `setTimeout(delayMs)` → fire で
    `transport.apply(step.action, version)` → `INGEST`。依存は `step.key`（決定の同一性）＋isPaused（view を依存に載せない）。
  - **timeout**: `decideTimeoutFromView(view, humanSeat, drawnUid, rules)`（新設・下記）→ fire で
    `transport.apply(timeout.action, version)` → `INGEST{isTimeout:true, accepted}`。依存は `timeout.key`＋timeLimitMs＋isPaused。
  - **drain**: 現行と同一（pending を EVENT_HOLD_MS 後に掃く）。
- 人間操作（discard/declare/claim/pass）: `isPaused` を見てから engine `Action` を組んで `transport.apply(action, version)` → `INGEST`。
  **演出中の二層停止**（7-4）は「callbacks の isPaused 判定」＋「auto/timeout 効果の isPaused」で担保（現行 reducer isPaused と等価）。
- 非同期対策: `transport.create()` は `useEffect` で1回に絞る（`createdRef`）。apply 中の二重発火は `applyingRef` で抑止
  （local は即解決で実害小・remote で必須）。

### decideTimeout の view 化（[必須] 問題2）

`src/ui/hooks/turnTimer.ts` の `decideTimeout(game,…)` は useGameLoop 以外に非テスト呼び出しが無い（実測）。
→ **`decideTimeoutFromView(view, humanSeat, drawnUid, rules): HumanTimeout | null` に置換**（`game.*` を `view.*` へ、
`game.players[humanSeat].hand` を `view.hand` へ、`game.claims[humanSeat] !== null` を `view.claims[humanSeat] !== 'pending'` へ）。
**claim 分岐は現行どおり `TICK` を返す**（local の byte-identical のため。remote は remoteTransport が `TICK→PASS` 変換）。
既存テスト `tests/ui/turnTimer.test.ts` は `toPlayerView(state)` を渡す形へ機械的に更新（kind/action/key の期待は不変）。

## useSelection 移行（src/ui/hooks/useSelection.ts・[中] 問題5）

`loop.state`（GameState）→ `loop.view`（PlayerView）へ。置換点:
- `state.players[loop.humanSeat]`（`me`）→ `view.hand`（self hand は top-level）。
- `yakuContextOf(state, rules)`（2箇所）→ `yakuContextFromView(view, rules)`。
- `state.phase`/`state.declarer`/`state.lastDiscard` → `view.*`（同名）。
- **`resetKeyOf` は `Pick<GameState,'phase'|'turn'|'declarer'|'chainCount'>` で受けるため `PlayerView` を無改修で渡せる**
  （`interactionGate` はプリミティブ引数なので同様）。この「無改修で通る」ことは構造的型付けに依存＝**局をまたぐ選択
  リセット**の不変条件（下記リスク8）に該当するので、E2E の `data-selected-count` 回帰で固定する。

## TableScreen（src/ui/screens/TableScreen.tsx）

- `useGameLoop({ transport, rules, fast })`。transport は `useMemo` で deployConfig 分岐生成
  （local: `createLocalTransport({roster,rules,seed,humanSeat,ai,fast})` / remote: `createRemoteTransport({bet})`）。
- `loop.state` → `loop.view` 読み替え: `state.players`→`view.players`（`PlayerSummary`）・`state.wall.length`→`view.wallCount`・
  `me.hand`→`view.hand`・他（activeGroups/activeMembers/bonusMemberIds/lastDiscard/lastDiscardBy/turn/declarer/phase/chainCount）は同名。
- `PlayerSeat` に渡す `player` を `Player`→`PlayerSummary`（`player.hand.length`→`player.handCount`。伏せ札は既に枚数描画で実質無変更）。
- 導出値（declarable/claimable/waits/unseen/canDiscard/isClaimWindowOpen/pendingCpuClaims）は `loop` が返す（内部で viewDerive）。
- settle: `view.phase === 'gameOver'`。server モードは `onSettle` に `loop.outcome`（サーバー精算）を添える。
- **[低] 提案1**: TableScreen は現状363行。読み替え後に `wc -l` を再測定（400行超なら分割）。

## wallet 分岐（src/ui/appReducer.ts・[中] 問題7 反映）

- `createAppReducer(rules, walletSource)`（`deployConfig` を appReducer が直接 import しない＝engine/config 非依存の作法）。
- `PLACE_BET`:
  - `walletSource==='local'`: 現行どおり控除（Pages 完全不変）。
  - `walletSource==='server'`: **控除しない**で table へ遷移。財布は createGame snapshot の `wallet`（サーバー debit 済み）を
    `SYNC_WALLET` で反映する。→ **create 失敗時も控除が無い**ため残高固着が起きない（問題7 を構造的に排除）。
    affordability チェックは同期済み wallet で行う。
- 追加 `SYNC_WALLET { wallet }`（server のみ dispatch）: `{ ...state, wallet: action.wallet }`。
- `FINISH`: `walletSource==='local'` は `computePayout`（現行）。`walletSource==='server'` は FINISH に添えた
  `serverOutcome`/`serverWallet`（settle snapshot 由来）を採用（`computePayout` を呼ばない）。
- **改竄耐性**: サーバーが権威・snapshot が毎回 wallet を上書き・server は client の wallet を信頼しない。localStorage 改竄は
  次の snapshot で必ず是正される。

## 注入点（src/App.tsx / src/main.tsx）

- `App` は `createAppReducer(rules, deployConfig.walletSource)`。onSettle は server モードで `loop` 由来の
  serverOutcome/serverWallet を FINISH に添える。server モードの wallet 同期（createGame/settle）は TableScreen の
  `useEffect([loop.wallet])` → `onWalletSync(loop.wallet)` → App が `SYNC_WALLET`。local モードでは onWalletSync を配線しない。
- main.tsx は無変更（AuthGate 済み）。

## 検証戦略

- **local 完全不変**: 検証ゲート＋Playwright 91件。ズレ＝リファクタ誤り。
- **viewDerive**: `declarableFromView` 等が `toPlayerView(state)` 経由で GameState 版と一致（差分オラクル seed 0..N）。
- **localTransport**: `create`/`apply`/`nextAuto` が現行 loopReducer + decideAutoAction と同一の state 遷移・events を出す
  （seed 0..N で engine 直叩きと突き合わせ）。claim 時間切れ（TICK）が現行と一致。
- **remoteTransport**: fake fetch で 201/200/**409=body 再同期**/402/404、`toClientAction`（TICK→PASS・DRAW 例外・playerId 除去）、
  parseSnapshot の形検査。
- **loop 折り込み**: INGEST が pending/pendingWins/drawnUid/timeLimit/gameOver を現行と同一に折り込む（snapshot 列の差分オラクル）。
- **appReducer wallet 分岐**: server で PLACE_BET が控除しない／SYNC_WALLET／FINISH がサーバー値採用（computePayout 不使用）。
- わざと壊して落ちる確認: redaction／409 再同期／wallet 分岐 の各1。

## リスクと落とし穴

1. **StrictMode 二重 create**: `useEffect` で `transport.create()` を1回に絞る（`createdRef`）。
2. **タイマー再予約の競合**（既知の轍）: auto は `nextAuto().key`、timeout は `decideTimeoutFromView().key` を依存に。view を依存に載せない。
3. **演出中の二層停止**（7-4）: 人間 callbacks の isPaused ＋ auto/timeout 効果の isPaused の両方。
4. **collectWins の scoresBefore**: **INGEST 前**の view の score を使う（Paid event で前進）。
5. **remote の CPU 進行差**: server は create/apply で `advanceToHuman` 済み＝一括。remote は CPU 逐次演出が無い（server 権威の帰結・未検証・許容）。
6. **appReducer の非依存規則**: `deployConfig` を appReducer が直接 import しない（walletSource は引数注入）。
7. **`TICK→PASS` は単一 human 前提**: `HUMAN_SEATS=[0]` に依る等価。remoteTransport にコメントで明記。将来 human 複数化で要再検証。
8. **局をまたぐ一時状態のリセット**（既知の轍・[中] 問題6）: `useSelection` の `resetKeyOf`／`interactionGate` は
   構造的型付け（`Pick<GameState,…>`／プリミティブ）により `PlayerView` を無改修で受ける。`waitsFromView` が安定値を返す限り
   `WaitPanel` の `useEffect([waits.length])` も機能する。これらは「たまたま通る」形なので E2E（`data-selected-count`・待ちパネル）で固定。
9. **ファイルサイズ**: useGameLoop / transport 群 / TableScreen を各フェーズ末に `wc -l` 測定（400行基準）。
