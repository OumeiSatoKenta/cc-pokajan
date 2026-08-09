# Step 7-3: プレイヤーアバター — タスクリスト

## フェーズ1: 型と純粋ロジック

- [x] `src/ui/avatars.ts` を新規作成する（`AvatarMap` / `parseAvatars` / `avatarImageIds` / `setAvatar`）
- [x] `tests/ui/avatars.test.ts` を新規作成する（壊れた入力・部分的な破損・往復）
- [x] `src/ui/rosterEditor.ts` の `usedImageIds` を2引数にする
      （**3つの呼び出しが型エラーになることを確認する**）
- [x] `tests/ui/rosterEditor.test.ts` を2引数化に追随させ、アバター分が含まれる検査を足す

## フェーズ2: 永続化

- [x] `src/storage/prefs.ts` に `avatars: unknown` を足す
- [x] `tests/storage/prefs.test.ts` に `avatars` の往復と欠落時の既定値を足す
- [x] `src/ui/rosterBundle.ts` に `avatars` を足す（`BUNDLE_VERSION` は 1 のまま）
- [x] `tests/ui/rosterBundle.test.ts` に往復と**旧形式（`avatars` なし）の互換**を足す

## フェーズ3: 画面遷移

- [x] `src/ui/appReducer.ts` の `Screen` と `GO_SETTINGS` に `'players'` を足す
- [x] `tests/ui/appReducer.test.ts` に遷移と「対局中は開けない」検査を足す
- [x] `src/ui/hooks/useGameLoop.ts` から `DEFAULT_HUMAN_SEAT` を公開する
- [x] `src/ui/screens/TitleScreen.tsx` に導線を足す

## フェーズ4: 設定画面

- [x] `src/ui/hooks/useAvatarUrls.ts` を新規作成する
- [x] `src/ui/screens/PlayerSettings.tsx` を新規作成する
- [x] `src/ui/settings.css` に `.avatars__*` を足す
- [x] `src/ui/screens/RosterEditor.tsx` にアバターを渡し、保存・書き出し・採番に含める

## フェーズ5: 卓への表示

- [x] `src/ui/components/PlayerSeat.tsx` に `avatarUrl` を足す
- [x] `src/ui/screens/TableScreen.tsx` でアバターを配線し、自席にも出す
- [x] `src/ui/board.css` にアバターの見た目を足す
- [x] `src/App.tsx` で状態と永続化を配線する
- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する

## フェーズ6: テスト

- [x] `tests/ui/tableLayout.test.tsx` にアバターの表示／未設定時の検査を足す
- [x] `tests/e2e/players.spec.ts` を新規作成する（6件）
      - 設定 → 席に反映 → リロード後も保持
      - **アバターを設定した後にロスター設定を保存してもアバターが消えないこと**
      - 未設定でも対局できること
- [x] **回帰テストが実際に落ちることを確かめる**
      （追加タスク: `pruneImages(usedImageIds(roster, {}))` に戻すと落ち、直すと通る）
- [x] 既存の E2E 57 件が通ることを確認する（63件に増えて全て通過）

## フェーズ7: 検証

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
- [x] `npx playwright test`
- [x] ブラウザで確認する（設定画面 / 卓の4席 / 未設定 / 375px）
- [x] 対面の見出しを中央寄せにする
      （追加タスク: スクリーンショットでアバターと席名が卓の端に離れていた）

## 実装後の振り返り

**実装完了日**: 2026-08-09

**規模**: 667 テスト / 28 ファイル（+3）、E2E 63件（+6）。
`PlayerSettings` 181行 / `RosterEditor` 329行 / `board.css` 405行 →
`board.css` だけが基準を 5 行超えたため確認したが、7-2 の分割直後で
これ以上割ると「卓の配置」がさらに散るので今回は据え置く（次に触るとき再判断）。

### 計画と実績の差分

**着手前の調査で、実装前から壊れることが分かっている欠陥を3つ見つけた**のが今回の中心。

