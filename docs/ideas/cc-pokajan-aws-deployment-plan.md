# cc-pokajan AWS デプロイ・マルチプレイ構成計画

## 1. 目的

`cc-pokajan` を AWS 上へデプロイし、現在のシングルプレイ構成から将来的に以下へ拡張できるようにする。

- Cognito によるユーザー認証
- DynamoDB を中心としたマルチプレイ
- サーバー権威型のゲーム進行
- ユーザー画像・ロスター画像の共有
- リアルタイム同期
- ゲームログ・運用ログの収集
- 低コストなサーバーレス構成
- Terraform による IaC
- GitHub Actions による CI/CD

Firebase は利用せず、AWS ネイティブな構成とする。

---

## 2. 基本方針

### 2.1 サーバーレスを基本とする

常時稼働する EC2 / ECS / Fargate は使わず、アクセスが少ないときの待機コストをできるだけ抑える。

主なサービスは以下。

- CloudFront
- S3
- Cognito
- API Gateway HTTP API
- Lambda
- DynamoDB
- AppSync Events
- CloudWatch Logs / Metrics

---

## 3. 全体構成

```text
                         ┌────────────────┐
                         │ Cognito        │
                         │ User Pool      │
                         └───────┬────────┘
                                 │ JWT
                                 ▼
┌──────────────┐        ┌──────────────────┐
│ Browser      │───────▶│ API Gateway      │
│ React / Vite │        │ HTTP API         │
└──────┬───────┘        │ JWT Authorizer   │
       │                └────────┬─────────┘
       │                         │
       │                         ▼
       │                ┌──────────────────┐
       │                │ Lambda           │
       │                │ game-api         │
       │                │                  │
       │                │ game-engine実行  │
       │                └──────┬─────┬─────┘
       │                       │     │
       │                       │     └─────────────┐
       │                       ▼                   ▼
       │                ┌────────────┐     ┌────────────────┐
       │                │ DynamoDB   │     │ AppSync Events │
       │                │ GameState  │     │ WebSocket      │
       │                └────────────┘     └───────┬────────┘
       │                                           │
       ◀──────────────── Game Update ──────────────┘
       │
       │ Static Assets
       ▼
┌────────────────┐
│ CloudFront     │
└───────┬────────┘
        ▼
┌────────────────┐
│ Private S3     │
│ React dist/    │
└────────────────┘
```

---

## 4. フロントエンド

現在の Vite + React アプリをそのまま利用する。

### 配信

```text
Browser
  ↓
CloudFront
  ↓
Private S3
```

S3 バケットは原則 public にせず、CloudFront からのみアクセスさせる。

### Vite の base

現在 GitHub Pages 向けに `/cc-pokajan/` が指定されているため、AWS では `/` で配信できるように切り替える。

例:

```text
VITE_DEPLOY_TARGET=github-pages
VITE_DEPLOY_TARGET=aws
```

AWS 向けビルドでは:

```ts
base: '/'
```

とする。

---

## 5. 認証

Cognito User Pool を使用する。

初期段階では以下で十分。

- email
- password
- email verification

API Gateway HTTP API では Cognito の JWT を検証する JWT Authorizer を利用する。

```text
Browser
  ↓
Cognito Login
  ↓
JWT
  ↓
API Gateway
  ↓
Lambda
```

### Bot 対策

Cognito を導入しても Bot を完全には防止できない。

初期段階:

- Email verification
- API Gateway / Lambda 側でのレート制限
- 不自然なゲーム作成数などを監視

必要になったら:

- AWS WAF
- CAPTCHA
- アカウント作成制限

を追加する。

---

## 6. サーバー権威型ゲーム

マルチプレイではクライアントの GameState や点数計算結果を信用しない。

クライアントが送信するのは「操作」のみとする。

例:

```json
{
  "type": "DISCARD",
  "cardId": "card-123",
  "expectedVersion": 42
}
```

サーバー側:

```text
Client Action
     ↓
Lambda
     ↓
DynamoDB GameState取得
     ↓
game-engine
     ↓
Action適用
     ↓
新しいGameState
     ↓
DynamoDB保存
```

### game-engine の共有

現在の `src/engine` は React 非依存の純粋 TypeScript であるため、Lambda でも同じエンジンを利用できる。

将来的には以下のような構造を想定する。

```text
packages/
└── game-engine/

apps/
├── frontend/
└── backend/
```

