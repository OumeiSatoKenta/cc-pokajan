# Step 6: ロスターエディタ + ルール設定 — 設計

## 全体方針

このステップで初めて **DOM API（canvas / File / IndexedDB）** に本格的に触れる。
テスト環境は `node` で jsdom を入れていないため、そのままだと
**新機能の大半が単体テストできない**という状態になる。

そこで一貫して次の分け方をする。

| 層                       | 内容                                        | 検証        |
| ------------------------ | ------------------------------------------- | ----------- |
| 純粋関数                 | 寸法計算・CRUD・検証・import/export の組み立て | 単体テスト  |
| DOM に触れる薄いラッパー | canvas 描画・FileReader・IndexedDB           | E2E         |

**判断を含む処理は必ず純粋関数側に置く。** ラッパーには「呼ぶ」以外の分岐を書かない。

---

## R1: 画像ストア（`src/storage/assets.ts`）

### 決定1: IndexedDB は薄い KV として使い、失敗を握りつぶす

```ts
export function putImage(id: string, blob: Blob): Promise<void>
export function getImage(id: string): Promise<Blob | null>
export function deleteImage(id: string): Promise<void>
export function listImageIds(): Promise<string[]>
export function getAllImages(): Promise<Map<string, Blob>>
```

DB名 `cc-pokajan` / ストア `assets`（`docs/architecture.md` の記載どおり）。

**すべての関数は失敗しても例外を投げない。** `prefs.ts` と同じ方針。
プライベートモードや容量超過で IndexedDB が使えない環境はあるが、
**画像が出ないことはゲームが遊べない理由にならない**。
読み出し失敗は `null`、書き込み失敗は黙って無視する。

例外は `putImage` のみ: 保存できなかったことは画面に伝える必要があるため、
戻り値を `Promise<boolean>` にして成否を返す（例外は投げない）。

### 決定2: 画像 ID はメンバー ID と分ける

`imageId` をメンバー ID と同じにすると、メンバーを削除して同じ ID で作り直したとき
**前の画像が復活する**。`img_<連番>` の形で独立に採番し、
メンバー削除時に対応する画像も消す。

---

## R2: 画像の縮小（`src/ui/imageResize.ts`）

### 決定3: 寸法計算を純粋関数として切り出す

```ts
export interface CropRect {
  readonly sx: number
  readonly sy: number
  readonly size: number
}

/** 中央を正方形に切り出すための元画像上の矩形を求める。 */
export function centerSquareCrop(width: number, height: number): CropRect
```

引き伸ばさず中央を切り出す。この計算だけが判断を含むので、ここを単体テストする。
`drawImage(img, sx, sy, size, size, 0, 0, 256, 256)` の引数になる。

DOM 側は次だけを持ち、分岐を書かない。

```ts
export async function fileToSquareWebp(file: File, size: number): Promise<Blob>
```

`createImageBitmap` → `OffscreenCanvas`（無ければ `<canvas>`）→ `toBlob('image/webp')`。
**webp に対応しない環境では png にフォールバックする**（Safari 旧版など）。
`toBlob` が `null` を返したら例外にし、呼び出し側がエラー表示する。

---

## R3: ロスターの編集（`src/ui/rosterEditor.ts`）

### 決定4: 編集状態は純粋なリデューサにする

`createLoopReducer` / `createAppReducer` と同じ形にそろえる。

```ts
export type RosterAction =
  | { type: 'ADD_GROUP' }
  | { type: 'RENAME_GROUP'; groupId: GroupId; name: string }
  | { type: 'DELETE_GROUP'; groupId: GroupId }
  | { type: 'ADD_MEMBER'; groupId: GroupId | null }
  | { type: 'RENAME_MEMBER'; memberId: MemberId; name: string }
  | { type: 'DELETE_MEMBER'; memberId: MemberId }
  | { type: 'SET_MEMBER_GROUP'; memberId: MemberId; groupId: GroupId | null }
  | { type: 'SET_MEMBER_IMAGE'; memberId: MemberId; imageId: string | undefined }
  | { type: 'RESET' }

export function rosterReducer(roster: Roster, action: RosterAction): Roster
```

**リデューサは検証しない。** 編集の途中は一時的に不正になる（グループを作った直後は0人）。
保存の可否は `validateRoster` が別に判定する。**「編集できない」と「保存できない」を混同しない。**

### 決定5: メンバーは1グループにのみ属する

`Group.memberIds` は配列だが、**同じメンバーを複数グループに入れない**。
入れられると、そのメンバーの3カードが2つのグループ役に同時に寄与し、
`findYaku` の候補列挙が意図しない重複を返す。
`SET_MEMBER_GROUP` は他グループから外してから追加する。

> `validateRoster` は現状これを検査していない。エディタ側で構造的に起こさないようにし、
> 検査は追加しない（エンジンの契約を変えない）。

### 決定6: ID は編集画面が採番する

