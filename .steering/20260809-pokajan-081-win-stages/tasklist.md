# Step 8-1: 和了演出の作り込み — タスクリスト

## フェーズ1: 土台（鍵と設定）

- [x] `src/config/presentation.ts` を新規作成する
      （`WinTiming` / `WIN_TIMING` / `NO_WIN_TIMING` / `isBigWin`）
- [x] `src/ui/hooks/loopReducer.ts` に `winKey` を追加し、
      `CONFIRM_WIN` → `DISMISS_WIN`（鍵つき）に改名する
- [x] `src/ui/hooks/useGameLoop.ts` の `confirmWin` → `dismissWin` に追随する
- [x] `tests/config/presentation.test.ts` を新規作成する（`isBigWin`）
- [x] `tests/ui/winGate.test.ts` を改名に追随させ、
      **鍵違いのディスパッチが何も落とさない**検査を追加する

## フェーズ2: 段の分割

- [x] `src/ui/components/WinCutIn.tsx` を新規作成する
- [x] `src/ui/components/WinResult.tsx` を新規作成する
- [x] `src/ui/components/WinOverlay.tsx` を段の状態機械に絞る
- [x] `src/ui/win.css` を作り、`table.css` から `.win*` を移す
      （`.overlay*` は残す）
- [x] `src/ui/screens/TableScreen.tsx` を新しい props と
      `key={winKey(win)}` と `win.css` の import に合わせる

## フェーズ3: 単体テスト

- [x] `tests/ui/winOverlay.test.tsx` を初期段の検査だけに絞る
- [x] `tests/ui/winCutIn.test.tsx` を新規作成する
- [x] `tests/ui/winResult.test.tsx` を新規作成する（7-5 の既存検査を移設）
- [x] 追加: `tests/helpers/winPresentation.ts` を作り、3ファイルの土台を共有する

## フェーズ4: E2E

- [x] `tests/e2e/helpers/table.ts` の `confirmWinIfAny` → `dismissWinIfAny`
- [x] `tests/e2e/winGate.spec.ts` を書き換える
      - 確認を押さずに自動で閉じること
      - 閉じるまで**山札**と**自分の河**が動かないこと
      - クリック1回では閉じず `data-stage` が `cutin` → `result` へ進むこと
      - 同色役の大物手（単体テストで押さえるため E2E では扱わない）
- [x] 追加: **人間が和了する経路**のテストを足す
      （CPU の和了では人間の時計が動いておらず、持ち時間の停止を検査できなかった）

## フェーズ5: 検証

- [x] `wc -l` で 400 行超過がないか測る
- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
- [x] `npx playwright test`
- [x] **新しい回帰テストをわざと壊して落ちることを確かめる**（design.md の表の5件）
- [x] ブラウザで確認する（Playwright のスクリーンショット / 通常役・大物手・375px）

## 実装後の振り返り

**実装完了日**: 2026-08-09

**規模**: 716 テスト / 34 ファイル（+18）、E2E 70件（+3）。
`WinOverlay` 164行 / `WinCutIn` 76行 / `WinResult` 125行 /
`win.css` 230行 / `table.css` 381→267行 — すべて基準内。

### 計画と実績の差分

| 項目 | 計画 | 実際 | 理由 |
| ---- | ---- | ---- | ---- |
| `App.tsx` / `appOptions.ts` の修正 | 演出の長さを `fast` から選ぶために触る | **触らなかった** | `TableScreen` が既に `fast` を受け取っていた。渡す先を1つ増やすだけで済んだ |
| 持ち時間の停止の E2E | CPU の和了で観測する | **人間の和了で観測する** | 下記1 |
| `WinOverlay` の `key` の検査 | 連続和了の E2E | **`winKey` の一意性の単体テスト** | 下記4 |
| `.win__kind` の色 | そのまま移設 | **`var(--fg)` → `var(--text)` に修正** | `--fg` は存在しない変数だった（7-5 から効いていなかった） |

追加タスクは1件（人間が和了する経路の E2E）。

### 学んだこと

1. **「壊して落ちることを確かめる」で、テストが何も見ていないことが分かった。**
   持ち時間の停止を外しても E2E が通ってしまった。調べると
   `decideTimeout` は `selfDeclare` で**宣言権者が人間のときだけ**時計を回すため、
   **CPU が和了した局面では人間の時計はそもそも動いていない**。
   つまり「持ち時間が止まっている」ことを検査したつもりで、
   最初から動いていないものを見ていた。
   人間が `declare-button` を押して和了する経路を足したところ、
   壊すと `selfDeclare` → `discard` で落ちるようになった。

   7-5 の偽陽性（`test.use({ reducedMotion })` が届かない）と同じ形が2回続いた。
   **どちらも「実装を壊しても落ちなかった」ことでしか気づけなかった。**

