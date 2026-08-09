# ポカジャン Step 8 — `/add-feature` 実行コマンド一覧

本書は [pokajan-presentation-and-counts-plan.md](pokajan-presentation-and-counts-plan.md) の実装を
2 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

Step 1〜6 のコマンドは [pokajan-add-feature-commands.md](pokajan-add-feature-commands.md)、
Step 7 のコマンドは [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md) にある。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-presentation-and-counts-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: Step 1〜7（+ 4b / 6b）が完了していること。
ユニットテスト 698 件 / E2E 67 件が通る状態から始める。

## 実行順の全体像

```
Step 8-1: 和了演出の作り込み
   ↓   ← ★ 和了が2段で読めるようになり、確認ボタンが要らなくなる
Step 8-2: 残り枚数の確認
       ← ★ 待ちが生きているかが分かる（完成）
```

**ポイント**:

- **8-1 → 8-2 の順は動かせない**。理由は CSS の分割にある。`src/ui/table.css` は現在 381 行で、
  8-1 が `.win*` を `win.css` へ出して約270行に戻す。順序を逆にすると 8-2 で待ち一覧を足した
  時点で 400 行を超え、**8-1 で二度目の分割をすることになる**
- **8-1 と 8-2 を分ける理由**は、8-1 が「対局ループの停止解除の仕組みを変える」変更
  （確認ボタン → 自動クローズ）で、8-2 が「情報を足すだけ」の変更だから。
  混ぜると E2E が落ちたときに、進行の問題か表示の問題かを切り分けられなくなる
- 8-1 は既存の演出・E2E ヘルパ・単体テストを**書き換える**ステップで、
  8-2 は**足すだけ**のステップ。切り戻しの重さが違う
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする

---

## Step 8-1: 和了演出の作り込み ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-081-win-stages/tasklist.md` を参照。
ユニット 716 件 / 34 ファイル（+18）、E2E 70 件（+3）。

**計画から変わった点**:

- `App.tsx` / `appOptions.ts` は**触らずに済んだ**（`TableScreen` が既に `fast` を受け取っていた）
- 持ち時間の停止の E2E は**人間が和了する経路**で書いた。CPU の和了では
  `decideTimeout` が人間の時計を回さないため（`selfDeclare` の宣言権者が CPU）、
  **止め忘れても落ちないテスト**になっていた（壊して確かめて発覚）
- `.win__kind` の色が `var(--fg)` という**存在しない変数**を参照していたので
  `var(--text)` に直した（7-5 から効いていなかった）

```
/add-feature ポカジャン 和了演出の作り込み: 和了演出を「アバターのフェードカットイン → 点数獲得結果」の2段にし、同色役では大物手バージョンのカットインを出す。点数獲得結果に役の絵札を載せ、確認ボタンではなく数秒で自動的に閉じる。参照ドキュメント: docs/ideas/pokajan-presentation-and-counts-plan.md (Step 8-1 範囲のみ実装、Step 7 完了前提)
```

**実装内容**:

- 新規: `src/config/presentation.ts`
  - `WIN_PRESENTATION`（`cutInMs: 1_200` / `resultMs: 2_500`）
  - `FAST_WIN_PRESENTATION`（`0` / `0`）— E2E の高速モード用
- 新規: `src/ui/components/WinCutIn.tsx`
  - アバターの**フェードイン**（7-5 の `x: -48` のスライドから変更）
  - `variant: 'normal' | 'big'` を受け取り `data-variant` に出す
  - **大物手の判定は `candidate.sameColor`**。点数の閾値は持たない
    （閾値を置くと「480点は大物手か」を `scores` を変えるたびに決め直すことになる）
  - アバター未設定なら席名の頭文字（7-3 から通している要件）
- 新規: `src/ui/components/WinResult.tsx`
  - `candidate.cards` を `CardView size="small"` で並べる。
    **`MemberTile` ではなく `CardView`** を使う（同色かどうかが色で分かる）
  - `.card--small` は BONUS の帯を隠すので、`candidate.bonusCount` をテキストで出す
  - 獲得点は `scoresAfter − scoresBefore`（7-5 の方針をそのまま維持）
  - `WinRanking` はそのまま使う
