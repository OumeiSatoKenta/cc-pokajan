# 設計書

## アーキテクチャ概要

Step 1 で確立したレイヤ構成をそのまま踏襲する。3 モジュールを追加し、依存は一方向。

```
yaku.ts   役候補の列挙・最良選択・待ち計算   ← 中核
   │ uses
   ▼
score.ts  役種 × 同色 × ボーナス枚数 → 点数
   │ uses
   ▼
types.ts  Card / YakuCandidate / YakuContext / RulesConfig

settle.ts 点数移動（yaku とは独立。金額を受け取るだけ）
```

**設計原則（Step 1 から継続）**:

1. 副作用なし・`Math.random()` を使わない
2. ルール値は `RulesConfig` を引数で受け取る（`src/config/` を import しない）
3. 返り値はイミュータブル（`readonly`）

## コンポーネント設計

### 1. `src/engine/score.ts` — 点数計算

**責務**: 役種・同色可否・ボーナス枚数から点数を求める。

**実装の要点**:

- 点数表は `rules.scores[kind]` から引く。同色倍率は役ごとにばらつく（7倍 / 3倍 / 2.8倍 / 3.75倍）ため**計算式では導けず、ルックアップテーブルとして扱う**
- ボーナス加点は「役の構成カードのうち、ボーナスメンバーのカードの枚数 × `bonusPerCard`」。3カードでボーナスメンバーを揃えると3枚分（+270）になる

```ts
export function countBonusCards(cards: readonly Card[], bonusMemberIds: readonly MemberId[]): number
export function scoreYaku(kind: YakuKind, sameColor: boolean, bonusCount: number, rules: RulesConfig): number
```

**重要な性質**: 点数は `(kind, sameColor, メンバー構成)` だけで決まり、**どの色のカードを消費するかには依存しない**。

- `triple` の構成メンバーは1人 → ボーナス枚数は 0 か 3
- `groupN` の構成メンバーはグループ全員 → ボーナス枚数は `|group.memberIds ∩ bonusMemberIds|`

この性質があるおかげで、候補列挙のときに「点数を最大化するカードの選び方」を探索する必要がない。

### 2. `src/engine/yaku.ts` — 役判定（中核）

**責務**: 手札から成立している役候補を列挙し、最良候補と待ちを求める。

#### 候補の列挙

```ts
export function findYaku(hand: readonly Card[], ctx: YakuContext, required?: Card): YakuCandidate[]
```

**引数の意味を明示する**: `hand` は**判定対象のカード全体**であり、ロン判定では「自分の手札 + 相手の捨て札」を渡す。`required` はその捨て札。呼び出し側は `findYaku([...player.hand, discard], ctx, discard)` と書く。

列挙するのは以下の4系統。組み合わせ爆発は起きない（メンバー最大16人 + グループ4つ、各色3通り）。

| 系統 | 条件 | 生成する候補 |
|---|---|---|
| 3カード（通常） | あるメンバーのカードが3枚以上 | 手札順に先頭3枚 |
| 3カード（同色） | あるメンバーの同一色カードが3枚以上 | その色の先頭3枚（色ごとに1候補） |
| N人組（通常） | 今局のグループの全メンバーが1枚以上ある | 各メンバーの先頭1枚 |
| N人組（同色） | 全メンバーが色 c のカードを持つような色 c が存在 | 色 c の各メンバー先頭1枚（色ごとに1候補） |

