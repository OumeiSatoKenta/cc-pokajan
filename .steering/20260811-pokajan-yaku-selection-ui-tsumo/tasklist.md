# タスクリスト: 絵札選択UI・ツモ（Step 2）

## 実装

- [x] T1. `src/ui/selection.ts` に `toggleUid` 純関数を追加
- [x] T2. `CardView.tsx` に `isSelected`・`actionKind`（aria 出し分け）・`aria-pressed`、`.card--selected` を付与
- [x] T3. `Hand.tsx` に `interaction`・`selectedUids`・`onSelect` を追加（discard 現状維持）
- [x] T4. `SelectionPreview.tsx`（新規）を作成（役ライブプレビュー＋緑ツモ確定ボタン）
- [x] T5. `ActionBar.tsx` の declare 候補を `onPrefill` 化（金 `button--primary` を流用）・`selection` prop で確定を内包
- [x] T6. `TableScreen.tsx` に `selectedUids` 状態・`composed`・リセット効果・配線
- [x] T7. `App.css` に `.card--selected` / `.button:disabled`、`src/ui/selection.css`（新規）に `.selection-preview*`（レビュー反映: 新 button CSS なし・table.css 不変）

## テスト

- [x] T8. `tests/ui/selection.test.ts`（`toggleUid`）
- [x] T9. `tests/ui/selectionPreview.test.tsx`（プレビュー配線）
- [x] T10. `tests/ui/cardVisual.test.tsx` 追記（`.card--selected` と面色の同時付与・aria 出し分け）
- [x] T11. `tests/ui/actionBar.test.tsx` 更新（プレフィル化・selection 描画）
- [x] T12. `tests/e2e/table.spec.ts` 追記（タップ選択トグル／おまかせ→確定でツモ／横向き fit with プレビュー）
- [x] T13. `tests/e2e/winGate.spec.ts` の `playUntilHumanWin` をプレフィル→確定に更新
- [x] T14. ミューテーション検証: SelectionPreview の `disabled={composed===null}` を `false` に壊すと不活性テスト2件が落ちる。E2E の選択トグルは interaction モードを壊すと `.card--selected` が付かず落ちる

## 検証

- [x] T15. `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` 全通過（807 tests）
- [x] T16. `npx playwright test --workers=1`（直列・競合なし）で **85 passed / 0 failed**（確定的に全緑）。
      フル並列（`fullyParallel`・既定ワーカー）は `fast:false` の遅いテストがサンドボックス競合で flake し、
      **失敗する組み合わせが実行ごとに変わる**（環境要因・ロジック回帰ではない）。CI は `retries:1` で自動回復。
- [x] T17. `wc -l`（App.css 412→381 で `selection.css` へ分割・table.css 395 不変）

## レビュー反映（Step 4.5 / 6.5）

- [x] R1. doc-reviewer [必須]: 選択 UI を `.table__mine`（横向き grid）から高さ保護のある `.actions`（ActionBar 内）へ移設
- [x] R2. doc-reviewer [必須]: 新 `.button--auto` を作らず既存 `button--primary` を流用（table.css 不変）
- [x] R3. doc-reviewer [高]: 横向き 844×390 で SelectionPreview 実マウント相当を注入する E2E を追加
- [x] R4. doc-reviewer [低]: `aria-pressed` を選択モードのカードに付与
- [x] R5. 3軸 structural [推奨]: boolean 命名（`isCardDisabled` / `isIdle`）
- [x] R6. 3軸 structural [推奨]: `playUntilHumanWin` を helpers の `playUntilHumanDeclare` 再利用へ（進行手順の二重実装解消）
- [x] R7. 3軸 secondary [推奨]: `canSelect` に `pendingWin === null` を追加（演出中はキーボードでも選択不可）
- [x] R8. impl-validator [高]: 選択リセットの回帰 E2E を追加（`data-selected-count` で直接観測・ミューテーションで落ちることを確認）
- [x] R9. 3軸 secondary + impl-validator [中]: `SelectionPreview` のライブ文言に `aria-live="polite"`
- [x] R10. 3軸 docs [推奨] + secondary [提案]: おまかせ候補ごとにプレビュー点数が切り替わる E2E（色の取り方で点数が変わる）
- [x] R11. impl-validator [中]: `.button:disabled` の app 共通適用にコメント
- [x] R12. 3軸 docs/impl-validator [低]: `aria-pressed` の単体テスト（cardVisual）