- 修正: `src/ui/components/WinOverlay.tsx`
  - **段の状態機械とタイマーだけを持つ**（`cutin` → `result` → 閉じる）
  - **`useGameLoop` にタイマーを置かない**。7-4 で「停止フラグを持つ効果が3つある」構造を
    作っており、4つ目を足すと止め忘れの面が1つ増える
  - クリックは**1段だけ進める**。1回で全部消すと、打とうとした瞬間の割り込みで
    押しかけのクリックが演出を丸ごと消す
  - Escape でいつでも閉じる。`role="status"` / `aria-live="polite"` にして焦点は奪わない
    （自動で閉じるものを `aria-modal` にすると読み上げが間に合わない）
  - `data-stage` を出す（E2E が段の進行を観測できるようにする）
- 修正: `src/ui/hooks/loopReducer.ts`
  - `CONFIRM_WIN` → **`DISMISS_WIN`** に改名。確認していないものを confirm と呼ばない
- 修正: `src/ui/hooks/useGameLoop.ts`
  - `confirmWin` → `dismissWin`
- 修正: `src/ui/screens/TableScreen.tsx`
  - `WinOverlay` に `memberNameById` / `imageUrlById` / `groupSymbolById` /
    `bonusMemberIds` / `timing` を渡す
  - **`key` にその和了を一意に決める値**（`playerId` + 構成カードの uid）を渡す。
    連続和了で鍵が同じだと、**段が進んだ状態のまま2件目が表示される**
- 新規: `src/ui/win.css`
  - `table.css` から `.win__*` / `.win-rank__*` を移し、段の演出を足す
  - **`.overlay*` は `table.css` に残す**（`ResultOverlay` と `ErrorBoundary` も使っている）
- 修正: `src/App.tsx` / `src/appOptions.ts` — `fast` から演出の長さを選ぶ
- 新規テスト:
  - `tests/ui/winCutIn.test.tsx` — 同色役で `data-variant="big"` / アバター未設定でも成立
  - `tests/ui/winResult.test.tsx` — 役の絵札が `candidate.cards` と同じ枚数・同じ uid /
    ボーナス枚数 / 獲得点は前後の差分（**7-5 の既存検査をここへ移す**）
- 修正テスト:
  - `tests/ui/winOverlay.test.tsx` — **`renderToStaticMarkup` は `useEffect` を実行しない**ため、
    `WinOverlay` からは**カットイン段しか見えない**。初期段の検査だけを残す
  - `tests/ui/winGate.test.ts` — `CONFIRM_WIN` の改名に追随
  - `tests/e2e/helpers/table.ts` — `confirmWinIfAny` → `dismissWinIfAny`（Escape を送る）。
    **進行ヘルパは1本しかない**ので直す場所も1つ（7-4 の教訓）
  - `tests/e2e/winGate.spec.ts` — 「5秒待って overlay が見えたまま」は3.7秒で閉じるため必ず落ちる。
    **オーバーレイが見えている間だけ**山札の残りを繰り返し観測する形へ書き換える。
    テスト専用のクエリパラメータは足さない

**動作確認**:

- 自動ゲート一式 PASS（`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`）
- `npx playwright test` PASS
- ブラウザ:
  1. 通常役と同色役で演出が違うこと
  2. カットイン → 点数獲得結果 → 自動で閉じる、の順に進むこと
  3. **確認を押さずに対局が再開すること**
  4. クリック1回では閉じずに結果段へ進むこと、2回目で閉じること
  5. 役の絵札が出て、同色かどうかが色で分かること
  6. アバター未設定でも成立すること
  7. 375px で演出が画面からはみ出さないこと
  8. 視覚効果を減らす設定で**動きが消え、時間は消えない**こと
  9. 連続和了（2件以上）でカットインが2回とも頭から出ること

**依存**: なし（Step 7 完了が前提）

---

## Step 8-2: 残り枚数の確認 ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-082-remaining-counts/tasklist.md` を参照。
ユニット 748 件 / 38 ファイル（+32）、E2E 75 件（+5）。

**計画から変わった点**:

- `colorCountsOf` を足して**引き当てを2種類**にした（ツールチップは全色、待ち一覧は1色）。
  どちらも見つからなければ `RangeError` を投げ、**0 を返さない**
