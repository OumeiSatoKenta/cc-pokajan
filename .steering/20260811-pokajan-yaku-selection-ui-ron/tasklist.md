# タスクリスト: 絵札選択UI・ロン（Step 3）

## 実装

- [x] T1. `SelectionPreview.tsx` に `kind: 'tsumo' | 'ron'` を追加（確定ボタンの色・testid・ラベルを出し分け）
- [x] T2. `src/ui/hooks/useSelection.ts`（新規）: ツモ／ロン共通の選択状態・`composed`・リセット・確定・プレフィルを集約
- [x] T3. `ActionBar.tsx`: claim 候補をおまかせプレフィル化（金 `button--primary`）・`onClaim` 削除・`selection.kind` 透過
- [x] T4. `TableScreen.tsx`: 選択配線を `useSelection` に置換（`useState`/`useEffect`/選択 import を除去・393→**352 行**）

## テスト

- [x] T5. `tests/ui/selectionPreview.test.tsx` 更新（`kind` を全 render に付与・ロン＝赤/`claim-confirm`/「ロン」・2件追加）
- [x] T6. `tests/ui/actionBar.test.tsx` 更新（claim をおまかせプレフィル化・`onClaim` 廃止・`selection.kind='ron'` 描画）
- [x] T7. `tests/e2e/helpers/table.ts` に `playUntilHumanClaim`（`claim-button` 到達・`claimWindow` で見送らない）
- [x] T8. `tests/e2e/table.spec.ts` 追記（ロンおまかせ→確定でロン／タップ再構成／捨て札固定の観測／色バリエーションで点数が変わる／横向き844×390 ロン注入）
- [x] T9. ミューテーション検証: M1 捨て札合流除去→ロン確定E2E落ち／M2 プレフィル除外除去→重複uidでnull→E2E落ち／M3 `kind`固定化→ロン単体2件落ち（3件とも確認・復元済み）

## 検証

- [x] T10. `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` 全通過（レビュー反映後 **824 tests**・lint/format 0件）
- [x] T11. `npx playwright test --workers=1`（直列・競合なし）で **90 passed / 0 failed**（85 既存 + 4 新ロン + 1 claimWindow リセット）
- [x] T12. `wc -l`: `TableScreen.tsx` **355**（< 400）/ `ActionBar` 113 / `SelectionPreview` 81 / `useSelection` 155 / `selection.ts` 85 / `actionBarItems` 105 / CSS 不変（App.css 384・table.css 395・selection.css 36）

## レビュー反映（Step 4.5 / 6.5）

- [x] R1. doc-reviewer [高]: ロンの色バリエーションで点数が変わる E2E を追加（ツモとの対称・G節/T8 に反映）
- [x] R2. doc-reviewer [中]: `playUntilHumanClaim` の最小疑似コードを design.md に追記（pass は selfDeclare のみ・流用不可を明示）
- [x] R3. doc-reviewer [中]: `data-selected-count` がロンで役の構成枚数より1小さい非対称を design.md A節に明記
- [x] R4. doc-reviewer [低]: 捨て札とプレビューが離れる件を H節リスク表に「意図的な簡略化」として記録
- [x] R5. doc-reviewer [推奨]: `ActionBar` の `<SelectionPreview kind={selection.kind}>` 受け渡し JSX を C節に明示
- [x] R6. **secondary [必須]**: 和了演出中の「両層停止」の漏れを是正。`useSelection` は手札タップを止めていたが
      `ActionBar` の見送る/おまかせボタンと `canDiscard` 経路が `pendingWin` を見ておらず、連続宣言で `game.state` が
      次の局面に進んだ演出裏で**キーボード経路**から押せた。`actionBarItems` に `isPaused` を追加（真なら `[]`）・
      `ActionBar` に `isPaused` prop・`interactionGate` の `isPaused` で手札も全停止。ミューテーションで両方落ちることを確認
- [x] R7. impl-validator [推奨] + structural [質問] + secondary（収束）: ゲート判定・リセット鍵を純関数化
      （`interactionGate` / `resetKeyOf` を `selection.ts` へ）＋ `tests/ui/selection.test.ts` に単体テスト（`autoAction`/`turnTimer` と同型）
