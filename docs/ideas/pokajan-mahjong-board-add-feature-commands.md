# ポカジャン Step 7 — `/add-feature` 実行コマンド一覧

本書は [pokajan-mahjong-board-plan.md](pokajan-mahjong-board-plan.md) の実装を
5 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

Step 1〜6 のコマンドは [pokajan-add-feature-commands.md](pokajan-add-feature-commands.md) にある。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-mahjong-board-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: Step 1〜6（+ 4b / 6b）が完了していること。
ユニットテスト 612 件 / E2E 50 件が通る状態から始める。

## 実行順の全体像

```
Step 7-1: カードの表現
   ↓   ← 河が絵札になり、伏せ札が描けるようになる
Step 7-2: 4方向レイアウト
   ↓   ← ★ 卓を囲んでいる盤面になる（ここで見た目の方針を判断できる）
Step 7-3: プレイヤーアバター
   ↓   ← 4人に顔がつく（演出で使えるようになる）
Step 7-4: 和了の確認ゲート
   ↓   ← 和了で進行が止まり、確認を押して進む
Step 7-5: 演出の中身
       ← ★ カットイン・得点移動・順位移動が出る（完成）
```

**ポイント**:

- **7-1 → 7-2 の順は動かせない**。4方向レイアウトは 7-1 で作るカード表現の上に載る
- **アバター（7-3）は演出（7-4・7-5）より前**。逆順だとカットインを席名だけで一度作ってから
  アバターに差し替えることになり、同じ場所を二度書く
- **7-4 と 7-5 を分ける理由**は、7-4 が「進行を止める」という**対局ループの構造変更**で、
  7-5 が「見せ方」だから。混ぜると、E2E が落ちたときに原因が構造か演出か切り分けられなくなる
- 各ステップ後に `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする

---

## Step 7-1: カードの表現 ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-071-card-visual/tasklist.md` を参照。

```
/add-feature ポカジャン カードの表現: 河を小さなカード絵で描く .card--small 修飾子、他家の伏せ手札に使う裏面、ボーナスをカード型で見せる MemberTile を実装する。参照ドキュメント: docs/ideas/pokajan-mahjong-board-plan.md (Step 7-1 範囲のみ実装、Step 1-6 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/CardView.tsx`
  - `size?: 'normal' | 'small'` を受け取り `.card--small` を付ける（河用）
  - `faceDown?: boolean` で裏面を描く。**`.card--back` の CSS は Step 4 で書いたまま
    未使用**（`src/ui/table.css:315`）なので、これをそのまま使う
  - 裏面のときはメンバー名・画像・グループ記号を**描かない**（手札の中身が漏れる）
- 修正: `src/ui/components/DiscardPile.tsx`
  - チップ（`.chip`）をやめ、`CardView` の小サイズで描く
  - `imageUrlById` / `groupSymbolById` を受け取る（手札と同じ見え方にそろえる）
- 新規: `src/ui/components/MemberTile.tsx`
  - ボーナスメンバーをカード型で見せる。**合成 `Card` は作らない**
    （`Card` は色を持つがボーナスはメンバー単位のため）。`.card` のスタイルだけ再利用する
- 修正: `src/ui/components/BoardInfo.tsx` — ボーナスのテキスト表示を `MemberTile` に置き換える
- 修正: `src/App.css` — `.card--small` / 裏面 / `MemberTile` のスタイル
- 新規テスト: `tests/ui/cardView.test.tsx`（`renderToStaticMarkup`）
  - 裏面のときにメンバー名・画像・記号が**出力に含まれない**こと（情報漏れの検査）
  - 小サイズで `.card--small` が付くこと

**動作確認**:

- 自動ゲート一式 PASS
- ブラウザ:
  1. 自分の河が小さなカードの絵で並ぶ
  2. ボーナスがカード型で中央に出る
  3. 画像を設定したメンバーの河のカードにも画像が出る
  4. 375px で河が破綻しない

**依存**: なし（Step 1〜6 完了が前提）