- `countUnseen` は `memberIds` に無いメンバー・ルールに無い色のカードも例外にする
- 待ち一覧の並びは**「残っている待ちが先、その中で点数降順」**。
  点数降順だけだと、高い役の待ちが全部死んでいる局面で
  **生きている待ちが「他N件」の下に隠れる**
- 突き合わせテストは食い違いを**配列に集めて最後に1度だけ `expect`** する。
  毎回 `expect` を呼ぶと1600万回を超えて時間切れになる（実測 45 秒 → 1.3 秒）
- `tests/e2e/helpers/table.ts` に `advanceOneStep` / `playUntil` / `wallCount` を足した
- **既存の E2E を1件直した**。`人間が宣言窓で迷っている間に…` が6回中3回落ちていた
  （見送るボタンは割り込みと宣言の両方に使われるため、進行の観測に使えない）
- 3軸レビューで `[必須]` 1件。**ホバー状態をメンバー単位で持っていた**ため、
  捨てたあとに同じメンバーの別の札を引くとツールチップが独りでに戻ってきた。
  `uid`（その1枚）で持つ形に直した
- `role="status"` → `role="tooltip"` + `aria-describedby`。
  暗黙の `aria-live` があると、マウスを乗せただけで読み上げが割り込む

```
/add-feature ポカジャン 残り枚数の確認: 手札の絵札をホバーすると、手札・河・成立済みの役から算出した各色の想定残枚数を出す。テンパイ時は待ち一覧を手札の上に常時表示し、各待ちの残枚数を並べる。算出はエンジンの純粋関数に置き、他家の手札に到達する経路を型として持たせない。参照ドキュメント: docs/ideas/pokajan-presentation-and-counts-plan.md (Step 8-2 範囲のみ実装、Step 8-1 完了前提)
```

**実装内容**:

- 新規: `src/engine/unseen.ts`
  - `VisibleCards`（自分の手札 + 全員の河 + 全員の `declared`）
  - `countUnseen(visible, memberIds, rules)` → `ReadonlyMap<MemberId, readonly ColorCount[]>`
  - `unseenOf(counts, memberId, color)`
  - `toVisibleCards(state, playerId)` — **状態に触るのはここ1箇所だけ**
  - **`countUnseen` は `GameState` を受け取らない**（`ai.ts` の `AiView` と同じ形）。
    渡す設計だと他家の手札に到達でき、カンニングが型で防げなくなる
  - **`AiView` に `declaredByPlayer` を足して流用しない**。AI が読まないフィールドを
    増やすことになり、7-5 で `payments` を外したときと同じ負債になる
  - **成立済みの役を数え落とさない**。消費されたカードが「まだ引ける」ことになる。
    ロンで取られた捨て札は河から `declared` へ移る（`win.ts` の `consumeAndRefill`）ので
    二重には数えない
- 修正: `src/engine/game.ts` — 再エクスポートに追加
- 修正: `src/ui/hooks/useGameLoop.ts` — `unseen` を公開（`waits` と同じ形の `useMemo`）
- 新規: `src/ui/components/CardCounts.tsx`
  - 「ミナ ／ 桃1 青2 橙3」の1行
  - **`.hand` を基準に絶対配置する**。カード単位に置くと 375px で端の札が画面外へ出る
- 新規: `src/ui/components/WaitPanel.tsx`
  - `loop.waits`（既存の `computeWaits`）を使う。**待ちの算出は二重実装しない**
  - `waits.length > 0` のときだけ描画する（＝上がれそうなときだけ出る）
  - 点数降順で上位6件 + 「他N件」。理論上の上限は
    `groupsPerGame × maxGroupSize × colors.length` = 60 件で画面を埋め尽くしうる
  - **残0 の行を淡く落とす**（役はできるが、その札はもう場に無い）。本機能の中心的な価値
- 修正: `src/ui/components/Hand.tsx`
  - `<li>` に `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` を付ける
  - **`CardView` には付けない**。捨てられないとき `disabled` の `<button>` になり、
    **無効化されたボタンにはマウスイベントが来ない**。カード側に付けると
    「自分の捨てる番のときしか調べられない」機能になる
- 修正: `src/ui/screens/TableScreen.tsx`
  - `WaitPanel` を `.table__mine` の見出し直下に置き、`unseen` を `Hand` へ渡す
