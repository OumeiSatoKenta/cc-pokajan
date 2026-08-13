/**
 * ビルド後の防波堤: 初期ロードされる chunk に aws-amplify / cognito が漏れていないことを検査する。
 *
 * AuthGate は aws-amplify を lazy import（`lazy(() => import('./AuthProvider'))`）で隔離しており、
 * Pages 版は実行時に読み込まない。だがこの隔離は「lazy のまま」に依存しており、うっかり静的 import へ
 * 変えても lint/typecheck/unit test は落ちない（unit test は vi.mock で実 import 経路を迂回している）。
 * その最悪の回帰（Pages が aws-amplify を eager 読み込み＝本番に載る）を **build ゲート**で機械的に止める。
 *
 * index.html が eager に読む JS（entry <script> と <link rel="modulepreload">）だけを対象にする。
 * lazy chunk は index.html に現れないため、正しく隔離されていれば検査対象に入らない。
 * postbuild で自動実行される（`npm run build` を叩く deploy.yml / deploy-aws.yml の両方が通る）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const FORBIDDEN = /amplify|cognito/i

const html = readFileSync(join(DIST, 'index.html'), 'utf8')

// base は target により /cc-pokajan/assets/... か /assets/... で変わるため、/assets/ 以降だけを取り出す。
const refs = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+\.js)"/g)].map((m) => m[1])

if (refs.length === 0) {
  console.error(
    'check-bundle-isolation: index.html に entry chunk が見つかりません。ビルド結果を確認してください。',
  )
  process.exit(1)
}

const leaks = []
for (const ref of refs) {
  const rel = ref.slice(ref.indexOf('/assets/') + 1) // "assets/xxx.js"
  const content = readFileSync(join(DIST, rel), 'utf8')
  if (FORBIDDEN.test(content)) leaks.push(rel)
}

if (leaks.length > 0) {
  console.error(
    `check-bundle-isolation: 初期ロードされる chunk に aws-amplify/cognito が漏れています: ${leaks.join(', ')}`,
  )
  console.error(
    'AuthGate の lazy import（./AuthProvider）が静的 import に変わっていないか確認してください。',
  )
  process.exit(1)
}

console.log(
  `check-bundle-isolation: OK（初期ロード ${refs.length} chunk に amplify/cognito 参照なし）`,
)