---

## Step 7-2: 4方向レイアウト ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-072-table-layout/tasklist.md` を参照。

```
/add-feature ポカジャン 4方向レイアウト: 対局画面を上家=左/対面=上/下家=右/自分=下の3×3グリッドに組み替え、各家に伏せ手札と河を持たせる。中央の山札・ボーナス・グループを BoardCenter に分離する。参照ドキュメント: docs/ideas/pokajan-mahjong-board-plan.md (Step 7-2 範囲のみ実装、Step 7-1 完了前提)
```

**実装内容**:

- 修正: `src/ui/screens/TableScreen.tsx`
  - `.table__opponents` の3列グリッドを**廃止**し、3×3 の `grid-template-areas` へ
  - 幅 30rem 以下では1列の縦積みに切り替える
  - ~~**177 行あるため、このままだと 400 行を超える**。中央を切り出す~~
    （実測: 中央は既に `BoardInfo.tsx` として独立しており、組み替え後も 221 行だった）
- ~~新規~~ **改名**: `src/ui/components/BoardInfo.tsx` → `BoardCenter.tsx`
  （中身は既に独立していたため、新規作成すると包むだけの層になる）
- 修正: `src/ui/components/PlayerSeat.tsx`
  - `orientation: 'top' | 'left' | 'right'` を受け取る
  - 伏せ手札を `player.hand.length` 枚描く（左右の席は縦に積む。
    ~~90度回転~~ → **幅と高さの入れ替え**。`transform` はレイアウトボックスを変えないため）
  - その家の河を `DiscardPile` で描く
- 新規: `src/ui/board.css` — 卓レイアウト。`src/ui/table.css`（573行）から分割する
- 新規テスト: `tests/ui/App.test.tsx` へ追加
  - 他家の伏せ札の枚数が `hand.length` と一致すること
  - **伏せ札の出力にメンバー名が含まれないこと**（他家の手札が漏れていないことの再確認）

**動作確認**:

- 自動ゲート一式 PASS
- ブラウザ:
  1. 900px で上家=左 / 対面=上 / 下家=右 / 自分=下に並ぶ
  2. 各家に伏せ手札と河が出る
  3. 375px で縦積みに切り替わり、横スクロールが出ない
  4. 画像付きロスターで河が4人分並んでも重くならない

**依存**: Step 7-1（`.card--small` / 裏面 / `DiscardPile` のカード化）

> **ここで一度スクリーンショットを撮り、見た目の作り込みをどうするか判断する。**
> そのまま 7-3 へ進む / 先に配色とカードの質感を詰める / 外部に出す。

---

## Step 7-3: プレイヤーアバター ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-073-player-avatar/tasklist.md` を参照。

> **実装で判明した重要点**: ロスターとアバターは同じ IndexedDB を共有するため、
> `usedImageIds` を `(roster, avatars)` の**必須2引数**にした。片方だけを数えると
> `pruneImages` がアバターを全消し、`nextId` が ID を衝突させ、書き出しから画像が欠ける。

```
/add-feature ポカジャン プレイヤーアバター: 4人の座席それぞれに画像を設定できるようにする。保存は既存の IndexedDB を使い、座席→画像IDの対応を prefs に持たせ、設定画面と書き出し形式を拡張する。参照ドキュメント: docs/ideas/pokajan-mahjong-board-plan.md (Step 7-3 範囲のみ実装、Step 7-1〜7-2 完了前提)
```

**実装内容**:

- 修正: `src/storage/prefs.ts`
  - `avatars: Record<string, string> | null`（`playerId` → `imageId`）を追加
  - **絶対座席（`PlayerId`）でキーを持つ**。席名（あなた/下家/…）は `humanSeat` からの
    相対表示なので、そちらで持つとアバターが対局ごとに移動する
  - 欠落・型違いは既定値に倒す（既存の防御的な読み出しと同じ方針）
