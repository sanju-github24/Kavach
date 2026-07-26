import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SpotlightProvider } from './contexts/SpotlightContext'
import { ToastProvider } from './components/ui/Toast'
import ProtectedRoute from './components/ProtectedRoute'

import Login         from './pages/Login'
import Dashboard     from './pages/Dashboard'
import DashboardHome from './pages/DashboardHome'
import Unauthorized  from './pages/Unauthorized'

import Chat         from './pages/Chat'
import Analytics    from './pages/Analytics'
import Network      from './pages/Network'
import Profiler     from './pages/Profiler'
import CaseInsight  from './pages/CaseInsight'
import Briefing     from './pages/Briefing'
import Forecast     from './pages/Forecast'
import Sociological from './pages/Sociological'
import Financial    from './pages/Financial'
import Reports      from './pages/Reports'

export default function App() {
  return (
    <AuthProvider>
    <ToastProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>

          {/* Public */}
          <Route path="/login"        element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          {/* Protected — any authenticated user */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<SpotlightProvider><Dashboard /></SpotlightProvider>}>
              <Route index element={<DashboardHome />} />
              <Route path="chat"      element={<Chat />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="network"   element={<Network />} />
              <Route path="profiler"     element={<Profiler />} />
              <Route path="case-insight" element={<CaseInsight />} />
              <Route path="briefing"     element={<Briefing />} />
              <Route path="forecast"     element={<Forecast />} />
              <Route path="sociological" element={<Sociological />} />
              <Route path="financial"    element={<Financial />} />
              <Route path="reports"      element={<Reports />} />
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/login" replace />} />

        </Routes>
      </HashRouter>
    </ToastProvider>
    </AuthProvider>
  )
}