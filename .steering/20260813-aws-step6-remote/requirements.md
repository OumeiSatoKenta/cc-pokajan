# Step 6 remote化（フロント transport seam） — 要求

参照計画: [docs/ideas/cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md) の Phase 3 フロント節。
前提: Step 2（engine 抽出）・Step 4（Cognito 認証 + apiClient 土台）・Step 5（サーバー権威 backend）完了済み。

## 背景

現状、対局の状態遷移はブラウザ内（`useGameLoop` + `loopReducer` + engine `reduce`）で完結している。
Step 5 で backend（Lambda + DynamoDB）がサーバー権威で同じ対局を回せるようになったが、**フロントはまだ
サーバーに繋がっていない**。本 Step はフロントに **transport seam**（対局の状態遷移をどこで行うかの差し替え点）を
入れ、`deployConfig.transport` で以下を切り替える。

- `local`（既定 = github-pages・オフライン）: 今までどおりブラウザ内エンジンで完結。
- `remote`（AWS）: `POST /games` / `POST /games/{id}/actions` / `GET /games/{id}` を叩き、サーバーが返す
  `PlayerView` を描画。CPU 進行・精算・財布はサーバー権威。

## ユーザー確認済みの方針（2026-08-13）

1. **フル seam・local 完全不変**: `useGameLoop` を PlayerView 消費＋注入 `GameTransport` 経由の dispatch へ
   作り替える。`localTransport` は今日の挙動を**完全再現**（CPU 駆動を transport 裏へ移すが、演出遅延・一時停止の
   不変条件は同一）。`remoteTransport`（POST / 409→GET 再同期）は完全実装＋fake fetch でユニットテストするが、
   実 AWS 挙動は dev 手動確認に委ねる。
2. **engine 導出関数のシグネチャは壊さない**（オプション3不採用）。`declarableFor` 等の `GameState` 版は温存し、
   UI 用に `PlayerView` から導く薄いヘルパを**別途追加**する（重い部分 `findYaku`/`computeWaits`/`countUnseen` は共有）。
3. **local（github-pages）は完全不変・検証ゲート＋Playwright 91件で固定**。観測可能な挙動が1つでもズレたら
   「テストが悪い」ではなく「リファクタが誤り」と判断する。

## 機能要件

### FR-1: transport seam の定義
- **`src/ui/transport/transport.ts`** に `GameTransport` インターフェースと `GameSnapshot`（クライアント側）型を定義する。
  （`src/net/` は oxlint で engine/ui への import が禁止のため置けない。transport は engine 依存＝ui 層に置く。詳細 design.md「配置」）
- `GameSnapshot` は Step 5 backend の DTO と**同形**: `{ id, version, view: PlayerView, events: GameEvent[],
  wallet: number, outcome: OutcomeSummary | null }`。`events` は redact 済みで、その apply 呼び出しの差分
  （人間手＋CPU手の連結）。
- `GameTransport` は `create()` / `apply(action, expectedVersion)` / `get()` / `nextAuto()`。
  **`apply` は engine `Action` 型を取る**（claim 時間切れの `TICK` が `ClientAction` に無いため。`ClientAction` への
  変換と `TICK→PASS` は remoteTransport 内に閉じる）。`nextAuto()` は local の CPU 逐次駆動用（remote は常に null）。

### FR-2: localTransport（今日の挙動＝ Pages/オフライン）
- **`src/ui/transport/localTransport.ts`**。全 `GameState` を内部に保持し、`reduce` + `decideAutoAction`（nextCpuAction）
  + `toPlayerView` + `redactEvents` で snapshot を組む。
- CPU は**1手ずつ**逐次に進める（`nextAuto()` が次の CPU 手＋演出遅延を返す）。全 CPU を一括解決しない
  （今日の「観戦できる」進行を保つ）。
- 演出遅延・一時停止・時間切れの不変条件は現行と同一。`fast`（E2E 用）で遅延のみ 0。

### FR-3: remoteTransport（サーバー権威）
- **`src/ui/transport/remoteTransport.ts`**。`apiClient`（`authorizedFetch`）経由で `POST /games`（create）・
  `POST /games/{id}/actions`（apply）・`GET /games/{id}`（get）を叩き、レスポンス JSON を `GameSnapshot` としてパースする。
