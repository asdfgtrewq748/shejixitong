import React from 'react'
import MiningDesignSystem from './MiningDesignSystem'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary showDetails={import.meta.env.DEV}>
      <MiningDesignSystem />
    </ErrorBoundary>
  )
}
