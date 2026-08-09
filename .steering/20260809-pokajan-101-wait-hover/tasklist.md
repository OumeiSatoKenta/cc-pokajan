# Step 10-1 待ちのホバー/タップ展開 — tasklist

## タスク

- [x] T1: `WaitPanel.tsx` をトリガ＋フロー外オーバーレイ構造に作り替える
      （`pinned` state / `useRef` / Escape・外側クリックの `useEffect` / `aria-expanded` / `aria-controls`）。
      並び・6件上限・残0 のロジックは維持
- [x] T2: `TableScreen.tsx` の `<WaitPanel>` を `.table__mine-head` 内（hint の後）へ移動。
      head と river の間の常時フロー配置を削除
- [x] T3: `hints.css` に `.wait`（relative 基準）・`.wait__trigger`（金枠チップ）・
      `.wait__overlay`（絶対配置・hover/data-open で可視・z-index 6）を追加。既存 `.wait__row` 系は流用
- [x] T4: `table.css` の `.table__mine-head` に `min-height` を追加（ちらつき保証）
- [x] T5: `landscape.css` の `.table__mine .wait { grid-area }` を撤去し、grid を
      `'head head' / 'river hand'` に。`.wait__list` の nowrap/overflow-x は残す
- [x] T6: `waitPanel.test.tsx` を新構造に追随（不変条件維持＋トリガ/aria/オーバーレイ内一覧を固定）
- [x] T7: E2E（`table.spec.ts`）にテンパイ→手札位置不変＋トリガ開閉（click/Escape）を追加。
      **`counts.spec.ts` の既存テストも新構造に追随**（行はオーバーレイ内なので開いてから可視確認）
- [x] T8: `tmp-design.zip` を削除
- [x] T9: 検証ゲート（lint/typecheck/test 764/build/format:check）＋ `npx playwright test` 78
- [x] T10: 行数計測（hints.css 255 / table.css 357 / landscape.css 227 / WaitPanel.tsx 172）

## 進捗

全タスク完了。unit 764 / E2E 78 / build / format:check が PASS。

## 振り返り（2026-08-10 完了）

### 計画と実績の差分

- 計画通り、`WaitPanel` をトリガ＋フロー外オーバーレイの自己完結型にし、ヘッダーへ移した。
  可視制御は当初 design の `visibility` を **`display: none`** に変更（絶対配置でも
  `visibility: hidden` はレイアウトに残り、横スクロール域を広げて横向き E2E を壊すため）。
- 追加で `counts.spec.ts` の既存2テストも新構造へ追随（行がオーバーレイ内に移ったため）。

### 3軸レビューが全緑の裏で捕まえた欠陥（重大2件）

**すべてのゲート（unit 764 / E2E 78 / build / format）が緑の状態で潜んでいた。**

1. **横スクロール崩壊（最重大）**: `.wait__overlay` の `min-width: max-content` が
   `max-width: 22rem` に勝ち（CSS 規則）、`flex-wrap` の `max-content` は「折り返さない幅」で
   算出されるため、待ち6件で幅 1500px 超・横あふれ 1288px。**我々の E2E と同じ seed 20260806 で
   発生していたのに、`scrollWidth` を見ていなかったため見逃していた**（8-2 の教訓「同じ値でしか
   落ちない検査」の別型）。→ `min-width` 撤去・viewport クランプ・右基準で内側へ開く＋
   展開中の `hOverflow <= 1` を実測する回帰テストを追加。
2. **ピン留めの局またぎ残留**: `WaitPanel` は局をまたいで同一インスタンスで使い回される
   （`key` を切らない）。`waits.length === 0` で `null` を返してもアンマウントされないため
   `pinned` state が生き残り、**無操作で再テンパイ時にオーバーレイが開いて復活**。隠れている間は
   `rootRef` が null で外側クリックも効かず、Escape だけ効く不整合も。→ `useEffect([waits.length])`
   で明示リセット。CLAUDE.md「正しさをたまたま成り立つ条件（＝常にマウントされ続ける）に
   依存させない」の典型例。
3. **ARIA 違反**: 素の `div`（暗黙ロール generic）への `aria-label` は WAI-ARIA 1.2 で禁止
   （"Authors MUST NOT"）。→ `role="group"` を付与。

推奨対応: ホバー隙間（`top: 100%` で解消・WCAG 1.4.13）、`counts.spec.ts` の偽陽性、
`as Node | null`、design.md の `visibility` 記述矛盾も是正。

### 学んだこと

- **`min-width: max-content` × `flex-wrap` × `max-width` は横あふれの罠**。`min-width` は
  `max-width` に勝ち、`max-content` は折り返し前提を無視する。オーバーレイに幅を持たせるなら
  `min-width` は置かず、`max-width` だけで上限を与える。
- **絶対配置＋レスポンシブの検査は縦だけでなく横の `scrollWidth` も実測する**（9-3 は縦、
  10-1 は横で、いずれも「見ていない軸」に欠陥が出た）。既存の固定シードは局面を再現するので、
  「同じシードなのに検査軸が足りず見逃す」が起きやすい。
- **局をまたいで使い回す UI コンポーネントの一時状態は、表示条件が偽になる瞬間にリセットする**。
  トリガの表示条件（テンパイ）が消える＝コンポーネントは残るが DOM が消える、という状態で
  内部 state が宙に浮く。

### 次回への申し送り

- **狭幅（375px）のヘッダー折り返しは残課題**（トリガ追加で 2 行に折れ、手札 Y が約30px下がる）。
  ちらつき不変はデスクトップ幅で担保。狭幅の完全固定は **10-3（横向き/狭幅の再設計）** の範囲。
- **crumble→re-tenpai の決定論的 E2E は固定シード autoplay では非現実的**として当該遷移テストは
  未追加（修正は effect で担保）。10-x で局面制御の口ができたら回帰テスト化を検討。
- 「トリガの表示条件が偽になる瞬間に開閉状態をリセットする」は再発しやすいパターン。
  同種の一時開閉 UI を足すときの定石として意識する。
