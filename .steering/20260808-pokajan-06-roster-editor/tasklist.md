# Step 6: ロスターエディタ + ルール設定 — タスクリスト

## フェーズ1: ルール値の検証（R6・最優先）

- [x] `src/engine/rulesValidation.ts` に `validateRules` を実装する
      （設計の検査表どおり。3の倍数は警告扱い）
- [x] 同ファイルに `canStartGame` を実装する
      （列挙に頼らず「実際に対局を作れるか」で判定する。決定9b）
- [x] `tests/engine/rulesValidation.test.ts` を作成する
      （既定値が通ること・各項目の不正値・境界値・警告と誤りの区別・
      **例外にならない `handSize: 0` / `playerCount: 0` を捕まえること**・
      ロスターとの組み合わせでしか壊れない `bonusMemberCount` を `canStartGame` が捕まえること）

## フェーズ2: 永続化の拡張

- [x] `src/storage/prefs.ts` に `roster` / `rulesOverride` を追加する
      （欠落・型違いは既定値へ倒す。既存の version 1 と後方互換を保つ）
- [x] `tests/storage/prefs.test.ts` に追加分の検証を足す
- [x] `src/storage/assets.ts` に IndexedDB の画像ストアを実装する
      （全関数が例外を投げない。`putImage` のみ成否を返す）

## フェーズ3: 純粋ロジック

- [x] `src/ui/imageResize.ts` に `centerSquareCrop` を実装する
- [x] `tests/ui/imageResize.test.ts` を作成する（横長・縦長・正方形・極端な比率）
- [x] `src/ui/rosterEditor.ts` に編集リデューサと ID 採番を実装する
- [x] `tests/ui/rosterEditor.test.ts` を作成する
      （CRUD 全アクション・ID 衝突回避・メンバーの単一所属・削除時の後始末）
- [x] `src/ui/rosterBundle.ts` に `buildBundle` / `parseBundle` を実装する
- [x] `tests/ui/rosterBundle.test.ts` を作成する
      （往復・format 判定・壊れた JSON・別形式・欠落フィールド）
- [x] `src/ui/rulesForm.ts` に文字列⇔数値の変換とフォーム定義を実装する
- [x] `tests/ui/rulesForm.test.ts` を作成する（空文字・非数値・差分の抽出）

## フェーズ4: DOM 層と画面

- [x] `src/ui/imageResize.ts` に `fileToSquareImage` を追加する（webp 非対応時は png）
- [x] `src/ui/hooks/useAssetUrls.ts` を実装する（まとめ作成と解放）
- [x] `src/ui/components/CardView.tsx` に `imageUrl` を追加し、失敗時は名前表示へ戻す
- [x] `Hand` / `TableScreen` に `imageUrlById` を通す
- [x] `src/ui/screens/RosterEditor.tsx` を作成する
- [x] `src/ui/screens/RulesSettings.tsx` を作成する
- [x] `src/ui/settings.css` を作成する（375px でも破綻しないこと）
- [x] `src/ui/appReducer.ts` に `roster` / `rules` 画面への遷移を足す
- [x] `src/ui/screens/TitleScreen.tsx` に設定への導線を足す
- [x] `src/appSettings.ts` に `resolveSettings` を実装する
      （追加タスク: 保存値とエンジンの境界を1箇所にまとめる必要があった）
- [x] `tests/ui/appSettings.test.ts` を作成する
- [x] `src/App.tsx` を配線し、ロスターとルールを永続化する

## フェーズ5: テスト

- [x] `tests/ui/appReducer.test.ts` に設定画面への遷移を足す
- [x] `tests/ui/App.test.tsx` をタイトルの導線に追随させる
- [x] `tests/e2e/roster.spec.ts` を作成する
      （編集 → 保存 → リロード後も保持・不正時は保存不可・画像アップロード・書き出し/読み込み）
- [x] `tests/e2e/rules.spec.ts` を作成する
      （点数変更が対局に反映・デフォルトに戻す・不正な上書きでも起動する）

