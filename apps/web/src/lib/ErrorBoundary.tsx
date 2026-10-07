import React from 'react';
/** A render error shows a plain message and a reload button; nothing about the error is put on the page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; onError?: (e: unknown) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(e: unknown): void { this.props.onError?.(e); }
  override render(): React.ReactNode { return this.state.failed ? <div role="alert" className="cc-boundary"><p>Something went wrong on this page.</p><button type="button" className="cc-btn cc-btn--secondary" onClick={() => this.setState({ failed: false })}>Try again</button></div> : this.props.children; }
}
