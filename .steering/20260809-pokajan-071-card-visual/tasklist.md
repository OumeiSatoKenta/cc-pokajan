# Step 7-1: カードの表現 — タスクリスト

## フェーズ1: カードの部品

- [x] `src/ui/components/CardView.tsx` に `size?: 'normal' | 'small'` を足す
- [x] `src/ui/components/CardView.tsx` に `testId` を足す
      （追加タスク: 河と手札で識別子を分けないと **E2E が河のカードを掴む**）
- [x] `src/ui/components/CardBack.tsx` を新規作成する（**枚数だけを受け取る**）
- [x] `src/ui/components/MemberTile.tsx` を新規作成する（合成 `Card` を作らない）
- [x] `src/App.css` に `.card--small` / `.card--tile` / `.card-backs` を追加する
- [x] `src/ui/table.css` の `.card--back` を `src/App.css` へ移す（定義の二重化を防ぐ）

## フェーズ2: 呼び出し側の差し替え

- [x] `DiscardPile` をチップから `CardView`（小）に置き換え、画像と記号を受け取る
- [x] `PlayerSeat` の「手札 N枚」を `CardBack` に置き換える
- [x] `BoardInfo` のボーナスを `MemberTile` に置き換える
- [x] `TableScreen` から `imageUrlById` / `groupSymbolById` を配線する
- [x] `src/ui/table.css` の河とボーナスのレイアウトを調整する

## フェーズ3: テスト

- [x] `tests/ui/cardVisual.test.tsx` を新規作成する（21件）
      - **伏せ札の出力に他家のメンバー名・画像・記号・色が含まれないこと**
      - 伏せ札の枚数が指定どおりであること・負値や小数でも落ちないこと
      - `.card--small` が付くこと・河のカードがボタンにならないこと
      - 河が手札と別の識別子で描かれること
      - `MemberTile` が名前と画像とラベルを出し、色クラスを持たないこと
- [x] `tests/e2e/table.spec.ts` に4件追加する
      （伏せ札の枚数一致・伏せ札の情報漏れ・河のカード・ボーナスのタイル）
- [x] 既存の E2E が壊れていないことを確認する（識別子を分けたので無改修で通った）

## フェーズ4: 検証

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全て通る
- [x] `npx playwright test` が通る（54件）
- [x] ブラウザで確認する（河のカード / 伏せ札 / ボーナス / 画像付き / 375px）
- [x] 伏せ札が1行に収まるようサイズを調整する
      （追加タスク: 最初の実装では7枚が2行に折り返していた）
- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する

## 実装後の振り返り

**実装完了日**: 2026-08-09

### 計画と実績の差分

計画（`docs/ideas/pokajan-mahjong-board-plan.md`）から**設計を1点変えた**。

| 項目 | 計画 | 実際 | 理由 |
| ---- | ---- | ---- | ---- |
| 伏せ札 | `CardView` に `faceDown` を足す | **`CardBack` を新設** | `faceDown` だと伏せ札を描くために他家の `Card` を渡すことになる |

追加タスクは3件。

| 追加項目 | 見つかったきっかけ |
| -------- | ------------------ |
| `CardView` の `testId` | 着手前に E2E の `getByTestId('card')` の使われ方を調べた |
| `.card--back` の重複解消 | 新しい定義を書いたら既存が `table.css` に残っていた |
| 伏せ札のサイズ調整 | スクリーンショットで7枚が2行に折り返していた |

### 学んだこと

1. **「渡すが描かない」は情報を守る方法として弱い。**
   計画では `CardView` に `faceDown` を足す想定だったが、それだと
   伏せ札を描くために他家の `Card` を渡すことになる。他家の手札は
   `GameState.players[].hand` として UI から参照できるので、
   条件分岐の取り違え1つで名前や画像が漏れる。
   **枚数だけを受け取る `CardBack`** にしたことで、漏らそうとしても漏らせなくなった。
   CPU に `AiView` しか渡さないのと同じ考え方を UI 側にも当てはめた形で、
   正しさを実装の注意深さではなく型の到達可能性に預けられた。

2. **識別子の再利用は、静かに別の場所を検査させる。**
   河を `CardView` にすると `data-testid="card"` が河にも付く。
   E2E の `getByTestId('card').first().click()` は**河のカードを掴む**し、
   `toHaveCount(HAND_SIZE + 1)` は河の枚数を巻き込む。
   落ちるならまだしも、`.first()` は「押せてしまう」ぶん**通ったまま間違える**。
   着手前に使われ方を洗ったので、`testId` を分けるだけで既存50件を無改修で通せた。

3. **表示のために偽のドメイン型を作らない。**
   ボーナスをカードで見せるとき、`Card` を合成すれば `CardView` を流用できた。
   しかし `Card` は `uid` と `color` を必須で持つため、実在しないカードが
   ドメイン型として生まれ、`uid` の衝突やカード保存則の検査に紛れ込む余地ができる。
   表示に必要な値だけを取る `MemberTile` にしたことで、その余地が残らなかった。

4. **CSS の定義は「新しく書く前に既にあるか探す」。**
   `.card--back` は Step 4 で書いたまま未使用だった。それを使うのが今回の目的なのに、
   場所を確認せず `App.css` に新しく書いてしまい、一時的に二重定義になった。

### 次回への改善提案

- **Step 7-2 に入る前にスクリーンショットで方針を判断する**（計画どおり）。
  卓レイアウトができた時点で、配色とカードの質感を詰めるか外部に出すかを決める
- **`CardBack` の `orientation="vertical"` は 7-2 で使う**。今は未使用だが、
  左右の席で縦積みにするために先に用意してある
- `PlayerSeat` はまだ `.chip`（直近の捨て札）を使っている。7-2 で各家に河を持たせるときに
  `.chip` ごと置き換える
- `src/engine/yaku.ts`（410行）と `deck.ts`（406行）は基準超過のまま。今回も触っていない