## フェーズ6: 検証

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全て通る
- [x] `npx playwright test` が通る（47件すべて）
- [x] ブラウザで実際に確認する（ロスター編集 / 画像アップロード / ルール設定 / 375px）
- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する
- [x] `RosterEditor.tsx`（411行）から `MemberRow` / `ValidationPanel` を切り出す
      （追加タスク: 基準超過を計測で検出。`ValidationPanel` は `RulesSettings` と共用にした）
- [x] `docs/architecture.md` に保存値とエンジンの境界を追記する
- [x] `CLAUDE.md` / `README.md` の実装状況を全ステップ完了に更新する

## 実装後の振り返り

**実装完了日**: 2026-08-08

### 計画と実績の差分

追加は3件。うち**2件は実装前の確認**、1件は計測で見つかった。

| 追加項目                       | 見つかったきっかけ                                          |
| ------------------------------ | ----------------------------------------------------------- |
| `canStartGame`（決定9b）       | 実装前に不正ルール11通りを `createGame` に通して確かめた     |
| `src/appSettings.ts`           | 保存値とエンジンの境界が App に散らばりそうだった            |
| `RosterEditor.tsx` の分割      | 411行。計測して初めて気づいた                                |

### 学んだこと

1. **「例外になる値」より「例外にならない値」のほうが危険だった。**
   実装前に不正なルール11通りを `createGame` に通したところ、8通りは例外になったが
   **`handSize: 0` / `handSize: -1` / `playerCount: 0` は例外にならなかった**。
   例外になる値はフォールバックが働くが、ならない値は**起動してしまう**ので
   「配牌0枚で始まり、捨てられずに止まる対局」が成立する。
   検証を「落ちるかどうか」で設計していたら、この3つを取りこぼしていた。

2. **列挙に頼る検証は、列挙の漏れがそのまま欠陥になる。**
   `bonusMemberCount` の上限はロスターの人数に依存するため、ルール単体の検査では
   判定できない。検査項目を数え上げる方針だと、こういう「組み合わせでのみ壊れる」
   項目を必ず取りこぼす。**「実際に対局を作れるか」を条件に加える**ことで、
   列挙の網羅性に正しさを預けずに済んだ。
   逆に `canStartGame` だけでは 1. の3つを通してしまうので、両方が要る。
   **この2つは互いの穴を塞ぎ合っている。**

3. **設計に書いた検査を、実装で呼び忘れていた。**
   `validateRules` と `canStartGame` の両方を設計したのに、`resolveSettings` では
   `canStartGame` しか呼んでいなかった。`handSize: 0` のテストが落ちて発覚した。
   **設計に書いたことと実装したことは別**で、テストがその差を埋めた。
   設計→実装→テストの3点が揃って初めて機能する。

4. **DOM 依存を先に切り分けると、テストできる範囲が変わる。**
   このステップで初めて canvas / File / IndexedDB を扱ったが、
   判断（切り出し矩形・CRUD・書き出しの組み立て・文字列⇔数値）をすべて
   純粋関数へ寄せたことで、**新規コードの大半を単体テストで固定できた**。
   E2E に回したのは「実際のブラウザでしか確かめられないこと」だけに絞れている。

5. **編集の自由と保存の可否は別の概念。**
   `validateRoster` を編集リデューサに組み込むと、空のグループを作れなくなり
   「グループを1つずつ組み立てる」操作ができなくなる。
   **リデューサは検証しない**と決めたことで、途中経過を自由に作れて、
   保存ボタンだけが止まる素直な挙動になった。

### 次回への改善提案

- **プレイテストを挟む。** Step 4b の3件はすべて実プレイでしか出てこなかった。
  今回追加した設定画面も、実際に自分たちの写真を入れてみないと
  「切り出し位置が顔を切る」「1辺256pxでは粗い」といった判断はできない
- **`initialWallet` と順位倍率の調整。** Step 5 の実測で1局あたり +1,017 と
  大きくプレイヤー有利なことが分かっている。設定画面ができたので、
  実際に何局か遊んで倍率を詰められる
- **`src/engine/yaku.ts`（410行）と `deck.ts`（406行）が基準を超えたままである。**
  今回は触っていないので放置したが、次に手を入れるときに分割する
