import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export const ROLES = {
  ADMIN:        'admin',
  SUPERVISOR:   'supervisor',
  ANALYST:      'analyst',
  INVESTIGATOR: 'investigator',
  POLICYMAKER:  'policymaker',
}

const ROLE_PERMISSIONS = {
  admin:        ['dashboard', 'briefing', 'chat', 'analytics', 'network', 'profiler', 'caseinsight', 'forecast', 'sociological', 'financial', 'reports', 'settings', 'user_management'],
  supervisor:   ['dashboard', 'briefing', 'chat', 'analytics', 'network', 'profiler', 'caseinsight', 'forecast', 'sociological', 'financial', 'reports', 'settings'],
  investigator: ['dashboard', 'briefing', 'chat', 'network', 'profiler', 'caseinsight', 'financial'],
  analyst:      ['dashboard', 'briefing', 'chat', 'analytics', 'caseinsight', 'forecast', 'sociological', 'financial', 'reports'],
  policymaker:  ['dashboard', 'briefing', 'analytics', 'forecast', 'sociological', 'reports'],
}

const ROLE_LABELS = {
  admin:        'System Admin',
  supervisor:   'Supervisor',
  investigator: 'Investigator',
  analyst:      'Crime Analyst',
  policymaker:  'Policymaker',
}

const ROLE_COLORS = {
  admin:        { bg: 'rgba(239,68,68,0.15)',  text: '#f87171', border: 'rgba(239,68,68,0.3)'  },
  supervisor:   { bg: 'rgba(168,85,247,0.15)', text: '#c084fc', border: 'rgba(168,85,247,0.3)' },
  investigator: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
  analyst:      { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80', border: 'rgba(34,197,94,0.3)'  },
  policymaker:  { bg: 'rgba(234,179,8,0.15)',  text: '#facc15', border: 'rgba(234,179,8,0.3)'  },
}

const MOCK_USERS = [
  { id:'USR001', email:'admin@ksp.gov.in',        password:'1234', role:'admin',        firstName:'Arjun',  lastName:'Nair',   station:'KSP HQ Bengaluru',    badgeNumber:'KSP-ADMIN-001' },
  { id:'USR002', email:'supervisor@ksp.gov.in',   password:'1234', role:'supervisor',   firstName:'Priya',  lastName:'Sharma', station:'Bengaluru Central',   badgeNumber:'KSP-SUP-0042'  },
  { id:'USR003', email:'investigator@ksp.gov.in', password:'1234', role:'investigator', firstName:'Kiran',  lastName:'Gowda',  station:'Koramangala PS',       badgeNumber:'KSP-SI-0187'   },
  { id:'USR004', email:'analyst@ksp.gov.in',      password:'1234', role:'analyst',      firstName:'Divya',  lastName:'Rao',    station:'CCTNS Cell Bengaluru', badgeNumber:'KSP-ANA-0023'  },
  { id:'USR005', email:'policymaker@ksp.gov.in',  password:'1234', role:'policymaker',  firstName:'Suresh', lastName:'Patil',  station:'Karnataka Home Dept',  badgeNumber:'KSP-POL-0005'  },
]

const BASE    = import.meta.env.VITE_CATALYST_BASE_URL    || ''
const FN_NAME = import.meta.env.VITE_FUNCTION_NAME        || 'ksp_crimint_function'
const PROJECT = import.meta.env.VITE_CATALYST_PROJECT_ID  || ''

async function catalystLogin(email, password) {
  const res = await fetch(
    `https://auth.catalyst.zoho.com/baas/v1/project/${PROJECT}/login`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email_id: email, password }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Login failed')
  const token = data.data?.access_token
  if (!token) throw new Error('No token returned')
  localStorage.setItem('catalyst_token', token)

  const meRes  = await fetch(`${BASE}/server/${FN_NAME}/auth-me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const meData = await meRes.json()
  if (!meRes.ok) throw new Error(meData.message || 'Profile fetch failed')
  return meData.user
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    const saved = localStorage.getItem('ksp_user')
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch (_) {}
    }
    setLoading(false)
  }, [])

  const login = useCallback(async (email, password) => {
    setError(null)

    // DEV: mock login
    if (!PROJECT || import.meta.env.DEV) {
      const found = MOCK_USERS.find(u => u.email === email && u.password === password)
      if (found) {
        const { password: _, ...safeUser } = found
        setUser(safeUser)
        localStorage.setItem('ksp_user', JSON.stringify(safeUser))
        return safeUser
      }
      const msg = 'Invalid email or password.'
      setError(msg)
      throw new Error(msg)
    }

    // PROD: real Catalyst Auth
    try {
      const user = await catalystLogin(email, password)
      setUser(user)
      localStorage.setItem('ksp_user', JSON.stringify(user))
      return user
    } catch (err) {
      const msg = err.message || 'Login failed. Please try again.'
      setError(msg)
      throw new Error(msg)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('catalyst_token')
    localStorage.removeItem('ksp_user')
    // Wipe any cached chat transcript / session id so the NEXT account signing
    // in on this device never inherits the previous officer's conversation.
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('kavach_chat_'))
        .forEach(k => localStorage.removeItem(k))
    } catch { /* ignore */ }
    setUser(null)
  }, [])

  const can = useCallback((module) => {
    if (!user?.role) return false
    return ROLE_PERMISSIONS[user.role]?.includes(module) ?? false
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, loading, error, setError,
      login, logout, can,
      isAuthenticated: !!user,
      roleLabel:   user ? (ROLE_LABELS[user.role]  ?? user.role)   : '',
      roleColor:   user ? (ROLE_COLORS[user.role]  ?? ROLE_COLORS.investigator) : null,
      permissions: user ? (ROLE_PERMISSIONS[user.role] ?? []) : [],
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}