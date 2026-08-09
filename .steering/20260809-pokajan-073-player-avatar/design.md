# Step 7-3: プレイヤーアバター — 設計

## 1. 画像の持ち主が増えることを型で扱う

要求に書いた3つの欠陥は、どれも同じ形をしている
——**「画像を参照しうるものを全部数える」ところで、ロスターしか数えていない**。

個別に `usedImageIds(roster).concat(avatarImageIds(avatars))` と書いて回ると、
書き忘れが起きても何も教えてくれない。そこで**シグネチャを変えて、
呼び出し側が両方を渡さない限りコンパイルが通らない**ようにする。

```ts
// src/ui/rosterEditor.ts
export function usedImageIds(roster: Roster, avatars: AvatarMap): string[]
```

引数を増やすだけの変更だが、**既存の3つの呼び出し全部が型エラーになる**ので、
直し漏れが物理的に起きない。「今は正しい」ではなく「間違えられない」形にする。
CPU に `AiView` しか渡さないのと同じ考え方。

> `pruneImages(keepIds)` 側は変えない。あれは「これ以外を消す」という
> 汎用の操作であって、誰が画像を持つかを知る立場にない。
> 知っているべきなのは keep 集合を組み立てる側。

## 2. 座席は絶対番号で持つ

```ts
// src/ui/avatars.ts
/** 座席番号（文字列化した `PlayerId`）→ 画像 ID。 */
export type AvatarMap = Readonly<Record<string, string>>
```

**席名（あなた / 下家 / 対面 / 上家）で持たない。** 席名は `humanSeat` からの
相対表示なので、そちらをキーにするとアバターが対局ごとに別人へ移る。
`seatOrientation` を相対で求めたのと同じ理由の裏返しで、
**保存は絶対、表示は相対**に統一する。

キーを `string` にするのは `Record<number, …>` を JSON にすると
どのみち文字列キーになるため。`number` を名乗って往復で崩れるより正直な型にする。

### 人間の席は 1 箇所で決める

`useGameLoop` は `options.humanSeat ?? 0` としており、`TableScreen` は渡していない。
つまり**人間は常に 0 番**だが、それがコードのどこにも書かれていない。
プレイヤー設定画面は席に「あなた」「下家」…と名前を付けて出す必要があるため、
ここで `humanSeat` を勝手に 0 と決め打つと、2 箇所の暗黙の前提が生まれる。

`useGameLoop` から `DEFAULT_HUMAN_SEAT` を公開し、既定値もこの定数から取る。
設定画面はそれを使って席名を出す。ずれようがなくなる。

## 3. 保存形式

### `prefs`

```ts
// src/storage/prefs.ts
readonly avatars: unknown
```

**`roster` と同じく `unknown` で持ち、検証は UI 層で行う。**
`prefs.ts` は「読めなければ既定値」だけを担い、内容の意味を知らないという
既存の役割分担を崩さない（`storage` は `engine` にも `ui` にも依存しない）。

`version` は 1 のまま。欠けていれば「未設定」として扱うので、
**Step 5・6 までに保存された所持コインを捨てずに済む**（`roster` 追加時と同じ判断）。

検証は `src/ui/avatars.ts` の `parseAvatars`。

- レコードでなければ `{}`
- キーが 0 以上の整数として読めない項目は落とす
- 値が空でない文字列でない項目は落とす
- **1件壊れていても全体を捨てない**（画像は欠けても遊べる。`parseImages` と同じ方針）

### 書き出しファイル

```ts
export interface RosterBundle {
  readonly format: typeof BUNDLE_FORMAT
  readonly version: number
  readonly roster: Roster
  readonly images: Readonly<Record<string, string>>  // imageId → data URL
  readonly avatars: AvatarMap                        // 省略可能。無ければ {}
}
```

**`BUNDLE_VERSION` は 1 のまま。** `avatars` を欠く既存ファイルは
`{}` として読めるので、上げると読めなくなるファイルが増えるだけで得がない。
アバターの画像そのものは既存の `images` に入る（`imageId → data URL` の対応表は共通）。

