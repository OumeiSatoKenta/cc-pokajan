/// <reference types="vite/client" />

/**
 * Vite が公開する VITE_ 環境変数の型付け。
 *
 * ViteTypeOptions.strictImportMetaEnv を宣言すると、Vite 既定の ImportMetaEnv が持つ
 * `Record<string, any>` フォールバックが外れ、下で宣言した既知キー以外（＝タイポ）への
 * import.meta.env アクセスが compile エラーになる（例: VITE_DEPLOY_TARGETT → TS2551）。
 * これを入れないと未知キーは any に落ち、変数名の打ち間違いが黙って github-pages 挙動になる
 * （このプロジェクトが最も嫌う「たまたま成り立つ正しさ」）。既知キーの型を any から絞るだけでなく、
 * タイポ検知まで効かせるためにこの1宣言が要る。
 *
 * ※ この .d.ts は module にしない（export を書かない）。ambient 宣言としてグローバル併合させる。
 * ※ VITE_DEPLOY_TARGET は .env* ファイルに書かないこと（CI/CLI インライン限定）。config 側
 *    （vite.config.ts の resolveBase）は .env* を読まず process.env のみ見るため、.env* に書くと
 *    base（Pages サブパス）と実行時フラグ（deploy.ts）がソース不一致で食い違う。
 * ※ 実行時は任意文字列・未設定がありうるため union ではなく `?: string`（string | undefined）にし、
 *    deriveDeployConfig の防御分岐を型でも活かす。
 */
interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_DEPLOY_TARGET?: string
  readonly VITE_API_BASE_URL?: string
  // AWS 版のみ。deploy-aws.yml が GitHub Environment 変数から build 時に注入する（公開値）。
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_APP_CLIENT_ID?: string
}
