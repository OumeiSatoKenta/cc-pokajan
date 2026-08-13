# Step 6 remote化 — タスクリスト

方針: **フル seam・local 完全不変・engine シグネチャ非破壊**。各フェーズ末で `wc -l` を機械測定。

## フェーズ0: 事前レビュー（実装前）

- [x] doc-reviewer で requirements.md / design.md をレビュー
- [x] [必須]/高 指摘を design/requirements へ反映（[必須]①配置 src/ui/transport ②apply=engine Action／[高]409=body／
      [中]派生3追加・useSelection 明文化・リスク8・wallet 楽観控除廃止／[低]wc -l・expectedVersion 源）

## フェーズ1: 型と派生（engine / ui-transport の土台）

- [x] `src/engine/viewDerive.ts`: `yakuContextFromView` / `declarableFromView` / `claimableFromView` /
      `visibleCardsFromView` / `waitsFromView` / `unseenFromView` / `canDiscardFromView` / `isClaimWindowOpenFromView` /
      `pendingCpuClaimsFromView`（GameState 版は温存・重い部分 findYaku/computeWaits/countUnseen は共有）
- [x] `src/ui/transport/transport.ts`: `GameTransport` / `GameSnapshot` / `OutcomeSummary` / `AutoStep` / `ApplyResult` /
      `ClientAction`（backend と同形。`apply` は engine `Action` 型）

## フェーズ2: transport 実装

- [x] `src/ui/transport/localTransport.ts`: 内部 full GameState、`create`（進めない）/`apply`(reduce+redactEvents)/
      `nextAuto`(decideAutoAction+autoActionKey)/`get`。IllegalActionError→accepted:false。expectedVersion は無視（409 出さない）。
- [x] `src/ui/transport/remoteTransport.ts`: `apiClient` 経由 POST/GET、`toClientAction`（TICK→PASS・DRAW 例外・playerId 除去）、
      **409=レスポンス本体を parseSnapshot**（追加 GET 無し）、402/404/401/5xx 例外変換、`nextAuto`=null。fetch 注入可能に。

## フェーズ3: loop 再構成（local 完全不変の核）

- [x] `src/ui/hooks/loopReducer.ts`: `reduce`/`createGame` の import を外し、`INGEST`/`INGEST_CREATE`（snapshot 折り込み）中心へ。
      `collectWins`（scoresBefore=INGEST 前 view）/`trackDrawnUid`/`isPaused`/`DISMISS_WIN`/`EVENTS_CONSUMED` は中身不変で再利用。
- [x] `src/ui/hooks/turnTimer.ts`: `decideTimeout` を **`decideTimeoutFromView(view,…)`** に置換（claim 分岐は TICK のまま）。
- [x] `src/ui/hooks/useGameLoop.ts`: `transport` 注入、PlayerView 派生の返り値、auto/timeout/drain タイマーを
      transport 駆動へ（apply に loop.version）。create の StrictMode ガード（createdRef）。applying ガード。
- [x] `wc -l` 測定（useGameLoop / loopReducer / transport 群）

## フェーズ4: 消費側の読み替え（画面）

- [x] `src/ui/components/PlayerSeat.tsx`: `player: Player` → `PlayerSummary`（`player.hand.length`→`handCount`）
- [x] `src/ui/screens/TableScreen.tsx`: transport 生成（deployConfig 分岐）、`loop.state`→`loop.view` 読み替え、
      派生値は loop から消費、settle に server outcome 添付＋wallet 同期（server モード）
- [x] `src/ui/hooks/useSelection.ts`: `loop.state`→`loop.view`（`me.hand`→`view.hand`、`yakuContextOf`→`yakuContextFromView`。
      `resetKeyOf`/`interactionGate` は無改修で通る）
- [x] `wc -l` 再測定（TableScreen / PlayerSeat 改修後・[低]提案1）

## フェーズ5: wallet 分岐と注入

- [x] `src/ui/appReducer.ts`: `createAppReducer(rules, walletSource)`、`SYNC_WALLET` 追加、`FINISH` の server 分岐
      （serverWallet/serverOutcome）。local は完全不変。
- [x] `src/App.tsx`: `createAppReducer` に walletSource、onSettle の server 分岐、SYNC_WALLET 配線

## フェーズ6: テスト

- [x] `tests/engine/viewDerive.test.ts`: GameState 版との差分オラクル（seed 0..N・9関数）
- [x] `tests/ui/localTransport.test.ts`: engine 直叩きとの state/events 一致 / nextAuto 遅延 / claim TICK 一致 / IllegalAction 見送り
- [x] `tests/ui/remoteTransport.test.ts`: fake fetch で 201/200/**409=body**/402/404、`toClientAction`(TICK→PASS/DRAW例外/playerId除去)、例外変換
- [x] ~~`tests/ui/transport.test.ts`~~（`transport.ts` は型のみで runtime なし。`parseSnapshot` は remoteTransport にあるので
      `tests/ui/remoteTransport.test.ts` の `describe('parseSnapshot')` に統合＝独立ファイル不要）
- [x] `tests/ui/loopReducer.test.ts`（既存があれば拡張）: INGEST 折り込みが現行と同一（差分オラクル）
- [x] `tests/ui/appReducer.test.ts`（既存拡張）: wallet 分岐（server は PLACE_BET 非控除 / SYNC_WALLET / FINISH サーバー値）
- [x] わざと壊して落ちることを確認（redaction / 409 再同期 / wallet 分岐の各1）

## フェーズ7: 検証ゲート