`grp_<連番>` / `mem_<連番>`。既存 ID と衝突しない値を選ぶ。
利用者に ID を意識させない（画面に出すのは名前だけ）。

---

## R4: 書き出し・読み込み（`src/ui/rosterBundle.ts`）

### 決定7: 画像は base64 で JSON に埋める

```ts
export interface RosterBundle {
  readonly format: 'cc-pokajan.roster'
  readonly version: 1
  readonly roster: Roster
  /** imageId → data URL。 */
  readonly images: Record<string, string>
}

export function buildBundle(roster: Roster, images: Record<string, string>): string
export function parseBundle(json: string): { ok: true; bundle: RosterBundle } | { ok: false; errors: string[] }
```

**`format` フィールドで自分の形式かを判定する。** 無いと、別アプリの JSON を
読み込んだときに「壊れたロスター」として黙って一部だけ取り込む可能性がある。

`parseBundle` は純粋関数で、Blob ↔ data URL の変換は呼び出し側（DOM 層）が行う。

### 決定8: 読み込みは検証に通ったときだけ適用する

`parseBundle` が成功しても、`validateRoster` に通らなければ適用しない。
**既存のロスターを壊さない**ことを優先する。

---

## R5・R6: ルール設定と検証（`src/engine/rulesValidation.ts`）

### 決定9: ルール上書きは**エンジンに渡す前に**検証する

これが本ステップで最も重要な設計判断。

保存されたルール上書きは localStorage から読まれ、そのまま `createGame` に渡る。
`handSize: 0` や `deckSize` がプール枚数を超える値だと**配牌の時点で例外**になり、
タイトル画面すら表示できなくなる。localStorage に残るのでリロードしても回復しない。

```ts
export function validateRules(rules: RulesConfig): RulesValidationResult
```

検査項目（いずれも「これを外すと対局が始まらない／進まない」もの）:

| 項目                              | 条件                                          |
| --------------------------------- | --------------------------------------------- |
| `playerCount`                     | 2 以上の整数                                  |
| `handSize`                        | 1 以上の整数                                  |
| `deckSize`                        | `playerCount × handSize` より大きい整数       |
| `groupsPerGame`                   | 1 以上の整数                                  |
| `copiesPerMemberColor`            | 1 以上の整数                                  |
| `colors`                          | 1色以上・重複なし                             |
| `minGroupSize` / `maxGroupSize`   | `3 ≤ min ≤ max ≤ 5`（役種を決められる範囲）   |
| `startingScore`                   | 1 以上の整数                                  |
| `bonusPerCard` / 各役の点数       | 0 以上の整数                                  |
| `turnTimer`                       | `minMs ≥ 1` かつ `initialMs ≥ minMs`、`decrementMs ≥ 0` |
| `maxChainDeclare`                 | 1 以上の整数                                  |
| `bonusMemberCount`                | 0 以上の整数（上限はロスター依存。決定9b で担保） |
| `bet.options`                     | 1件以上・すべて正                             |
| `bet.rankMultiplier`              | 長さ = `playerCount`・すべて 0.5 の倍数で正   |
| `bet.initialWallet`               | `max(options)` 以上                           |

**「3の倍数」は検査しない。** 3で割り切れないと `settleTsumo` の
`Math.floor(amount / 3)` で端数が切り捨てられるだけで、点数保存則もカード保存則も
壊れない（各人が `share` を払い、勝者が `3 × share` を得る）。
遊べなくなるわけではないので、**エラーではなく警告**として扱う。

> 実測で確認済み: `amount = 100 / 121 / 1` のいずれでも4人の合計は 4000 のまま。

### 実測: どの値が実際に起動を壊すか

`createGame` に不正なルールを渡して確かめた（11ケース）。

| 上書き                         | 結果                                            |
| ------------------------------ | ----------------------------------------------- |
| `deckSize` 過小 / 過大         | 例外（配牌不足 / プール不足）                   |
| `groupsPerGame` 過大           | 例外（グループ数不足）                          |
| `colors: []`                   | 例外（プール0枚）                               |
| `copiesPerMemberColor: 0`      | 例外（プール0枚）                               |
| `minGroupSize` / `maxGroupSize` が 3〜5 の外 | 例外（役種を決められない）         |
| `bonusMemberCount` 過大        | 例外（人数不足）                                |
| **`handSize: 0` / `-1`**       | **例外にならない**。配牌0枚で始まり、捨てられず進行が止まる |
| **`playerCount: 0`**           | **例外にならない**。最初のアクションで例外になる |

**例外にならない値のほうが危険**である。起動はするので既定値へのフォールバックが働かず、
遊べない対局が始まってしまう。`validateRules` はこの2つを必ず捕まえる。

### 決定9b: 列挙に頼らず、**実際に対局を作れるか**も確かめる

