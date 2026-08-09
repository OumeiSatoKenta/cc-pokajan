# Step 8-1: 和了演出の作り込み — 設計

## 1. 二重ディスパッチを構造で塞ぐ（この設計のいちばんの要点）

オーバーレイ全体をクリックで進める。すると**パネル内の「閉じる」ボタンの click は
オーバーレイまで泡立つ**。素直に書くと `dismiss` が2回走り、`pendingWins` が
**2件落ちる**。連続和了の2件目が黙って消え、プレイヤーには点数バグに見える。

`stopPropagation` でも塞げるが、それは「今の DOM 構造ではたまたま漏れない」形の正しさで、
CLAUDE.md が繰り返し禁じている形（「正しさを『たまたま成り立っている条件』に依存させない」）。

**アクションに鍵を持たせる。**

```ts
/** 和了1回分を一意に決める鍵。構成カードは一度消費されたら二度と場に戻らない。 */
export function winKey(win: WinPresentation): string {
  const uids = win.candidate.cards.map((card) => card.uid).sort((a, b) => a - b)
  return `${win.playerId}:${uids.join('-')}`
}

| { readonly type: 'DISMISS_WIN'; readonly key: string }

case 'DISMISS_WIN': {
  const head = state.pendingWins[0]
  if (head === undefined || winKey(head) !== action.key) {
    return state
  }
  return { ...state, pendingWins: state.pendingWins.slice(1) }
}
```

これで**二重クリック・イベントの泡立ち・E2E の重複操作・タイマーとクリックの競合**が
すべて同じ1つの規則で無効になる。しかも**純粋関数なので Vitest で検査できる**
（DOM の泡立ちを再現しなくても、鍵違いのディスパッチで確かめられる）。

同じ `winKey` を **React の `key`** にも使う。連続和了で鍵が同じだと、
段が進んだ状態のまま2件目が表示される（カットインが飛ぶ）。1つの概念が2つの必要を満たす。

`CONFIRM_WIN` → `DISMISS_WIN` の改名も同時に行う。確認していないものを confirm と呼ばない。

## 2. 段の状態機械の置き場所

**`WinOverlay` に置く。`useGameLoop` には置かない。**

7-4 で「停止フラグ（`isPaused`）を持つ効果が3つある」構造を作った。ここに4つ目を足すと
止め忘れの面が1つ増える。対局ループは「`pendingWins` が空でない間は止まる」ことだけを
知っていればよく、段が2つあることは演出の内部事情である。

```tsx
type Stage = 'cutin' | 'result'
const [stage, setStage] = useState<Stage>('cutin')
```

- `cutin` に入ったら `timing.cutInMs` 後に `result` へ
- `result` に入ったら `timing.resultMs` 後に `onDismiss`
- クリックは**1段だけ進める**（`cutin` → `result` → 閉じる）
- Escape はいつでも閉じる

`onDismiss` は **`useEffectEvent` で受ける**。依存配列に載せると親の再描画のたびに
タイマーが張り直され、**永久に閉じない**（`useGameLoop` の自動進行で同じ罠を踏んでいる）。

段の入れ替えは `AnimatePresence mode="wait" initial={false}` に `key={stage}`。
Context7 で framer-motion 13 の用法を確認した（`mode="wait"` は前の要素の退場を待つ）。

## 3. 「視覚効果を減らす」設定の扱い

**アニメーションの長さは 0 にするが、段の滞留時間は変えない。**
「動きを減らす」設定であって「読む時間を減らす」設定ではない。

7-5 の `WinRanking` は初期値で吸収する形（減らす設定では最初から和了後の順位）で、
これはそのまま維持する。段の進行は別の話なので混ぜない。

## 4. コンポーネントの分割

| ファイル | 責務 |
| ---- | ---- |
| `WinOverlay.tsx`（修正） | 段の状態機械・タイマー・クリック・Escape のみ |
| `WinCutIn.tsx`（新規） | アバターのフェードイン・席名・役名・`variant` |
| `WinResult.tsx`（新規） | 役の絵札・獲得点・`WinRanking`・閉じるボタン |
| `WinRanking.tsx` | 変更なし |

### cutin 段

`data-testid="win-cutin"` / `data-variant="normal" | "big"`

- アバターは**フェードイン**（7-5 の `x: -48` のスライドから変更）
- 未設定なら席名の頭文字（7-3 から通している要件）
- 大物手は金の縁・拡大（`scale` 0.86→1）・背景のきらめき。**画像は使わない**（CSS のみ）

### result 段

役名 + 同色タグ + ツモ/ロン + **役の絵札** + ボーナス数 + 獲得点 + 順位表 + 閉じる

- 絵札は `win.candidate.cards` を `CardView size="small"` で並べる。
  **`MemberTile` ではなく `CardView`**（同色かどうかが色で分かる）
- `.card--small` は BONUS の帯を隠す（`src/App.css`）ので、
  `candidate.bonusCount > 0` のときだけテキストで出す
- 獲得点は `scoresAfter − scoresBefore`（7-5 の方針を維持。
  残高不足で徴収額が減っても順位表の点数と食い違わない）
- **アバターは出さない**。直前の段で見せたばかりで、この段の新しい情報は絵札と点数

