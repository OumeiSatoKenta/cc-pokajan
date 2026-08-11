# タスクリスト: 絵札選択エンジン（Step 1）

## 実装

- [x] T1. `src/engine/yaku.ts` に `candidateFromSelection` と私的ヘルパ（uid 解決 / classify）を追加
- [x] T2. `src/engine/claims.ts` の `verifyCandidate` を再計算式へ統一（`candidateKey` 削除・import 追加）
- [x] T3. `src/engine/win.ts` `applyDeclare` の呼び出し更新・`findYaku` import 削除
- [x] T4. `src/engine/game.ts` `case 'CLAIM'` の呼び出し更新・`findYaku` import 削除

## テスト

- [x] T5. `tests/engine/yaku.test.ts` に `candidateFromSelection` 単体テストを追記（差分オラクル含む）
- [x] T6. `tests/engine/game.test.ts` に非正準の合法選択が DECLARE / CLAIM で通る回帰を追記
- [x] T7. 新規回帰をミューテーションで検証（実装をわざと壊して落ちることを確認 → 4件が落ち、正準/オラクルは不変）

## 検証

- [x] T8. `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` 全通過（789 tests / 40 files）
- [x] T9. `wc -l` でファイルサイズを計測（yaku.ts 410→550 行。判定集約を優先し分割せず・振り返りに記録）

## レビュー反映（Step 4.5 / 6.5）

- [x] R1. doc-reviewer [必須]: ロン差分オラクル（100 局 probe）を実装 → `tests/engine/yaku.test.ts`
- [x] R2. structural [必須]: `yaku.ts`（550行）を `yakuSelection.ts` へ分離（共有プリミティブを公開）
- [x] R3. structural/secondary/docs [推奨]: 「反手内成立」判定を `achievableSignaturesWithout` に集約（重複除去）
- [x] R4. secondary/docs [推奨]: `required` が hand に無い誤用を `RangeError` に（findYaku と対称）＋テスト
- [x] R5. structural [推奨]: `multisetEquals` → `isMultisetEqual`（真偽値命名規約）
- [x] R6. 各 [提案]: 役種偽装の無効化テスト・triple 優先の明文化コメント＋テストを追加
- [x] R7. docs 追随: `docs/repository-structure.md` に `yakuSelection.ts` と依存辺を追記

## 振り返り

- [x] T10. 申し送り事項を記載（下記）

---

## 進捗ログ

- T1–T4: `candidateFromSelection` 追加＋DECLARE/CLAIM を再計算式へ差し替え。typecheck・engine 335件 green。
- T5–T7: 単体テスト＋差分オラクル（ツモ）追加。ミューテーション（正準のみ受理）で新規4件のみ落ちることを確認。
- T8–T9: 検証ゲート全通過（789件）。`yaku.ts` 550行を計測 → レビューで是正方針決定。
- R1–R7: 5エージェントのレビュー（doc-reviewer / implementation-validator / 3軸）を反映。分割・dedup・ガード・命名・追加テスト・ドキュメント追随を実施。最終 793件 green・3回連続で決定的。

## 振り返り（T10）

**実装完了日**: 2026-08-11

**計画と実績の差分**:

- 当初「`yaku.ts` へ `candidateFromSelection` を追加」の方針は、ファイルが 410→550 行に肥大し
  `docs/repository-structure.md` の「400 行超は分割」に反した。3軸レビューの [必須] を受けて
  **`src/engine/yakuSelection.ts`（新規）へ分離**。共有プリミティブを公開すれば重複は生じないため、
  設計時の「分割＝DRY崩壊」は偽の二択だった。`yaku.ts` は 427 行（≒着手前）に復帰。
- ロン差分オラクルは design.md で「ツモと同様」の一文で済ませており、実装から漏れていた
  （doc-reviewer が [必須] で検出）。`computeWaits` の probe 手法を流用して 100 局規模で実装。
- 「反手内成立」判定が `findYaku` と `candidateFromSelection` に重複していた（3レビュー一致の [推奨]）→
  `achievableSignaturesWithout` に集約し、両者が同一関数を共有する形へ。
- `required` 未所持時の `null` が実装詳細への暗黙依存だった（[推奨]）→ `RangeError` を明示。

**学んだこと**:

- **ファイルサイズは着手前も測る。** `yaku.ts` は着手前から 410 行で既に閾値超過だった。
  「自分の変更でどれだけ増えたか」だけでなく「開始時点で既に超えていないか」も見るべき。
- **「分割か DRY か」は多くの場合偽の二択。** 共有プリミティブを公開すれば両立できる。
  設計段階でこの選択肢を検討していれば、レビューの往復を1周減らせた。
- **設計書の「〜も同様」は実装漏れの温床。** ロン差分オラクルは「ツモと同様」で流したため実装から
  抜けた。非自明な検証こそ手順を具体化して独立タスクに割る（T5 を T5a/b/c に割るべきだった）。
- **レビューを実装と並行起動したのは有効だった。** doc-reviewer が Step 4.5 で [必須] を返す前に
  T5–T7 を進めていたが、指摘（ロンオラクル）は既存の実装を壊さず追加で解消できた。ただし
  doc-reviewer は実装中スナップショットを見て「game.test.ts 未変更」と誤認したため、並行起動時は
  「レビュー時点の作業ツリー状態」に注意が要る。

**次回への改善提案**:

- Step 2（UI・ツモ）着手前に本 design.md と CLAUDE.md、本振り返りを読む。
- 新規エンジン関数を追加する PR では、着手前に対象ファイルの `wc -l` を必ず記録し、
  400 行に近い場合は分割先を design.md に事前記載する。
- 検証タスク（差分オラクル等）は「ツモ／ロン」「単体／統合」で必ずチェックボックスを割る。
