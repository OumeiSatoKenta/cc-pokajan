# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実装可能なタスクのみを計画
- 計画段階で「実装可能なタスク」のみをリストアップ
- 「将来やるかもしれないタスク」は含めない
- 「検討中のタスク」は含めない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

### タスクが大きすぎる場合
- タスクを小さなサブタスクに分割
- 分割したサブタスクをこのファイルに追加
- サブタスクを1つずつ完了させる

---

## フェーズ1: プロジェクト基盤

- [x] Vite(react-ts) スキャフォールドをプロジェクト直下に配置
  - [x] `index.html` / `src/main.tsx` / `src/index.css` / `.gitignore` / `.oxlintrc.json` を配置
  - [x] `public/` のテンプレート付属アセットは不要なため配置しない
  - [x] `docs/` と `.steering/` が破壊されていないことを確認
  - [x] `index.html` を日本語ロケール・タイトル「ポカジャン」・インライン favicon に変更（テンプレートの `/favicon.svg` 参照を除去）

- [x] `package.json` を整備
  - [x] name を `cc-pokajan` に設定
  - [x] scripts に `test` / `test:watch` / `typecheck` / `lint:fix` / `format` / `format:check` を追加
  - [x] devDependencies に `vitest` / `prettier` を追加
  - [x] `npm install` を実行して成功を確認（57 packages / 0 vulnerabilities）

- [x] TypeScript / Vite / Vitest の設定
  - [x] `vite.config.ts` に Vitest 設定（`vitest/config` の defineConfig、`environment: 'node'`、include パターン）を統合
  - [x] `tsconfig.test.json` を新規作成し `tests/` を型検査対象にする
  - [x] `tsconfig.json` の references に `tsconfig.test.json` を追加
  - [x] `tsconfig.app.json` / `tsconfig.test.json` に `strict: true` を明示

- [x] Prettier 設定
  - [x] `.prettierrc.json` を作成
  - [x] `.prettierignore` を作成

## フェーズ2: ドメイン型とルール設定

- [x] `src/engine/types.ts` を実装
  - [x] `COLOR_IDS` と `ColorId`（配列から型を導出）
  - [x] `Card` / `Member` / `Group` / `Roster`
  - [x] `YakuKind` / `YakuCandidate` / `WinKind`
  - [x] `Phase` / `Player` / `ClaimDecision` / `GameState`
  - [x] `Action` / `GameEvent`
  - [x] `RulesConfig` / `YakuScore` / `BetConfig`（設計変更: エンジンが `config/` に依存しないよう型は types.ts に配置）

- [x] `src/config/rules.ts` を実装
  - [x] ~~`RulesConfig` / `YakuScore` / `BetConfig` 型~~（`types.ts` へ移動。エンジン層 → config 層の依存を作らないため）
  - [x] `DEFAULT_RULES` を定義（調査で判明した点数を反映）
  - [x] 未確定値（`group3.sameColor` / `startingScore`）に `TODO(要実機確認)` コメント
  - [x] 「点数は全て3の倍数」の前提をコメントで明示

- [x] `src/config/defaultRoster.ts` を実装
  - [x] 6グループ / 24メンバー（サイズ 3,3,4,4,5,5）を創作名で定義
  - [x] 各メンバーに `accent` カラーを設定
  - [x] 公式素材・実在キャラ名を含めないことを確認
  - [x] 最小構成（サイズ小さい順4グループ = 13人 = 117枚）でも `deckSize`(100) を満たすことを確認
  - [x] レビュー指摘反映: サイズ配分を 3,3,3,4,4,5（22人）に変更し、4グループ選出時の人数を 13〜16 人（原作実測 12〜16 種とほぼ一致）に調整

