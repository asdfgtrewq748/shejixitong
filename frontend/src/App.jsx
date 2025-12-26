import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MiningDesignSystem from './MiningDesignSystem'
import DisturbanceEvaluation from './components/DisturbanceEvaluation'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary showDetails={import.meta.env.DEV}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MiningDesignSystem />} />
          <Route path="/disturbance" element={<DisturbanceEvaluation />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