| 箇所 | 症状（アバターを同じ IndexedDB に置いた瞬間に発生） |
| ---- | ---- |
| `RosterEditor` の保存 | `pruneImages` が**アバターを全部消す** |
| `RosterEditor` の画像採番 | `nextId` がアバターの ID と衝突し**別人の画像で上書き** |
| `RosterEditor` の書き出し | アバターの画像がファイルに入らない |

計画（`docs/ideas/pokajan-mahjong-board-plan.md`）はこれに触れていなかった。
3箇所を個別に直すのではなく `usedImageIds` を**必須2引数**にして、
呼び忘れが型エラーになる形にした。

その他の差分は1点。

| 項目 | 計画 | 実際 | 理由 |
| ---- | ---- | ---- | ---- |
| アバターの検証 | `resolveSettings` に通す想定 | **`App.tsx` で `parseAvatars` を直接呼ぶ** | 壊れたアバターでルールとロスターを既定値へ倒す理由がない（画像は対局の成否に関わらない） |

### 学んだこと

1. **共有する資源に持ち主を1人増やすと、既存の「全部数える」処理が全部壊れる。**
   `pruneImages(keepIds)` は「渡した ID 以外を消す」という素直な API で、
   それ自体は正しい。壊れるのは**keep 集合を組み立てる側**で、しかも
   組み立てる場所が3つあった。1箇所ずつ直すとその場は直るが、
   次に持ち主が増えたとき（例: Step 7-5 で演出用の画像を足す）に同じ穴が開く。
   `usedImageIds(roster, avatars)` と**引数を増やした**ことで、
   3つの呼び出しが同時に型エラーになり、直し漏れが物理的に起きなくなった。
   引数を増やすのは一見ただの手間だが、**呼び出し側に「考えろ」と強制する**のが本体。

2. **回帰テストは、落ちることを確かめて初めてテストになる。**
   「アバターを設定してロスターを保存しても消えない」を書いたあと、
   `usedImageIds(roster, {})` にわざと戻して落ちることを確認した。
   落ちなければ、それは**通ることしかできない検査**で、
   `pruneImages` が IndexedDB を触る以上、単体テストでは代替できない。
   CLAUDE.md の「テストが全部通っていることは正しいことを意味しない」を
   具体的に潰す手順として、今後も欠陥の回帰にはこれを付ける。

3. **確認用の足場そのものが2回連続で壊れた。**
   7-2 では IndexedDB に `{ id, blob }` を入れて画像が出ず、
   今回は席ごとの色を変えるために**でっち上げた base64 が不正な PNG** で、
   4席目のアップロードが失敗した。どちらも「検証したつもり」で終わりかけた。
   今回は `zlib` で本物の PNG を組み立てる方に倒した。
   **足場は本番と同じ形式・同じ API を通す**のが結局いちばん短い。

4. **暗黙の `0` は増えると危ない。**
   `useGameLoop` は `options.humanSeat ?? 0` で人間の席を決めていたが、
   それがコードのどこにも書かれていなかった。アバターの設定画面が
   席名を出すために同じ `0` を必要としたので、`DEFAULT_HUMAN_SEAT` として公開した。
   2箇所目が生まれる瞬間が、定数に名前を付けるべきタイミングだった。

### 積み残し（意図的）

- `board.css` が 405 行。7-2 で割った直後なので今回は据え置き
- 空の河が `min-height` を占める件（7-2 から継続）
- 375px では左右の席の見出しが `space-between` で広がる。読めるので許容

### 次回への改善提案

- **Step 7-4（和了の確認ゲート）は E2E の進行ヘルパを必ず壊す。**
  `playToEnd` / `playUntilClaimWindow` は確認ボタンを知らないため、
  対局を進める全テストがタイムアウトする。着手時に**先にヘルパを直す**
- Step 7-5 で演出用の画像を足すなら、`usedImageIds` に引数を足すこと。
  型エラーが出た場所が、直すべき場所の全部になる
- 計画書に「既存の共有資源（IndexedDB / localStorage）に持ち主を増やすか」の欄を作る。
  今回の3つの欠陥はどれも、その一言があれば計画時に挙がっていた