## 4. 画面

### `PlayerSettings.tsx`（新規）

- 4座席ぶんの行。各行は「サムネイル / 席名 / 画像ボタン / 消すボタン」
- 画像変換は `fileToStoredImage`（`src/ui/imageResize.ts`）をそのまま再利用（256px webp）
- 保存先は `putImage`（IndexedDB）。**新しいストアは作らない**
- 保存時に `pruneImages(usedImageIds(roster, avatars))` で差し替え前の画像を掃除する
- 見た目は `MemberRow` と同じ形にそろえる。専用クラス `.avatars__*` を
  `settings.css` に足す（`roster__*` を借りると、片方を触ったときにもう片方が動く）

`RosterEditor` と同じく**編集中は反映せず、保存で確定**する。
戻るを押したら破棄（画像は `pruneImages` の対象として次の保存時に消える）。

### `appReducer`

`Screen` に `'players'` を、`GO_SETTINGS` の `screen` に `'players'` を足す。
**対局中は開けない**既存の判定（`state.screen !== 'title'`）がそのまま効く。

### 席への表示

`PlayerSeat` に `avatarUrl?: string` を足し、見出しの左に出す。
自分の席（`TableScreen` の `.table__mine`）にも同じ形で出す。

**未設定でも成立させる。** 画像が無ければ席名だけを出す
（`MemberRow` のサムネイルが名前の1文字目に落ちるのと同じ考え方）。

## 5. `useAvatarUrls`

`useAssetUrls` と同じ形。**まとめて作り、まとめて解放する。**

```ts
export function useAvatarUrls(avatars: AvatarMap): ReadonlyMap<PlayerId, string>
```

依存は「どの席がどの画像を使うか」の文字列にする。
`avatars` の参照が変わるたびに読み直すと、無関係な再描画で毎回 Blob を読み直す。

## 6. 変更するファイル

**新規**
- `src/ui/avatars.ts` — `AvatarMap` / `parseAvatars` / `avatarImageIds` / `setAvatar`
- `src/ui/hooks/useAvatarUrls.ts`
- `src/ui/screens/PlayerSettings.tsx`

**修正**
- `src/ui/rosterEditor.ts` — `usedImageIds(roster, avatars)`（**3つの呼び出しが型エラーになる**）
- `src/ui/screens/RosterEditor.tsx` — アバターを受け取り、保存・書き出し・ID採番に含める
- `src/ui/rosterBundle.ts` — `avatars` の書き出しと省略可能な読み込み
- `src/storage/prefs.ts` — `avatars: unknown`
- `src/ui/appReducer.ts` — `Screen` に `'players'`
- `src/ui/screens/TitleScreen.tsx` — 導線
- `src/ui/hooks/useGameLoop.ts` — `DEFAULT_HUMAN_SEAT` を公開
- `src/ui/components/PlayerSeat.tsx` — `avatarUrl`
- `src/ui/screens/TableScreen.tsx` — アバターの配線と自席への表示
- `src/App.tsx` — 状態と永続化の配線
- `src/ui/board.css` / `src/ui/settings.css` — アバターの見た目

**テスト**
- `tests/ui/avatars.test.ts`（新規） — `parseAvatars` の防御・`setAvatar`・`avatarImageIds`
- `tests/ui/rosterEditor.test.ts` — `usedImageIds` の2引数化
- `tests/ui/rosterBundle.test.ts` — `avatars` の往復と**旧形式の互換**
- `tests/ui/appReducer.test.ts` — `players` 画面への遷移と、対局中に開けないこと
- `tests/e2e/players.spec.ts`（新規） — 設定 → 席へ反映 → リロード後も保持

## 7. 検証

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

**必ず確かめること（要求で挙げた欠陥の回帰）**:
アバターを設定した状態で**ロスター設定を開いて保存し、アバターが残っていること**。
これは E2E でしか踏めない（`pruneImages` は IndexedDB を触るため）。