- `YakuKind` はグループの人数から決まる（3人 → `group3`）。対応範囲は `types.ts` の `MIN_YAKU_GROUP_SIZE` / `MAX_YAKU_GROUP_SIZE` に定数として置き、**役種の決定（`yaku.ts`）とルール検証（`deck.ts`）の単一の真実にする**。`RulesConfig.maxGroupSize` がこの範囲を超えると、ロスター検証と配牌は通るのに最初の役判定で落ちるため、`validateRoster` が対局開始前に弾く
- **カードの選び方は手札順で決定的にする**。点数はカード選択に依存しない（上記の性質）ため、探索は不要。どのカードを残すかという戦術判断は Step 3 の AI の責務
- **`sameColor` は「どちらの列挙ループから来たか」ではなく、実際に消費するカードの色から判定する**。ループの出自で決めると、混色候補として選んだカードがたまたま全て同色だった場合に「重複除去が高得点側を残す」ことでしか正しくならず、`RulesConfig` では強制されていない「同色の点数 > 通常の点数」という大小関係に正しさが依存してしまう
- **グループのメンバー重複に対する防御**: `pickGroupCards` は選択済みの uid を除外する。正規のロスターでは `validateRoster` が重複を弾くが、`YakuContext` は検証を経ずに直接渡せる公開 API のため、同じカードを二重に数えないようここでも守る
- **重複除去**: 消費するカード集合（uid の昇順）が同一の候補が複数出た場合、点数が高い方だけを残す

#### ロン判定（`required` 指定時）

「その1枚がなければ成立しない候補だけを残す」を、次の2段階で実装する。

1. `hand` から `required` を1枚除いた手札で候補を列挙し、その**シグネチャ集合**を作る
2. `hand` 全体の候補のうち、`required` を消費し、かつシグネチャが 1 の集合に含まれないものだけを残す

シグネチャは `${kind}:${targetId}:${color ?? 'mixed'}`（`targetId` は 3カードならメンバーID、N人組ならグループID）。

これにより「手の内で既に成立している役でロンを主張する」ことを防げる。単に「`required` を含む候補」で絞るだけでは、同じメンバー・同じ色の予備カードが手札にある場合に誤ってロンが成立してしまう。

#### 最良候補の選択

```ts
export function bestYaku(candidates: readonly YakuCandidate[], hand: readonly Card[], ctx: YakuContext): YakuCandidate | null
```

1. 点数が最大のもの
2. 同点なら**残り手札の価値**が高いもの（消費後の手札で、同一メンバーの重複枚数と同色の重複枚数を数えた単純なスコア）
3. それも同点なら、消費カードの uid 列が小さい方（決定性のため）

「残り手札の価値」は次の役に繋がりやすさの近似であり、厳密な期待値計算ではない。実装（`remainingValue`）は次の3項の和とする。

```
Σ n(n-1)  over 同一メンバーの枚数 n        … 3カードへの寄与
Σ n(n-1)  over 同一メンバー同一色の枚数 n  … 同色役への寄与
Σ held    over 活性グループ（held >= 2 のとき）… N人組への寄与
```

これはあくまで「エンジンが同点候補を決定的に1つ選ぶ」ためのタイブレークであり、CPU AI の戦術評価とは目的が異なる。Step 3 の AI がより精密な判断をしたい場合は `findYaku` の全候補を直接評価できる。

#### 待ち計算（リーチ表示）

```ts
export interface WaitEntry {
  readonly memberId: MemberId
  readonly color: ColorId
  readonly best: YakuCandidate
}
export interface WaitInfo {
  readonly waits: readonly WaitEntry[]
  /** 待ちに寄与している手札カードの uid。UI はこれを黄色枠でハイライトする。 */
  readonly contributingUids: ReadonlySet<number>
}
export function computeWaits(hand: readonly Card[], ctx: YakuContext): WaitInfo
```

実装は総当たり。「今局の登場メンバー × 色数」それぞれについて、仮のカードを1枚足して `findYaku(hand + probe, ctx, probe)` を呼ぶだけ。試行回数の構造的な上限は `groupsPerGame × maxGroupSize × colors.length`（既定値では 4 × 5 × 3 = 60）で、軽量判定を数十回繰り返すだけなので最適化は不要。判定ロジックを1箇所に集約できる利点の方が大きい。