または現状を維持しつつ:

```text
src/engine/
backend/
infra/
```

でもよい。

---

## 7. DynamoDB

### 初期案: 1ゲーム = 1 Item

ゲーム規模が小さいため、まずは GameState 全体を 1 Item として保持する。

```text
PK = GAME#{gameId}
```

例:

```json
{
  "gameId": "01J...",
  "version": 42,
  "status": "PLAYING",
  "seed": 12345,
  "players": [
    "user-a",
    "user-b",
    "user-c",
    "user-d"
  ],
  "gameState": {
    "deck": [],
    "hands": {},
    "discardPiles": {},
    "scores": {},
    "turn": "user-b"
  },
  "createdAt": "...",
  "expiresAt": 0
}
```

### Optimistic Lock

同時操作への対策として `version` を使用する。

```text
version = 42
↓
Action適用
↓
version = 43
```

書き込み時に:

```text
ConditionExpression:
version = :expectedVersion
```

を指定する。

これにより同時に複数の操作が送られても、一方だけが成功する。

---

## 8. GameState と GameView の分離

DynamoDB に保存される GameState は全情報を含む。

```ts
type GameState = {
  version: number
  deck: Card[]
  hands: Record<PlayerId, Card[]>
  discards: Record<PlayerId, Card[]>
  scores: Record<PlayerId, number>
  currentPlayer: PlayerId
}
```

ただしクライアントへ GameState をそのまま送らない。

プレイヤーごとに閲覧可能な情報だけを含む `GameView` を生成する。

```ts
type GameView = {
  version: number

  players: {
    id: string
    score: number
    handCount: number
    discards: Card[]
  }[]

  myHand: Card[]
  deckCount: number
  currentPlayer: string
}
```

### プレイヤーAから見える情報

```text
Aの手札 → 見える
Bの手札 → 枚数のみ
Cの手札 → 枚数のみ
Dの手札 → 枚数のみ

山札     → 残数のみ
捨て札   → 全員分見える
点数     → 全員分見える
```

### 目標

```text
GameState
├── AiView
├── PlayerView(A)
├── PlayerView(B)
├── PlayerView(C)
└── PlayerView(D)
```

将来的には:

```text
GameState
├── PlayerView
├── SpectatorView
└── ReplayView
```

へ拡張可能。

---

## 9. リアルタイム同期

リアルタイム通信には AppSync Events を使用する。

### 更新フロー

```text
Browser A
   │
   │ POST /games/{id}/actions
   ▼
API Gateway
   ▼
Lambda
   │
   ├── DynamoDB GameState取得
   ├── engineへAction適用
   ├── version更新
   └── DynamoDB保存
          │
          ▼
    AppSync Events
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
    A     B     C ...
```

---

## 10. AppSync チャンネル

プレイヤーごとの private channel を基本とする。

```text
/game/{gameId}/player/{userId}
```

例:

```text
/game/01ABC/player/user-a
/game/01ABC/player/user-b
/game/01ABC/player/user-c
/game/01ABC/player/user-d
```

Cognito の JWT 情報から:

```text
JWT.sub == channel userId
```

を検証し、他人の private channel を Subscribe できないようにする。

### Public / Private を分ける案

必要になれば:

```text
/game/{gameId}/public
/game/{gameId}/player/{userId}
```

としてもよい。

Public:

- 捨て札
- 点数
- 現在ターン
- 山札残数
- 演出

Private:

- 自分の手札
- 自分だけに見えるヒント
- 個人向け通知

---

## 11. 同期方式

初期段階では差分同期ではなく、PlayerView を丸ごと送る。

```json
{
  "type": "GAME_UPDATED",
  "version": 43,
  "view": {
    "myHand": [],
    "players": [],
    "deckCount": 52,
    "currentPlayer": "user-b"
  }
}
```

理由:

- 実装が簡単
- 状態不整合を起こしにくい
- データ量が小さい
- 再同期が容易

アクセス規模が大きくなったら:

```text
Full GameView
↓
Patch / Event差分
```

に変更する。

---

## 12. 再接続

WebSocket / AppSync Events を真実の保存場所にはしない。

真実は常に DynamoDB。

```text
DynamoDB = Source of Truth
AppSync  = Update Notification
```

ネットワーク切断後:

```text
Browser
  ↓
Reconnect
  ↓
GET /games/{gameId}
  ↓
Lambda
  ↓
DynamoDB
  ↓
最新版PlayerView
```