- [x] `tests/config/rules.test.ts` を実装（レビュー指摘によりフェーズ4から移動）
  - [x] 全役の点数が 3 で割り切れる
  - [x] `bonusPerCard` が 3 で割り切れる
  - [x] `deckSize` が配牌に足りる / 順位倍率がプレイヤー数分で降順
  - [x] 調査で判明した点数（120/840・180・300/840・480/1800・+90）が反映されている
  - [x] デフォルトロスターがデフォルトルールで検証を通過する

- [x] レビュー指摘反映: `.oxlintrc.json` に `no-restricted-imports` を追加
  - [x] `src/engine/**` と `src/config/**` から `react` / `react-dom` / `**/ui/**` の import を禁止
  - [x] 実際に違反ファイルを置いて `npm run lint` が検知することを確認

- [x] レビュー指摘反映: `src/engine/types.ts` に `YakuContext` を追加
  - [x] Step 2 の `findYaku` / `computeWaits` が受け取る局の文脈（`activeGroups` / `bonusMemberIds` / `rules`）を型として確定

## フェーズ3: シード付き乱数

- [x] `src/engine/rng.ts` を実装
  - [x] `createRng`（mulberry32）と `Rng` インターフェース（`next` / `state`）
  - [x] `shuffle`（入力非破壊の Fisher–Yates）
  - [x] `randomInt`（範囲外は `RangeError`）
  - [x] `pickSome`（部分 Fisher–Yates、範囲外は `RangeError`）

- [x] `tests/engine/rng.test.ts` を実装（21 tests PASS）
  - [x] 同一シードで乱数列が一致 / 異なるシードで不一致
  - [x] 生成値が `[0, 1)` に収まる（10,000 回試行）
  - [x] `state()` から続きを再現できる
  - [x] `shuffle` が入力非破壊・多重集合保存・シード決定的
  - [x] `randomInt` の範囲検証
  - [x] `pickSome` の件数・重複なし検証

## フェーズ4: 山札構築と配牌

- [x] `src/engine/deck.ts` を実装
  - [x] `RosterValidationError` クラス
  - [x] `validateRoster`（グループ数 / サイズ範囲 / 未知メンバー / 重複所属 / ID重複 / 最悪ケースのプール枚数）
  - [x] `cardsPerMember` / `selectGroups` / `collectMembers`
  - [x] `buildCardPool`（uid 連番付与）
  - [x] `buildDeck`（プールをシャッフルして deckSize 枚抽出）
  - [x] `selectBonusMembers`（レビュー指摘反映: **山札に実在するメンバー**から選び、死にボーナスを防ぐ）
  - [x] `deal`（山札不足時は throw）
  - [x] `setupGame`（検証 NG で `RosterValidationError`）

- [x] `tests/engine/deck.test.ts` を実装
  - [x] `validateRoster` の OK ケースと 9 種の NG ケース
  - [x] `selectGroups` の件数・重複なし・シード決定性
  - [x] `collectMembers` の解決・13〜16人レンジ・未知メンバーで throw
  - [x] `buildCardPool` の枚数・uid 一意・各メンバー各色 3 枚
  - [x] `buildDeck` の 100 枚・メンバー上限 9 枚・色上限 3 枚・所属検証・シード決定性・プール不足で throw
  - [x] `selectBonusMembers` の件数・重複なし・**山札実在メンバーからの選出**検証
  - [x] `deal` の 4×7 枚 + 壁 72 枚・合計一致・重複なし・不足時 throw
  - [x] `setupGame` をシード 0〜99 で回した不変条件テスト

## フェーズ5: UI プレースホルダ

- [x] `src/App.tsx` をプレースホルダに差し替え
  - [x] Vite テンプレートのデモ内容とアセット依存を除去
  - [x] Step 1 の状態（エンジンのみ実装済み）が分かる最小限の表示にする
  - [x] `setupGame` の結果（今局グループ・登場人数・ボーナス・山札残り・初期手札）を表示し、ブラウザ上でもエンジンが動くことを確認できるようにする
  - [x] `src/index.css` / `src/App.css` をプレースホルダ用に整理（ライト/ダーク両対応）