- 新規: `src/ui/hooks/useAvatarUrls.ts` — `useAssetUrls` と同じ形。まとめて作りまとめて解放する
- 新規: `src/ui/avatars.ts` — `AvatarMap` / `parseAvatars` / `setAvatar` / `avatarImageIds`
- **修正: `src/ui/rosterEditor.ts` — `usedImageIds(roster, avatars)`（呼び忘れを型で塞ぐ）**
- 新規: `src/ui/screens/PlayerSettings.tsx`
  - 4座席の画像を選択・削除する。行の UI は `MemberRow.tsx` と同じ形にそろえる
  - 画像変換は `fileToStoredImage`（`src/ui/imageResize.ts`）をそのまま再利用
  - **保存先は既存の `src/storage/assets.ts`（IndexedDB）**。新しいストアは作らない
- 修正: `src/ui/rosterBundle.ts` — 省略可能な `avatars` を足す。
  **`BUNDLE_VERSION` は 1 のまま**（既存の書き出しファイルがそのまま読める）
- 修正: `src/ui/appReducer.ts` — `Screen` に `'players'` を追加、`GO_SETTINGS` の分岐を拡張
- 修正: `src/ui/screens/TitleScreen.tsx` — 「プレイヤー設定」への導線
- 修正: `src/ui/components/PlayerSeat.tsx` / `TableScreen.tsx` — 席にアバターを出す
- 修正: `src/App.tsx` — 画面の配線とアバターの永続化
- 新規／修正テスト:
  - `tests/storage/prefs.test.ts` — `avatars` の往復・型違い・欠落
  - `tests/ui/rosterBundle.test.ts` — `avatars` の往復と**旧形式の互換**
  - `tests/ui/appReducer.test.ts` — `players` 画面への遷移（対局中は開けないこと）
  - `tests/e2e/players.spec.ts` — 設定 → 保存 → 席に反映 → リロード後も保持

**動作確認**:

- 自動ゲート一式 PASS
- ブラウザ:
  1. タイトルからプレイヤー設定を開き、4人分の画像を設定できる
  2. 対局画面の各席にアバターが出る
  3. リロード後もアバターが残る
  4. 書き出し → 読み込みでアバターも復元される
  5. アバター未設定でも対局できる（席名だけで描画される）

**依存**: Step 7-2（席の描画位置）

---

## Step 7-4: 和了の確認ゲート ✅ 完了（2026-08-09）

実績は `.steering/20260809-pokajan-074-win-gate/tasklist.md` を参照。

> **実装で判明した重要点**:
> 1. 停止は**2層**。`useEffect` を止めるだけでは人間のクリックが止まらないので、
>    リデューサ側でも `ENGINE` / `TIMEOUT` を弾く。自動進行と持ち時間は
>    リデューサの弾きだけで止まり、効果側の停止が単独で効いているのは
>    **イベントの排出**（`EVENTS_CONSUMED` は意図的に弾かないため）。
> 2. `pendingWin` は**配列**（`pendingWins`）にした。単数だと `reduce` が
>    2つ `Declared` を出すようになった瞬間に片方が黙って消える。
> 3. E2E の進行ヘルパを `tests/e2e/helpers/table.ts` に集約した。
>    `playToEnd` の写しが2箇所にあり、同じ修正を2回書く羽目になったため。

```
/add-feature ポカジャン 和了の確認ゲート: 和了が起きたら対局の自動進行を止め、確認ボタンを押すまで進まないようにする。LoopState に pendingWin を持たせ、自動進行・持ち時間・イベント排出の3つの効果を停止する。参照ドキュメント: docs/ideas/pokajan-mahjong-board-plan.md (Step 7-4 範囲のみ実装、Step 7-1〜7-3 完了前提)
```

**実装内容**:

- 修正: `src/ui/hooks/loopReducer.ts`
  - `WinPresentation`（勝者・役・ツモ/ロン・支払い・**適用前後の点数**）を定義
  - `LoopState.pendingWin: WinPresentation | null`
  - `applyEngine` で**`reduce` を呼ぶ前に点数を控え**、`Declared` と `Paid` を組にして積む
  - 新アクション `CONFIRM_WIN` で解除する
