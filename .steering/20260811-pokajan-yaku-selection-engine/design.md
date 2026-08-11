# 設計: 絵札選択エンジン（Step 1）

## 方針

**「検証」から「再導出」へ。** 現状は `findYaku` が列挙した正準候補と uid が一致するかを見る。
これを、プレイヤーが選んだカードそのものから役を組み立て直す方式へ変える。列挙（`findYaku` /
`bestYaku` / `computeWaits`）は AI・待ち・おまかせ候補が使うため**そのまま残す**。変えるのは
**宣言／割り込みの検証経路だけ**。

`candidateFromSelection` は `yaku.ts` 内に置くことで、既存の私的ヘルパ
（`enumerateDrafts` / `signatureOf` / `toCandidate` / `removeFirstByUid` / `groupYakuKind` /
`TRIPLE_SIZE`）を再利用できる。これによりロン規則を `findYaku` と**同一のシグネチャ計算**で
表現でき、判定ロジックの二重化を避ける。

## A. `candidateFromSelection`（`src/engine/yaku.ts` に追加）

```ts
export function candidateFromSelection(
  hand: readonly Card[],
  selectedUids: readonly number[],
  ctx: YakuContext,
  required?: Card,   // ロンのとき必須の捨て札。selectedUids に含まれること
): YakuCandidate | null
```

処理手順:

1. **uid 解決**: `selectedUids` を `hand` のカードへ解決。重複 uid・未所持 uid があれば `null`。
2. **役種の判定（classify）**: 解決したカードから中間表現 `CandidateDraft` を作る。
   - 全カードが同一メンバーで枚数 = `TRIPLE_SIZE`(3) → `triple`（`targetId` = メンバーID）。
   - あるアクティブグループのメンバー多重集合とちょうど一致 → `groupN`（`targetId` = グループID）。
     （メンバー重複のある壊れたグループも `pickGroupCards` と同じく多重集合一致で扱う。）
   - それ以外 → `null`。
   - `color` = 全同色なら共有色、混色なら `null`（`signatureOf` 用。既存 draft の色規約に一致）。
3. **ロン規則（`required` あり）**:
   - 選択に `required.uid` を含まなければ `null`。
   - `withoutRequired = removeFirstByUid(hand, required.uid)` の全 draft シグネチャ集合に、
     この選択の `signatureOf(draft)` が含まれれば `null`（＝手の内で既に成立 → ロン不可）。
     これは `findYaku(..., required)` の「反手内成立でロン不可」規則と**同一**。
4. `toCandidate(draft, ctx)` を返す。`sameColor` はカードから、`bonusCount` / `score` は既存
   `countBonusCards` / `scoreYaku` で再計算される（点数はカードの色ではなく役種・同色・ボーナスで決まる）。

### 不変条件を壊さない根拠（重要）

AI は `bestYaku(findYaku(...))` の候補を渡す。その `cards` は合法選択なので、`candidateFromSelection`
は同一の `kind` / `sameColor` / `score` を再導出する。ロン規則の一致は次で保証される:

- 混色（mixed）の列挙は任意の単色列挙より**厳密に緩い**。すなわち、あるグループ／メンバーを
  色 X で組めるなら混色でも必ず組める。ゆえに `signature(X) ∈ achievableWithout ⟹
  signature(mixed) ∈ achievableWithout`。
- findYaku が受理した ron draft `d` は `signatureOf(d) ∉ achievableWithout`。
  - `d.cards` が混色 → `d` は混色 draft → シグネチャ一致 → 受理一致。
  - `d.cards` が同色 X → 再導出シグネチャは X。`d` が同色 draft なら一致。`d` が混色 draft でも
    `signature(mixed) ∉ achievableWithout ⟹ signature(X) ∉ achievableWithout`（上記の対偶）→ 受理一致。
- よって `candidateFromSelection` は findYaku が受理した候補を**必ず受理**し、点数も一致する。
  100 局の点数保存則・カード保存則・手札枚数は不変。

## B. 検証経路の差し替え（`verifyCandidate` を再計算式へ統一）

`src/engine/claims.ts` の `verifyCandidate` を、選択の再導出で検証する形へ変更する（計画の推奨 (i)）。

```ts
export function verifyCandidate(
  hand: readonly Card[],
  claimed: unknown,
  ctx: YakuContext,
  label: string,
  required?: Card,
): YakuCandidate {
  if (!isCandidateShape(claimed)) {
    throw new IllegalActionError(`${label} に渡された候補が役の形をしていません`)
  }
  const candidate = candidateFromSelection(hand, claimed.cards.map((c) => c.uid), ctx, required)
  if (candidate === null) {
    throw new IllegalActionError(
      `${label} で宣言された役は現在の手札では成立しません（${claimed.kind} / ${claimed.cards.length}枚）`,
    )
  }
  return candidate
}
```

- `isCandidateShape`（入口ガード）は**維持**。壊れた入力は `IllegalActionError` にする（素の TypeError にしない）。
- `candidateKey` は不要になるため**削除**（唯一の利用者が `verifyCandidate` だったため）。
- `claims.ts` が `yaku.ts` の `candidateFromSelection` を import する（循環なし: `yaku.ts` は
  `claims.ts` を import しない）。

### 呼び出し側

- **DECLARE**（`src/engine/win.ts:137` `applyDeclare`）:
  `verifyCandidate(hand, claimed, ctx, 'DECLARE')`（`required` なし）。`findYaku` の import を削除。
- **CLAIM**（`src/engine/game.ts:283` `case 'CLAIM'`）:
  `verifyCandidate(probed, action.candidate, ctx, 'CLAIM', discard)`（`probed = [...hand, discard]`,
  `required = discard`）。`findYaku` の import を削除。