- [x] `npm run lint`
- [x] `npm run typecheck`（fe + be）
- [x] `npm test`（fe + be・**local 完全不変**）
- [x] `npm run build`（+ postbuild isolation）
- [x] `npm run format:check`
- [x] Playwright（`npm run test:e2e`）91件 無改変で通過

## フェーズ8: 振り返り・docs

- [x] tasklist に振り返り（完了日・差分・学び・改善提案）
- [x] `docs/architecture.md` / `docs/repository-structure.md` に transport seam 層を反映
- [x] `CLAUDE.md` 実装状況（AWS Step 6）更新

---

## 実装後の振り返り

**実装完了日**: 2026-08-14

### 計画と実績の差分

- **配置**: 計画は `src/net/transport.ts` 等だったが、`.oxlintrc.json` の `src/net/**` が engine/ui import を全面禁止のため
  **`src/ui/transport/`** へ変更（doc-review で [必須] 化・実プローブで確認）。`src/net/` は `apiClient` のまま・oxlint 変更ゼロ。
- **`apply` の型**: `ClientAction` でなく **engine `Action`**（claim 時間切れの `TICK` が `ClientAction` に無い問題）。
  `TICK→PASS` 変換は remoteTransport 内 `toClientAction` に閉じた。
- **409**: 計画初版は「409→GET 再同期」だったが、backend が 409 の body に snapshot を載せるので**追加 GET を廃止**。
- **wallet**: 計画初版の「両モード楽観控除」を、server モードは**非控除＋SYNC_WALLET**に変更（create 失敗時の残高固着を構造的に排除）。
- **`current()` 追加**: 計画に無かったが、local を「初回から loading 無し」にするため `GameTransport.current()`（同期 seed）を追加。
- **`createTransportFor` 抽出**: レビュー指摘で transport 選択を純関数へ切り出し、`useState` 遅延初期化で安定化（`useMemo` は捨てられうる）。

### レビューで捕まえた欠陥（すべて反映済み）

3軸 + validator + doc-review で **[必須]4件**を検出・修正（いずれも local 経路では踏めず、ゲート・E2E も
`VITE_DEPLOY_TARGET=aws` を張らないため素通りしていた＝「テストが全部通っても欠陥は潜む」の再演）:

1. **[必須] onWalletSync 無限レンダーループ**（server）: `App` の非メモ化インライン関数 + `SYNC_WALLET` の無条件新オブジェクト
   + effect 依存で無限ループ。→ `useCallback` 安定化 + reducer の値同一 bail-out。
2. **[必須] create 前の wallet:0 破壊**（server）: create 解決前のダミー `wallet:0` が SYNC_WALLET され localStorage を 0 で焼く。
   → 同期 effect を `view !== null` で絞る。
3. **[必須] localTransport.apply の同期 throw**（local/remote 共通の transport 契約）: 非 async だと `IllegalActionError` 以外の
   engine 例外（settle の `RangeError` 等）が Promise を貫通し ErrorBoundary に届かず、`applyingRef` が立ったまま**無言フリーズ**。
   → `apply` を `async` 化（throw が reject に）＋ `dispatchApply` を `.then(ok).catch(fail)` に。
4. **[必須] render 本体での ref 書き込み**（`versionRef`/`pausedRef`）: React 禁則。→ `useEffect` へ移動。

[高]（console.warn 復元）・[推奨]（DTO 同期コメント・createTransportFor 抽出・createdRef の意図明記）も反映。

### 学んだこと

- **「local 完全不変」は達成できたが、それは server 経路のバグを1つも防がなかった。** 検証ゲートも Playwright も
  `github-pages`（local）ビルドしか駆動しないため、`walletSource==='server'` / `transport==='remote'` の分岐は
  **どのテストからも一度も評価されない**。CLAUDE.md の「テストが全部通っていても欠陥は潜む」が、今回は「テストが触れない
  分岐に4件の [必須] が潜む」という形で出た。**AWS ビルドを実ブラウザにマウントする E2E が唯一の機械的検出手段**（次段の宿題）。
- **transport 抽出で「reduce が render フェーズから外れた」副作用**: 旧 loopReducer は `reduce` を dispatch 経由（render 相当）で
  呼び、engine の契約違反例外が ErrorBoundary に届いていた。transport（Promise）へ移すと、同期 throw はこの安全網を貫通する。
  **層をまたいで移すときは、旧層が担っていた「例外の到達先」まで移さないと安全網が静かに壊れる。**
- **`useMemo` を安定性の保証に使わない**（React 公式）。可変状態を内包する transport は `useState` 遅延初期化で持つべき。
- doc-review の実プローブ（oxlint に実際にファイルを置いて確認）が、計画の [必須] 欠陥（net 配置不能）を着手前に捕まえた。

### 次回への改善提案

- **AWS ビルド（`VITE_DEPLOY_TARGET=aws`）を実ブラウザで `TableScreen` までマウントする E2E** を追加し、
  server 分岐の regression を機械化する（今回の [必須]4件はこれがあれば全部落ちた）。
- HTTP エラー（402/404/401/5xx）が一律 ErrorBoundary の全画面クラッシュに落ちる点は、実 AWS 運用前にリトライ/文言分岐を検討。
- DTO 3型（`GameSnapshot`/`OutcomeSummary`/`ClientAction`）の frontend/backend 二重定義は、将来 `@dto/*` 共有 or
  `expectTypeOf` 契約テストで機械化する価値がある（今回は同期コメントで留保）。