という流れにする。

---

## 13. API

初期案:

```text
POST /games
POST /games/{id}/join
GET  /games/{id}
POST /games/{id}/actions
POST /games/{id}/leave
```

Lambda は最初は 1つでよい。

```text
game-api Lambda
```

内部で route ごとに handler を分ける。

早期に細かく Lambda を分割しすぎない。

---

## 14. 画像共有

画像 binary は WebSocket / AppSync で共有しない。

画像本体は S3、配信は CloudFront。

```text
Browser
  │
  │ 1. Upload URL要求
  ▼
Lambda
  │
  │ 2. Presigned URL
  ▼
Browser
  │
  │ 3. PUT
  ▼
S3
```

画像取得:

```text
Browser
  ↓
CloudFront
  ↓
S3
```

---

## 15. 画像データ設計

DynamoDB には画像本体ではなく S3 key / URL を保存する。

例:

```json
{
  "playerId": "user-a",
  "avatarKey": "users/user-a/avatar/01ABC.webp"
}
```

クライアントには:

```json
{
  "playerId": "user-a",
  "avatarUrl": "https://assets.example.com/users/user-a/avatar/01ABC.webp"
}
```

を返す。

画像更新通知も URL のみを送信する。

```json
{
  "type": "PLAYER_PROFILE_UPDATED",
  "playerId": "user-a",
  "avatarUrl": "https://assets.example.com/..."
}
```

---

## 16. S3 のキー構成案

### アプリ共通素材

```text
assets/
├── cards/
├── ui/
└── backgrounds/
```

### ユーザー素材

```text
user-content/
├── users/
│   └── {userId}/
│       └── avatar/
│
└── rosters/
    └── {ownerId}/
        └── {rosterId}/
            ├── member-01.webp
            ├── member-02.webp
            └── ...
```

---

## 17. ロスター画像共有

マルチプレイでは「誰のロスターを使うか」を Game に記録する。

```json
{
  "rosterId": "roster-123",
  "rosterOwnerId": "user-a"
}
```

参加者は同じ画像 URL を参照する。

```text
Game
  ↓
Roster
  ↓
CloudFront URL
  ↓
全参加者
```

---

## 18. Game Roster Snapshot

ゲーム開始時点のロスターを Snapshot 化する。

```text
LobbyRoster
↓
GameRosterSnapshot
```

理由:

ゲーム中にオーナーが画像を変更しても、進行中ゲームの表示を変えないため。

例:

```text
Game A
Member1 = image-v1.webp

設定変更

Game B
Member1 = image-v2.webp
```

これによりリプレイ時も当時の見た目を再現しやすい。

---

## 19. ログ

ログは2種類に分ける。

### Operational Log

Lambda / API / システム運用向け。

```json
{
  "level": "INFO",
  "requestId": "...",
  "gameId": "...",
  "userId": "...",
  "action": "DISCARD",
  "latencyMs": 32
}
```

保存:

```text
Lambda
  ↓
CloudWatch Logs
```

CloudWatch Logs は無期限保存にせず Terraform で保持期間を指定する。

例:

```hcl
retention_in_days = 14
```

---

## 20. Game Event Log

ゲーム分析用。

```json
{
  "gameId": "01ABC",
  "seq": 123,
  "userId": "user-a",
  "type": "DISCARD",
  "payload": {},
  "timestamp": "..."
}
```

将来的には:

```text
Game Event
   ↓
Firehose
   ↓
S3
   ↓
Athena
```

として分析可能にする。

初期段階では Lambda から構造化 JSON を CloudWatch Logs に出すだけでもよい。

---

## 21. リプレイ

現在のゲームエンジンが:

```text
初期seed + Action列
```

から再現可能な設計であるため、将来的にイベントログを利用してリプレイを実装できる。

```text
seed
+
[
  DRAW,
  DISCARD,
  CLAIM,
  ...
]
↓
game-engine
↓
Replay
```

これはマルチプレイのデバッグにも有効。

---

## 22. Terraform

構成案:

```text
cc-pokajan/
├── src/
│   ├── engine/
│   └── ui/
│
├── backend/
│   └── game-api/
│       ├── handler.ts
│       └── ...
│
├── infra/
│   ├── environments/
│   │   ├── dev/
│   │   └── prod/
│   │
│   └── modules/
│       ├── frontend/
│       ├── cognito/
│       ├── game-api/
│       ├── realtime/
│       ├── dynamodb/
│       ├── user-assets/
│       └── monitoring/
│
└── .github/
    └── workflows/
        ├── test.yml
        └── deploy.yml
```