## 振り返り

- [x] T18. 申し送り事項を記載（下記）

---

## 進捗ログ

- T1–T7: 選択モード・プレビュー・確定・プレフィルの実装。doc-reviewer [必須] を受け配置を ActionBar 内へ是正。
- T8–T14: 単体4種・E2E追加・winGate 更新・ミューテーション検証。807 tests green。
- レビュー（doc-reviewer 3.6/5 + implementation-validator 4.8/5 + 3軸 B/B/A）を反映（R1–R12）。最終 809 unit / E2E 直列全通過。

## 振り返り（T18）

**実装完了日**: 2026-08-11

**計画と実績の差分**:
- **配置の是正が最大の差分**。初稿は `SelectionPreview` を `.table__mine` 内に置く計画だったが、横向き
  `landscape.css` の `.table__mine` が `display:grid`（`head/river/hand`）で、兄弟挿入すると grid が壊れる。
  doc-reviewer [必須] を受け、高さ保護（`max-height`+`overflow-y`）のある `.actions`（ActionBar 内）へ移設。
- 新 `.button--auto` は不要と判断し既存 `button--primary` を流用 → `table.css` 不変（395行）。
- App.css が 412 行で 400 超 → `.selection-preview` を新規 `selection.css` に分割（App.css 384行）。
- 計画にあった「あと1枚」案内は**意図的に未実装**（部分一致の進捗検出は脆く、Step 2 では「有効/無効」の
  2状態に単純化）。「役になりません／手札をタップして役を作る」で代替。

**学んだこと**:
- **横向きレイアウトの新規子要素は grid を疑う。** `.table__mine`/`.table__controls` は横向きで grid/flex に
  切り替わる。新しい UI をどこに挿すかは、縦の見た目だけでなく**横向きの grid-area/高さ保護**まで見る。
- **一時状態のリセットは「消費で自然に消える」に頼らず直接観測する。** `data-selected-count` を出したことで、
  リセット効果そのものをミューテーションで落とせるようになった（消費済み uid が偶然消えることに依存しない）。
- **新しい対話面は既存の停止ガードに揃える。** 手札タップという新経路は `.overlay` のクリック奪取では止まらず
  キーボードで裏を書ける。`canSelect` に `pendingWin === null` を足し、7-4 の「効果とクリックの両層で止める」に揃えた。
- **依存最小化の [提案] は lint 警告とトレードオフ**。`composed` の deps を絞ると exhaustive-deps 警告が出るため、
  実害のない [提案] は broad deps（lint-clean）のまま据え置いた。
- **useEffect でのリセットは React 公式のアンチパターン**（"You Might Not Need an Effect"）だが、本プロジェクトは
  `WaitPanel` で同型の useEffect リセットを採用済み。**コードベースの一貫性を優先**して useEffect を維持した
  （窓は演出ポーズと `candidateFromSelection` の null 化で無害）。render 中リセットへの移行は将来検討。

**次回への改善提案（Step 3: ロン選択UI）**:
- `TableScreen.tsx` は 393 行（`300〜400: 分割の余地` ゾーン）。Step 3 でさらに増えるため、選択状態の配線を
  `useSelection` フックへ抽出する分割を着手前に検討する（structural [推奨]）。
- `canDiscard`（`useGameLoop` 内）と `canSelect`（`TableScreen` 内）が非対称。ロンでも同種判定が要るため、
  `useGameLoop` への統合を検討する（structural [提案]）。
- ActionBar が「候補ボタン＋プレビュー＋確定」を抱える操作パネルに肥大。Step 3 のロン選択でさらに増えるなら
  「操作バー本体」と「宣言/確定パネル」の分割を検討する（structural [質問]）。
