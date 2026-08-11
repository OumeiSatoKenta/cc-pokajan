# タスクリスト — GitHub Pages 公開 Step 1: base パス対応

参照: requirements.md / design.md / [計画書](../../docs/ideas/pokajan-github-pages-deploy-plan.md)

## フェーズ0: ベースライン確認

- [x] 着手前の `npm test`（ユニット）件数を控える → **40 files / 768 tests PASS**
- [x] 着手前の `npx playwright test`（E2E）件数を控える → **78 passed / 2 failed**。失敗2件は
  `winGate.spec.ts:260`（順位表 before→after）と `:282`（reduced-motion）で、**base 変更前から失敗**
  （＝本 Step と無関係。`fast:false` の演出タイミング依存でflaky疑い。doc-reviewer 同時実行の負荷下で計測）。
  base 変更は production ビルドのみに効き dev の e2e 挙動には無影響のため、変更後も同数であることを確認する。

## フェーズ1: 実装

- [x] `vite.config.ts` を `defineConfig((env) => (...))` の関数形に変換
- [x] base 解決を純関数 `resolveBase(env) = env.command === 'build' || env.isPreview === true ? '/cc-pokajan/' : '/'` に
  切り出して export（`plugins` / `test` は維持）。`REPO_BASE` 定数にリポジトリ改名時の注意コメントを添える
- [x] 4系統（dev/build/preview/vitest）のマッピングと `mode` を使わない理由をコメントで残す
- [x] `tests/config/viteBase.test.ts` を追加（`resolveBase` の回帰。build/preview→`/cc-pokajan/`、dev/vitest→`/`、
  isPreview 未指定→`/`）。**わざと `isPreview` 分岐を落として preview ケースが失敗することを確認**（回帰テストの teeth）
  - **注**: 当初 `mode === 'production'` で実装したが、3軸レビューの [推奨]（欠陥・API 両軸が収束）を受け、
    Vite 公式の正準パターン `command`/`isPreview === true` に変更（`vite build --mode X` で base が落ちる脆さを排除）。
    さらに base 解決を純関数化し回帰テストを追加（欠陥軸 [推奨]）。

## フェーズ2: 検証

- [x] `npm run lint` PASS（oxlint、エラーなし）
- [x] `npm run typecheck` PASS（tsc -b、エラーなし）
- [x] `npm test` PASS（40 files / **768 tests** ＝ベースラインと一致）
- [x] `npm run build` PASS（production ＝ base `/cc-pokajan/` で `dist/` 生成。`dist/index.html` の
  JS/CSS が `/cc-pokajan/assets/...` になっていることを確認）
- [x] `npm run format:check` PASS（Prettier、全ファイル準拠）
- [x] `npx playwright test` **80 passed / 0 failed**（クリーン実行。ベースラインで落ちた winGate 2件も緑。
  ＝あの2件は doc-reviewer 同時実行の負荷/設定書き換えによる flaky だったと確定。dev=`/` は無傷）
- [x] `npm run build && npm run preview` → `http://localhost:4173/cc-pokajan/` **200**、JS アセット **200**、
  root `/` は **302**（Vite の base リダイレクト。正しい挙動）。curl で機械検証（対局の通しは e2e が担保）
- [x] `npm run dev` → `http://localhost:5173/` **200**、entry script が `src="/src/main.tsx"`（base `/`）で従来どおり

## 実装後の振り返り

- **実装完了日**: 2026-08-11

- **最終成果物**: `vite.config.ts`（純関数 `resolveBase` を export し `base: resolveBase(env)`）＋
  `tests/config/viteBase.test.ts`（回帰テスト 4 ケース）。
  `resolveBase(env) = env.command === 'build' || env.isPreview === true ? '/cc-pokajan/' : '/'`

- **検証結果（すべて緑）**:
  - `npm run lint` / `npm run typecheck` / `npm run format:check`: エラーなし
  - `npm test`: 40 files / **768 tests PASS**（ベースラインと一致）
  - `npm run build`: 成功。`dist/index.html` が `/cc-pokajan/assets/...` になることを確認
  - `npm run preview` → `/cc-pokajan/` **200**・JS アセット **200**（`isPreview: true` で base 付与を実測）
  - `npm run dev` → `/` **200**・entry script `src="/src/main.tsx"`（base `/`）
  - `npx playwright test`: **80 passed / 0 failed**（クリーン実行）

