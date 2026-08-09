import { useEffect, useMemo, useReducer, useState } from 'react'

import { readOptions, withTurnMs } from './appOptions'
import { resolveSettings } from './appSettings'
import { DEFAULT_ROSTER } from './config/defaultRoster'
import { DEFAULT_RULES } from './config/rules'
import type { Roster, RulesConfig } from './engine/types'
import { loadPrefs, savePrefs } from './storage/prefs'
import { createAppReducer, createInitialAppState } from './ui/appReducer'
import { parseAvatars, type AvatarMap } from './ui/avatars'
import { diffFromDefaults } from './ui/rulesForm'
import { ErrorBoundary } from './ui/components/ErrorBoundary'
import { BetScreen } from './ui/screens/BetScreen'
import { ResultScreen } from './ui/screens/ResultScreen'
import { RosterEditor } from './ui/screens/RosterEditor'
import { PlayerSettings } from './ui/screens/PlayerSettings'
import { RulesSettings } from './ui/screens/RulesSettings'
import { TableScreen } from './ui/screens/TableScreen'
import { TitleScreen } from './ui/screens/TitleScreen'
import './App.css'

/**
 * 画面のステートマシンと永続化の配線。
 *
 * **対局を生成できるのはここだけ。** BET を払うことと対局を始めることが
 * 不可分なので、`TableScreen` 側にやり直しの導線を持たせていない。
 */
export default function App() {
  const options = useMemo(readOptions, [])
  const defaultRules = useMemo(() => withTurnMs(DEFAULT_RULES, options.turnMs), [options.turnMs])

  // 保存値は検証を通ったときだけ採用する。通らなければ既定値で必ず起動する。
  const initial = useMemo(() => {
    const prefs = loadPrefs({ wallet: defaultRules.bet.initialWallet, seed: options.seed })
    const settings = resolveSettings(prefs, { roster: DEFAULT_ROSTER, rules: defaultRules })

    return { prefs, settings }
  }, [defaultRules, options.seed])

  const [roster, setRoster] = useState<Roster>(initial.settings.roster)
  const [rules, setRules] = useState<RulesConfig>(initial.settings.rules)
  /*
   * アバターは `resolveSettings` に通さない。**画像は対局の成否に関わらない**ので、
   * 壊れていてもロスターやルールを既定値へ倒す理由にならない。
   * 壊れた項目だけを落とす `parseAvatars` に任せる。
   */
  const [avatars, setAvatars] = useState<AvatarMap>(() => parseAvatars(initial.prefs.avatars))

  const appReducer = useMemo(() => createAppReducer(rules), [rules])
  const [state, dispatch] = useReducer(appReducer, initial, ({ prefs }) =>
    createInitialAppState({
      wallet: prefs.wallet,
      // URL 指定は保存値より優先する。E2E が同じ配牌を再現できるようにするため。
      seed: options.seedFromUrl ? options.seed : prefs.lastSeed,
    }),
  )

  /*
   * 所持コイン・シード・ロスター・ルールの差分だけを保存する。
   * 精算額や順位は保存しない（保存すると localStorage を書き換えるだけで
   * コインを増やせる経路が増える）。
   */
  useEffect(() => {
    savePrefs({
      version: 1,
      wallet: state.wallet,
      lastSeed: state.seed,
      roster: roster === DEFAULT_ROSTER ? null : roster,
      avatars,
      rulesOverride: diffFromDefaults(rules, defaultRules),
    })
  }, [state.wallet, state.seed, roster, avatars, rules, defaultRules])

  return (
    // data-screen は横向きの対局画面でだけ app タイトル見出しを畳むために使う（landscape.css）。
    <div className="app" data-screen={state.screen}>
      <header className="app__header">
        <h1 className="app__title">ポカジャン</h1>
      </header>

      <ErrorBoundary>
        {/* 既定値に倒したことはタイトルでだけ知らせる。全画面に出すと邪魔になる。 */}
        {initial.settings.fellBack && state.screen === 'title' && (
          <p className="app__notice" data-testid="settings-fallback">
            保存された設定では対局を始められなかったため、既定の設定で起動しました。
          </p>
        )}

        {state.screen === 'title' && (
          <TitleScreen
            wallet={state.wallet}
            onPlay={() => dispatch({ type: 'GO_BET' })}
            onOpenRoster={() => dispatch({ type: 'GO_SETTINGS', screen: 'roster' })}
            onOpenRules={() => dispatch({ type: 'GO_SETTINGS', screen: 'rules' })}
            onOpenPlayers={() => dispatch({ type: 'GO_SETTINGS', screen: 'players' })}
          />
        )}

        {state.screen === 'bet' && (
          <BetScreen
            wallet={state.wallet}
            rules={rules}
            onPlaceBet={(amount) => dispatch({ type: 'PLACE_BET', amount })}
            onTopUp={() => dispatch({ type: 'TOP_UP' })}
            onBack={() => dispatch({ type: 'GO_TITLE' })}
          />
        )}

        {state.screen === 'table' && state.bet !== null && (
          <TableScreen
            // 対局ごとに作り直す。フック側にやり直しの仕組みを持たせない。
            key={state.seed}
            roster={roster}
            rules={rules}
            seed={state.seed}
            // PLACE_BET が screen:'table' と同時に bet を設定するので、ここでは非 null。
            bet={state.bet}
            avatars={avatars}
            fast={options.fast}
            onSettle={(result) => dispatch({ type: 'FINISH', ...result })}
          />
        )}

        {state.screen === 'result' && state.outcome !== null && (
          <ResultScreen
            outcome={state.outcome}
            playerCount={rules.playerCount}
            onPlayAgain={() => dispatch({ type: 'GO_BET' })}
            onBackToTitle={() => dispatch({ type: 'GO_TITLE' })}
          />
        )}

        {state.screen === 'roster' && (
          <RosterEditor
            roster={roster}
            rules={rules}
            defaultRoster={DEFAULT_ROSTER}
            avatars={avatars}
            onSave={(next, nextAvatars) => {
              setRoster(next)
              // 読み込み（import）でアバターも入れ替わる。
              setAvatars(nextAvatars)
              dispatch({ type: 'GO_TITLE' })
            }}
            onBack={() => dispatch({ type: 'GO_TITLE' })}
          />
        )}

        {state.screen === 'players' && (
          <PlayerSettings
            avatars={avatars}
            roster={roster}
            rules={rules}
            onSave={(next) => {
              setAvatars(next)
              dispatch({ type: 'GO_TITLE' })
            }}
            onBack={() => dispatch({ type: 'GO_TITLE' })}
          />
        )}

        {state.screen === 'rules' && (
          <RulesSettings
            rules={rules}
            defaultRules={defaultRules}
            roster={roster}
            onSave={(next) => {
              setRules(next)
              dispatch({ type: 'GO_TITLE' })
            }}
            onBack={() => dispatch({ type: 'GO_TITLE' })}
          />
        )}
      </ErrorBoundary>
    </div>
  )
}