- 仮カードの `uid` は固定の番兵値ではなく **「手札中の最小 uid − 1」を動的に計算する**。固定値だと将来 uid の割り当て方が変わったときに衝突しうるため
- 登場メンバーは `ctx.activeGroups` から導出する（`YakuContext` は `activeMembers` を持たないため）
- `contributingUids` は、各待ちの最良候補が消費するカードから仮カードを除いた uid の和集合

### 3. `src/engine/settle.ts` — 支払い処理

**責務**: 和了時の点数移動。役判定とは独立で、金額を受け取るだけ。

```ts
// Payment は types.ts に置き、GameEvent の Paid variant と同一の型を共有する。
// 別々に定義すると片方だけフィールドを足したときに drift するため。
export interface Payment { from: PlayerId; to: PlayerId; amount: number }   // types.ts
export type GameEvent = … | ({ type: 'Paid' } & Payment)                    // types.ts

export interface SettlementResult {
  readonly scores: readonly number[]
  readonly payments: readonly Payment[]
}

export function settleTsumo(scores: readonly number[], winner: PlayerId, amount: number): SettlementResult
export function settleRon(scores: readonly number[], winner: PlayerId, discarder: PlayerId, amount: number): SettlementResult

/** 精算結果を演出用イベントに変換する。Step 3 が同じ変換を複数箇所に書かないための入口。 */
export function toPaidEvents(result: SettlementResult): GameEvent[]
```

**実装の要点**:

- **ツモ**: 自分以外の `playerCount - 1` 人が等分を支払う。既定ルールでは全点数が3の倍数なので割り切れるが、Step 6 でルール値が編集可能になることを見越して `Math.floor` で分配する
- **入力の前提**: `scores` の各要素は 0 以上であること。ポカジャンは誰かの点数が 0 以下になった時点で対局が終了するため、Step 3 のリデューサからは常にこの前提が満たされる。ただし防御的に `max(残高, 0)` を挟んでおり、前提に反した入力でも点数保存則は破れない（その相手からは何も徴収しない）
- **0 クランプと点数保存則を同時に満たす**。これが本モジュールで最も重要な点:
  - 各支払い者から徴収する額は `min(負担額, max(その人の残高, 0))`
  - 和了者が受け取るのは**実際に徴収できた合計**
  - この形にすることで、クランプが発生しても4人の総和が変わらない（テストで固定する）
  - 「和了者に満額を渡し、支払い者を0で止める」実装にすると点数が増殖してしまう
- `amount` が負のときは `RangeError`。`winner === discarder` も `RangeError`

## データフロー

### 自分の手番で和了する（ツモ）

```
1. 山から1枚引く（Step 3） → 手札8枚
2. findYaku(hand8, ctx)           → 候補一覧
3. bestYaku(候補, hand8, ctx)     → 最良候補（null なら和了なし）
4. settleTsumo(scores, self, best.score)
5. 消費カードを手札から除去し、同数を補充（Step 3）
```

### 他家の捨て札で和了する（ロン）

```
1. 他家が1枚捨てる（Step 3）
2. findYaku([...hand7, discard], ctx, discard)  → その1枚を必要とする候補のみ
3. bestYaku(候補, [...hand7, discard], ctx)
4. settleRon(scores, self, discarder, best.score)
5. 消費カードを除去し、不足分を補充（Step 3）
```

### リーチ表示（毎ターン）

```
1. computeWaits(hand7, ctx)
2. waits が空でなければテンパイ
3. contributingUids に含まれる手札カードを黄色枠で描画（Step 4）
```

## エラーハンドリング戦略

Step 1 の方針を踏襲する。

- **引数の前提違反は `RangeError`**（`settleTsumo` の負の金額、`settleRon` の `winner === discarder`、プレイヤー index の範囲外）
- **役が成立しないことはエラーではない**。`findYaku` は空配列、`bestYaku` は `null` を返す
- **内部不変条件の違反は例外ではなくテストで防ぐ**。`yaku.ts` は `validateRoster` を通ったロスターを前提にしてよい（グループ人数が 3〜5 に収まっていること等）
- ただし `YakuKind` への変換だけは、想定外のグループ人数が来た場合に**黙って誤った役種を返さない**よう例外を投げる