5枚 × `.card--small`（2.4rem）＋ 隙間で約 13.6rem。`.overlay__panel` は
`min(24rem, 100%)` なので 375px でも収まる。

## 5. 段の長さと大物手の判定

```ts
// src/config/presentation.ts（新規）
export interface WinTiming {
  readonly cutInMs: number
  readonly resultMs: number
}
export const WIN_TIMING: WinTiming = { cutInMs: 1_200, resultMs: 2_500 }
/** 演出の待ち時間を消す（E2E 用）。`autoAction.ts` の `NO_DELAYS` と同じ扱い。 */
export const NO_WIN_TIMING: WinTiming = { cutInMs: 0, resultMs: 0 }

/** 大物手の演出に切り替える条件。**同色役かどうかで決める。** */
export function isBigWin(candidate: YakuCandidate): boolean {
  return candidate.sameColor
}
```

**点数の閾値を持たない理由**: 閾値を置くと「480点は大物手か」を `scores` を
変えるたびに決め直すことになる。同色役はルールの構造そのものなので、
点数を変えても意味が変わらない。

`isBigWin` を1行の関数として切り出すのは、**この判断がどこにあるかを1箇所にする**ため。
コンポーネントに `candidate.sameColor` と書くと、次に条件を変えるときに探すことになる。

`TableScreen` が既に `fast?: boolean` を受け取っているので選択はそこで行う。
**`App.tsx` と `appOptions.ts` は触らない**（`fast` は既に届いている）。

## 6. CSS の分割

`src/ui/win.css`（新規）へ `.win__*` / `.win-rank__*` を `table.css` から移す。

**`.overlay*` は `table.css` に残す。** `ResultOverlay` と `ErrorBoundary` も使っており、
演出だけのものではない。

| ファイル | 現在 | 見込み |
| ---- | ---- | ---- |
| `src/ui/table.css` | 381 | 約270 |
| `src/ui/win.css` | — | 約210 |

## 7. テストへの影響

| 影響 | 対応 |
| ---- | ---- |
| **`tests/ui/winOverlay.test.tsx` の大半が落ちる** | `renderToStaticMarkup` は `useEffect` を実行しないため、`WinOverlay` からは**カットイン段しか見えない**。役名・獲得点・順位表の検査は `WinResult` を直接描画する形へ移す |
| **`tests/e2e/winGate.spec.ts` の「5秒待って overlay が見えたまま」** | 3.7秒で自動的に閉じるため必ず落ちる。**オーバーレイが見えている間だけ**繰り返し観測する形へ書き換える |
| `tests/e2e/helpers/table.ts` の `confirmWinIfAny` | `dismissWinIfAny` へ。**進行ヘルパは1本しかない**ので直す場所も1つ（7-4 の教訓） |
| `tests/ui/winGate.test.ts` の `CONFIRM_WIN` | 改名に追随。**鍵違いでは何も落ちない**検査を追加 |

### 止まっていることの観測を強くする

7-4 の E2E は「持ち時間が減らない」ことを**タイマーの表示文字**で見ていたが、
`withTurnMs` は `minMs` も一緒に下げるため、**短い持ち時間では表示が変わらない**
（下限に張り付く）。つまりあの検査は短い `turnMs` では素通りする。

今回は**自分の河の枚数**で見る。持ち時間を止め忘れるとツモ切りされ、河が1枚増える。
山札の残り（自動進行の停止）と合わせて、2つの効果を別々の観測で押さえる。

## 8. わざと壊して落ちることを確かめる対象

| 壊し方 | 落ちるべきテスト | 実測 |
| ---- | ---- | ---- |
| `DISMISS_WIN` の鍵の照合を外す | 「鍵が合わない DISMISS_WIN は何も落とさない」単体 | ✅ 落ちた |
| 自動クローズのタイマーを外す | 「確認を押さずに自動で閉じて再開する」E2E | ✅ 落ちた |
| `isBigWin` を常に `true` にする | `data-variant` の単体（4件） | ✅ 落ちた |
| 自動進行の停止を外す | 同上 E2E（山札とフェーズが動く） | ✅ 落ちた |
| 持ち時間の停止を外す | 「人間の和了では演出中に持ち時間が進まない」E2E | ✅ 落ちた |

「自動で閉じる」の検査は、**閉じない実装でも `toBeHidden` の待ちが
タイムアウトするだけで通る書き方がある**ため、必ず壊して確かめる。

### `WinOverlay` の `key` について（テストで押さえられない部分）

`key` に `winKey` を渡すのは**防御**であり、今の実装では E2E で踏めない。
`reduce` は1回につき最大1つしか `Declared` を出さない
（`applyDeclare` は1手につき1回、`resolveClaims` は `resolveClaimWinner` で
勝者を1人に絞る）ため、`pendingWins` に2件同時に積まれることが起こらない。
1件ずつなら演出は間で必ずアンマウントされ、段は自然に初期化される。

`pendingWins` を配列で持っているのと同じ理由（将来2つ出るようになった瞬間に
片方が黙って消えるのを防ぐ）でこの `key` を置く。**押さえられるのは
「鍵が和了ごとに異なること」までで、それは単体テストで固定した。**
