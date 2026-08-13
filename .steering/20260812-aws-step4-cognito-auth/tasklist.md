# タスクリスト: AWS デプロイ Step 4 — Cognito 認証

## 事前

- [x] ベースライン確認: フロントゲート緑（lint/typecheck/test 860/build/format）・terraform 3 root validate 緑（E2E は実装後に 90 と突合）
- [x] 実装前 doc-review 反映（[必須]2: gate 判断を純関数化して両分岐テスト・README 更新タスク追加／[高]2: build environment: の二重承認明記・AuthProvider の checking で App 非描画／[中][低]: E2E ネットワーク実測・architecture.md 申し送り・main configure 逸脱・mfa OFF/deletion_protection を design へ反映済み）

## 実装（インフラ）

- [x] T1: `infra/modules/cognito/**`（versions / variables / main〔user pool〔email/検証コード/mfa OFF/deletion_protection〕 + public client〔secret 無し・SRP+refresh〕/ outputs〔pool_id, client_id, endpoint, issuer〕）
- [x] T2: `infra/environments/{dev,prod}` に cognito module 配線（tags を common_tags + Component 分割）・outputs に cognito_user_pool_id / cognito_app_client_id / cognito_issuer 追加

## 実装（フロント）

- [x] T3: `aws-amplify@6.20.0` を dependencies に追加（lock 同期）。build/typecheck 早期通過確認
- [x] T4: `src/vite-env.d.ts` に `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_APP_CLIENT_ID` を追加
- [x] T5: `src/net/apiClient.ts`（authorizedFetch + amplifyIdToken〔動的 import〕・base/token 注入可能）
- [x] T6: `src/ui/auth/amplifyConfig.ts`（VITE_COGNITO_* → Amplify.configure・欠落は明示エラー・冪等）
- [x] T7: `src/ui/auth/authGateMode.ts`（純関数 `authGateMode`。※ `AuthGate.tsx` と大小衝突しない名前にした＝macOS の case-insensitive FS 罠回避）
- [x] T8: `src/ui/auth/AuthForm.tsx`（signIn/signUp/confirmSignUp/resendSignUpCode の最小フォーム + auth.css）
- [x] T9: `src/ui/auth/AuthProvider.tsx`（configure を effect で・checking/signedIn/signedOut・checking で App 非描画・signOut 導線）
- [x] T10: `src/ui/auth/AuthGate.tsx`（authGateMode で分岐。passthrough=素通し / gate=lazy AuthProvider + Suspense。aws-amplify 静的 import なし。isAuthEnabled prop でテスト可能）
- [x] T11: `src/main.tsx` を `<AuthGate><App/></AuthGate>` に
- [x] T12: `.github/workflows/deploy-aws.yml` の build に `environment:` と `VITE_COGNITO_*` 注入（id-token は付けない）
- [x] T13: `infra/README.md` に cognito 認証欄・GitHub Environment 変数（VITE_COGNITO_*）・手動ログイン確認・build 二重承認・deletion_protection 撤去手順を追加

## 実装（テスト）

- [x] T14: `tests/ui/authGateMode.test.ts`（両分岐）＋ `tests/ui/authGate.render.test.tsx`（素通しは children 表示・gate は children 非表示・AuthProvider をモックし aws-amplify 非ロード）
- [x] T15: `tests/net/apiClient.test.ts`（Bearer 付与 / null token 未付与 / baseUrl null 例外）
- [x] T16: `tests/e2e/auth.spec.ts`（既定 github-pages で amplify/AuthProvider/cognito リクエスト 0 件を `page.on('request')` 実測）

## 検証

- [x] V1: lint / typecheck / test 867 / build / format:check すべて緑
- [x] V2: `npx playwright test` 91 passed（既存 90 + 新規 auth 1・認証無効で挙動不変）
- [x] V3: `terraform fmt -check` クリーン + 3 root `validate` Success
- [x] V4: ① 既定ビルドの main index chunk に aws-amplify 参照 0・index.html が AuthProvider chunk を preload しない ② E2E ネットワーク実測 0 件（実行時で固定）
- [x] V5: `wc -l` 最大 AuthForm.tsx 143 / cognito main.tf 68（すべて 400 行未満）
- [x] V6: ミューテーション3件（authGateMode 反転・AuthGate 常時 passthrough・apiClient ヘッダ削除）すべてテストが落ちることを実測→revert 済み
- [x] V7: `git status` OK（aws-amplify の package.json/lock 差分・新規は src/net・src/ui/auth・tests・infra/modules/cognito のみ・awscli-bundle 未 stage）