## テスト戦略

### ユニットテスト

**`tests/engine/score.test.ts`**
- 4役 × 通常 / 同色の8通りが `DEFAULT_RULES.scores` と一致
- ボーナス0枚 / 1枚 / 3枚の加点
- `countBonusCards` がメンバーID基準で数える（色は無関係）
- 未知の役種で例外

**`tests/engine/yaku.test.ts`** — 手札をリテラルで組み立てる `card(memberId, color, uid)` ヘルパを用意する
- 3カード: 通常 / 同色 / 4枚持ちのとき / 2枚では成立しない
- N人組: 3人 / 4人 / 5人 / 全員揃わないと不成立 / 今局にないグループでは不成立
- 同色: 複数色で成立しうるときに色数だけ候補が返る
- ボーナス加点込みの点数
- 重複除去: 同じカード集合の候補が1つに畳まれる
- `required`: その1枚を含む候補だけ返る / 手の内で成立済みの役は返らない / 予備カードがある場合の誤ロン防止
- `bestYaku`: 点数最大 / 同点時の残り手札比較 / 候補なしで `null`
- `computeWaits`: 3カード待ち / N人組待ち / 同色待ち / 待ちなし / 既に成立している手札 / `contributingUids` の内容
- **不変条件**: `setupGame` の実際の配牌に対して `findYaku` を回し、候補の枚数・メンバー構成・点数が常に整合すること

**`tests/engine/settle.test.ts`**
- ツモ: 3人が等分を支払う / 和了者の増分が徴収合計と一致
- ロン: 放銃者だけが支払う
- クランプ: 残高不足時に残高分だけ徴収 / 誰も負にならない
- **点数保存則**: クランプの有無にかかわらず総和が不変（複数パターンで検証）
- 不正引数で `RangeError`

### 統合テスト（プロパティテスト）

`setupGame` の出力（シード 0〜99 × 4人 = 400 手札）に対して以下を確認する。

- 全プレイヤーの初期手札で `findYaku` が例外を投げない
- 返る候補の `cards.length` が役種と整合する
- `computeWaits` が例外を投げず、`contributingUids` が必ず手札の uid の部分集合になる
- `bestYaku` の点数が `findYaku` の最大点数と一致する
- **別実装との突き合わせ**: 「どの役種がどの対象で成立しているか」だけを判定する素朴な総当たり実装を用意し、`findYaku` の結果と完全に一致することを確認する

最後の項目が重要である。上の構造的整合性チェックは「候補に入っているものの正しさ」しか見ておらず、**本来成立すべき役を取りこぼす偽陰性を検出できない**（候補が 0 件ならループ本体が空実行されて素通りする）。独立した素朴実装との比較で、取りこぼしと過検出の両方を押さえる。

## 依存ライブラリ

**新規追加なし**。Step 2 は純粋な TypeScript のみで実装でき、外部ライブラリを必要としない。そのため Context7 による外部 API 調査も実施していない。

## ディレクトリ構造

```
src/engine/
  score.ts      （新規）
  yaku.ts       （新規）
  settle.ts     （新規）
  types.ts      （変更）Payment / MIN_YAKU_GROUP_SIZE / MAX_YAKU_GROUP_SIZE を追加
  deck.ts       （変更）validateGroupSizeRules を追加
src/
  App.tsx       （変更）役・待ち・リーチ枠を表示する動作確認画面に更新
  App.css       （変更）
tests/engine/
  score.test.ts   （新規）
  yaku.test.ts    （新規）
  settle.test.ts  （新規）
  deck.test.ts    （変更）グループ人数のルール検証テストを追加
tests/helpers/
  cards.ts        （新規）テスト用のカード組み立てヘルパ
tests/ui/
  App.test.tsx    （変更）役・待ちパネルの描画を検証
```

### 動作確認画面（`src/App.tsx`）

