import { useState } from 'react'

import { canStartGame, validateRules } from '../../engine/rulesValidation'
import { ValidationPanel } from '../components/ValidationPanel'
import type { Roster, RulesConfig } from '../../engine/types'
import {
  CASINO_FIELDS,
  GAME_FIELDS,
  SCORE_FIELDS,
  applyFormValues,
  toFormValues,
  type RuleField,
} from '../rulesForm'
import '../settings.css'

export interface RulesSettingsProps {
  readonly rules: RulesConfig
  readonly defaultRules: RulesConfig
  readonly roster: Roster
  readonly onSave: (rules: RulesConfig) => void
  readonly onBack: () => void
}

/**
 * ルール設定画面。
 *
 * 編集中の値は**文字列**で持つ。数値の state にすると入力を消した状態を
 * 表現できず、`0` に化けてしまう。確定時にまとめて数値へ変換して検証する。
 *
 * 保存前に `validateRules` と `canStartGame` の両方を通す。前者は理由を出すため、
 * 後者は**列挙し切れないルールとロスターの組み合わせ**を捕まえるため。
 */
export function RulesSettings({ rules, defaultRules, roster, onSave, onBack }: RulesSettingsProps) {
  const [values, setValues] = useState(() => toFormValues(rules))

  const applied = applyFormValues(rules, values)
  const validation = validateRules(applied.rules)
  const startable = validation.ok && canStartGame(roster, applied.rules)

  const errors = [
    ...applied.invalid.map((label) => `${label} に数値を入力してください`),
    ...validation.errors,
    ...(validation.ok && !startable
      ? ['この設定では対局を開始できません（ロスターの構成と噛み合っていません）']
      : []),
  ]

  return (
    <main className="settings" data-testid="rules-settings">
      <header className="settings__head">
        <h2 className="settings__title">ルール設定</h2>
        <button type="button" className="button button--ghost" onClick={onBack}>
          戻る
        </button>
      </header>

      <ValidationPanel
        errors={errors}
        warnings={validation.warnings}
        okMessage="この設定で対局できます"
        testIdPrefix="rules"
      />

      <FieldGroup title="点数表" fields={SCORE_FIELDS} values={values} onChange={setValues} />
      <FieldGroup title="対局" fields={GAME_FIELDS} values={values} onChange={setValues} />
      <FieldGroup title="カジノ" fields={CASINO_FIELDS} values={values} onChange={setValues} />

      <div className="settings__actions">
        <button
          type="button"
          className="button"
          onClick={() => setValues(toFormValues(defaultRules))}
          data-testid="reset-rules"
        >
          デフォルトに戻す
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onSave(applied.rules)}
          disabled={errors.length > 0}
          data-testid="save-rules"
        >
          保存する
        </button>
      </div>
    </main>
  )
}

interface FieldGroupProps {
  readonly title: string
  readonly fields: readonly RuleField[]
  readonly values: Readonly<Record<string, string>>
  readonly onChange: (next: Record<string, string>) => void
}

function FieldGroup({ title, fields, values, onChange }: FieldGroupProps) {
  return (
    <section className="settings__group">
      <h3 className="settings__group-title">{title}</h3>
      <ul className="settings__fields">
        {fields.map((field) => (
          <li key={field.key} className="settings__field">
            <label className="settings__label" htmlFor={field.key}>
              {field.label}
              {/* 実機で確認が取れていない値であることを画面にも出す。 */}
              {field.note !== undefined && (
                <span className="settings__note" title={field.note}>
                  ※{field.note}
                </span>
              )}
            </label>
            <input
              id={field.key}
              className="settings__input settings__number"
              inputMode="numeric"
              value={values[field.key] ?? ''}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
              data-testid={`rule-${field.key}`}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