---

## 23. CI/CD

GitHub Actions を利用する。

Pull Request:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run test:e2e
terraform fmt -check
terraform validate
```

main merge:

```text
Build React
↓
Terraform Apply
↓
S3 Upload
↓
CloudFront Invalidation
↓
Lambda Deploy
```

将来的には OIDC を利用し、GitHub Actions に固定 AWS Access Key を保存しない構成にする。

---

## 24. コスト方針

低トラフィック時に待機コストを持たないサービスを優先する。

```text
S3
CloudFront
Cognito
API Gateway
Lambda
DynamoDB On-Demand
AppSync Events
CloudWatch
```

DynamoDB は On-Demand を基本とする。

EC2 / ECS / Fargate 常時稼働は、アクセスが増えLambdaでは不都合が出てから検討する。

---

## 25. セキュリティ

### Client を信用しない

クライアントから以下を受け取っても信用しない。

- 現在点数
- 完成役
- 相手の手札
- 山札
- GameState
- 勝敗

受け取るのは Action。

```text
DISCARD
CLAIM
DECLARE
JOIN
LEAVE
```

GameState はサーバー側 engine が決定する。

### 画像

Presigned URL を発行する際に:

- Content-Type
- ファイルサイズ
- 拡張子
- userId prefix

などを制限する。

必要になれば画像アップロード後に Lambda で再エンコード・検査する。

---

## 26. 推奨実装順

### Phase 1: AWS 静的配信

```text
React
↓
S3
↓
CloudFront
```

Terraform化する。

---

### Phase 2: Cognito

```text
Cognito User Pool
↓
Login
↓
JWT
```

ログインユーザーのみゲーム画面へ入れるようにする。

---

### Phase 3: Single Player Server Authority

現在ブラウザ内で行っている GameState 更新を Lambda + DynamoDB に移す。

```text
Browser
↓ Action
Lambda
↓
game-engine
↓
DynamoDB
```

最初は1人 + CPU3人でもよい。

これによりマルチプレイ前にサーバー権威型を検証できる。

---

### Phase 4: AppSync Events

2つのブラウザで同じ Game を表示し、リアルタイム更新を確認する。

```text
Browser A
↓
Action
↓
Lambda
↓
DynamoDB
↓
AppSync
↓
Browser B
```

---

### Phase 5: 4人マルチプレイ

- Lobby
- Join
- Ready
- Start
- PlayerView
- private channel
- Disconnect / reconnect

を実装する。

---

### Phase 6: 画像共有

- Presigned Upload
- S3
- CloudFront
- Avatar
- Roster
- GameRosterSnapshot

を実装する。

---

### Phase 7: Observability

- CloudWatch structured logs
- Metrics
- Alarm
- GameEvent

を追加する。

---

### Phase 8: 分析基盤

必要になったら:

```text
Game Events
↓
Firehose
↓
S3
↓
Athena
```

へ拡張する。

---

## 27. 最終構成

```text
Frontend
CloudFront
  └── S3

Authentication
Cognito

Command API
API Gateway HTTP API
  └── Lambda
       └── game-engine
            └── DynamoDB

Realtime
AppSync Events
  ├── game-public
  └── player-private

User Assets
S3
  └── CloudFront

Observability
CloudWatch Logs
CloudWatch Metrics

Analytics
Game Events
  └── Firehose
       └── S3
            └── Athena

Infrastructure
Terraform

CI/CD
GitHub Actions
```

---

## 28. 設計上の重要原則

1. DynamoDB がゲーム状態の Source of Truth
2. AppSync Events は通知に徹する
3. Client からは Action だけを送る
4. game-engine がゲーム状態を決定する
5. GameState を直接クライアントへ送らない
6. Player ごとに PlayerView を生成する
7. 画像 binary をリアルタイム通信に流さない
8. 画像は S3 + CloudFront で共有する
9. ロスターはゲーム開始時に Snapshot 化する
10. 最初から差分同期を作らず Full View 同期から始める
11. アクセスが少ない間はサーバーレスでコストを抑える
12. IaC / CI/CD / Observability を段階的に追加する
