import { Component } from 'react';

/**
 * 错误边界组件 - 捕获子组件中的JavaScript错误
 * 防止整个应用崩溃，提供友好的错误提示
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // 可以在这里上报错误到监控系统
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // 自定义错误UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={styles.container}>
          <div style={styles.content}>
            <div style={styles.icon}>⚠️</div>
            <h2 style={styles.title}>系统出现错误</h2>
            <p style={styles.message}>
              {this.state.error?.message || '发生了未知错误'}
            </p>
            {this.props.showDetails && this.state.errorInfo && (
              <details style={styles.details}>
                <summary style={styles.summary}>查看详细信息</summary>
                <pre style={styles.stack}>
                  {this.state.error?.stack}
                  {'\n\nComponent Stack:'}
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            <div style={styles.buttons}>
              <button onClick={this.handleRetry} style={styles.retryButton}>
                重试
              </button>
              <button onClick={this.handleReload} style={styles.reloadButton}>
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    padding: '20px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    margin: '20px',
  },
  content: {
    textAlign: 'center',
    maxWidth: '500px',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    color: '#ff6b6b',
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 12px 0',
  },
  message: {
    color: '#a0a0a0',
    fontSize: '14px',
    margin: '0 0 20px 0',
    lineHeight: '1.5',
  },
  details: {
    textAlign: 'left',
    marginBottom: '20px',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: '4px',
    padding: '10px',
  },
  summary: {
    color: '#888',
    cursor: 'pointer',
    fontSize: '12px',
  },
  stack: {
    color: '#888',
    fontSize: '11px',
    overflow: 'auto',
    maxHeight: '200px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    marginTop: '10px',
  },
  buttons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  retryButton: {
    padding: '10px 24px',
    backgroundColor: '#4a9eff',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  reloadButton: {
    padding: '10px 24px',
    backgroundColor: 'transparent',
    color: '#888',
    border: '1px solid #444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  },
};

export default ErrorBoundary;