## レビュー反映タスク（実装後 3軸 + validator。doc-reviewer は実装前に反映済み）

- [x] R1: [security 必須] **Pages への aws-amplify 実行時漏れを build ゲートで機械検知**。`scripts/check-bundle-isolation.mjs` を
  `postbuild` に追加（index.html が eager に読む chunk に amplify/cognito が無いことを検査）。`npm run build` を叩く deploy.yml/deploy-aws.yml
  両方に効く（Playwright 不要）。lazy→静的 import の実回帰でビルドが落ちることを実測（tree-shake で消える偽ミューテーションに注意）。
- [x] R2: [security 必須] **VITE_COGNITO_* 欠落の白画面デプロイ防止**。① deploy-aws.yml の build 前に変数存在を assert（fail-closed）。
  ② `AuthProvider` に `configError` 状態を追加し、configureAmplify の throw を catch して中立画面を出す（無限スピナー/白画面を回避）。
- [x] R3: [structural 必須] `.oxlintrc.json` に `src/net/**` の依存方向を機械担保（engine/config/storage → net を禁止、net → react/ui/engine/storage を禁止）。
- [x] R4: [structural 高] `AuthProvider`(Status)・`useAuthForm`(Mode) を `switch + never` 網羅性検査に統一（既存8箇所と同型・将来の値追加を compile で捕える）。
- [x] R5: [structural 高] `AuthForm` の6 useState を `useAuthForm` フックへ抽出（`useSelection` と同型）。AuthForm は描画のみに。
- [x] R6: [validator 高] `tests/ui/amplifyConfig.test.ts` を追加（env 欠落で throw／充足で正しい shape・1回だけ configure）。requireEnv の throw を消すと落ちることを実測。
- [x] R7: [validator 低] `apiClient.test.ts` の oxlint 警告（no-unsafe-optional-chaining）を `new Headers(...)` で解消（lint warning 0）。
- [x] R8: [structural 中] AuthGate/AuthForm/AuthProvider を named `readonly` Props interface に。`tests/ui/authGate.render.test.tsx`→`authGate.test.tsx` に改名（既存規約に統一）。
- [x] R9: [structural 中] `docs/architecture.md` のレイヤー図に `src/net/`（出口 I/O）と `src/ui/auth/`（lazy 隔離）を追記。
- [x] R10: [structural 低] `infra/modules/cognito/.terraform.lock.hcl` を削除（子 module に lock は不要・frontend module と対称に）。[提案] cognito 名の内部組み立ての意図をコメント化。[security 提案] `email.trim()`・signOut に finally・signInStep MVP コメント。
- [x] R11: 再検証: lint(0 warning)/typecheck/test 869/build(+postbuild 隔離検査)/format 緑・terraform fmt+validate・E2E 91・ミューテーション4件（+bundle 隔離 guard 実回帰）すべて確認。
- [x] R12: [security 再レビュー 推奨] `AuthProvider` の catch で `console.error` に診断情報を残す（ユーザー表示は中立のまま）／`useAuthForm` の submit・resend 先頭に `if (busy) return`（onSubmit はボタン disabled を経由しないため二重送信を明示的に弾く）。再レビューは [必須]/[高] 新規0・security A で解消確認。

## 実装後の振り返り（実装完了: 2026-08-12）

**計画と実績の差分**:

- Phase 2 / Step 4 の要素（Cognito public client・email 検証・AuthGate・apiClient・deploy-aws.yml 注入）を計画どおり実装。
  `src/App.tsx`・engine は不変、Pages 版は無認証を維持（E2E 91・対局挙動不変）。
