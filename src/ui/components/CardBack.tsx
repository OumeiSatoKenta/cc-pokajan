export interface CardBackProps {
  /** 描く枚数。 */
  readonly count: number
  /** 並べる向き。左右の席は縦に積む（Step 7-2 で使う）。 */
  readonly orientation?: 'horizontal' | 'vertical'
  readonly label?: string
}

/**
 * 伏せた手札。
 *
 * **`Card` を受け取らない。** 他家の手札は `GameState.players[].hand` として
 * UI から参照できるため、伏せ札を描くためにカードを渡す設計にすると
 * 「渡すが描かない」という約束だけで中身を守ることになり、
 * 条件分岐の取り違え1つで名前や画像が漏れる。
 *
 * 枚数だけを受け取れば**漏らそうとしても漏らせない**。
 * CPU に `AiView` しか渡さないのと同じ考え方で、正しさを実装の注意深さではなく
 * 型の到達可能性で担保する。
 */
export function CardBack({ count, orientation = 'horizontal', label }: CardBackProps) {
  // 負値や小数が来ても描画を壊さない（枚数は上流で保証されるが、ここでも潰す）。
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0

  return (
    <ul
      className={`card-backs card-backs--${orientation}`}
      data-testid="card-backs"
      data-count={safeCount}
      aria-label={label ?? `伏せ札 ${safeCount}枚`}
    >
      {Array.from({ length: safeCount }, (_, index) => (
        <li key={index} className="card card--small card--back" data-testid="card-back" />
      ))}
    </ul>
  )
}