Step 2 はエンジンだけの実装のため、そのままではブラウザから何も確認できない。プレースホルダ画面を更新し、以下を表示する。対局 UI（Step 4）ではなく、あくまでエンジンの目視確認用。

- 成立している役の一覧（役種・同色・ボーナス枚数・点数。最良候補を強調）
- 待ちの一覧（メンバー・色・成立する役・点数）
- 待ちに寄与する手札カードの**黄色枠ハイライト**（原作のリーチ表示の再現）
- ボーナスメンバーのカードへの印
- 「次の配牌」ボタン（シードを進めて多数の配牌を確認できる）

## 実装の順序

1. `score.ts` + `tests/engine/score.test.ts`（依存なし・最小）
2. `settle.ts` + `tests/engine/settle.test.ts`（`yaku` と独立に完成させられる）
3. `tests/helpers/cards.ts`（役判定テストの土台）
4. `yaku.ts` の候補列挙 + テスト
5. `yaku.ts` の `required` 絞り込み + テスト
6. `yaku.ts` の `bestYaku` + テスト
7. `yaku.ts` の `computeWaits` + テスト
8. `setupGame` 出力に対する統合テスト
9. 品質ゲート

## セキュリティ考慮事項

- Step 2 の成果物は外部入力を受け取らず、ネットワーク I/O もない
- ただし `RulesConfig` は Step 6 でユーザー編集可能になるため、`score.ts` は `rules.scores` に未知の役種が無いことを前提にせず、参照できない場合は例外を投げる

## パフォーマンス考慮事項

- 候補列挙は「メンバー数（最大16）+ グループ数（4）」× 色数（3）で最大 60 候補程度。無視できる
- `computeWaits` は 48 通り × 候補列挙。1回あたり数千回の単純ループで、毎ターン呼んでも問題にならない
- 早すぎる最適化は避け、Step 4 で実測して問題が出てからメモ化を検討する

## Step 3 へ申し送る設計課題

コードレビューで挙がった、本 Step のスコープ外だが Step 3（対局状態機械 + CPU AI）の着手前に決めておくべき論点:

- **`computeWaits` は1手先（テンパイ）専用**である。Step 3 の CPU AI が「あと何枚で揃うか（2手以上先）」を評価したい場合は、`computeWaits` を無理に転用せず、`enumerateDrafts` 相当の列挙ロジックを参考に独自のシャンテン計算を書くこと。1手先専用の関数を N 手先に拡張しようとすると破綻する
- **`rules` の受け渡し方を確定させる**。`GameState` は `RulesConfig` を保持しない設計だが、`findYaku` / `computeWaits` / `scoreYaku` はいずれも `rules` を必須で受け取る。リデューサを `reduce(state, action, rules)` にするのか、`GameState` に埋め込むのかを Step 3 の最初に決める（Step 1 から持ち越している課題）
- **`bestYaku` と AI の評価関数の境界**。`bestYaku` の `remainingValue` は「エンジンが同点候補を決定的に1つ選ぶ」ためのタイブレークであり、AI の戦術評価ではない。AI 側の評価関数をここに継ぎ足すと、決定的デフォルト選択と戦略評価が同じ関数に混在してしまう。AI は `findYaku` の全候補を受け取って独自に評価する形にすること
- **`yaku.ts` の肥大化に注意**。現在 374 行。Step 3 で役関連ロジックを継ぎ足したくなったら、列挙部分（`enumerateTriples` / `enumerateGroups` / `pickGroupCards`）を `yaku/enumerate.ts` へ切り出すことを先に検討する

## 将来の拡張性

- **役の追加**: `YakuKind` と `rules.scores` にエントリを足し、`findYaku` に列挙ロジックを1つ追加するだけで済む構造にする
- **ダマポカジャン（v2）**: `findYaku` が全候補を返すため、AI が「宣言せず伏せる」判断を後から足せる
- **色数の変更**: `rules.colors` を参照するので、4色構成にしても `yaku.ts` の変更は不要