- engine `Action` → `ClientAction` の変換（`TICK→PASS`・`DRAW` は不達で例外・`playerId` 除去）を内部に持つ。
- `apply` が **409（version 競合）** を返したら、**レスポンス本体の snapshot をそのまま使う**（backend は 409 body に
  現在 snapshot を載せるため追加 GET をしない）。`accepted:false` で返す。
- `nextAuto()` は常に null（CPU 進行はサーバーが解決済み。クライアントは CPU タイマーを持たない）。
- HTTP エラー（401/402/404/5xx）は分かる例外へ変換する（UI は ErrorBoundary で受ける）。

### FR-4: useGameLoop の一度きりの作り替え
- 生の `GameState` ではなく **`PlayerView` から表示値を導出**する（`declarable`/`claimable`/`waits`/`unseen` は
  PlayerView 派生ヘルパで算出）。
- 注入された `GameTransport` 経由で状態を進める（`transport.apply`）。CPU 逐次進行は `transport.nextAuto()` を
  タイマーで駆動する（local のみ非 null）。
- `loopReducer` は `reduce`/`createGame` を import せず、**transport が出した event 列を UI 状態へ折り込む**
  役割に純化する（`pending`/`pendingWins`/`drawnUid`/`timeLimitMs`/`gameOverReason`/`ranking` の算出は現行と同一）。

### FR-5: wallet のサーバー権威化（walletSource 分岐）
- `deployConfig.walletSource === 'server'`（AWS）: 財布は snapshot.wallet（サーバー値）を正とする。
  `SYNC_WALLET` で毎 snapshot 反映。精算（`FINISH`）はサーバーの `outcome` を使う（`computePayout` をローカル再計算しない）。
- `deployConfig.walletSource === 'local'`（Pages）: 現行の `appReducer`（prefs）で完全不変。
- `GET /wallet` ルートは存在しない（Step 5 スコープ外）ため、初期表示はローカル既定→初回 snapshot で reconcile。
  `PLACE_BET` は **server モードでは楽観控除しない**（財布は createGame snapshot の wallet を `SYNC_WALLET` で反映）。
  これにより **create 失敗時も控除が無く残高固着が起きない**（local モードは現行どおり控除）。**改竄耐性**は
  「サーバーが権威・snapshot が毎回上書き・server は client の wallet を信頼しない」で担保する。

### FR-6: transport / 財布の選択と注入
- `deployConfig.transport`（`aws`→remote / それ以外→local）で transport を選ぶ。
- transport は `App`/`TableScreen` の合成点で生成し `useGameLoop` へ注入する（テストで差し替え可能にする）。

## 非機能要件

- **NFR-1（最重要）**: local 経路は観測可能な挙動が完全不変。検証ゲート（lint/typecheck/test/build/format）と
  Playwright 全 spec（91件）が無改変で通ること。
- **NFR-2**: engine 層は React / `src/config` に依存しない（oxlint 検知）。`Math.random()`/`Date` 不使用。
  **`src/net/`（apiClient）は engine/ui を import できない**（oxlint override・全面禁止）ため現状維持。transport seam は
  `src/ui/transport/` に置き、そこから engine/net/config を import する（`src/ui/**` に import 制限は無い）。oxlint 変更なし。
- **NFR-3**: remoteTransport は aws-amplify も実ネットワークも介さずユニットテスト可能（fetch 注入）。
- **NFR-4**: 他家手札・山札の中身・seed がクライアントへ渡る経路を作らない（PlayerView/redactEvents を通す）。
- **NFR-5**: ファイルは分割基準（400 行超で分割検討）を機械測定（`wc -l`）。

## スコープ外

- backend の変更（`GET /wallet` 追加等）。Step 5 で確定した DTO をそのまま消費する。
- infra / CI の変更（Step 5 で `game_api_endpoint` 出力・`deploy-aws.yml` の Lambda デプロイは配線済み）。
  `VITE_API_BASE_URL` の実配線（CI 変数）は Step 1/デプロイ運用側の話で、本 Step はコード seam に集中する。
- 実 AWS スタックへの apply と live 動作確認（dev 手動。ローカルでは検証不能）。
- Phase 4 以降（AppSync リアルタイム・4人マルチ等）。
