# 設計: AWS デプロイ Step 2 — engine 純粋ロジック抽出

## A. `src/engine/playerView.ts`（新規）

`AiView`/`VisibleCards` と同じ「状態に触るのは1関数だけ、以降は公開情報で完結」を PlayerView にも適用する。

```ts
export interface PlayerSummary {
  readonly id: PlayerId
  readonly isCpu: boolean
  readonly score: number
  readonly handCount: number          // 他家は枚数のみ。hand 配列を構造として持たない
  readonly discards: readonly Card[]
  readonly declared: readonly YakuCandidate[]
}

export interface PlayerView {
  readonly selfId: PlayerId
  readonly hand: readonly Card[]       // 自分の手札のみ
  readonly phase: ObservablePhase
  readonly turn: PlayerId
  readonly declarer: PlayerId
  readonly players: readonly PlayerSummary[]
  readonly wallCount: number           // 山札は残数のみ
  readonly activeGroups: readonly Group[]
  readonly activeMembers: readonly Member[]
  readonly bonusMemberIds: readonly MemberId[]
  readonly lastDiscard: Card | null
  readonly lastDiscardBy: PlayerId | null
  readonly claims: Readonly<Partial<Record<PlayerId, ClaimStatus>>>  // ← ClaimDecision ではなく状態のみに redact
  readonly claimTimerMs: number
  readonly chainCount: number
}

/** 割り込みの状態のみ。`ClaimDecision`（YakuCandidate を含む）を外へ出さないための redact 型。 */
export type ClaimStatus = 'pending' | 'passed' | 'claimed'

export function toPlayerView(state: GameState, seat: PlayerId): PlayerView { ... }
```

**redaction の要点（この Step の存在意義）**:

- `PlayerSummary` は **`hand` フィールドを一切持たない**。他家の手札を表現する型経路が存在しない（AiView と同型の構造的隠蔽）。
  自分の手札だけ `PlayerView.hand`。
- 山札は `wallCount` のみ。`wall`（中身）は含めない。
- **`claims` は `ClaimStatus`（`'pending'|'passed'|'claimed'`）に redact する（[必須] doc-review 指摘）。**
  `GameState.claims[id]` は CLAIM 時に**実カードを含む `YakuCandidate`** を保持する（`game.ts` の `draft.claims[id]=candidate`）。
  claimWindow は全員表明まで閉じないため、「CPU が先に CLAIM・人間が未表明」という **Step 5 の想定運用（＝単一人間プレイでも到達）**で
  `state.claims` を素通しすると他家の手札が漏れる。`null→'pending' / 'pass'→'passed' / YakuCandidate→'claimed'` に落とす
  （既存消費側は `=== null`/`!== null` の真偽判定のみで中身を見ないため、意味は保たれる。キー不在＝捨て札の本人＝割り込み対象外も維持）。
- **`seed` / `rngState` を含めない。** これが最重要。`seed + roster + rules` から山札の並びは決定的に再現できるため、
  seed を送ると**山札の中身が間接的に漏れる**（マルチプレイでカンニング可能）。revised.md の PlayerView スケッチは `seed` を
  挙げていたが、redaction の観点で除外する（「たまたま漏れない」ではなく型・構造で漏らさない）。
- 範囲外 `seat` は `RangeError`（`toAiView`/`toVisibleCards` と同じ。0 埋めフォールバックを置かない）。

**`rules` を引数に取らない**理由: PlayerView の全フィールドは `GameState` から得られ、rules は不要。`tsconfig` の
`noUnusedParameters` に反するため署名から外す（3引数 `toPlayerView(state,seat,rules)` は本体ではなく姉妹の
`...-add-feature-commands.md` L89 のスケッチ。そちらも `(state,seat)` に更新して食い違いを消す）。
Step 6 の UI は `view.activeGroups`/`bonusMemberIds` ＋ クライアント既知の rules を**利用側で**合成して `YakuContext` を作る。
`version` も含めない（`GameState` に無く、Step 5 の DynamoDB 層が付ける）。

## B. `src/engine/autoAction.ts`（新規・engine）— CPU/自動判断の純ロジック

UI `decideAutoAction` の判断部分を、演出遅延を除いて engine へ移す。**human を単数 `humanSeat` から複数 `humanSeats` へ一般化**
（Step 5 マルチプレイの前段）。単数 `[h]` を渡せば既存挙動と完全一致することを検証済み（下記トレース）。

