import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * ページの表示中に想定外のエラーが起きても、アプリ全体を真っ白にせず、そのページの場所に案内を出す（DESIGN.md 253章）。
 * ヘッダーやメニューはそのまま使える。resetKey（今のページの場所）が変わったら、案内を外して次のページを表示する。
 * 各ページの見た目・動きは変えない（エラーが起きたときだけ働く）
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 原因を調べられるよう、開発者向けの記録だけコンソールに残す（画面には出さない）
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-message" role="alert">
        <p>このページを表示できませんでした。</p>
        <p>データの読み込みや表示で問題が起きた可能性があります。読み込み直すか、ほかのページを選んでください。</p>
        <button type="button" className="load-more-button" onClick={() => window.location.reload()}>
          ページを読み込み直す
        </button>
      </div>
    );
  }
}
