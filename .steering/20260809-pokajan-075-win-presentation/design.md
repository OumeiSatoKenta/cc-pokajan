# Step 7-5: 和了演出の中身 — 設計

## 1. `computeRanking` は `gameSelectors.ts` に置く

計画は `turnFlow.ts` 内で切り出すとしていたが、**`gameSelectors.ts` に置く**。

`gameSelectors.ts` の役割は冒頭に書いてあるとおり
「`GameState` からの導出（クエリ）。状態を変更しない読み取り専用の計算だけを置く」で、
順位の算出はまさにそれ。`turnFlow.ts` は「次は誰の番か・もう終わりか」を担う場所で、
そこに読み取り専用の計算を足すと、次に順位が要る人が `turnFlow` を読むことになる。

依存は `turnFlow` → `gameSelectors` の一方向で、循環しない
（`gameSelectors` は `types` しか import していない）。

```ts
/** 順位。点数降順・同点はプレイヤー ID 昇順（決定性のため）。 */
export function computeRanking(
  players: readonly { readonly id: PlayerId; readonly score: number }[],
): PlayerId[]
```

**引数を最小の形にする。** `GameState['players']` と `Draft['players']` の両方から
呼べるようにするため（前者は `readonly`、後者は可変）。
`GameState` を丸ごと受け取ると `Draft` から呼べなくなる。

`game.ts` の再エクスポートに加え、UI は `engine/game` から取る（既存と同じ経路）。

**振る舞いは変えない純粋な抽出**。`finishGame` はこの関数を呼ぶだけになる。

## 2. 得点の増減は `scoresAfter − scoresBefore` から出す

`WinPresentation` は `payments`（支払い明細）も持っているが、**表示には使わない**。

- 画面に出す数字は**盤面の点数と一致していなければならない**
- 明細を合計して出すと、集計の書き方1つで盤面とずれる余地が残る
- 差分から出せば、**ずれようがない**（表示している前後の点数そのもの）

残高不足で徴収額が候補の点数より少なくなる場合も、差分なら自動的に正しい。
これは 7-4 で `gained` を `candidate.score` ではなく差分から出したのと同じ判断。

### `payments` を型から外す

そうすると `payments` は**どこからも読まれないフィールド**になる。
残すと「これを使うべきなのか」を次に読む人が考えることになるので、
`WinPresentation` から外す。7-4 のテストも差分の検査に寄せる。

> 7-4 で足した直後に外すことになるが、**使われないデータを持ち続けるほうが高くつく**。
> エンジンの `Paid` イベントは `pending` に残るので、明細が必要になれば
> そこから作り直せる（情報は失われない）。

## 3. 順位の並べ替えアニメーション

和了**前**の順位で描いてから、和了**後**の順位へ動かす。

```tsx
const [showAfter, setShowAfter] = useState(reduced)
const order = showAfter ? rankingAfter : rankingBefore
```

- `motion.li` に `layout` を付けると、配列の順序が変わったときに
  framer-motion が位置差分を補間する（`Hand.tsx` と同じ仕組み）
- **`key` は `playerId`**。順位ではなく人に紐づけないと、
  並べ替えではなく「中身が入れ替わっただけ」になり動かない
- マウント後に `showAfter` を立てる。`useEffect` で 1 回だけ

**`useReducedMotion` が真なら最初から `after` を出す**（初期値に反映）。
後から `useEffect` で切り替えると、動かないだけで「一瞬前の順位が見える」ことになる。

> 順位が変わらない和了（よくある）では何も動かない。それが正しい。

## 4. カットイン

`motion.div` で勝者のアバター＋席名を横から入れる。
`useReducedMotion` のときは `duration: 0`（`Hand.tsx` / `TimerBar.tsx` と同じ方針）。

アバターが無い場合は席名の頭文字を丸で出す（`MemberRow` のサムネイルと同じ考え方）。
**画像が無くても成立させる**のは 7-3 から通している要件。

## 5. 画面の構成

```
┌──────────────────────────┐
│  [アバター] 上家          │  ← カットイン
│  3カード 同色 ロン        │
│  +840                    │
├──────────────────────────┤
│ 1位 上家   1,960  +840   │  ← 順位表（並べ替わる）
│ 2位 対面   1,000         │
│ 3位 あなた   880  −840   │
│ 4位 下家     160         │
├──────────────────────────┤
│         [確認]           │
└──────────────────────────┘
```

順位表は**全員分**を出す。増減のある席にだけ `+N` / `−N` を添える。
「誰が払ったか」は増減の位置で分かるので、明細を別に出さない。

## 6. ファイル分割の見込み

`WinOverlay.tsx` は 72 行。カットイン＋順位表を足すと 160 行前後。
基準内だが、順位表は独立した部品なので **`WinRanking.tsx` に分ける**。
分けることで、順位表だけを `renderToStaticMarkup` で検査できる。

## 7. 変更するファイル

**新規**
- `src/ui/components/WinRanking.tsx` — 順位表（並べ替えアニメーション）
- `tests/engine/gameSelectors.test.ts` — `computeRanking`
- `tests/ui/winOverlay.test.tsx` — 演出の出力

**修正**
- `src/engine/gameSelectors.ts` — `computeRanking`
- `src/engine/turnFlow.ts` — `finishGame` が `computeRanking` を呼ぶ
- `src/engine/game.ts` — 再エクスポート
- `src/ui/hooks/loopReducer.ts` — `payments` を外す
- `src/ui/components/WinOverlay.tsx` — カットイン・増減・順位表
- `src/ui/table.css` — 演出のスタイル
- `tests/ui/winGate.test.ts` — `payments` の検査を差分の検査へ
- `tests/e2e/winGate.spec.ts` — カットイン・順位表・**視覚効果を減らす設定**

## 8. 検証

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

**必ず確かめること**:
- **`computeRanking` の抽出で `GameOver.ranking` が変わっていないこと**
  （抽出は「振る舞いを変えない」ことが前提。ここが崩れると精算額が変わる）
- 表示している増減が、表示している前後の点数と一致すること
- Playwright の `reducedMotion: 'reduce'` で演出が止まること
- 375px ではみ出さないこと