- **計画と実績の差分**:
  - **分岐方式を `mode === 'production'` → `command === 'build' || isPreview === true` に変更**。当初計画・design も
    当初は `mode` 案だったが、3軸コードレビューで**欠陥軸（[推奨]）と API 軸（[推奨]）が独立に同じ懸念に収束**
    （`vite build --mode X` で base が黙って落ちる脆さ）。Vite 公式の正準パターン `isPreview` に切り替えた。
  - **base 解決を純関数 `resolveBase` に切り出し、回帰テスト `tests/config/viteBase.test.ts` を追加**。
    「本番だけ効く分岐は手動検証のみで CI が守れていない」という欠陥軸 [推奨] への対応。当初 requirements の
    「tests は触らない」を意図的に緩め、既存テストは変えずに1本だけ足した。
  - **`isPreview === true` の明示比較**（Vite 公式推奨。undefined を渡すツールへの堅牢化）＝ API/doc 軸 [提案]。
  - 計画書（plan.md）・コマンド一覧・requirements/design/tasklist をすべて追随更新済み。

- **レビュー結果（2 ラウンド）**:
  - 1回目（共有 worktree・実装直後）: 構造 **A** / 欠陥 **A** / API **B**、[必須] 0。ここで `mode → isPreview` を採択。
  - 2回目（**隔離 worktree で再レビュー**・最終コード `b51aa8c` に対して）: 構造 **A** / 欠陥 **B** / API **B**、
    [必須] 0 だが**実在の追随漏れを2件検出**（plan.md 冒頭と commands.md の `mode` 文言）＋回帰テスト [推奨]。
    → 本ラウンドですべて反映（doc 修正・テスト追加・`=== true`）。

- **学んだこと**:
  - **E2E ベースラインは他エージェントと同時に取らない**。着手時の e2e ベースラインは doc-reviewer が
    同時に `vite.config.ts` を書き換え＆サーバを起動していた最中に計測してしまい、**78/2（winGate 2件 flaky）**
    という汚染された値になった。クリーン実行では **80/0**。ベースライン計測は排他的に行うべき。
  - **`vite preview` の `command` は `'serve'`**（`'build'` ではない）。base をビルド文脈で切り替えるときの典型的な罠。
    Vite はこの区別に `isPreview` フラグを用意している。`mode` 既定値に頼る分岐より `command`/`isPreview` が正準。
  - **base 変更は production ビルド専用**なので dev/e2e（development・`command 'serve'`・非 preview）には無影響。
    「本番のみ再現」する類の変更は、preview の curl 実測（`/cc-pokajan/` 200）＋ `resolveBase` の回帰テストで機械的に担保できる。
  - **セカンダリ worktree から `isolation: "worktree"` を使うと、エージェント worktree は“プライマリ（main）”の HEAD から作られる**
    （自分のフィーチャーブランチ HEAD ではない）。working tree には Step 1 の変更が無いため、コミットハッシュを渡して
    `git show <hash>:<path>` で読ませる必要がある。共有 `.git` のおかげでハッシュ経由なら参照できる。
    レビュー用の隔離エージェントは**コミット後に・ハッシュ指定で・読み取り専用**で回すのが正解。
  - **`mode` 文言の追随漏れは backtick で grep をすり抜けた**（`` `mode` で `` は `mode で` に一致しない）。方針転換時は
    **裸の語で `grep -rn "mode" <docs>` を打って残数ゼロを確認**するまで完了としない（隔離 doc-reviewer が2件検出）。

- **次回への改善提案（Step 2 への申し送り）**:
  - Step 2 の Actions ワークフローは `npm run build`（＝`tsc -b && vite build`、`--mode` なし）を固定で呼ぶこと。
    `--mode` を上書きすると base 判定が崩れる（今回 isPreview 化で mode 依存は消したが、build の `command` 前提は残る）。
  - README への公開 URL 追記は Step 2 に含める（本 Step ではアプリコード＝`vite.config.ts` のみに絞った）。
  - `dist/` はビルド生成物（gitignore 済み）。コミットしない。