```ts
/** nextCpuAction が返しうるアクション。TICK（時間経過）は CPU 判断では発生しないので型で除外する。 */
export type CpuAction = Exclude<Action, { readonly type: 'TICK' }>

export function claimableFor(state, rules, playerId): YakuCandidate[]      // UI から移設（findYaku ベース）
export function declarableFor(state, rules, playerId): YakuCandidate[]     // UI から移設
export function pendingCpuClaimIds(state, humanSeats: readonly PlayerId[]): PlayerId[]  // 元 humanSeat 単数を一般化
export function nextCpuAction(state, rules, ai, humanSeats: readonly PlayerId[]): CpuAction | null
```

`CpuAction`（TICK 型除外）で「TICK を返さない」を**型レベル**で保証する（`ObservablePhase` が `resolveClaim` を型で除外するのと同流儀・[低] 指摘）。
`delayFor` は `CpuAction` を受け、TICK ケースを書かずに `never` 網羅できる。

`nextCpuAction` は `decideAutoAction` の `switch(phase)` から `delayMs` を除いたもの。`humanSeat === id` を
`humanSeats.includes(id)` に、claimWindow の human 末尾を「未表明 human を id 昇順で1人選ぶ」に一般化する。

**単数→複数の等価性（`humanSeats = [h]` で既存と一致することを全ケースでトレース済み）**:

- `pendingCpuClaimIds`: `!humanSeats.includes(id)` は `[h]` で `id !== h` に一致。
- claimWindow human 末尾: `pendingHumans = humanSeats.filter(id => id in claims && claims[id] === null).sort()`。
  `[h]` では「h が claims にあり未表明なら [h]、そうでなければ []」＝元の `claims[h] !== null ? null : ...` と同値。
- `[]`（全 CPU）では human 分岐に入らず、`autoplay.ts` の `nextAction` と同じアクションを返す（到達する全局面で）。

## C. `src/ui/hooks/autoAction.ts`（改修）— 薄い UI アダプタ

- `decideAutoAction(game, rules, ai, humanSeat, delays = DELAYS): AutoStep | null`
  = `nextCpuAction(game, rules, ai, [humanSeat])` を呼び、`null` ならそのまま、非 null なら `{ action, delayMs: delayFor(action, delays) }`。
- `delayFor(action: CpuAction, delays)`: **遅延は `action.type` の純関数**（元コードの各分岐の delay と1:1）。
  `DRAW→draw / DISCARD→discard / DECLARE→declare / SKIP_DECLARE→skipDeclare / CLAIM・PASS→claim`。
  `TICK` は型（`CpuAction`）で除外済みなのでケース不要・`never` 網羅のみ。
- `claimableFor` / `declarableFor` は engine から **re-export**（消費側の import パス `'./autoAction'` を維持）。
- `countPendingCpuClaims(game, humanSeat) = pendingCpuClaimIds(game, [humanSeat]).length`（engine へ委譲・単数署名維持）。
- `autoActionKey` / `candidateKey` / `Delays` / `DELAYS` / `NO_DELAYS` / `EVENT_HOLD_MS` / `AutoStep` は**現状維持**。

これで `useGameLoop.ts` と `tests/ui/autoAction.test.ts` の import・呼び出しは**無改修**。既存 autoAction テストが
「decideAutoAction（＝nextCpuAction 経由）の挙動不変」の回帰そのものになる。

## D. テスト

- `tests/engine/playerView.test.ts`:
  - 自分の手札 === `state.players[seat].hand`。`players[i]` は `hand` キーを持たない（`'hand' in players[i]` が false）。
    `PlayerView` は `wall`/`seed`/`rngState` キーを持たない。
  - **leak オラクル（初期局面）**: `createGame` の実局で、`JSON.stringify(view)` に**他家手札の uid・山札の uid が1つも出ない**。
  - **leak オラクル（claimWindow・[必須]）**: `gameState({ phase:'claimWindow', claims:{ 1: 他家の手札由来 YakuCandidate, 0: null }})`
    を作り、CLAIM した他家の**カード uid が `JSON.stringify(view)` に出ない**こと・`view.claims[1] === 'claimed'` を検査。
  - 範囲外 seat で `RangeError`。
- `tests/engine/nextCpuAction.test.ts`:
  - **差分オラクル**: `playGameToEnd`（autoplay=独立参照）の `onStep` でアクション列を捕捉し、`nextCpuAction(state, rules, ai, [])`
    で同一 seed を駆動したアクション列と `toEqual`（seed 0〜N）。→ 全 CPU で autoplay と完全一致。
  - 人間経路（単数 `[0]`）: draw は DRAW / 自席 discard は null / 役なし selfDeclare は SKIP / 役あり selfDeclare は null /
    claimWindow は CPU 先行、human 役なしは PASS・役ありは null。
  - **複数人間（`[0,1]`・[高]）**: claimWindow で 0,1 とも pending のとき、役なしの先頭 human を PASS・役ありなら null になること
    （Phase 5 の中枢ロジックを Step 2 で最低1件固定する）。
  - ミューテーション: redaction を壊す（他家 hand を混ぜる）と leak オラクルが、`includes` を `===` 逆にすると差分オラクルが落ちる。

