/**
 * 認証ゲートの分岐判断（React 非依存の純関数）。
 *
 * `AuthGate` の描画分岐をここに切り出すことで、両分岐（gate / passthrough）を
 * レンダリングや Suspense に依存せず機械的にユニットテストできる。
 * 「条件そのものが消えて常に素通しする」欠陥（＝ AWS 版が実質無認証になる最悪の回帰）を
 * このテストが固定する（`interactionGate` と同型・「たまたま成り立つ正しさ」を排除）。
 *
 * ※ ファイル名は `AuthGate.tsx` と大文字小文字だけで衝突しないよう `authGateMode.ts` にしている
 *   （macOS の case-insensitive FS で自己 import になる罠を避ける）。
 */
export type AuthGateMode = 'gate' | 'passthrough'

/**
 * 認証が有効なら 'gate'（ログインを要求）、無効なら 'passthrough'（素通し）。
 * `isAuthEnabled` は `deployConfig.isAuthEnabled`（AWS 版=true / Pages 版=false）。
 */
export const authGateMode = (isAuthEnabled: boolean): AuthGateMode =>
  isAuthEnabled ? 'gate' : 'passthrough'
