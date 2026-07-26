import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ module }) {
  const { isAuthenticated, loading, can } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Verifying credentials...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (module && !can(module)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <Outlet />
}