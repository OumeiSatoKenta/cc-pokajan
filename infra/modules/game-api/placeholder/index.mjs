// 未デプロイ時のダミーハンドラ。terraform が Lambda を作る初回だけ使われ、
// CI（deploy-aws.yml の update-function-code）が本体（backend の esbuild バンドル）へ差し替える。
// aws_lambda_function の lifecycle.ignore_changes がこの置換を以後の apply で戻さない。
export const handler = async () => ({
  statusCode: 503,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'game-api is not deployed yet' }),
})