- [x] R8. docs [推奨]: `SelectionPreview.kind` の型を `engine/types` の `WinKind` へ（`WinCutIn` と同じ・同義の再定義を解消）
- [x] R9. docs [推奨]: `SelectionPreview` の live 領域に `role="status"` を追加（コメント/`WinOverlay` と一致）
- [x] R10. structural [推奨]: `composed` useMemo のコメントをロン受付でも正確に（他家 claim/pass で state が変わるが結果は同値）
- [x] R11. secondary [推奨]: claimWindow のリセット E2E を追加（受付で選択→見送る→`data-selected-count` が 0 に戻る）
- [x] R12. impl-validator [提案]: `selectedCount` の二重読み出しを1箇所に束縛
- [x] R13. docs [質問] + secondary [提案]: リセット鍵がエンジンの同期更新順序（`declarer`/`chainCount` が `pendingWin` より先）に
      暗黙依存する点を `useSelection`/`resetKeyOf` のコメントに明記（順序が変われば最初にここが壊れる）
- [x] R14. **再レビュー secondary [推奨]**: `hintFor`（ヘッダー案内文）も `isPaused` を考慮。演出裏で局面が進むと
      「捨ててください／割り込めます」を出すが操作は凍結済み＝「押せると言うのに押せない」矛盾。演出中は
      「和了を確認しています」に倒す（`interactionGate`/`actionBarItems` と同じ停止に揃える）。ミューテーションで落ちることを確認
- [x] R15. 再レビュー secondary [提案]: `isPaused = pendingWin !== null` を `TableScreen` トップで1回だけ評価し、
      `useSelection`（interaction）・`ActionBar`（ボタン）・`hintFor`（文言）へ配る（判定元がずれる余地を排除）
- 据え置き（記録のみ）: structural [推奨] `Pick<GameLoop>` 化＝`TableScreen` が `loop` を広いハンドルとして扱う既存方針に合わせ据え置き。
  `composed` の `state` 丸ごと依存＝`yakuContextOf` が `activeGroups` 等を読むため意図的（過剰依存は無害）。
  `onSelect`/`onPrefill`/`selection` の `useCallback`/`useMemo` 化＝`Hand`/`ActionBar` が `React.memo` でないため YAGNI。
  `waitForTimeout` ポーリング＝既存ヘルパ踏襲（deadline 付きで実用上安定）。oxlint の exhaustive-deps 未設定＝プロジェクト全体設定で今回範囲外。

## 振り返り

- [x] T13. 申し送り事項を記載（下記）

---

## 進捗ログ

- T1–T4: `SelectionPreview` の `kind` → `useSelection` 抽出 → `ActionBar` の claim プレフィル化 → `TableScreen` 結線置換。
  TableScreen 393→352→（最終 355）行。ツモ経路（Step 2）は不変。
- T5–T9: 単体（selectionPreview ロン / actionBar claim プレフィル）・E2E 4件（ロン確定・タップ再構成・色バリエーション・横向き）・
  helper `playUntilHumanClaim`・ミューテーション3件（M1 捨て札合流 / M2 プレフィル除外 / M3 kind 固定）。
- T10–T12: 全ゲート通過。E2E 直列 89→90 passed。
- レビュー: doc-reviewer 4.6/5（R1–R5）→ 3軸（structural A / secondary B→再A / docs B）+ impl-validator 4.8/5。
  **secondary [必須] 1件**（演出中の両層停止の漏れ）を修正（R6–R7）＋純関数化・型共有・a11y・E2E 追加（R8–R13）。
  再レビュー secondary **A・[必須]0**、その [推奨]（hintFor）・[提案]（isPaused 一括評価）も反映（R14–R15）。最終 unit 825 / E2E 直列 90。

## 振り返り（T13）

**実装完了日**: 2026-08-11

