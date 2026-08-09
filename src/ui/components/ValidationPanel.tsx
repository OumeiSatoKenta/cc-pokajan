export interface ValidationPanelProps {
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  /** 誤りも警告も無いときに出す文言。 */
  readonly okMessage: string
  /** E2E と画面テストが状態を観測するための接頭辞（`roster` / `rules`）。 */
  readonly testIdPrefix: string
}

/**
 * 設定画面の検証結果。ロスターとルールで同じ形なのでまとめている。
 *
 * **誤りと警告を見た目で分ける。** 警告（どのグループにも属さないメンバー、
 * 3で割り切れない点数）は保存を妨げないので、同じ赤で並べると
 * 「直さないと保存できない」と誤解させる。
 */
export function ValidationPanel({
  errors,
  warnings,
  okMessage,
  testIdPrefix,
}: ValidationPanelProps) {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <p className="settings__ok" data-testid={`${testIdPrefix}-valid`}>
        {okMessage}
      </p>
    )
  }

  return (
    <div className="settings__validation">
      {errors.length > 0 && (
        <ul className="settings__errors" data-testid={`${testIdPrefix}-errors`}>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="settings__warnings" data-testid={`${testIdPrefix}-warnings`}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
