import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { IconLock } from '../components/ui/Icons'

export default function Unauthorized() {
  const navigate = useNavigate()
  const { role } = useAuth()

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4 font-sans">
      <div className="text-center max-w-sm kv-card p-10 animate-fade-up">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-risk-critical/10 border border-risk-critical/25 flex items-center justify-center text-risk-critical">
          <IconLock className="w-6 h-6" />
        </div>
        <h1 className="text-white font-display text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-ink-dim text-sm mb-7 leading-relaxed">
          Your role ({role?.toUpperCase() || 'UNKNOWN'}) does not have permission to access this module.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-accent text-base font-semibold text-sm px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