## フェーズ6: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `npm test`（76 tests / 3 files PASS）
- [x] リントエラーがないことを確認
  - [x] `npm run lint`（exit 0）
- [x] 型エラーがないことを確認
  - [x] `npm run typecheck`（exit 0）
- [x] ビルドが成功することを確認
  - [x] `npm run build`（197.87 kB / gzip 63.00 kB）
- [x] フォーマットが適用されていることを確認
  - [x] `npm run format`
- [x] エンジン層が React に依存していないことを確認
  - [x] `.oxlintrc.json` の `no-restricted-imports` により `npm run lint` で自動検知される（手動 grep ではなく恒久的なゲートにした）

## フェーズ7: コードレビュー指摘の反映

3軸コードレビュー（構造 / 欠陥・セキュリティ / API準拠）と実装検証の指摘に対応する。

- [x] **[必須]** `validateRoster` の構造的型ガードを追加
  - [x] `members` / `groups` が配列でない、`memberIds` が欠落・非文字列、`id` が非文字列のケースで `TypeError` を投げずエラーとして返す
  - [x] `setupGame` が壊れた入力でも契約どおり `RosterValidationError` を投げることを保証
  - [x] 壊れた入力 7 ケースのテストを追加

- [x] **[推奨]** `validateRoster`（84行）を検証観点ごとの小関数に分割
  - [x] `validateStructure` / `validateMemberUniqueness` / `validateGroupUniqueness` / `validateGroupComposition` / `validatePoolCapacity` / `collectOrphanWarnings`

- [x] **[推奨]** 最悪ケース検証を本当に担保するテストへ修正
  - [x] `deckSize: 200`（最良ケースすら下回る値）では偽陽性になるため `deckSize: 130`（最悪117枚と最良144枚の間）に変更
  - [x] 最悪ケースちょうど（117枚）で通過することも検証

- [x] **[推奨]** 孤立メンバーの検出（`RosterValidationResult.warnings` を追加。エラーにはせず警告として報告）
- [x] **[推奨]** `randomInt` に整数チェックを追加（非整数はサイレントな分布の偏りを生むため）
- [x] **[推奨]** `.oxlintrc.json` に `src/engine/**` → `config` の import 禁止を追加し、`patterns` をオブジェクト形式に統一
- [x] **[推奨]** `App.tsx` の `setupGame` 呼び出しを `useDemoSetup`（`useMemo`）に切り出し（StrictMode の二重実行と再レンダー時の再計算を防ぐ）
- [x] **[推奨]** `GameSetup` の配列を `readonly` に統一
- [x] **[提案]** `DEFAULT_RULES` を型注釈から `satisfies RulesConfig` に変更（リテラル型を保持）
- [x] **[提案]** 境界値テストを追加（プール枚数 == `deckSize` / 配牌ちょうどで壁が空 / ボーナス要求数 == 山札の登場メンバー数）
- [x] **[提案]** `RosterValidationError` の `name` / `message` を直接検証するテストを追加
- [x] **[提案]** 複数の不正を同時に含むロスターで全エラーが収集されることを検証
- [x] **[提案]** 「3の倍数」の前提が `playerCount` と結びついていることを明示するテストを追加
- [x] ~~**[推奨]** `tsconfig.test.json` に `tsconfig.app.json` への `references` を追加~~（実装方針変更により不要: Vite テンプレートは `composite: true` を使わない `noEmit` 構成のため、リーフ間で `references` を張ると `tsc -b` が TS6306 / TS6310 で失敗する。参照なしでも `tests/` が型検査されることを、意図的な型エラーを投入して実地確認した上で、理由を `tsconfig.test.json` にコメントとして記録した）
- [x] `RulesConfig` 自体の検証欠如など、Step 6 で必要になる論点を `design.md` へ申し送り