## リスクと対応

| リスク | 対応 |
| ------ | ---- |
| 抽出で `decideAutoAction` の挙動が変わる | delay は type の純関数・判断は逐語移設。既存 `autoAction.test.ts` 無改修 PASS を必須条件に。 |
| human 単数→複数の一般化で境界がズレる | `[h]` での等価性を全ケースでトレース（上記 B）。既存テストで機械的に担保。 |
| 100 局不変条件の破壊 | `autoplay.ts` を触らない。`nextCpuAction([])` は autoplay と別実装のまま差分オラクルで一致を検査。 |
| PlayerView が seed 経由で山札を漏らす | seed/rngState/wall を構造的に除外。leak オラクルで uid 非出現を実測。 |
| 同名 `autoAction.ts` が2層に並ぶ混乱 | import パスで一意（`../../engine/autoAction` vs `./autoAction`）。両ファイル冒頭で相互参照コメント。 |

## 検証（受け入れの実測方法）

1. `tests/engine/{playerView,nextCpuAction}.test.ts` を追加し、わざと壊して落ちることを確認 → revert。
2. 既存 `tests/ui/autoAction.test.ts`・`tests/engine/autoplay.test.ts`（100 局）が無改修で緑。
3. 検証ゲート一式 + `npx playwright test` 緑（ローカル挙動不変）。

## レビュー反映（実装後 3軸 + validator + doc-reviewer）

採り入れた修正（すべて反映済み）:

- **[必須] `toPlayerView` の seat 検証を明示化**: `state.players[seat] === undefined` はプロトタイプ由来キー
  （`'__proto__'`/`'length'`）や文字列添字を素通りし `hand: undefined` の壊れた view を返す。Step 5 で seat は
  ネットワーク境界から来るため、`toAiView` と同じ `Number.isInteger(seat) && 0 <= seat < length` の明示検証に統一。
  プロトタイプキー・文字列添字の回帰テストを追加（ミューテーションで実測）。
- **[推奨] `toClaimStatus` に網羅性ガード**: 最終分岐に `decision satisfies YakuCandidate` を置き、`ClaimDecision` に
  変種が増えたら compile エラーで気づく（redaction 境界の網羅性を型で守る）。
- **[中] `claimableFor` の暗黙依存にコメント**: `!== null` が「表明済み」と「キー不在＝捨て札の本人」を両方弾くこと、
  後者を `game.ts` が保証することを明記。
- **[推奨] テストを engine 側に直置き**: `nextCpuAction.test.ts` → `tests/engine/autoAction.test.ts` に改名し、
  `claimableFor`/`declarableFor`/`pendingCpuClaimIds`（単数/複数 humanSeats・非破壊ソート）を engine から直接検査。
  複数人間 `[0,1]` の「役あり→null」も明示追加（Step 5 の backend が engine から直接 import するため）。
- 計画コマンド doc L89 の `toPlayerView(state,seat,rules)` を `(state,seat)` に修正（自己矛盾の解消）。

## 後続 Step への申し送り（Step 5/6）

- **`PlayerView.claims` は `ClaimStatus`（null を含まない）**。Step 6 で `useGameLoop.ts` / `turnTimer.ts` の
  `GameState.claims[seat] === null` 判定を PlayerView に載せ替えるときは、`=== null` が常に false になり受付判定が壊れる。
  「自分にとって受付が開いているか（`'pending'`）」を判定する PlayerView 向けの純関数を別途用意すること。
- **`humanSeats` と `players[].isCpu` の二重の真実**: `nextCpuAction` は `humanSeats` 引数だけで人間を判断する
  （`isCpu` と照合しない）。Step 5 でリクエストごとに `humanSeats` を組み立てるときは `isCpu` と一致させるか、
  境界で assert すること（食い違うと「人間席が CPU に操作される／CPU 席で進行が止まる」が静かに起きる）。
- **シリアライズ境界での防御的コピー**: `toPlayerView` は `toAiView`/`toVisibleCards` と同様に内部配列
  （`hand`/`discards`/`declared`/`activeGroups`/`activeMembers`）を参照で返す。Step 5 の単一プロセス Node サーバーで
  同時リクエストに使う前に、クロスプレイヤー共有配列の `Object.freeze` かコピーを検討する。
- **UI の re-export シム**: `src/ui/hooks/autoAction.ts` の `claimableFor`/`declarableFor` re-export は Step 6 で
  `useGameLoop.ts` を engine 直下 import へ切り替えて畳むか、UI の恒久窓口として残すかを Step 6 で判断する。
