/**
 * デプロイ先ごとの実行時設定。
 *
 * base（vite.config.ts）は「サブパス/ルート」を決めるだけだが、AWS 版はさらに認証・サーバー権威
 * transport・サーバー財布が有効になる。ここでは VITE_DEPLOY_TARGET から、それら「AWS でだけ有効に
 * なるフラグ」を1箇所へ集約して公開する（消費は後続 Step の認証ゲート／transport／wallet）。
 *
 * VITE_DEPLOY_TARGET は .env ファイルではなく CI / CLI がインラインで渡す
 * （例: `VITE_DEPLOY_TARGET=aws npm run build`）。Vite は VITE_ 接頭辞の変数を import.meta.env へ
 * 露出するため、アプリコードからは import.meta.env で読む（型は src/vite-env.d.ts で string に絞り、
 * VITE_ 変数名のタイポを compile 時に検知する）。
 *
 * ※ 同じ VITE_DEPLOY_TARGET を vite.config.ts の resolveBase も解釈する（base はあちら、実行時フラグは
 *   こちら）。target 文字列の種類を増やすときは両方を同時に直すこと。また .env* ファイルには書かない
 *   （resolveBase は config 評価時に .env* を読めず process.env のみ見るため、書くと base とフラグが食い違う）。
 *
 * 導出は純関数 deriveDeployConfig に切り出して単体テストする（tests/config/deploy.test.ts）。
 * resolveBase（vite.config.ts）と同じ「本番でしか効かない分岐を純関数で固定する」方針。
 */

export type DeployTarget = 'github-pages' | 'aws'

export interface DeployConfig {
  /** ビルド対象。未知の VITE_DEPLOY_TARGET は既定の 'github-pages' に握り潰す。 */
  readonly target: DeployTarget
  /** AWS 版はログイン必須（Cognito）。Pages 版は無認証。 */
  readonly isAuthEnabled: boolean
  /** 'remote'=サーバー権威（AWS）/ 'local'=ブラウザ内エンジン（Pages・オフライン）。 */
  readonly transport: 'local' | 'remote'
  /** 'server'=財布をサーバーで権威化（AWS）/ 'local'=localStorage（Pages）。 */
  readonly walletSource: 'local' | 'server'
  /** AWS 版の API ベース URL。未設定（undefined・空文字）・Pages 版では null。 */
  readonly apiBaseUrl: string | null
}

/**
 * VITE_DEPLOY_TARGET / VITE_API_BASE_URL から DeployConfig を導出する純関数。
 * 'aws' 以外（未知値・undefined 含む）はすべて 'github-pages' 扱い（既定安全側）。
 * apiBaseUrl は aws かつ非空のときだけ採用し、それ以外（Pages 版・未設定・空文字）は null に倒す
 * （空文字は CI 変数の未定義が '' で展開される事故パターン。誤配線を防ぐ）。
 */
export const deriveDeployConfig = (
  rawTarget: string | undefined,
  rawApiBaseUrl: string | undefined,
): DeployConfig => {
  const target: DeployTarget = rawTarget === 'aws' ? 'aws' : 'github-pages'
  const isAws = target === 'aws'
  return {
    target,
    isAuthEnabled: isAws,
    transport: isAws ? 'remote' : 'local',
    walletSource: isAws ? 'server' : 'local',
    apiBaseUrl: isAws && rawApiBaseUrl ? rawApiBaseUrl : null,
  }
}

export const deployConfig: DeployConfig = deriveDeployConfig(
  import.meta.env.VITE_DEPLOY_TARGET,
  import.meta.env.VITE_API_BASE_URL,
)