- 修正: `src/ui/hooks/useGameLoop.ts`
  - **3つの効果すべてに停止フラグを入れる**
    1. 自動進行（`[autoKey]` → `[autoKey, isPaused]`）
    2. **持ち時間の時間切れ**（止め忘れると、演出を読んでいる間にツモ切りされる）
    3. イベントの排出
  - `pendingWin` と `confirmWin()` を公開する
- 新規: `src/ui/components/WinOverlay.tsx` — この段階では**最小限**
  （誰が・何の役で・何点、と確認ボタンだけ。見せ方は 7-5）
- 廃止: `src/ui/components/YakuToast.tsx` — 役割が `WinOverlay` と重複する
- 修正: **E2E の進行ヘルパすべて**
  - `tests/e2e/table.spec.ts` の `playToEnd` / `playUntilClaimWindow` / `waitForMyDiscard`
  - `tests/e2e/casino.spec.ts` の `playToEnd`
  - `tests/e2e/rules.spec.ts` の対局を進める箇所
  - 「役成立のトーストは一定時間で消える」を演出の確認テストに置き換える
- 新規テスト: `tests/ui/loopReducer.test.ts` へ追加
  - 和了で `pendingWin` が積まれること（適用前後の点数を含む）
  - `CONFIRM_WIN` で解除されること
  - 停止中は自動進行の決定が発火しないこと
  - 連続宣言では**1回ごとに**止まること

> **最大の落とし穴**: 確認ゲートを入れると **E2E の `playToEnd` が止まって全滅する**。
> 進行ヘルパの追随を同じステップでやること。忘れると既存 50 件のうち
> 対局を進めるテストが軒並みタイムアウトする。

**動作確認**:

- 自動ゲート一式 PASS（**E2E 50 件が引き続き通ること**が最重要）
- ブラウザ:
  1. 自分がツモると進行が止まり、確認を押すまで動かない
  2. CPU 同士の和了でも止まる
  3. 止まっている間に持ち時間が減らない
  4. 連続宣言では回数分だけ確認を押す

**依存**: Step 7-3（アバターを演出に出すため）

---

## Step 7-5: 演出の中身 ✅ 完了（2026-08-09）— **Step 7 完了**

実績は `.steering/20260809-pokajan-075-win-presentation/tasklist.md` を参照。

> **実装で判明した重要点**:
> 1. `computeRanking` は `turnFlow.ts` ではなく **`gameSelectors.ts`** に置いた
>    （「状態を変更しない読み取り専用の計算」がその module の役割）。
> 2. 得点の増減は `payments` ではなく **`scoresAfter − scoresBefore`** から出す。
>    表示している点数そのものなので、集計の書き方でずれる余地がない。
>    結果 `payments` は読まれなくなったので `WinPresentation` から削除した。
> 3. **Playwright の `test.use({ reducedMotion: 'reduce' })` はこの構成では
>    ページに届かない**（`matchMedia` が false のまま）。`page.emulateMedia()` を使い、
>    設定が届いたこと自体を `data-reduced` で確かめる。
>    最初の実装はこれに気づかず**偽陽性のテスト**になっていた。

```
/add-feature ポカジャン 和了演出: 和了時に勝者アバターのカットイン、得点の移動（支払い側に−N・勝者に+N）、順位の並べ替えアニメーションを出す。順位の算出はエンジンの computeRanking を共有する。参照ドキュメント: docs/ideas/pokajan-mahjong-board-plan.md (Step 7-5 範囲のみ実装、Step 7-1〜7-4 完了前提)
```

**実装内容**:

- 修正: `src/engine/turnFlow.ts`
  - `finishGame` 内の順位ソートを `computeRanking(players)` として切り出す
  - **振る舞いは変えない純粋な抽出**。終局時と演出が同じ関数を使うようにするため
  - Step 5 で「順位はエンジンが確定させた値だけを使う」と決めているが、
    **対局中の順位にはエンジン側の対応物がない**。二重実装を避けるための措置