- 新規: `src/ui/hints.css` — 待ち一覧とツールチップ（`table.css` をこれ以上太らせない）
- 新規テスト:
  - `tests/engine/unseen.test.ts`
    - 手札・河・成立済みの役をそれぞれ数え、3つが重ならないこと
    - **自動対局との突き合わせ**（本機能でいちばん重要な検査）。`autoplay` の `onStep` で
      毎ステップ、**製品コードが決して見ない情報**から独立に導いた値と一致を見る:
      `unseen(m,c) === wall(m,c) + Σ_{他家} hand(m,c) + (copiesPerMemberColor − 場の全カード(m,c))`
    - 残枚数が `0 〜 copiesPerMemberColor` に必ず収まること
  - `tests/ui/waitPanel.test.tsx` — 待ちが無ければ描画しない / 残0 の行に印が付く /
    上限を超えたら「他N件」が出る
  - `tests/e2e/counts.spec.ts` — 固定シードで手札にホバーして数字が出ること。
    **捨てられない状態（自分の手番でないとき）でも出ること**

**動作確認**:

- 自動ゲート一式 PASS
- `npx playwright test` PASS
- ブラウザ:
  1. 手札にホバーすると色ごとの残り枚数が出ること
  2. **自分の手番でなくても出ること**（`disabled` の回避が効いている）
  3. テンパイすると待ち一覧が出て、テンパイが崩れると消えること
  4. 残0 の待ちが淡く落ちていること
  5. 河に同じ絵札が捨てられると残り枚数が減ること
  6. 375px で待ち一覧とツールチップが画面からはみ出さないこと
  7. 画像付きロスターで表示が崩れないこと

**依存**: Step 8-1（`table.css` の分割。`.win*` が出ていないと `table.css` が 400 行を超える）

---

## 参考: 各ステップ完了時点で何が動くか

| Step     | 動く状態                                                             |
| -------- | -------------------------------------------------------------------- |
| 8-1 完了 | ★ 和了が2段で読め、同色役は大物手演出。確認ボタンを押さずに再開する   |
| 8-2 完了 | ★ 手札ホバーで残り枚数、テンパイ時に待ち一覧（完成）                 |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。
ただし以下に注意。

- **8-1 を revert する場合、E2E の進行ヘルパも同時に戻すこと。**
  `dismissWinIfAny`（Escape）だけ残すと、確認ボタンが復活しているのに押されず、
  **押しているのに進まない形のタイムアウト**になる。7-4 と同じ失敗の裏返し
- **8-2 を revert しても 8-1 は無傷**（8-2 は足すだけで、演出には触らない）
- **8-2 の `src/engine/unseen.ts` は単独で残しても害はない**。
  UI から呼ばれなくなるだけの純粋関数で、エンジンの状態遷移には関与しない
- 逆順（8-2 だけ先に入れる）は `table.css` が 400 行を超えるため取らない

## 参考: 着手前の事前確認

- **新規依存追加**: なし。framer-motion と既存の CSS で足りる
- **`computeWaits` は既にある**（`src/engine/yaku.ts`）。8-2 で待ちを再実装しない
- **残枚数は上限であって確定値ではない**。`buildDeck` はプール（117〜144枚）から
  `deckSize`（100枚）しか抜かないため、残枚数には「そもそも山札に入らなかったカード」が混ざる。
  画面のラベルもそのように書く
- **高得点の基準は同色役**（確認済み）。帰結として **5人組（480点）は通常演出**、
  **3カード同色（840点）は大物手**になる
- **既存テストの状態**: ユニット 698 件 / E2E 67 件が通っていること

## 参考: v2 以降で検討する機能

- **河のカードとボーナスのタイルもホバー対象にする**（8-2 は手札のみ）
- **触れる端末での残り枚数の確認**（長押し。8-2 では待ち一覧が代替する）
- **中央のグループメンバー一覧のホバー**（まだ手札に無いメンバーの残枚数を調べる）
- **山札に残っている期待値の表示**（残枚数 × 山札 / 未確認の総数）
- **和了演出の長さの設定**（プレイヤーが秒数を選べるようにする）
- **効果音**（PRD で P2）
- **カードの質感・卓の背景**（Step 7 から継続の積み残し）
- **精算バランス調整**（1局あたり +1,017 とプレイヤー有利のまま。保留中）