- **計画からの意図的な逸脱**: `Amplify.configure` を main.tsx でなく lazy chunk 側（amplifyConfig.ts）に置いた。main.tsx で
  configure すると aws-amplify を静的 import して lazy 分離が壊れるため（受け入れ基準4「Pages 実行時に読み込まない」と矛盾）。
- **依存**: `@aws-amplify/ui-react` は使わず `aws-amplify@6.20.0` のみ（承認済み依存の範囲）。自前 AuthForm。
- 最終ゲート: lint(0 warning)/typecheck/test **869**/build(+postbuild 隔離検査)/format、terraform fmt+validate(3 root)、E2E **91**、
  ミューテーション4件（authGateMode/AuthGate/apiClient/amplifyConfig）+ bundle 隔離 guard の実回帰、すべて緑。

**学んだこと**:

- **lazy 隔離の「正しさ」は unit test で守り切れない**。`vi.mock` は静的/動的 import を区別せず、`build`/`typecheck` は chunk 分割失敗で
  落ちない。security レビューが「唯一の実測が E2E で本番ゲート外」という穴を突いた。→ `postbuild` の bundle 隔離検査（Playwright 不要・
  deploy ゲート内）で機械化。ミューテーション検証では **tree-shake で消える偽の漏れ**（side-effect import・`void` 参照）に注意が要り、
  「実際に render される静的 import」でないと guard の有効性を確認できなかった。
- **「型で redaction/fail-closed したつもり」も実行時境界は別**（Step 2 の再演）。`VITE_COGNITO_*` 欠落でも Vite は build を落とさず、
  ErrorBoundary が AuthProvider の外に無いため白画面になる。CI の存在 assert（fail-closed）と `configError` 状態の両方で塞ぐ。
- **新レイヤーを足したら依存方向を即 oxlint に落とす**。`src/net/` は「今クリーン」だが機械的な壁が無ければ「たまたま成り立つ正しさ」。
  engine の React 禁止と同じ扱いにする。
- **macOS の case-insensitive FS**: `authGate.ts` と `AuthGate.tsx` は自己 import になる。純関数ファイルは `authGateMode.ts` に改名して回避。
- **switch+never と useState→フック抽出は本プロジェクトの強い規約**。外部ライブラリの union（signInStep）は別だが、自前の Mode/Status は
  網羅性検査に揃える。6 useState は `useAuthForm` へ抽出（`useSelection` 同型）。

**次回への申し送り**:

- **未コミット**: Step 1〜4 が同一作業ブランチにスタック。PR を Step 単位で分けるなら ship-pr でコミット分割。`awscli-bundle*` はコミットしない。
- **実 apply/ログイン確認はユーザー作業**（実 Cognito が要る）: `infra/README.md` の「認証（Cognito）の手動確認」手順。GitHub の各
  Environment に `VITE_COGNITO_*`（cognito outputs 由来）を設定。prod は build/deploy で二重承認になりうる（意図した多層防御）。
- **Step 5（backend）**: cognito の `issuer`（output）と `app_client_id`（audience）を API Gateway JWT authorizer へ。`apiClient` を remote
  transport から使い始める。`amplifyIdToken` は AuthProvider マウント後（configure 済み）前提なので配線位置に注意。
- **残 UX（低優先）**: AuthForm の signInStep 他ケース（MFA/RESET_PASSWORD）UI は MVP スコープ外。将来 MFA 有効化時に拡張が要る。
  AuthForm/AuthProvider の状態遷移ロジックの unit test は jsdom/testing-library が無いため未追加（`configError` 含む遷移決定を純関数に切り出せば到達可能・[security 再レビュー 推奨]）。
- **堅牢性の隣接穴 [security 再レビュー 提案]**: (1) `AuthGate` の `Suspense` を `ErrorBoundary` で包むと lazy chunk 取得失敗
  （デプロイ直後のハッシュ不整合・瞬断）の白画面を防げる。(2) `configError` 画面にリロード導線を添える。(3) Amplify 既定の
  トークン保存先は localStorage（XSS 時の露出経路）＝クライアントオンリー構成の既知トレードオフとして認識。いずれも将来 Step で検討。
