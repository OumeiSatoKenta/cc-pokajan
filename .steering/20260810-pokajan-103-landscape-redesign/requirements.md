# Step 10-3 横向き専用レイアウト再設計 — requirements

## 背景

9-3 は portrait 用 DOM を CSS で畳むだけで横向きに対応しようとし、**縦 fit（844×390）に到達できず
保留**にした（実測 約540px あふれ）。10-1（待ちをフロー外へ）で最大のあふれ要因が消え、
現状の横向きあふれは **vOverflow 106px**（実測、844×390・CLAIM_SEED）まで下がった。
内訳: app__header 約51px（卓の外）＋ 卓内（header40 / felt316〔top84・middle99・**mine117**〕/ actions69）。

本 Step で **DOM 再構成**により縦 fit（`scrollHeight <= clientHeight`）を達成し、9-3 の保留を解除する。

## 確定方針（ユーザー確認済み・plan）

- **下段をレール化**: 手札（`.table__mine`）と操作バー（`.actions`）を1つのラッパ `.table__controls` に
  まとめ、横向きで **[手札 | 操作]** の横並びにする（縦では従来どおり縦積み）。
- **他家席を横向きで簡略化**して縦を空ける。
- **E2E の高さ実測でループ**して詰める。

## 要件

### 機能要件

1. **844×390 で縦横ともスクロールが出ない**（`scrollHeight - clientHeight <= 1` かつ
   `scrollWidth - clientWidth <= 1`）。9-3 の保留（`vOverflow <= 200`）を **fit（<= 1）** に戻す。
2. **下段レール**: `.table__controls` を導入し、横向きで [手札 | 操作] の row、縦で column（現状の積み順）。
3. **他家席の簡略化**（横向きのみ）で縦を削る。
4. **app__header（"ポカジャン" タイトル）を横向きの対局画面でだけ視覚的に畳む**。対局中は
   `TableHeader` がブランドを視覚的に出すため冗長で、卓の外で約51px を浪費している。縦・デスクトップは従来どおり。
   - **`.app[data-screen='table']` にスコープ**（landscape.css はバンドル全体に効くため、無指定だと
     タイトル/BET/精算/設定の見出しまで消える。タイトル画面は他に見出しが無く 0 件になる）。
   - **`display: none` にしない。sr-only（画面外退避）で h1 を支援技術に残す**
     （`.table__title` は `<span>` で見出しではないため、消すと対局画面の heading が 0 件になる）。

### 非機能要件（壊してはいけない既存の担保）

- **エンジン層（`src/engine/`）は変更しない。** UI（TableScreen の DOM ＋ CSS）のみ。
- **座標 E2E**（他家=上/左/右・自分=下）が通り続ける（`.table__mine` は opponents より下）。
- **375px（縦）E2E**（1列積み・横スクロール無し・伏せ札が横並び）が通り続ける。
- **デスクトップ（既定 1280×720）が破綻しない**。操作バーが felt 内下段へ移る視覚変化は許容
  （第2稿も操作エリアは felt 内・手札の右にある＝むしろ設計準拠）。
- testid / aria（`table-screen` / `あなたの手札` / `action-bar` / `card-backs` 等）を維持する。

### 設計上の既知の罠（9-1/9-3/10-2 の教訓）

- **grid-area は grid item（直接の子）にしか効かない**（9-3: `.hand` でなく `.hand-area`）。
- **同詳細度は import 順で負ける**（landscape.css は App.css より前。`.seat`/`.button.button--x` を挟む）。
- **レスポンシブ fit は E2E で数値化して初めて検証できる**（縦・横の両方を `scrollHeight`/`scrollWidth` で実測）。

## スコープ外

- 待ちのホバー展開（10-1・完了）、ゲーム風ボタン（10-2・完了）。
- 縦（portrait）/デスクトップのレイアウト刷新（積み順は維持。操作バーが felt 内へ移る以外の変更はしない）。

## 受け入れ基準

- 844×390 で `vOverflow <= 1` かつ `hOverflow <= 1`（E2E・実測）。**達成できなければ到達値で正直に据え置き**、
  理由を記録（9-3 と同じ誠実さ）。
- 座標 E2E・375px E2E・デスクトップが通り続ける。
- 検証ゲート一式（lint / typecheck / test / build / format:check）＋ `npx playwright test` PASS。
- 横向きの最終目視はユーザーに依頼（スクショが常時アニメで撮れないのは 9-1〜9-3 で確認済み）。