**計画と実績の差分**:
- **`useSelection` 抽出は計画どおり成功**。TableScreen は 393→355 行（結線のみ）に純減し、Step 2 振り返りの[推奨]を回収。
  ツモ／ロンの差分が「対象手札・固定捨て札・確定先・確定ボタン種別」の4点に自然に閉じた（3軸 structural A）。
- **最大の差分は secondary [必須]**: 「和了演出中は両層で止める」（7-4）を手札タップには効かせたが、**同じ操作バーの
  兄弟要素（見送る/おまかせボタン）と `canDiscard` 経路の手札に効かせ忘れた**。連続宣言で `applyWin` が同じ `reduce()` 内で
  `game.state` を次局面へ進めるため、演出裏の**キーボード経路**で押せた。`interactionGate`/`actionBarItems`/`hintFor` の
  3箇所を**1つの `isPaused`**（`TableScreen` で1回評価）で閉じて是正。
- **レビュー収束を受けてゲート/リセットを純関数化**（`interactionGate`/`resetKeyOf` を `selection.ts` へ）。当初は
  フック内クロージャに閉じていたが、impl-validator[推奨]・structural[質問]・secondary が独立に「E2E 頼みで単体テストが無い」を
  指摘。純関数に出して `autoAction`/`turnTimer` と同型の単体テストを付け、演出中停止の[必須]もミューテーションで固定できた。
- CSS 追加は**ゼロ**（`.card--selected`・`button--ron` は既存）。計画どおり。

**学んだこと**:
- **「両層で止める」は“同じ操作面の全要素”に効かせる。** 7-4 の教訓を手札タップには適用したのに、**すぐ隣の
  ボタン**を止め忘れた。停止の判定は1つの値（`isPaused`）に集約し、手札・ボタン・案内文の**全 affordance へ配る**。
  「一部だけ止まっている」は「全部止まっている」ように見えて最も気づきにくい（`loopReducer` の下層防御があるので
  データは壊れず、テストも通ってしまう）。
- **連続宣言は「同じ `reduce()` 内で局面が先に進む」。** `pendingWin`（演出待ち）が立っていても `game.phase`/`declarable`/
  `canDiscard` は既に次局面を指す。UI が `phase` だけで affordance や文言を出すと演出裏で嘘になる。**演出中フラグは
  `phase` と直交する独立軸**として扱う。
- **判断は純関数に出す＝レビューの「E2E 頼み」指摘は3人が独立に言う。** `useState`/`useEffect` に埋めた判定は
  単体テストできず、正しさが E2E（低速・単一シード）と手動トレースに落ちる。`interactionGate`/`resetKeyOf` に
  切り出したことで、演出中停止の[必須]回帰をミューテーションで機械的に固定できた（CLAUDE.md の「たまたま成り立つに
  依存しない」の実践）。
- **同義の型は再定義しない。** `'tsumo'|'ron'` は `WinKind` として既にあり `WinCitIn` が使っている。構造的型付けは
  別宣言でも黙って通るため、共有型を使わないと将来の拡張で片方だけ取り残される（docs [推奨]）。

**次への改善提案**:
- **`useGameLoop` の `canDiscard` に `pendingWin` を含める根治**を検討（今回は `interactionGate` 側の局所ガード）。
  `canDiscard` を参照する箇所（`hintFor`・`useSelection`）が増えるほど、各所での `!isPaused` 付け忘れリスクが戻る。
- **`useSelection(loop)` の引数を `Pick<GameLoop, …>` に絞る**と依存が型で正直になる（structural [推奨]・今回は据え置き）。
- **oxlint に exhaustive-deps 相当のルール導入**を検討（docs [提案]）。`composed`/リセットの依存はエンジンの同期更新順序に
  暗黙依存しており、CI に機械的ガードが無い（コメントで残したが、順序が変われば静かに壊れる）。
- 絵札選択機能は Step 1–3 で**完成**。次は実プレイでの手触り確認（ロンの捨て札固定の分かりやすさ＝docs [低]で据え置いた
  「河の強調＋手札選択＋プレビューの3箇所を目で追う」UX）をプレイテストで検証する。
