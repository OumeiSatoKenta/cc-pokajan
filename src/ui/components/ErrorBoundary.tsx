import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly error: Error | null
}

/**
 * 予期しない例外で画面全体が白くなるのを防ぐ受け皿。
 *
 * エンジンは契約違反を例外として積極的に投げる設計であり、対局ループは
 * 受け付けられないアクションだけを見送るようにしている。それでも想定外の例外が
 * 出たときに**復帰手段のない白画面**になると、何が起きたのかも分からなくなる。
 *
 * React のエラー境界はクラスコンポーネントでしか作れないため、
 * ここだけ関数コンポーネントの方針から外れる。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[pokajan] 予期しないエラーが発生しました', error, info.componentStack)
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state

    if (error === null) {
      return this.props.children
    }

    return (
      <div className="overlay" role="alert" data-testid="error-boundary">
        <div className="overlay__panel">
          <h2 className="overlay__title">エラーが発生しました</h2>
          <p className="overlay__reason">{error.message}</p>
          <button type="button" className="button button--primary" onClick={this.handleReload}>
            最初からやり直す
          </button>
        </div>
      </div>
    )
  }
}
