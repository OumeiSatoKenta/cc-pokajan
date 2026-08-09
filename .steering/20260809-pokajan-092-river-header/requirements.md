# Step 9-2 河の直近5枚固定とヘッダー — requirements

## 背景

第2稿デザイン反映の3段（9-1〜9-3）の2段目。全体計画は
[docs/ideas/pokajan-casino-table-redesign-plan.md](../../docs/ideas/pokajan-casino-table-redesign-plan.md)、
コマンド分割は [docs/ideas/pokajan-casino-table-redesign-add-feature-commands.md](../../docs/ideas/pokajan-casino-table-redesign-add-feature-commands.md)。
9-1（カジノ風テーマ・木縁/羅紗ラッパ）は完了済み（`.steering/20260809-pokajan-091-casino-theme/`）。

本ステップは **D 河の直近5枚固定** と **E ヘッダー（連続和了・BET）**。

## 要求

### D. 河を直近5枚の固定長に（`DiscardPile`）
1. 各席の河は**直近5枚だけ**表示する（`cards.slice(-5)`）。古い札は押し出す。
2. 件数ラベルを出す。5枚以下は「{N}枚」、5枚超は「直近5枚 / 計{N}」。
3. **直前の1枚（ロン対象）を白熱色（#ffe58a）の枠＋グローで強調**する。
   強調するのは「その席が直前に捨てた席（`state.lastDiscardBy`）」の河の最新札だけ。
4. **残枚数（残N）の算出は変えない**。`src/engine/unseen.ts` は表示枚数と無関係に
   全枚を数えるため、表示を5枚に絞っても `残N` は不変であること（＝エンジンは触らない）。

### E. ヘッダー（連続和了・BET）
1. 卓の木縁（`.table`）上部に、羅紗（`.table__felt`）の**上**にヘッダー行を新設する。
2. 内容: タイトル「ポカジャン / CARD MAHJONG」＋**連続和了ピップ**＋**BET 額**。
3. **連続和了は実データ**: `state.chainCount` /（上限）`rules.maxChainDeclare`。
   `chainCount` は「今の和了チェーンで連続何回上がったか」で、平常時 0・和了チェーン中に増える
   正しい値（`win.ts` で増加、`turnFlow.ts`/`game.ts` の draw・手番交代で 0 リセット）。
   →「連続和了 {chainCount} / {maxChainDeclare}」を出すのは嘘UIではない。
4. **BET は `App.tsx` から配線**する。`appReducer` の `bet`（`PLACE_BET` で `screen:'table'` と
   同時に設定＝table 画面では非 null 確定）を、`state.bet !== null` ガードで narrow して
   `TableScreen` に `bet: number` として渡す（`ResultScreen` の `outcome !== null` と同じ作法）。
5. ヘッダーは**別コンポーネント** `TableHeader.tsx` に切り出す（9-1 の反省。TableScreen 肥大回避）。

## 受け入れ基準

- 河が5枚を超えても各席の河は5枚に留まり、卓の高さが変わらない。件数ラベルが出る。
- 直前の捨て札（ロン対象）が白熱色で強調される。強調は `lastDiscardBy` の席のみ。
- 河を大量に捨てても待ちの「残N」が全枚数基準で正しい（`unseen` 不変）。
- ヘッダーに BET 額と連続和了ピップ（chainCount/maxChainDeclare）が出る。
- 自動ゲート（lint/typecheck/test/build/format:check）と E2E が通る。
  既存の河系テスト（`my-river` 0→1、4人全員が河を持つ、座標検査）が維持される。

## 非対象

- 横向きレイアウト・待ちチップの丸チップ化（→ 9-3）
- 河タップでの全履歴シート（→ v2）
- エンジン層（`src/engine/`）の変更（`chainCount`/`bet`/`unseen` は読むだけ）

## 制約

- エンジン非依存。`Math.random()`/`Date` 不使用。
- 既存の `data-testid`/`aria-label`/`grid-template-areas` を壊さない。
- カード面の色（桃/青/橙）は塗り替えない（直前強調も枠・グローのみ）。