`bonusMemberCount` の上限のように、**ルール単体では判定できずロスターとの
組み合わせで初めて壊れる**項目がある。検査項目を列挙し切ろうとすると、
数え漏れがそのまま起動不能につながる。

そこで `validateRules`（画面に理由を出すための構造的な検査）に加えて、
**起動時に一度だけ試しに `createGame` を呼び、例外が出たら既定値へ倒す**。

```ts
export function canStartGame(roster: Roster, rules: RulesConfig): boolean
```

固定シードで1局分の初期化を試すだけの純粋関数。副作用も乱数の持ち越しもない。
列挙の網羅性に正しさを預けず、**「実際に始められること」そのものを条件にする**。

### 決定10: 上書きは「差分」で保存し、読み込み時に既定値へマージする

```ts
readonly rulesOverride: Partial<RulesConfig> | null
```

全体を保存すると、既定値を変更したときに古い保存値が全項目を上書きし続ける。
差分で持てば、触っていない項目は常に最新の既定値に追随する。

マージ後に `validateRules` を通し、**通らなければ上書きを丸ごと捨てて既定値を使う**。
部分的に採用すると「どの項目が生きているか」が利用者にも読めなくなる。

### 決定11: 画面は文字列で編集し、確定時に数値へ変換する

数値入力を `number` の state で持つと、`''`（消した状態）や `-` の途中入力を
表現できず、入力体験が壊れる。編集中は文字列、保存時に数値化して検証する。

---

## R7: カードへの画像表示

### 決定12: object URL はメンバー単位でまとめて作り、画面が解放する

```ts
export function useAssetUrls(memberIds: readonly MemberId[]): ReadonlyMap<MemberId, string>
```

カードごとにフックを呼ぶと、1局で最大 108 枚 × レンダーのたびに URL が作られる。
**画面レベルで `memberId → objectURL` を1つ作り、アンマウント時にまとめて解放する。**

`CardView` は `imageUrl?: string` を受け取るだけにする（フックを持たない）。
読み込みに失敗したら `onError` で画像を隠し、従来の名前表示に戻す。

---

## ファイル別の変更一覧

| ファイル                              | 区分 | 内容                                     |
| ------------------------------------- | ---- | ---------------------------------------- |
| `src/engine/rulesValidation.ts`       | 新規 | `validateRules`                          |
| `src/storage/assets.ts`               | 新規 | IndexedDB の画像ストア                   |
| `src/storage/prefs.ts`                | 修正 | `roster` / `rulesOverride` の保存        |
| `src/ui/imageResize.ts`               | 新規 | `centerSquareCrop` + `fileToSquareWebp`  |
| `src/ui/rosterEditor.ts`              | 新規 | 編集リデューサと ID 採番                 |
| `src/ui/rosterBundle.ts`              | 新規 | 書き出し・読み込みの純粋関数             |
| `src/ui/rulesForm.ts`                 | 新規 | 文字列⇔数値の変換とフォーム定義          |
| `src/ui/hooks/useAssetUrls.ts`        | 新規 | object URL のまとめ作成と解放            |
| `src/ui/screens/RosterEditor.tsx`     | 新規 | ロスター編集画面                         |
| `src/ui/screens/RulesSettings.tsx`    | 新規 | ルール設定画面                           |
| `src/ui/components/CardView.tsx`      | 修正 | `imageUrl` の表示とフォールバック        |
| `src/ui/components/Hand.tsx` ほか     | 修正 | `imageUrlById` の受け渡し                |
| `src/ui/screens/TitleScreen.tsx`      | 修正 | 設定への導線                             |
| `src/ui/screens/TableScreen.tsx`      | 修正 | `useAssetUrls` の適用                    |
| `src/ui/appReducer.ts`                | 修正 | `roster` / `rules` 画面への遷移          |
| `src/ui/settings.css`                 | 新規 | 設定画面のスタイル                       |
| `src/App.tsx`                         | 修正 | 画面の配線・ロスターとルールの永続化     |
| テスト                                 | 新規 | 上記の純粋関数すべて + E2E               |

## リスク

| リスク                                                   | 対策                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| 不正なルール上書きで**起動不能**になり、リロードでも直らない | 決定9・10。検証に通らなければ丸ごと捨てる                |
| 不正なロスターが保存され、対局開始で例外                 | 保存時と読み込み時の両方で `validateRoster`             |
| 同じメンバーが複数グループに属し、役判定が重複            | 決定5。エディタ側で構造的に起こさない                   |
| object URL の解放漏れでメモリが増え続ける                | 決定12。画面レベルでまとめて解放                        |
| DOM 依存で単体テストできない範囲が広がる                 | 判断を純粋関数へ寄せ、ラッパーに分岐を書かない          |
| IndexedDB 不在の環境で落ちる                             | 決定1。全関数が失敗を握りつぶす                         |
| 画像を含む書き出しが巨大になる                           | 256px webp（1枚あたり十数KB）+ 書き出し時にサイズ表示   |
