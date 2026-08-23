import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CommandPalette from '../components/ui/CommandPalette';
import KavachLogo from '../components/ui/KavachLogo';
import Spotlight from '../components/ui/Spotlight';
import { useSpotlight } from '../contexts/SpotlightContext';
import {
  IconChat, IconAnalytics, IconNetwork, IconProfiler,
  IconForecast, IconSociological, IconFinancial, IconReports,
  IconLogout, IconCollapse, IconExpand, IconTimeline, IconBriefing, IconScan,
} from '../components/ui/Icons';

const ALL_NAV_ITEMS = [
  { id: 'briefing',     label: 'AI Intel Briefing',     Icon: IconBriefing,     route: '/dashboard/briefing' },
  { id: 'chat',         label: 'Conversational AI',     Icon: IconChat,         route: '/dashboard/chat' },
  { id: 'analytics',    label: 'Pattern Analytics',      Icon: IconAnalytics,    route: '/dashboard/analytics' },
  { id: 'network',      label: 'Network Relations',      Icon: IconNetwork,      route: '/dashboard/network' },
  { id: 'profiler',     label: 'Criminal Profiler',      Icon: IconProfiler,     route: '/dashboard/profiler' },
  { id: 'caseinsight',  label: 'Case Insight',           Icon: IconTimeline,     route: '/dashboard/case-insight' },
  { id: 'visualintel',  label: 'Visual Intelligence',    Icon: IconScan,         route: '/dashboard/visual-intel' },
  { id: 'forecast',     label: 'Crime Forecasting',      Icon: IconForecast,     route: '/dashboard/forecast' },
  { id: 'sociological', label: 'Sociological Insights',  Icon: IconSociological, route: '/dashboard/sociological' },
  { id: 'financial',    label: 'Financial Crime',        Icon: IconFinancial,    route: '/dashboard/financial' },
  { id: 'reports',      label: 'Reporting',              Icon: IconReports,      route: '/dashboard/reports' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, can, roleLabel, logout } = useAuth();
  const { moduleBadge } = useSpotlight();
  const [userProfile, setUserProfile] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    fetch('/server/ksp_crimint_function/auth-me')
      .then(res => { if (!res.ok) throw new Error('Session unauthenticated'); return res.json(); })
      .then(data => { setUserProfile(data.user || data); setLoadingSession(false); })
      .catch(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const isActive = (path) => location.pathname === path;
  const navItems = ALL_NAV_ITEMS.filter(item => can(item.id));
  const current = navItems.find(n => isActive(n.route));

  const paletteItems = [
    ...navItems.map(n => ({ label: n.label, icon: <n.Icon className="w-4 h-4" />, route: n.route, keywords: n.id, hint: 'Go to' })),
    { label: 'Sign out', icon: <IconLogout className="w-4 h-4" />, action: () => { logout(); navigate('/login'); }, hint: 'Session' },
  ];

  return (
    <div className="flex h-screen w-screen bg-base overflow-hidden text-ink font-sans">
      <CommandPalette items={paletteItems} />

      {/* SIDEBAR */}
      <div className={`${collapsed ? 'w-[76px]' : 'w-64'} transition-[width] duration-200 bg-base-panel/80 backdrop-blur-xl border-r border-base-border flex flex-col justify-between shadow-panel z-10 relative`}>
        <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="p-5 relative">
          <div className={`flex items-center gap-3 mb-8 cursor-pointer select-none ${collapsed ? 'justify-center' : ''}`} onClick={() => navigate('/dashboard')}>
            <KavachLogo size={34} />
            {!collapsed && (
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-wide text-white leading-tight">KAVACH</h2>
                <p className="text-[9px] text-accent uppercase font-mono tracking-widest font-semibold">KSP Intelligence</p>
              </div>
            )}
          </div>

          <nav className="space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
            {navItems.map(item => {
              const activeItem = isActive(item.route)
              const badge = moduleBadge(item.id)
              const dotColor = badge.critical ? 'bg-risk-critical' : badge.count ? 'bg-[#A78BFA]' : ''
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.route)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 text-sm font-medium rounded-xl transition-all duration-150 relative ${
                    activeItem
                      ? 'bg-accent text-base font-semibold shadow-glow'
                      : 'text-ink-dim hover:bg-base-raised hover:text-white'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <span className="relative flex-shrink-0">
                    <item.Icon className={`w-[18px] h-[18px] ${activeItem ? 'text-base' : 'text-ink-dim'}`} />
                    {collapsed && badge.count > 0 && (
                      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${dotColor} ${badge.critical ? 'animate-pulse' : ''}`} />
                    )}
                  </span>
                  {!collapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
                  {!collapsed && badge.count > 0 && (
                    <span className={`flex items-center gap-1 flex-shrink-0 ${activeItem ? '' : ''}`}>
                      {badge.changed && <span className="text-[8px] text-[#C4B5FD]">↑</span>}
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${badge.critical ? 'animate-pulse' : ''}`} />
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="relative">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-ink-faint hover:text-accent border-t border-base-borderSoft text-xs transition-colors"
          >
            {collapsed ? <IconExpand /> : <><IconCollapse /> Collapse</>}
          </button>
          {/* Profile / session footer */}
          <div className="p-3 border-t border-base-border">
            {loadingSession ? (
              <div className="flex items-center gap-2.5 px-1 py-1.5">
                <div className="w-8 h-8 rounded-full bg-base-raised animate-pulse flex-shrink-0" />
                {!collapsed && <div className="h-2.5 w-24 rounded bg-base-raised animate-pulse" />}
              </div>
            ) : (
              <div className={`flex items-center gap-2.5 group ${collapsed ? 'justify-center' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-white text-base font-display font-bold text-sm flex items-center justify-center flex-shrink-0 relative">
                  {(userProfile?.email || user?.email || 'O').charAt(0).toUpperCase()}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-risk-low border-2 border-base-panel" title="Online" />
                </div>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-ink text-xs font-medium">{userProfile?.email || user?.email || 'Officer session'}</p>
                      <p className="truncate text-ink-faint text-[10px]">{roleLabel || user?.role || 'Officer'}</p>
                    </div>
                    <button
                      onClick={() => { logout(); navigate('/login'); }}
                      title="Sign out"
                      className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-ink-faint hover:text-white hover:bg-base-raised transition-colors"
                    >
                      <IconLogout className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOPBAR */}
        <div className="h-14 flex-shrink-0 border-b border-base-border bg-base-panel/60 backdrop-blur flex items-center justify-between px-6 relative z-[5]">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
          <div className="flex items-center gap-2 text-xs text-ink-faint font-mono">
            <span>KAVACH</span><span>/</span>
            <span className="text-ink">{current?.label || 'Overview'}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="hidden sm:flex items-center gap-2 text-[11px] text-ink-faint hover:text-accent border border-base-border hover:border-accent/40 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <span>Search modules</span>
              <kbd className="font-mono text-[9px] bg-base-raised px-1.5 py-0.5 rounded">⌘K</kbd>
            </button>
            <span className="text-[10px] font-mono text-ink-faint tabular hidden md:inline">
              {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-base relative">
          <Outlet />
        </div>
      </div>

      {/* KAVACH Spotlight — driven by the current ROUTE (not the role-filtered
          nav, so it still works on pages reached directly by URL). */}
      {(() => {
        const seg = location.pathname.split('/').filter(Boolean).pop();
        const mod = seg === 'case-insight' ? 'caseinsight' : seg;
        return <Spotlight module={mod} />;
      })()}
    </div>
  );
}