## フェーズ8: プレースホルダ画面の実機確認

- [x] `npm run dev` / `npm run preview` でサーバが起動し HTTP 200 を返すことを確認
- [x] ~~ブラウザ拡張でスクリーンショットを取得して目視確認~~（依存関係の変更により実行不可: Chrome 拡張のスクリプト注入が 4 回連続でタイムアウトし、ページ内容を取得できなかった。代替として下記のレンダリングテストで自動検証した）
- [x] `tests/ui/App.test.tsx` を追加し、`renderToStaticMarkup` でレンダリングを自動検証
  - [x] 例外なくレンダリングできる
  - [x] Vite テンプレートのデモ内容を含まない
  - [x] `setupGame` の結果（山札残り 72 枚）と手札 7 枚が描画される
  - [x] `vite.config.ts` の include を `*.test.{ts,tsx}` に拡張、`tsconfig.test.json` に `jsx` / `DOM` / `vite/client` / `allowArbitraryExtensions` を追加

## フェーズ9: ドキュメント更新

- [x] `README.md` を作成（プロジェクト概要・セットアップ手順・スクリプト一覧・現在の実装状況）
- [x] レビュー指摘を `requirements.md` / `design.md` に反映
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-08-07

### 最終的な品質ゲート

| コマンド               | 結果                                       |
| ---------------------- | ------------------------------------------ |
| `npm test`             | ✅ 97 tests / 4 files PASS                 |
| `npm run typecheck`    | ✅ 0 errors                                |
| `npm run lint`         | ✅ 0 errors                                |
| `npm run build`        | ✅ 成功（199.12 kB / gzip 63.37 kB）       |
| `npm run format:check` | ✅ All matched files use Prettier style    |

### 計画と実績の差分

**計画と異なった点**:

- **リンターが ESLint ではなく oxlint になった**。Vite 8 の `react-ts` テンプレートは既定リンターが oxlint に変更されており、テンプレート標準に従う方が依存が少なく高速。`npm run lint` のゲートとしては同等に機能する。
- **`framer-motion` と `@playwright/test` の追加を Step 4 へ繰り延べた**。Step 1 は UI を実装しないため未使用依存になり、Playwright はブラウザバイナリのダウンロードも完全に無駄になる。実際に使う Step で追加する。
- **`RulesConfig` の型を `config/rules.ts` ではなく `engine/types.ts` に置いた**。当初案のままだと `deck.ts` が `RulesConfig` を必要とするため engine → config の逆依存が生まれる。型だけ `types.ts` に引き上げ、config には値だけを残すことで依存を一方向に保った。
- **デフォルトロスターを 24 人（3,3,4,4,5,5）から 22 人（3,3,3,4,4,5）に変更**。当初の配分だと 4 グループ選出時の人数が 14〜18 人になり、原作の実測レンジ（12〜16 種）から外れていた。13〜16 人に収まる配分へ調整した。
- **`selectBonusMembers` の引数を `members` から `deck` に変更**。ドキュメントレビューの指摘で、プールから 100 枚を抜き出す際にあるメンバーの 9 枚すべてが山札外に落ちると、そのボーナスが一度も引けない「死にボーナス」になることが判明した。山札に実在するメンバーからのみ選ぶよう仕様を変更した。
- **`tsconfig.test.json` への `references` は採用しなかった**。API 準拠レビューでは TypeScript 公式ガイダンスに沿って追加を推奨されたが、実際に入れると `tsc -b` が TS6306 / TS6310 で失敗した。Vite テンプレートが `composite: true` を使わない `noEmit` 構成であることが原因。テストにわざと型エラーを入れて `tsc -b` が検知することを確認し、参照なしで問題ないと判断した。

**新たに必要になったタスク**:

- **`validateRoster` の構造的型ガード**（欠陥レビューで [必須] 判定）。docstring では「信頼できない入力の検証点」と謳いながら、`members` が配列でない・`memberIds` が欠落しているといった壊れた JSON に対しては素の `TypeError` を投げてクラッシュしていた。Step 6 の JSON インポートで確実に踏む欠陥だったため、構造検証を先頭に追加した。
- **`validateRoster` の関数分割**。上記の修正で 84 行からさらに伸びるため、検証観点ごとの小関数に分割した。
- **`tests/ui/App.test.tsx` の追加**。ブラウザ拡張でのスクリーンショット取得が繰り返しタイムアウトしたため、`renderToStaticMarkup` による自動検証に切り替えた。結果的に手動確認より回帰検知力が高い形になった。
- **`RosterValidationResult.warnings` の追加**。孤立メンバー（どのグループにも属さない）はエラーにすると「控えキャラを置いておく」使い方を潰してしまうため、警告として報告する形にした。

### 学んだこと

**技術的な学び**:

- **`tsc -b` のプロジェクト参照は `composite: true` の有無で挙動が変わる**。公式ガイダンスに従って `references` を足すと、`noEmit` 構成では逆にビルドが壊れる。ドキュメント上の推奨をそのまま適用せず、実際にゲートを回して確かめる必要があった。
- **「テストが通ること」と「テストが不変条件を担保していること」は別**。最悪ケース検証のテストは `deckSize: 200` を使っていたが、これはロスター全体の合計枚数（198枚）すら下回る値で、実装が「合計枚数を見る」バグに置き換わっても通ってしまう偽陽性だった。境界値は「正しい実装だけが通り、素朴な誤実装は落ちる」値を選ぶ必要がある。
- **アーキテクチャ制約は lint ルールにして初めて守られる**。「エンジン層は React に依存しない」を手動 grep で確認していたが、`no-restricted-imports` に落とし込むことで恒久的なゲートになった。実際に違反ファイルを置いて検知されることまで確認した。
- **シード付き乱数を最初に決めたことの効果が大きい**。`setupGame` をシード 0〜99 で回す不変条件テストが書けたのは、エンジンが `Math.random()` を一切使わない設計にしたおかげ。

**プロセス上の改善点**:

- **実装前のドキュメントレビューが効いた**。「死にボーナス」問題は、コードを書く前に設計文書のレビューで発見できた。実装後に気づいていたら `selectBonusMembers` のシグネチャ変更とテスト書き直しが発生していた。
- **3軸の並列レビューで指摘の性質が綺麗に分かれた**。構造レビューは関数長とレイヤ依存、欠陥レビューは型ガード欠如と偽陽性テスト、API準拠レビューは設定ファイルの正しさと、重複の少ない指摘が得られた。
- **tasklist をリアルタイムに更新したことで、レビュー指摘の反映漏れが起きなかった**。実装検証エージェントも「フェーズ7が未完了」を正しく検出していた。

### 次回への改善提案

- **Step 2 着手前に `reduce` への `rules` の渡し方を決めておく**。`YakuContext` は `rules` を内包するが `GameState` は持たない設計になっており、Step 3 で呼び出し規約が分かれる。`design.md` の「Step 6 へ申し送る設計課題」に記録済み。
- **`RulesConfig` の検証関数を Step 6 の最初に作る**。`handSize` が負値だと `deal` の `slice` が負インデックスを末尾オフセットとして解釈し、エラーにならず不正な配牌を返す。ルール設定画面を作る前に `validateRules` を用意すること。
- **ブラウザ経由の確認手段を Step 4 で確立する**。今回は Chrome 拡張が使えず `renderToStaticMarkup` で代替したが、対局 UI ではクリック操作やアニメーションの確認が必要になる。Step 4 で Playwright を入れるときに、この用途で使える形にしておく。
- **境界値テストは「素朴な誤実装が落ちるか」を基準に値を選ぶ**。今回の `deckSize: 130` のように、正しい実装だけが通る値を意識的に選定する。
