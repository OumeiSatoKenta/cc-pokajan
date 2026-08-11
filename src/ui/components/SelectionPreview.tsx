import type { WinKind, YakuCandidate } from '../../engine/types'
import { describeYaku } from './actionBarItems'

export interface SelectionPreviewProps {
  /**
   * 選択されたカードから再導出した役。`null` なら役として成立していない。
   * `candidateFromSelection`（エンジン）の結果をそのまま渡す（ここで計算し直さない）。
   */
  readonly composed: YakuCandidate | null
  /** 今選ばれている枚数。0 と「選んだが役にならない」を案内文で区別するために使う。 */
  readonly selectionCount: number
  /** 確定操作。有効な役のときだけ押せる。 */
  readonly onConfirm: () => void
  /**
   * 確定ボタンの種別。**ツモ／ロンで色・testid・ラベルだけを出し分ける**（本体の
   * プレビュー文言・活性条件・aria は共通）。`tsumo`=緑「ツモ」（`declare-confirm`）／
   * `ron`=赤「ロン」（`claim-confirm`）。プレビューは `selfDeclare`（ツモ）と `claimWindow`（ロン）で
   * 完全に同じ導出（`candidateFromSelection`）を通るため、差分はこの1軸に閉じる。
   * 型は和了種別 `WinKind`（`engine/types`）を共有する（`WinCutIn` と同じ。同義の再定義を避ける）。
   */
  readonly kind: WinKind
}

/** 確定ボタンの見た目・testid・ラベルを種別で決める（色・詳細度勝敗は E2E が実測する）。 */
const CONFIRM_BY_KIND = {
  tsumo: { className: 'button button--tsumo', testId: 'declare-confirm', label: 'ツモ' },
  ron: { className: 'button button--ron', testId: 'claim-confirm', label: 'ロン' },
} as const

/**
 * 選択が作る役のライブプレビューと、確定ボタン（ツモ＝緑／ロン＝赤）。
 *
 * `selfDeclare`（人間が宣言権者）または `claimWindow`（人間が割り込める役を持つ）のときだけ
 * `TableScreen` が描画する。手札タップで選択が変わるたびに `composed` が変わり、役名・同色・点数が
 * 即時に更新される。**確定は有効な役のときだけ**（`composed !== null`）。ボタンは常に描き、不活性で
 * 見せることで「今は押せない」ことを可視化する（E2E も活性/不活性を実測できる）。
 *
 * ロンでは捨て札（`lastDiscard`）が構成の固定要素だが、その合流は `useSelection` が担う。
 * ここは「手札をタップして役を作る」案内のまま（ロンでも手札をタップするのは正しい）。
 */
export function SelectionPreview({
  composed,
  selectionCount,
  onConfirm,
  kind,
}: SelectionPreviewProps) {
  const message =
    composed !== null
      ? describeYaku(composed)
      : selectionCount > 0
        ? 'この組み合わせでは役になりません'
        : '手札をタップして役を作る'

  const confirm = CONFIRM_BY_KIND[kind]

  return (
    <div className="selection-preview" data-testid="selection-preview">
      {/*
        タップで選択が変わるたびに文言が変わる。支援技術にも変化を伝えるため live 領域にする
        （更新は頻繁なので polite。`WinOverlay` の role="status" aria-live="polite" に倣い両方付ける）。
      */}
      <span
        className="selection-preview__text"
        data-valid={composed !== null}
        role="status"
        aria-live="polite"
      >
        {message}
      </span>
      <button
        type="button"
        className={confirm.className}
        onClick={onConfirm}
        disabled={composed === null}
        data-testid={confirm.testId}
      >
        {confirm.label}
      </button>
    </div>
  )
}