## C. ファイル別の変更

| ファイル | 変更 |
| --- | --- |
| `src/engine/yakuSelection.ts`（**新規**） | `candidateFromSelection` と私的ヘルパ（`resolveSelection` / `classifySelection` / `memberCounts` / `isMultisetEqual`）。※3軸レビューの [必須] を受け、当初 `yaku.ts` へ追加予定だったものを別ファイルへ分離（E 参照） |
| `src/engine/yaku.ts` | 共有プリミティブ（`CandidateDraft` / `signatureOf` / `toCandidate` / `achievableSignaturesWithout`）を export。ロンの「反手内成立」判定を `achievableSignaturesWithout` に集約（列挙と再導出が同一関数を共有）。既存の列挙群は不変 |
| `src/engine/claims.ts` | `verifyCandidate` を再計算式へ。`candidateKey` 削除。`./yakuSelection` から import |
| `src/engine/win.ts` | `applyDeclare` の呼び出しを更新。`findYaku` import 削除 |
| `src/engine/game.ts` | `case 'CLAIM'` の呼び出しを更新。`findYaku` import 削除 |
| `tests/engine/yaku.test.ts` | `candidateFromSelection` の単体テスト・差分オラクル（ツモ／ロン）を追記 |
| `tests/engine/game.test.ts` | 非正準の合法選択が DECLARE / CLAIM で通る回帰・役種偽装の無効化を追記 |

## D. テスト設計

### `tests/engine/yaku.test.ts`（`candidateFromSelection`）

- 有効な triple / groupN を再導出（kind・cards・score）。
- **正準以外の合法選択を受理**: 同一メンバー4枚のうち末尾3枚を選んでも triple になる。
  → ミューテーション: classify を「先頭 N 枚固定」に壊すと落ちる。
- 色違いで役種・点数が変わる: 同色3枚 → sameColor・高得点、混色3枚 → mixed・低得点。
- 未所持 uid → `null` / 枚数過不足（2枚・4枚の triple）→ `null` / 重複 uid → `null` /
  役にならない混在 → `null`。
- ロン規則: `required` を含まない選択 → `null`。手の内で完成済み（同シグネチャが反手で成立）→ `null`。
  その1枚で新たに完成 → 非 null。混色完成済みでも同色化する1枚ならロン可。
- ロン規則: `required` を含まない選択 → `null`。手の内で完成済み（同シグネチャが反手で成立）→ `null`。
  その1枚で新たに完成 → 非 null。混色完成済みでも同色化する1枚ならロン可。
  `required` が `hand` に無い呼び出しは `RangeError`（`findYaku` と対称・レビュー [推奨] 反映）。
- 全メンバー同一の壊れたグループでも triple 判定が groupN より優先される（レビュー [提案] 反映）。
- **差分オラクル（ツモ）**: シード 0〜99 の配牌直後の手札で、`findYaku(hand, ctx)` の各候補について
  `candidateFromSelection(hand, uids, ctx)` が同一の `kind` / `sameColor` / `bonusCount` / `score` を返す。
- **差分オラクル（ロン）**: `computeWaits` と同じ probe 手法（実在しない負の uid の仮カードを捨て札として
  1枚追加）で、シード 0〜99 × 全メンバー × 全色について `findYaku(probed, ctx, probe)` の各候補を
  `candidateFromSelection(probed, uids, ctx, probe)` で再導出し一致を検証する。ロンでのみ signature の
  achievableWithout 照合が働くため、この経路を機械的に全数検証する（レビュー [必須] 反映）。

### `tests/engine/game.test.ts`（配線の回帰）

- **非正準の合法選択が DECLARE で通る**: 同一メンバー4枚を持つ手で、`findYaku` が選ぶのとは別の
  3枚を `cards` に持つ候補を渡して和了できる（「正準のみ受理」に壊すと落ちる）。
- **非正準の合法選択が CLAIM で通る**: 同様にロンで。
- 既存の「候補の再計算による検証」ブロック（偽装点数・成立しない役・malformed）が引き続き通る。

## E. サイズ規律（レビューで是正）

`yaku.ts` は着手前から 410 行（`docs/repository-structure.md` の「400 行超は分割」を既に超過）。
当初設計は「私的ヘルパの重複 or 公開の二択」を理由に集約を優先し `yaku.ts` へ追加としたが、
3軸レビューの [必須] が「共有プリミティブを**公開して**分割すれば重複は生じない」と指摘。これは
正しく、偽の二択だった。是正として選択の再導出を **`src/engine/yakuSelection.ts`（新規・約176行）**
へ分離し、`yaku.ts` は 427 行（≒着手前の 410 行）に戻した。列挙（AI・待ち用）と再導出（宣言・
割り込み検証用）を最初から2つの関心事として書いていた設計とも一致する切り口で、行数目的の
機械的分割ではない。**閾値: いずれのファイルも 400 行超で分割を検討・600 行を上限とする。**

## リスクと対応

| リスク | 対応 |
| --- | --- |
| 神聖なエンジン検証の変更で安全性の穴 | 100 局不変条件 ＋ 偽装（点数・役種）／未所持／不要牌ロンの既存・新規テスト ＋ 差分オラクル（ツモ・ロン）で担保 |
| ロン規則が findYaku とずれて AI 経路が壊れる | 「反手内成立」判定を `achievableSignaturesWithout` に集約し `findYaku` と**同一関数**を共有。上記「壊さない根拠」＋ ロン差分オラクル（100 局 probe）で検証 |
| 循環 import | `claims.ts → yakuSelection.ts → yaku.ts` の一方向のみ（`yaku.ts` は下流を参照しない） |