- 修正: `src/ui/components/WinOverlay.tsx`
  - 勝者アバターのカットイン（framer-motion）
  - 役名・同色・ツモ/ロン・獲得点
  - **得点の移動**: `payments` から支払い側に `−N`、勝者に `+N` を出す
  - **順位の移動**: 4人の順位表を `layout` アニメーションで並べ替える
  - `useReducedMotion` を尊重する（既存コンポーネントと同じ方針）
- 修正: `src/App.css` / `src/ui/board.css` — 演出のスタイル
- 新規テスト: `tests/engine/turnFlow.test.ts`（または既存へ追加）
  - `computeRanking` が `GameOver.ranking` と一致すること（**抽出で振る舞いが変わっていない**）
  - 同点時はプレイヤー ID 昇順になること
- 修正: `tests/e2e/table.spec.ts` — カットインと順位表が出ること

**動作確認**:

- 自動ゲート一式 PASS
- ブラウザ:
  1. 和了時に勝者のアバターがカットインする
  2. 支払い側に `−N`、勝者に `+N` が出る
  3. 順位表が並べ替わる
  4. アバター未設定でも席名で成立する
  5. 375px で演出が画面からはみ出さない
  6. OS の「視覚効果を減らす」設定でアニメーションが止まる

**依存**: Step 7-4（`pendingWin` と停止の仕組み）

---

## 参考: 各ステップ完了時点で何が動くか

| Step    | 動く状態                                                          |
| ------- | ----------------------------------------------------------------- |
| 7-1 完了 | 河が絵札で並び、ボーナスがカード型で出る                          |
| 7-2 完了 | ★ 卓を囲む配置になり、他家の伏せ手札と河が見える                  |
| 7-3 完了 | 4人に顔がつき、リロード後も残る                                   |
| 7-4 完了 | 和了で進行が止まり、確認を押して進む                              |
| 7-5 完了 | ★ カットイン・得点移動・順位移動が出る（完成）                    |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。
ただし以下に注意。

- **7-4 を revert する場合**、E2E の進行ヘルパも同時に戻すこと。
  確認ボタンを押すコードだけ残ると、ボタンが無いのに待ち続けてタイムアウトする
- **7-3 を revert する場合**、IndexedDB に保存済みのアバター画像は残る。
  `prefs` の `avatars` が消えるだけなので対局には影響しないが、
  参照されない画像が残る（`pruneImages` はロスター保存時にしか走らない）
- **7-1 を revert すると 7-2 が壊れる**（レイアウトがカード表現に依存している）。
  この2つはまとめて戻すこと
- **7-5 の `computeRanking` 抽出**は振る舞いを変えないため、単独で残しても害はない

## 参考: 着手前の事前確認

- **新規依存追加**: なし。framer-motion と既存の IndexedDB / canvas で足りる
- **`.card--back` の CSS が未使用のまま存在する**（`src/ui/table.css:315`）。7-1 で使う
- **ビジュアルデザインの扱い**: 本計画は構造まで。配色とカードの質感は 7-2 完了後に判断する
- **確認ボタンの回数**: 連続宣言は最大8回（`maxChainDeclare`）まで起こりうる。
  すべての和了で止める方針は確認済み
- **既存テストの状態**: ユニット 612 件 / E2E 50 件が通っていること

## 参考: v2 以降で検討する機能

- **和了演出のスキップ設定**（連続宣言が続くときに毎回押すのを省く）
- **カードの質感**（麻雀牌のような側面の陰影・象牙色の面・彫り込み風の文字）
- **卓の背景**（緑のフェルト調など）
- **効果音**（PRD で P2）
- **他家の河のハイライト**（直前に捨てた1枚を強調する）
- **点数移動のコインアニメーション**（`docs/ideas/pokajan-plan.md` の当初案）