2. **停止の検査は「観測できる量」を先に決めてから書く。**
   7-4 は持ち時間の停止をタイマーの**表示文字**で見ていたが、`withTurnMs` は
   `minMs` も一緒に下げるため、短い `turnMs` では表示が変わらない（下限に張り付く）。
   今回は「山札の残り / 自分の河の枚数 / フェーズ」を1つの指紋にまとめ、
   **何が動いたら失敗なのか**を先に決めた。落ちたときの差分がそのまま原因を指す
   （`68枚/0/selfDeclare` → `68枚/0/discard`）。

3. **二重ディスパッチは `stopPropagation` ではなくアクションの鍵で塞ぐ。**
   オーバーレイ全体をクリックで進めるため、パネル内のボタンの click は
   必ず泡立つ。`stopPropagation` は「今の DOM 構造ではたまたま漏れない」形の正しさで、
   構造を変えた瞬間に静かに壊れる。`DISMISS_WIN` に鍵を持たせると
   **純粋関数のテストで固定できる**（DOM の泡立ちを再現しなくてよい）。
   しかもその鍵が React の `key` としてもそのまま使えた。

4. **押さえられないものは「押さえた」と書かない。**
   `WinOverlay` の `key` は、今の実装では E2E で踏めない。
   `reduce` は1回につき最大1つしか `Declared` を出さない
   （`resolveClaims` は勝者を1人に絞る）ため、`pendingWins` に2件同時に積まれない。
   1件ずつなら演出は間で必ずアンマウントされ、段は自然に初期化される。
   検証できるのは「鍵が和了ごとに異なること」までなので、design.md にそう書いた。

5. **`setState` の更新関数の中で副作用を呼ばない。**
   最初 `setStage((cur) => { if (cur === 'cutin') return 'result'; dismiss(); return cur })`
   と書いた。StrictMode の二重実行で閉じる処理が2回走る。
   `stage` を直接読む形に直した。**鍵の照合があるので実害は出ないが、
   実害が出ないことを理由に純粋性を崩すと、次に鍵の無い場所で同じことを書く。**

6. **`AnimatePresence mode="wait"` は属性より中身が遅れる。**
   `data-stage` は状態と同時に変わるが、前の段の退場を待ってから DOM が
   差し替わるため、属性を見てすぐ `count()`（再試行しない）を呼ぶと 0 を拾う。
   実際に一度落とした。**待つべきは属性ではなく中身。**

### 検証の記録（わざと壊して落ちることの確認）

| 壊し方 | 結果 |
| ---- | ---- |
| `DISMISS_WIN` の鍵の照合を外す | ✅ 単体1件が落ちた |
| `isBigWin` を常に `true` にする | ✅ 単体4件が落ちた |
| 自動クローズのタイマーを外す | ✅ E2E が落ちた（22.5秒・明示メッセージ） |
| 自動進行の停止を外す | ✅ E2E が落ちた（`61枚/1/claimWindow` → `59枚/1/draw`） |
| 持ち時間の停止を外す | ✅ E2E が落ちた（`selfDeclare` → `discard`） |

「自動で閉じる」の検査は最初、壊すと**3分のテストタイムアウト**で落ちていた。
落ちること自体は正しいが、メッセージが `waitForTimeout が遅い` という的外れなものになる。
観測ループに自前の期限を持たせ、22.5秒で
「和了演出が自動で閉じませんでした」と落ちるようにした。

### 目視の記録

Playwright のスクリーンショットで確認（Chrome 拡張のスクリーンショットが
`Script injection timed out` で繰り返し失敗したため、既存の E2E 基盤に切り替えた）。

- 通常役: カットイン（アバターの頭文字・席名・役名・ロン）→ 結果（絵札3枚・+120・順位表）
- 大物手: 金の輪郭・放射状の光・「大物手」バッジ。
  **同色役はブラウザ経路では出にくいため、`isBigWin` を一時的に常時 true にして
  見た目だけを確認し、すぐ戻した**（判定は単体テストで押さえてある）
- 375px: はみ出しなし・横スクロールなし

### 積み残し（意図的）

- `src/ui/board.css` 406行 / `src/engine/yaku.ts` 410行 / `deck.ts` 406行 は基準超過のまま
- 空の河が `min-height` を占める（7-2 から継続）
- 精算バランス調整（ユーザーが保留と明言）

### 次回への改善提案

- **停止・待機の検査を書くときは、まず「壊したら何が動くか」を1つの値にする。**
  観測量を決めずに書くと、今回のように何も動かない局面を検査してしまう
- Step 8-2（残り枚数）へ。`table.css` は 267行に戻ったので、
  待ち一覧を足す余地ができた（計画どおり）
