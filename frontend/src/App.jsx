import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Outlet, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import {
  Scale, FileText, LogOut, LayoutDashboard, CheckCircle2, AlertTriangle,
  XCircle, Bell, Shield, Users, Search, Filter, Printer, ExternalLink,
  Plus, History, RefreshCw, ChevronRight, Award, AlertCircle, Clock,
  Wifi, WifiOff, Download, CloudUpload, HardDrive, Smartphone, Send,
  Camera, QrCode
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from './api';
import { offlineDB } from './offline/db';
import { syncEngine } from './offline/syncEngine';
import { supabase, isSupabaseConfigured } from './supabase';

// --- CONTEXT & AUTH ---
const AuthContext = createContext(null);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectivity, setConnectivity] = useState({ isOnline: navigator.onLine, isSyncing: false });
  const [sessionExpired, setSessionExpired] = useState(false);

  const fetchNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (e) {
      // offline or silent
    }
  };

  useEffect(() => {
    // Subscribe to SyncEngine connectivity & sync state
    const unsubscribe = syncEngine.subscribe((state) => {
      setConnectivity(state);
    });

    // Global session expiry listener from API client interceptor
    const handleUnauthorized = () => {
      localStorage.removeItem('token');
      setUser(null);
      setSessionExpired(true);
      setNotifications([]);
      setUnreadCount(0);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    // 1. Supabase onAuthStateChange listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        localStorage.setItem('token', session.access_token);
        try {
          const profile = await api.getMe();
          setUser(profile.user);
          setSessionExpired(false);
          fetchNotifications();
        } catch {
          if (!navigator.onLine && session.user) {
            setUser({
              id: session.user.id,
              email: session.user.email,
              role: session.user.user_metadata?.role || 'OFFICER',
              name: session.user.user_metadata?.name || session.user.email
            });
          }
        }
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem('token');
        setUser(null);
        setNotifications([]);
        setUnreadCount(0);
      }
      setAuthChecked(true);
    });

    // 2. Initial session resolution
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        localStorage.setItem('token', session.access_token);
        try {
          const profile = await api.getMe();
          setUser(profile.user);
          setSessionExpired(false);
          fetchNotifications();
        } catch {
          if (!navigator.onLine && session.user) {
            setUser({
              id: session.user.id,
              email: session.user.email,
              role: session.user.user_metadata?.role || 'OFFICER',
              name: session.user.user_metadata?.name || session.user.email
            });
          }
        }
      } else {
        const storedToken = localStorage.getItem('token');
        if (storedToken) {
          try {
            const profile = await api.getMe();
            setUser(profile.user);
            setSessionExpired(false);
            fetchNotifications();
          } catch {
            localStorage.removeItem('token');
            setUser(null);
          }
        }
      }
      setAuthChecked(true);
    }).catch(() => {
      setAuthChecked(true);
    });

    return () => {
      unsubscribe();
      subscription.unsubscribe();
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = async (email, password) => {
    let authUser = null;

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) {
        throw new Error(error.message || 'Invalid credentials. Please verify your sign-in details.');
      }

      if (data?.session) {
        localStorage.setItem('token', data.session.access_token);
        const profile = await api.getMe();
        authUser = profile.user;
      }
    } else {
      // Direct backend auth / fallback if Supabase client not configured
      const data = await api.login(email, password);
      localStorage.setItem('token', data.token);
      authUser = data.user;
    }

    setUser(authUser);
    setSessionExpired(false);
    fetchNotifications();
    return authUser;
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // silent
    }
    localStorage.removeItem('token');
    setUser(null);
    setSessionExpired(false);
    setNotifications([]);
    setUnreadCount(0);
  };

  return (
    <AuthContext.Provider value={{
      user,
      authChecked,
      login,
      logout,
      sessionExpired,
      setSessionExpired,
      notifications,
      unreadCount,
      fetchNotifications,
      connectivity
    }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

// --- ACCESS RESTRICTED SCREEN (PROHIBITS UNAUTHORIZED ROLE TRAVERSAL) ---
const AccessRestricted = ({ requiredRole }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const getPermittedRoute = () => {
    if (user?.role === 'OWNER') return '/owner/dashboard';
    if (user?.role === 'OFFICER') return '/officer/dashboard';
    if (user?.role === 'ADMIN') return '/admin/dashboard';
    return '/login';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4 select-none">
      <div className="card w-full max-w-md p-8 border-brand-red/30 space-y-5 text-center shadow-lg">
        <div className="flex justify-center">
          <div className="h-16 w-16 bg-red-50 border border-red-200 rounded-full flex items-center justify-center">
            <Shield className="h-9 w-9 text-brand-red" />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-brand-red font-bold">Access Restricted</div>
          <h2 className="text-xl font-bold text-brand-navy">Insufficient Statutory Privileges</h2>
          <p className="text-xs text-brand-slate-muted leading-relaxed">
            Your authenticated identity (<strong>{user?.name}</strong> • <span className="font-mono">{user?.email}</span>) holds the role <strong>{user?.role}</strong>.
            This portal view requires <strong>{requiredRole || 'higher statutory authorization'}</strong>.
          </p>
        </div>

        <div className="p-3 bg-slate-50 border border-brand-slate-border rounded text-[11px] text-brand-slate text-left">
          <div className="font-bold text-brand-navy mb-0.5">Statutory Security Notice:</div>
          <div>Unauthorized traversal across departmental portals is prohibited under the Legal Metrology Act, 2009.</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
          <button
            onClick={() => navigate(getPermittedRoute(), { replace: true })}
            className="btn-primary flex-1 text-xs py-2"
          >
            Return to Permitted Portal
          </button>
          <button
            onClick={logout}
            className="btn-secondary text-xs py-2"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

// --- CENTRALIZED PROTECTED ROUTE GUARD ---
const ProtectedRoute = ({ allowedRoles }) => {
  const { user, authChecked } = useAuth();

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 select-none">
        <Scale className="h-10 w-10 text-brand-navy animate-pulse mb-3" />
        <div className="text-xs font-bold text-brand-navy uppercase tracking-wider">e-Maanak Legal Metrology</div>
        <div className="text-[11px] text-brand-slate-muted mt-1">Verifying cryptographic session credentials...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <AccessRestricted requiredRole={allowedRoles.join(' or ')} />;
  }

  return <Outlet />;
};

// --- REAL SOVEREIGN LOGIN SCREEN ---
const Login = () => {
  const { login, user, authChecked, sessionExpired, setSessionExpired } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDemoHelp, setShowDemoHelp] = useState(false);

  useEffect(() => {
    if (authChecked && user) {
      if (user.role === 'OWNER') navigate('/owner/dashboard', { replace: true });
      else if (user.role === 'OFFICER') navigate('/officer/dashboard', { replace: true });
      else if (user.role === 'ADMIN') navigate('/admin/dashboard', { replace: true });
    }
  }, [user, authChecked, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please provide both official email and password.');
      return;
    }

    setLoading(true);
    setError('');
    setSessionExpired(false);
    try {
      const authUser = await login(email.trim(), password);
      if (authUser.role === 'OWNER') navigate('/owner/dashboard', { replace: true });
      else if (authUser.role === 'OFFICER') navigate('/officer/dashboard', { replace: true });
      else if (authUser.role === 'ADMIN') navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid credentials. Please verify your sign-in details.');
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (demoEmail, demoPass) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4 select-none">
      <div className="card w-full max-w-md p-6 sm:p-8 border-brand-slate-border shadow-md">
        {/* State Seal & Portal Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-16 w-16 bg-brand-navy/5 border-2 border-brand-brass/40 rounded flex items-center justify-center mb-3">
            <Scale className="h-9 w-9 text-brand-navy" />
          </div>
          <div className="text-[10px] uppercase tracking-widest text-brand-brass font-bold">
            Government of India • Legal Metrology
          </div>
          <h1 className="text-2xl font-bold text-brand-navy mt-1 tracking-tight">e-Maanak Portal</h1>
          <p className="text-brand-slate-muted text-xs mt-1">
            Statutory Digital Verification, Inspection & Certificate Authority
          </p>
        </div>

        {/* Session Expired Banner */}
        {sessionExpired && (
          <div className="mb-4 p-3 bg-amber-50 border border-yellow-300 text-amber-900 text-xs font-semibold rounded flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-brass shrink-0" />
            <span>Your session has expired. Please sign in again with your official credentials.</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-brand-red text-xs font-semibold border border-red-200 rounded flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Real Authentication Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5 text-xs text-left">
            <label className="font-bold text-brand-slate block">Official Email / User ID</label>
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="e.g. officer@emaanak.gov.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field text-xs py-2"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5 text-xs text-left">
            <label className="font-bold text-brand-slate block">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field text-xs py-2"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>Authenticating Identity...</span>
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 text-brand-brass" />
                <span>Sign In to Portal</span>
              </>
            )}
          </button>
        </form>

        {/* Collapsible SIH Evaluation Demo Credentials Helper */}
        <div className="mt-6 pt-4 border-t border-brand-slate-border text-left">
          <button
            type="button"
            onClick={() => setShowDemoHelp(!showDemoHelp)}
            className="text-[11px] text-brand-navy hover:underline font-semibold flex items-center justify-between w-full"
          >
            <span>SIH 2026 Evaluation Accounts Reference</span>
            <span className="text-xs text-brand-slate-muted">{showDemoHelp ? '▲ Hide' : '▼ View'}</span>
          </button>

          {showDemoHelp && (
            <div className="mt-3 space-y-2 text-[11px] bg-slate-50 p-3 rounded border border-brand-slate-border">
              <div className="text-[10px] text-brand-slate-muted uppercase font-bold">Click to populate form:</div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fillCredentials('techcorp@example.com', 'owner123')}
                  className="text-left px-2 py-1 bg-white hover:bg-slate-100 rounded border border-slate-200 text-brand-navy font-mono truncate"
                >
                  <strong>Owner:</strong> techcorp@example.com <span className="text-slate-400 font-sans">(owner123)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('shop@example.com', 'shop123')}
                  className="text-left px-2 py-1 bg-white hover:bg-slate-100 rounded border border-slate-200 text-brand-navy font-mono truncate"
                >
                  <strong>Shop:</strong> shop@example.com <span className="text-slate-400 font-sans">(shop123)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('v.sharma@emaanak.gov.in', 'officer123')}
                  className="text-left px-2 py-1 bg-white hover:bg-slate-100 rounded border border-slate-200 text-brand-navy font-mono truncate"
                >
                  <strong>Officer:</strong> v.sharma@emaanak.gov.in <span className="text-slate-400 font-sans">(officer123)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('admin@emaanak.gov.in', 'admin123')}
                  className="text-left px-2 py-1 bg-white hover:bg-slate-100 rounded border border-slate-200 text-brand-navy font-mono truncate"
                >
                  <strong>Admin:</strong> admin@emaanak.gov.in <span className="text-slate-400 font-sans">(admin123)</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Statutory Legal Metrology Notice */}
        <div className="mt-6 text-center text-[10px] text-brand-slate-muted leading-relaxed">
          Authorized personnel access only. Pursuant to the Legal Metrology Act, 2009.
        </div>
      </div>
    </div>
  );
};

// --- MAIN LAYOUT WITH CONNECTIVITY BEACON & NOTIFICATIONS ---
const MainLayout = ({ role }) => {
  const { user, logout, notifications, unreadCount, fetchNotifications, connectivity } = useAuth();
  const [showNotifs, setShowNotifs] = useState(false);
  const location = useLocation();

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    fetchNotifications();
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg">
      {/* Top Sovereign Masthead */}
      <header className="bg-brand-navy text-white h-16 flex items-center justify-between px-4 sm:px-6 shrink-0 border-b border-white/10 select-none">
        <div className="flex items-center gap-3">
          <Scale className="h-6 w-6 text-brand-brass shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg tracking-wide">e-Maanak</span>
              <span className="text-[10px] bg-brand-brass/20 text-brand-brass border border-brand-brass/40 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider hidden sm:inline-block">
                Legal Metrology
              </span>
            </div>
            <span className="text-[10px] text-white/60 hidden md:block">Department of Consumer Affairs, Govt. of India</span>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {/* Robust Online/Offline Connectivity Beacon */}
          <div className="flex items-center">
            {connectivity.isSyncing ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-blue-500/20 text-blue-200 border border-blue-400/40 animate-pulse">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>Syncing Queue...</span>
              </span>
            ) : connectivity.isOnline ? (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="hidden sm:inline">Online</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40">
                <WifiOff className="h-3 w-3 text-amber-300" />
                <span>Offline (Field Mode)</span>
              </span>
            )}
          </div>

          {/* In-app Notification Center */}
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="p-2 text-white/80 hover:text-white rounded hover:bg-white/10 relative transition-colors"
              title="System Alerts & Expiry Notices"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 bg-brand-red text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-brand-navy">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded border border-brand-slate-border-dark shadow-xl z-50 text-brand-slate overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-brand-slate-border flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-navy uppercase tracking-wider">Statutory Notifications ({unreadCount} unread)</span>
                  {unreadCount > 0 && (
                    <button onClick={handleMarkAllRead} className="text-[10px] text-brand-navy hover:underline font-semibold">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-brand-slate-border text-xs">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-brand-slate-muted">No statutory notices at this time.</div>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className={`p-3 ${n.isRead ? 'bg-white' : 'bg-brand-bg/70'} hover:bg-slate-50 transition-colors`}>
                        <div className="flex items-start gap-2">
                          {n.type === 'ALERT' && <AlertCircle className="h-4 w-4 text-brand-red shrink-0 mt-0.5" />}
                          {n.type === 'WARNING' && <Clock className="h-4 w-4 text-brand-brass shrink-0 mt-0.5" />}
                          {n.type === 'SUCCESS' && <CheckCircle2 className="h-4 w-4 text-brand-green shrink-0 mt-0.5" />}
                          {n.type === 'INFO' && <Award className="h-4 w-4 text-brand-navy shrink-0 mt-0.5" />}
                          <div className="flex-1">
                            <div className="font-semibold text-brand-slate">{n.title}</div>
                            <div className="text-[11px] text-brand-slate-muted mt-0.5 leading-relaxed">{n.message}</div>
                            <div className="text-[10px] text-slate-400 mt-1 tabular-nums">{new Date(n.createdAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-l border-white/20 pl-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-white">{user?.name}</div>
              <div className="text-[10px] text-brand-slate-border-dark capitalize">{user?.role?.toLowerCase()} Portal</div>
            </div>
            <button
              onClick={logout}
              className="p-1.5 text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-60 bg-white border-r border-brand-slate-border hidden md:flex flex-col shrink-0">
          <nav className="flex-1 p-3 space-y-1 text-xs">
            {role === 'owner' && (
              <>
                <Link
                  to="/owner/dashboard"
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded font-medium transition-colors ${location.pathname === '/owner/dashboard' ? 'bg-brand-bg text-brand-navy border border-brand-slate-border-dark font-bold' : 'text-brand-slate hover:bg-slate-50'}`}
                >
                  <LayoutDashboard className="h-4 w-4 text-brand-navy" />
                  My Instruments
                </Link>
                <Link
                  to="/owner/apply"
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded font-medium transition-colors ${location.pathname === '/owner/apply' ? 'bg-brand-bg text-brand-navy border border-brand-slate-border-dark font-bold' : 'text-brand-slate hover:bg-slate-50'}`}
                >
                  <Plus className="h-4 w-4 text-brand-navy" />
                  Register & Apply
                </Link>
              </>
            )}

            {role === 'officer' && (
              <>
                <Link
                  to="/officer/dashboard"
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded font-medium transition-colors ${location.pathname === '/officer/dashboard' ? 'bg-brand-bg text-brand-navy border border-brand-slate-border-dark font-bold' : 'text-brand-slate hover:bg-slate-50'}`}
                >
                  <LayoutDashboard className="h-4 w-4 text-brand-navy" />
                  Field Inspection Bench
                </Link>
              </>
            )}

            {role === 'admin' && (
              <>
                <Link
                  to="/admin/dashboard"
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded font-medium transition-colors ${location.pathname === '/admin/dashboard' ? 'bg-brand-bg text-brand-navy border border-brand-slate-border-dark font-bold' : 'text-brand-slate hover:bg-slate-50'}`}
                >
                  <LayoutDashboard className="h-4 w-4 text-brand-navy" />
                  State Analytics & Federation
                </Link>
              </>
            )}
          </nav>

          <div className="p-3 border-t border-brand-slate-border text-[11px] text-brand-slate-muted space-y-1">
            <div className="flex items-center justify-between">
              <span>Field Engine:</span>
              <span className="font-mono font-bold text-brand-green">v5.0 PWA</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Local Store:</span>
              <span className="font-mono font-bold text-brand-navy">IndexedDB</span>
            </div>
          </div>
        </aside>

        {/* Work Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 bg-brand-bg">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

// --- HARDWARE SCANNER / OCR CAMERA ABSTRACTION ---
const HardwareScannerModal = ({ isOpen, onClose, onScan }) => {
  const [manualCode, setManualCode] = useState('');
  if (!isOpen) return null;

  const sampleBarcodes = [
    { label: 'Avery Scale (SN-TC-99882211)', code: 'SN-TC-99882211' },
    { label: 'Platform Scale (SN-TC-77665544)', code: 'SN-TC-77665544' },
    { label: 'Weighbridge (SN-AG-44332211)', code: 'SN-AG-44332211' },
    { label: 'Dispenser Pump (SN-ML-11223344)', code: 'SN-ML-11223344' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded border border-brand-slate-border-dark p-6 max-w-md w-full space-y-4">
        <div className="flex items-center justify-between border-b border-brand-slate-border pb-3">
          <div className="flex items-center gap-2 text-brand-navy font-bold text-sm">
            <Camera className="h-5 w-5 text-brand-brass" />
            <span>Field Optical Barcode & QR Scanner</span>
          </div>
          <button onClick={onClose} className="text-brand-slate-muted hover:text-brand-slate text-lg font-bold">&times;</button>
        </div>

        {/* Camera Viewport Simulation */}
        <div className="relative bg-slate-900 rounded overflow-hidden aspect-video flex flex-col items-center justify-center text-white border-2 border-dashed border-brand-brass/60 p-4">
          <div className="w-48 h-20 border-2 border-emerald-400 rounded-sm relative flex items-center justify-center">
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-red-500 animate-pulse"></div>
            <span className="text-[10px] text-emerald-300 font-mono tracking-wider">ALIGN SERIAL BARCODE</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-2">Camera stream active • Optical nameplate recognition</span>
        </div>

        {/* Quick Demo Scan Picks */}
        <div className="space-y-1.5 text-xs">
          <div className="font-bold text-brand-slate text-[11px] uppercase">Simulate Physical Nameplate / QR Scan:</div>
          <div className="grid grid-cols-2 gap-2">
            {sampleBarcodes.map(b => (
              <button
                key={b.code}
                onClick={() => { onScan(b.code); onClose(); }}
                className="p-2 border border-brand-slate-border rounded hover:border-brand-navy hover:bg-slate-50 text-left transition-colors"
              >
                <div className="font-mono font-bold text-brand-navy text-[11px]">{b.code}</div>
                <div className="text-[9px] text-brand-slate-muted truncate">{b.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Manual Fallback */}
        <div className="pt-2 border-t border-brand-slate-border flex gap-2">
          <input
            type="text"
            placeholder="Or type raw optical barcode digits..."
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            className="input-field text-xs font-mono"
          />
          <button
            onClick={() => { if (manualCode.trim()) { onScan(manualCode.trim()); onClose(); } }}
            className="btn-primary text-xs shrink-0"
          >
            Apply Code
          </button>
        </div>
      </div>
    </div>
  );
};

// --- OWNER DASHBOARD ---
const OwnerDashboard = () => {
  const [instruments, setInstruments] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showScanner, setShowScanner] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [instData, metricData] = await Promise.all([
        api.getInstruments({ search, status: statusFilter }),
        api.getOwnerAnalytics(),
      ]);
      setInstruments(instData);
      setMetrics(metricData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, statusFilter]);

  const handleApply = async (id) => {
    try {
      await api.applyVerification(id);
      alert('Verification application submitted! Assigned to state queue.');
      loadData();
    } catch (err) {
      alert(err.message || 'Application error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-brand-navy">Registered Weighing & Measuring Instruments</h2>
          <p className="text-xs text-brand-slate-muted mt-0.5">Statutory legal metrology inventory and active verification status</p>
        </div>
        <Link to="/owner/apply" className="btn-primary flex items-center gap-1.5 text-xs">
          <Plus className="h-4 w-4" />
          Register New Instrument
        </Link>
      </div>

      {metrics && metrics.expiringSoon > 0 && (
        <div className="p-3.5 bg-brand-amber border border-yellow-300 rounded text-brand-amber-text text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <Clock className="h-4 w-4 shrink-0 text-brand-brass" />
            <span>Statutory Notice: <strong>{metrics.expiringSoon} instrument(s)</strong> expire within 30 days. Re-verification required.</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider bg-white/70 px-2 py-0.5 rounded border border-yellow-400">Action Required</span>
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3.5 border-l-4 border-l-brand-navy">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Total Inventory</div>
            <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{metrics.totalInstruments}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-green">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Verified & Stamped</div>
            <div className="text-2xl font-bold text-brand-green mt-1 tabular-nums">{metrics.verified}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-brass">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">In Verification Queue</div>
            <div className="text-2xl font-bold text-brand-brass mt-1 tabular-nums">{metrics.pending}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-red">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Expired / Rejected</div>
            <div className="text-2xl font-bold text-brand-red mt-1 tabular-nums">{metrics.expired + metrics.rejected}</div>
          </div>
        </div>
      )}

      <div className="card p-3 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex-1 w-full flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-slate-muted shrink-0" />
          <input
            type="text"
            placeholder="Search by Serial Number, Model, or Manufacturer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field h-8 text-xs border-0 bg-transparent focus:ring-0"
          />
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            title="Scan physical nameplate barcode / QR"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-brand-slate-border rounded hover:bg-slate-100 text-brand-navy shrink-0 font-medium transition-colors"
          >
            <Camera className="h-3.5 w-3.5 text-brand-brass" />
            <span className="hidden sm:inline">Scan Barcode</span>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0">
          <Filter className="h-3.5 w-3.5 text-brand-slate-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 text-xs border border-brand-slate-border rounded px-2 bg-white text-brand-slate"
          >
            <option value="ALL">All Statuses</option>
            <option value="VERIFIED">Verified</option>
            <option value="PENDING">Pending Verification</option>
            <option value="REGISTERED">Registered (Unapplied)</option>
            <option value="EXPIRED">Expired</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-brand-slate-muted">Retrieving instrument registry records...</div>
          ) : instruments.length === 0 ? (
            <div className="p-8 text-center text-xs text-brand-slate-muted">No instruments match the selected filter.</div>
          ) : (
            <table className="w-full text-left border-collapse tabular-nums">
              <thead>
                <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                  <th className="p-3">Serial No.</th>
                  <th className="p-3">Instrument Specification</th>
                  <th className="p-3">Max Capacity</th>
                  <th className="p-3">Verif. Interval (e)</th>
                  <th className="p-3">Legal Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {instruments.map(inst => {
                  const approvedApp = inst.applications?.find(a => a.status === 'APPROVED');
                  const cert = approvedApp?.inspection?.certificate;

                  return (
                    <tr key={inst.id} className="border-b border-brand-slate-border hover:bg-slate-50/70">
                      <td className="p-3 font-mono font-semibold text-brand-navy">{inst.serialNumber}</td>
                      <td className="p-3">
                        <div className="font-medium text-brand-slate">{inst.type}</div>
                        <div className="text-[10px] text-brand-slate-muted">{inst.manufacturer} • {inst.model}</div>
                      </td>
                      <td className="p-3 font-medium">{inst.maxCapacity} &thinsp;kg</td>
                      <td className="p-3">{inst.verificationInterval} &thinsp;kg</td>
                      <td className="p-3">
                        {inst.status === 'VERIFIED' && <span className="badge-passed">Verified</span>}
                        {inst.status === 'PENDING' && <span className="badge-pending">Pending Review</span>}
                        {inst.status === 'REGISTERED' && <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-sm bg-slate-200 text-slate-700">Registered</span>}
                        {inst.status === 'EXPIRED' && <span className="badge-rejected">Expired</span>}
                        {inst.status === 'REJECTED' && <span className="badge-rejected">Rejected</span>}
                      </td>
                      <td className="p-3 text-right">
                        {(inst.status === 'REGISTERED' || inst.status === 'EXPIRED' || inst.status === 'REJECTED') && (
                          <button
                            onClick={() => handleApply(inst.id)}
                            className="text-brand-navy hover:underline font-bold text-xs"
                          >
                            Apply Verification
                          </button>
                        )}
                        {inst.status === 'VERIFIED' && cert && (
                          <Link
                            to={`/certificate/${cert.certificateNumber}`}
                            className="text-brand-navy hover:underline font-bold text-xs inline-flex items-center gap-1"
                          >
                            Certificate <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <HardwareScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => setSearch(code)}
      />
    </div>
  );
};

// --- OWNER REGISTRATION FORM ---
const OwnerApply = () => {
  const navigate = useNavigate();
  const [rules, setRules] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [formData, setFormData] = useState({
    type: 'Electronic Weighing Scale (Class II)',
    manufacturer: '',
    model: '',
    serialNumber: '',
    maxCapacity: '',
    verificationInterval: '0.005'
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getVerificationRules().then(setRules).catch(console.error);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const inst = await api.createInstrument(formData);
      await api.applyVerification(inst.id);
      alert('Instrument Registered and Application queued for physical inspection.');
      navigate('/owner/dashboard');
    } catch (err) {
      alert(err.message || 'Registration error');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-brand-navy">Register Instrument & Submit Verification</h2>
        <p className="text-xs text-brand-slate-muted mt-0.5">Submit equipment metadata to enroll into the legal metrology state registry</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-6 border-brand-slate-border">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          <div className="space-y-1.5 md:col-span-2">
            <label className="font-bold text-brand-slate">Statutory Instrument Classification</label>
            <select
              className="input-field"
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
            >
              {rules.length > 0 ? (
                rules.map(r => <option key={r.id} value={r.name}>{r.name} ({r.category})</option>)
              ) : (
                <>
                  <option>Electronic Weighing Scale (Class II)</option>
                  <option>Platform Scale</option>
                  <option>Weighbridge</option>
                  <option>Dispensing Pump</option>
                </>
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-brand-slate">Manufacturer</label>
            <input
              required
              type="text"
              className="input-field"
              value={formData.manufacturer}
              onChange={e => setFormData({ ...formData, manufacturer: e.target.value })}
              placeholder="e.g. Avery India Ltd."
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-brand-slate">Model Designation</label>
            <input
              required
              type="text"
              className="input-field"
              value={formData.model}
              onChange={e => setFormData({ ...formData, model: e.target.value })}
              placeholder="e.g. DS-852 Pro"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-brand-slate">Serial Number (S/N)</label>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="text-[11px] text-brand-navy hover:underline flex items-center gap-1 font-semibold"
              >
                <Camera className="h-3 w-3 text-brand-brass" />
                <span>Scan Barcode</span>
              </button>
            </div>
            <input
              required
              type="text"
              className="input-field font-mono"
              value={formData.serialNumber}
              onChange={e => setFormData({ ...formData, serialNumber: e.target.value })}
              placeholder="e.g. SN-TC-998822"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-brand-slate">Max Rated Capacity (Max)</label>
            <div className="flex">
              <input
                required
                type="number"
                step="0.01"
                className="input-field rounded-r-none tabular-nums"
                value={formData.maxCapacity}
                onChange={e => setFormData({ ...formData, maxCapacity: e.target.value })}
                placeholder="50.00"
              />
              <span className="bg-slate-50 border border-l-0 border-brand-slate-border-dark px-3 flex items-center text-brand-slate-muted font-bold rounded-r-sm">kg</span>
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="font-bold text-brand-slate">Verification Scale Interval (e)</label>
            <div className="flex">
              <input
                required
                type="number"
                step="0.0001"
                className="input-field rounded-r-none tabular-nums"
                value={formData.verificationInterval}
                onChange={e => setFormData({ ...formData, verificationInterval: e.target.value })}
                placeholder="0.005"
              />
              <span className="bg-slate-50 border border-l-0 border-brand-slate-border-dark px-3 flex items-center text-brand-slate-muted font-bold rounded-r-sm">kg</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-brand-slate-border flex justify-end gap-3 text-xs">
          <Link to="/owner/dashboard" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Registering...' : 'Register & Submit for Verification'}
          </button>
        </div>
      </form>

      <HardwareScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => setFormData(prev => ({ ...prev, serialNumber: code }))}
      />
    </div>
  );
};

// --- OFFICER DASHBOARD (WITH PWA OFFLINE CACHE & SYNC QUEUE) ---
const OfficerDashboard = () => {
  const { connectivity } = useAuth();
  const [apps, setApps] = useState([]);
  const [certs, setCerts] = useState([]);
  const [syncQueue, setSyncQueue] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' | 'syncQueue' | 'certificates'
  const [cacheStatus, setCacheStatus] = useState(null);
  const [revokingCert, setRevokingCert] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [queueSearch, setQueueSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Load sync queue from local IndexedDB
      const localQueue = await offlineDB.getSyncQueue();
      setSyncQueue(localQueue || []);

      if (connectivity.isOnline) {
        // Online: fetch live records
        const [appData, metricData, certData] = await Promise.all([
          api.getPendingApplications(),
          api.getOfficerAnalytics(),
          api.getCertificates(),
        ]);
        setApps(appData);
        setMetrics(metricData);
        setCerts(certData);
      } else {
        // Offline: fetch cached assignments from IndexedDB
        const offlineApps = await offlineDB.getAssignedApplications();
        setApps(offlineApps || []);
      }
    } catch (e) {
      console.warn('Failed to fetch online officer data, falling back to IndexedDB:', e);
      const offlineApps = await offlineDB.getAssignedApplications();
      setApps(offlineApps || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [connectivity.isOnline]);

  const handlePreCache = async () => {
    try {
      setCacheStatus('Caching...');
      const res = await syncEngine.cacheFieldData();
      setCacheStatus(`✓ ${res.count} assignments & rules stored locally in IndexedDB.`);
      setTimeout(() => setCacheStatus(null), 4000);
    } catch (e) {
      setCacheStatus('Failed to cache field data.');
    }
  };

  const handleManualSync = async () => {
    const res = await syncEngine.syncPendingQueue();
    if (res.success) {
      alert(`Sync Complete: ${res.syncedCount} accepted, ${res.conflictCount} conflicts.`);
    } else {
      alert(`Sync Failed: Device appears offline.`);
    }
    loadData();
  };

  const handleRevoke = async (certNumber) => {
    if (!revokeReason.trim()) {
      alert('Statutory reason is required.');
      return;
    }
    try {
      await api.revokeCertificate(certNumber, revokeReason);
      alert(`Certificate ${certNumber} has been officially REVOKED.`);
      setRevokingCert(null);
      setRevokeReason('');
      loadData();
    } catch (err) {
      alert(err.message || 'Revocation error');
    }
  };

  const pendingSyncCount = syncQueue.filter(i => i.status === 'PENDING').length;

  const filteredApps = apps.filter(app => {
    if (!queueSearch) return true;
    const q = queueSearch.toLowerCase();
    return (
      app.instrument?.serialNumber?.toLowerCase().includes(q) ||
      app.instrument?.type?.toLowerCase().includes(q) ||
      app.applicant?.name?.toLowerCase().includes(q) ||
      app.id?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Field Mode Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-brand-navy">Field Inspection & Stamping Bench</h2>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-900 border border-blue-200 rounded text-[10px] font-bold uppercase">
              PWA Mode
            </span>
          </div>
          <p className="text-xs text-brand-slate-muted mt-0.5">Physical calibration testing, offline queue management, and certificate issuance</p>
        </div>

        <div className="flex items-center gap-2">
          {connectivity.isOnline && (
            <button
              onClick={handlePreCache}
              className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
              title="Cache pending assignments and statutory calibration rules into IndexedDB for field work without internet"
            >
              <Download className="h-3.5 w-3.5 text-brand-navy" />
              <span>Pre-Cache for Offline Field</span>
            </button>
          )}

          {pendingSyncCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={!connectivity.isOnline}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 bg-brand-brass border-brand-brass hover:bg-amber-700"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              <span>Sync Queue ({pendingSyncCount})</span>
            </button>
          )}
        </div>
      </div>

      {cacheStatus && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded text-xs font-semibold flex items-center gap-2">
          <HardDrive className="h-4 w-4 shrink-0 text-blue-700" />
          <span>{cacheStatus}</span>
        </div>
      )}

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3.5 border-l-4 border-l-brand-brass">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Pending in Queue</div>
            <div className="text-2xl font-bold text-brand-brass mt-1 tabular-nums">{metrics.pendingQueueCount}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-navy">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Total Inspected</div>
            <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{metrics.totalInspectedByOfficer}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-green">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Passed & Stamped</div>
            <div className="text-2xl font-bold text-brand-green mt-1 tabular-nums">{metrics.passedCount}</div>
          </div>
          <div className="card p-3.5 border-l-4 border-l-brand-red">
            <div className="text-[11px] text-brand-slate-muted font-bold uppercase">Failed Tests</div>
            <div className="text-2xl font-bold text-brand-red mt-1 tabular-nums">{metrics.failedCount}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-brand-slate-border gap-4 text-xs font-bold">
        <button
          onClick={() => setActiveTab('queue')}
          className={`pb-2.5 border-b-2 transition-colors ${activeTab === 'queue' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          Assigned Queue ({apps.length})
        </button>
        <button
          onClick={() => setActiveTab('syncQueue')}
          className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'syncQueue' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          <span>Offline Sync Queue</span>
          {syncQueue.length > 0 && (
            <span className="px-1.5 py-0.2 bg-slate-200 text-brand-navy rounded-full text-[10px]">
              {syncQueue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('certificates')}
          className={`pb-2.5 border-b-2 transition-colors ${activeTab === 'certificates' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          Issued Certificates ({certs.length})
        </button>
      </div>

      {/* Assigned Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          <div className="card p-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-brand-slate-muted shrink-0" />
              <input
                type="text"
                placeholder="Search assigned queue by Serial No, Type, or Applicant..."
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                className="input-field h-8 text-xs border-0 bg-transparent focus:ring-0"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              title="Scan physical instrument barcode or nameplate"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-brand-slate-border rounded hover:bg-slate-100 text-brand-navy shrink-0 font-medium transition-colors"
            >
              <Camera className="h-3.5 w-3.5 text-brand-brass" />
              <span className="hidden sm:inline">Scan Nameplate</span>
            </button>
          </div>

          <div className="card">
            <div className="p-0 overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-xs text-brand-slate-muted">Loading assigned verification queue...</div>
              ) : filteredApps.length === 0 ? (
                <div className="p-8 text-center text-xs text-brand-slate-muted">No applications match the search query.</div>
              ) : (
                <table className="w-full text-left border-collapse tabular-nums">
                  <thead>
                    <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                      <th className="p-3">Application ID</th>
                      <th className="p-3">Applicant / Organization</th>
                      <th className="p-3">Instrument Type</th>
                      <th className="p-3">Serial No.</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {filteredApps.map(app => (
                      <tr key={app.id} className="border-b border-brand-slate-border hover:bg-slate-50">
                        <td className="p-3 font-mono font-medium text-brand-navy">{app.id.slice(0, 8)}...</td>
                        <td className="p-3">
                          <div className="font-semibold text-brand-slate">{app.applicant?.name || 'Applicant'}</div>
                          <div className="text-[10px] text-brand-slate-muted">{app.applicant?.email}</div>
                        </td>
                        <td className="p-3 font-medium">{app.instrument.type}</td>
                        <td className="p-3 font-mono">{app.instrument.serialNumber}</td>
                        <td className="p-3 text-right">
                          <Link
                            to={`/officer/inspect/${app.id}`}
                            className="btn-primary py-1 px-3 text-xs inline-flex items-center gap-1"
                          >
                            {connectivity.isOnline ? 'Start Inspection' : 'Inspect (Offline)'} <ChevronRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Offline Sync Queue Tab */}
      {activeTab === 'syncQueue' && (
        <div className="card">
          <div className="p-3 bg-slate-50 border-b border-brand-slate-border flex items-center justify-between">
            <div className="text-xs font-bold text-brand-navy uppercase">Local Offline Inspections Registry (IndexedDB)</div>
            {connectivity.isOnline && (
              <button onClick={handleManualSync} className="text-xs text-brand-navy font-bold hover:underline flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> Trigger Background Sync
              </button>
            )}
          </div>
          <div className="p-0 overflow-x-auto">
            {syncQueue.length === 0 ? (
              <div className="p-8 text-center text-xs text-brand-slate-muted">
                No inspections currently queued for offline synchronization.
              </div>
            ) : (
              <table className="w-full text-left border-collapse tabular-nums text-xs">
                <thead>
                  <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                    <th className="p-3">Client Operation ID</th>
                    <th className="p-3">Instrument</th>
                    <th className="p-3">Readings Count</th>
                    <th className="p-3">Local Timestamp</th>
                    <th className="p-3">Sync Status</th>
                    <th className="p-3 text-right">Server Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {syncQueue.map(item => (
                    <tr key={item.clientOperationId} className="border-b border-brand-slate-border">
                      <td className="p-3 font-mono text-[11px] text-brand-navy font-semibold">{item.clientOperationId}</td>
                      <td className="p-3">
                        <div className="font-bold">{item.instrumentType}</div>
                        <div className="text-[10px] font-mono text-brand-slate-muted">S/N: {item.instrumentSerial}</div>
                      </td>
                      <td className="p-3">{item.readings?.length || 0} test points</td>
                      <td className="p-3 text-brand-slate-muted">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="p-3">
                        {item.status === 'PENDING' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Pending Sync
                          </span>
                        )}
                        {item.status === 'SYNCED' && (
                          <span className="badge-passed">
                            <CheckCircle2 className="h-3 w-3" /> Synced
                          </span>
                        )}
                        {item.status === 'CONFLICT' && (
                          <span className="badge-rejected bg-red-100 text-red-900">
                            <AlertTriangle className="h-3 w-3" /> Conflict
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {item.serverResult ? (
                          <span className="font-mono font-bold text-brand-green">
                            {item.serverResult.certificateNumber || item.serverResult.result}
                          </span>
                        ) : item.error ? (
                          <span className="text-[10px] text-brand-red font-semibold" title={item.error}>
                            {item.error.slice(0, 30)}...
                          </span>
                        ) : (
                          <span className="text-slate-400">Awaiting Server Validation</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Issued Certificates Tab */}
      {activeTab === 'certificates' && (
        <div className="card">
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums">
              <thead>
                <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                  <th className="p-3">Certificate No.</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3">Instrument</th>
                  <th className="p-3">Validity</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Management</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {certs.map(cert => (
                  <tr key={cert.id} className="border-b border-brand-slate-border hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-brand-navy">{cert.certificateNumber}</td>
                    <td className="p-3">{cert.inspection.application.instrument.owner.name}</td>
                    <td className="p-3">
                      <div>{cert.inspection.application.instrument.type}</div>
                      <div className="text-[10px] font-mono text-brand-slate-muted">S/N: {cert.inspection.application.instrument.serialNumber}</div>
                    </td>
                    <td className="p-3 text-[11px]">
                      {new Date(cert.issueDate).toLocaleDateString()} → {new Date(cert.expiryDate).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      {cert.status === 'VALID' && <span className="badge-passed">Valid</span>}
                      {cert.status === 'EXPIRED' && <span className="badge-rejected">Expired</span>}
                      {cert.status === 'REVOKED' && <span className="badge-rejected bg-red-800 text-white border-red-900">Revoked</span>}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <Link to={`/certificate/${cert.certificateNumber}`} className="text-brand-navy font-bold hover:underline">
                        View
                      </Link>
                      {cert.status === 'VALID' && (
                        <button
                          onClick={() => setRevokingCert(cert.certificateNumber)}
                          className="text-brand-red font-bold hover:underline ml-2"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Revocation Modal */}
      {revokingCert && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded border border-brand-slate-border-dark p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-2 text-brand-red font-bold text-sm">
              <AlertTriangle className="h-5 w-5" />
              <span>Statutory Certificate Revocation</span>
            </div>
            <p className="text-xs text-brand-slate leading-relaxed">
              You are revoking certificate <strong>{revokingCert}</strong>. This will immediately mark the instrument as suspended and flag the public QR registry as REVOKED.
            </p>
            <div className="space-y-1.5 text-xs">
              <label className="font-bold text-brand-slate">Statutory Grounds for Revocation:</label>
              <textarea
                rows={3}
                required
                className="input-field h-auto py-2"
                placeholder="e.g. Field inspection detected unauthorized calibration potentiometer adjustment and broken lead seal."
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 text-xs pt-2">
              <button onClick={() => setRevokingCert(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => handleRevoke(revokingCert)} className="btn-destructive">Confirm Revocation</button>
            </div>
          </div>
        </div>
      )}

      <HardwareScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => setQueueSearch(code)}
      />
    </div>
  );
};

// --- FIELD INSPECTION BENCH (WITH DRAFT AUTO-SAVE & OFFLINE QUEUING) ---
const InspectionBench = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connectivity } = useAuth();
  const [appData, setAppData] = useState(null);
  const [rule, setRule] = useState(null);
  const [readings, setReadings] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedTime, setDraftSavedTime] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedSerial, setScannedSerial] = useState(null);

  useEffect(() => {
    async function loadBenchData() {
      // 1. Try to fetch from online API or fallback to local IndexedDB
      let app = null;
      let r = null;
      let suggestedPoints = [];

      try {
        const res = await api.getApplicationDetails(id);
        app = res.application;
        r = res.rule;
        suggestedPoints = res.suggestedTestPoints || [];
      } catch (err) {
        console.warn('Cannot fetch application details from server, checking local IndexedDB:', err);
        const cachedApps = await offlineDB.getAssignedApplications();
        app = cachedApps.find(a => a.id === id);
        const cachedRules = await offlineDB.getRules();
        r = cachedRules.find(ruleItem => ruleItem.name.includes(app?.instrument?.type));
      }

      if (app) {
        setAppData(app);
        setRule(r);

        // 2. Check for an existing auto-saved draft in IndexedDB
        const draft = await offlineDB.getDraft(id);
        if (draft && draft.readings && draft.readings.length > 0) {
          setReadings(draft.readings);
          setRemarks(draft.remarks || '');
          setDraftSavedTime(draft.lastModified);
        } else if (suggestedPoints.length > 0) {
          setReadings(suggestedPoints.map((p, idx) => ({
            id: idx + 1,
            pointName: p.name,
            ref: p.referenceLoad,
            obs: ''
          })));
        } else {
          const cap = app.instrument.maxCapacity;
          setReadings([
            { id: 1, pointName: '20% Calibration Point', ref: Math.round(cap * 0.2 * 100) / 100, obs: '' },
            { id: 2, pointName: '50% Mid-Scale Load', ref: Math.round(cap * 0.5 * 100) / 100, obs: '' },
            { id: 3, pointName: '100% Full Capacity Load', ref: cap, obs: '' },
          ]);
        }
      }
    }

    loadBenchData();
  }, [id]);

  // Auto-save draft on changes to IndexedDB
  const handleObsChange = (rId, value) => {
    const updated = readings.map(r => r.id === rId ? { ...r, obs: value } : r);
    setReadings(updated);
    offlineDB.saveDraft(id, { readings: updated, remarks });
    setDraftSavedTime(new Date().toISOString());
  };

  const addPoint = () => {
    const nextId = readings.length + 1;
    const updated = [...readings, { id: nextId, pointName: `Supplementary Test Load #${nextId}`, ref: 10.0, obs: '' }];
    setReadings(updated);
    offlineDB.saveDraft(id, { readings: updated, remarks });
  };

  const removePoint = (rId) => {
    if (readings.length <= 1) return;
    const updated = readings.filter(r => r.id !== rId);
    setReadings(updated);
    offlineDB.saveDraft(id, { readings: updated, remarks });
  };

  const allFilled = readings.length > 0 && readings.every(r => r.obs !== '' && !isNaN(Number(r.obs)));

  const handleSubmit = async () => {
    setSubmitting(true);
    const clientOperationId = `OP-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const payloadReadings = readings.map(r => ({
      pointName: r.pointName,
      referenceLoad: Number(r.ref),
      observedValue: Number(r.obs)
    }));

    try {
      if (connectivity.isOnline) {
        // Direct Online Submission
        const res = await api.submitInspection(id, payloadReadings, remarks, clientOperationId);
        await offlineDB.clearDraft(id);

        if (res.inspection.result === 'PASS') {
          alert(`Verification Test PASSED! Certificate ${res.certificate.certificateNumber} generated.`);
          navigate(`/certificate/${res.certificate.certificateNumber}`);
        } else {
          alert('Verification Test FAILED! Observations exceeded statutory Maximum Permissible Error.');
          navigate('/officer/dashboard');
        }
      } else {
        // Offline Field Mode: Enqueue into IndexedDB Sync Queue!
        await offlineDB.enqueueInspection({
          clientOperationId,
          applicationId: id,
          instrumentSerial: appData.instrument.serialNumber,
          applicantName: appData.applicant.name,
          instrumentType: appData.instrument.type,
          ruleVersion: rule?.ruleVersion || 'LM-RULE-2026.1',
          readings: payloadReadings,
          remarks,
        });

        await offlineDB.clearDraft(id);
        alert(`[OFFLINE FIELD MODE]\nInspection saved locally with Operation ID: ${clientOperationId}.\nIt will automatically synchronize when connectivity is restored.`);
        navigate('/officer/dashboard');
      }
    } catch (err) {
      alert(err.message || 'Submission error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!appData) return <div className="p-8 text-center text-xs text-brand-slate-muted">Loading verification bench parameters...</div>;

  const mpeMultiplier = rule?.mpeMultiplier || 1.0;
  const mpe = Math.round((mpeMultiplier * appData.instrument.verificationInterval) * 10000) / 10000;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-2xl font-bold text-brand-navy">Physical Verification Inspection Bench</h2>
          <p className="text-xs text-brand-slate-muted mt-0.5">
            Application {appData.id.slice(0, 8)} • Applicant: {appData.applicant.name} ({appData.applicant.email})
          </p>
        </div>
        {draftSavedTime && (
          <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200">
            Draft Auto-saved: {new Date(draftSavedTime).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Instrument Spec Matrix */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="card p-3 bg-slate-50 border-brand-slate-border">
          <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Instrument Type</div>
          <div className="font-semibold text-brand-navy mt-0.5 truncate">{appData.instrument.type}</div>
        </div>
        <div className="card p-3 bg-slate-50 border-brand-slate-border">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Serial Number</div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="text-[10px] text-brand-navy font-bold hover:underline flex items-center gap-0.5"
              title="Scan physical nameplate barcode to verify against application"
            >
              <Camera className="h-3 w-3 text-brand-brass" />
              <span>Verify</span>
            </button>
          </div>
          <div className="font-mono font-semibold text-brand-navy mt-0.5 flex items-center justify-between">
            <span className="truncate">{appData.instrument.serialNumber}</span>
            {scannedSerial && (
              scannedSerial === appData.instrument.serialNumber ? (
                <span className="text-[9px] bg-green-100 text-green-800 px-1.5 py-0.2 rounded font-sans font-bold border border-green-300">
                  MATCH ✓
                </span>
              ) : (
                <span className="text-[9px] bg-red-100 text-red-800 px-1.5 py-0.2 rounded font-sans font-bold border border-red-300" title={`Scanned: ${scannedSerial}`}>
                  MISMATCH ✗
                </span>
              )
            )}
          </div>
        </div>
        <div className="card p-3 bg-slate-50 border-brand-slate-border">
          <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Rated Max (Max)</div>
          <div className="font-semibold text-brand-navy mt-0.5 tabular-nums">{appData.instrument.maxCapacity} &thinsp;kg</div>
        </div>
        <div className="card p-3 bg-slate-50 border-brand-slate-border">
          <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Tolerance Limit (MPE)</div>
          <div className="font-semibold text-brand-green mt-0.5 tabular-nums">&plusmn;{mpe} &thinsp;kg</div>
        </div>
      </div>

      {/* Observation Table */}
      <div className="card">
        <div className="bg-brand-navy text-white px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-bold tracking-wide">Multi-Point Test Readings ({rule?.ruleVersion || 'LM-RULE-2026.1'})</div>
          <button onClick={addPoint} className="text-[11px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white font-medium flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add Test Point
          </button>
        </div>

        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse tabular-nums text-xs">
            <thead>
              <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                <th className="p-3 w-1/4">Test Schedule Point</th>
                <th className="p-3 w-1/5">Reference Standard (kg)</th>
                <th className="p-3 w-1/5">Observed Reading (kg)</th>
                <th className="p-3 w-1/6">Live Error Preview</th>
                <th className="p-3 w-1/6">Compliance Status</th>
                <th className="p-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {readings.map(r => {
                const hasObs = r.obs !== '' && !isNaN(Number(r.obs));
                const error = hasObs ? Math.round((Number(r.obs) - Number(r.ref)) * 10000) / 10000 : null;
                const isPass = error !== null ? Math.abs(error) <= (mpe + 0.00001) : null;

                return (
                  <tr key={r.id} className="border-b border-brand-slate-border last:border-b-0">
                    <td className="p-3">
                      <input
                        type="text"
                        value={r.pointName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReadings(prev => prev.map(p => p.id === r.id ? { ...p, pointName: val } : p));
                        }}
                        className="input-field h-7 text-xs"
                      />
                    </td>
                    <td className="p-3 font-semibold text-brand-slate">
                      <input
                        type="number"
                        step="0.001"
                        value={r.ref}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReadings(prev => prev.map(p => p.id === r.id ? { ...p, ref: val } : p));
                        }}
                        className="input-field h-7 text-xs font-mono w-24"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        step="0.0001"
                        className="input-field h-7 text-xs font-mono w-28 font-bold"
                        value={r.obs}
                        onChange={(e) => handleObsChange(r.id, e.target.value)}
                        placeholder="0.000"
                      />
                    </td>
                    <td className="p-3 font-mono">
                      {error !== null ? (
                        <span className={isPass ? 'text-brand-slate font-semibold' : 'text-brand-red font-bold'}>
                          {error > 0 ? '+' : ''}{error.toFixed(4)} kg
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isPass === true && <span className="badge-passed">Compliant</span>}
                      {isPass === false && <span className="badge-rejected">Exceeds MPE</span>}
                      {isPass === null && <span className="text-[10px] text-brand-slate-muted">Enter Observed</span>}
                    </td>
                    <td className="p-3 text-right">
                      {readings.length > 1 && (
                        <button onClick={() => removePoint(r.id)} className="text-brand-red hover:text-red-700 text-xs font-bold">
                          &times;
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-slate-50 border-t border-brand-slate-border text-[11px] text-brand-slate-muted leading-relaxed flex items-center justify-between">
          <span><strong>Local Calculation Preview:</strong> Authoritative pass/fail is validated by server engine upon sync.</span>
          {!connectivity.isOnline && (
            <span className="text-amber-800 font-bold flex items-center gap-1">
              <WifiOff className="h-3 w-3" /> Will save to offline queue
            </span>
          )}
        </div>
      </div>

      {/* Remarks & Submission */}
      <div className="card p-5 space-y-4 border-brand-slate-border">
        <div className="space-y-1 text-xs">
          <label className="font-bold text-brand-slate">Statutory Officer Observations & Remarks:</label>
          <textarea
            rows={2}
            className="input-field h-auto py-2 text-xs"
            value={remarks}
            onChange={e => {
              setRemarks(e.target.value);
              offlineDB.saveDraft(id, { readings, remarks: e.target.value });
            }}
            placeholder="e.g. Counter scale level bubble centered, knife-edge bearing inspected, security seal stamped with verification punch."
          />
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-brand-slate-border">
          <div className="text-[11px] text-brand-slate-muted">
            {connectivity.isOnline ? 'Submitting directly to central server.' : 'Operating offline: Inspection will be queued in IndexedDB.'}
          </div>
          <div className="flex gap-2.5">
            <Link to="/officer/dashboard" className="btn-secondary text-xs">Cancel</Link>
            <button
              onClick={handleSubmit}
              disabled={!allFilled || submitting}
              className={`btn-primary text-xs flex items-center gap-1.5 ${!connectivity.isOnline ? 'bg-brand-brass border-brand-brass hover:bg-amber-700' : ''}`}
            >
              {submitting ? 'Processing...' : connectivity.isOnline ? (
                <>Validate & Issue Stamped Record</>
              ) : (
                <>Queue for Offline Sync <Send className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        </div>
      </div>

      <HardwareScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => setScannedSerial(code)}
      />
    </div>
  );
};

// --- ADMIN DASHBOARD (ANALYTICS, AUDIT TRAIL, & STATE FEDERATION) ---
const AdminDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [federation, setFederation] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'audit' | 'rules' | 'users' | 'federation'
  const [loading, setLoading] = useState(true);
  const [exportingCert, setExportingCert] = useState('');
  const [exportResult, setExportResult] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getAdminAnalytics(),
      api.getAuditLogs({ limit: 25 }),
      api.getVerificationRules(),
      api.getUsers(),
      api.getFederationHealth(),
    ]).then(([aData, lData, rData, uData, fData]) => {
      setAnalytics(aData);
      setAuditLogs(lData.logs || []);
      setRules(rData || []);
      setUsers(uData || []);
      setFederation(fData);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleTestFederationExport = async () => {
    if (!exportingCert.trim()) {
      alert('Enter a certificate number to export (e.g. CERT-2026-901).');
      return;
    }
    try {
      const res = await api.exportCertificateFederation(exportingCert.trim(), 'NATIONAL_LEGAL_METROLOGY_GATEWAY_V1');
      setExportResult(res);
      // reload federation status
      const updatedFed = await api.getFederationHealth();
      setFederation(updatedFed);
    } catch (e) {
      alert(e.message || 'Federation export error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-brand-navy">State Legal Metrology Administrative Oversight</h2>
        <p className="text-xs text-brand-slate-muted mt-0.5">Real-time system monitoring, statutory audit trail, national federation node, and user directory</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-brand-slate-border gap-4 text-xs font-bold overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-2.5 border-b-2 whitespace-nowrap transition-colors ${activeTab === 'overview' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          State Overview & Metrics
        </button>
        <button
          onClick={() => setActiveTab('federation')}
          className={`pb-2.5 border-b-2 whitespace-nowrap transition-colors ${activeTab === 'federation' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          National Federation Gateway
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-2.5 border-b-2 whitespace-nowrap transition-colors ${activeTab === 'audit' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          System Audit Trail ({auditLogs.length})
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`pb-2.5 border-b-2 whitespace-nowrap transition-colors ${activeTab === 'rules' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          Statutory Calibration Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-2.5 border-b-2 whitespace-nowrap transition-colors ${activeTab === 'users' ? 'border-brand-navy text-brand-navy' : 'border-transparent text-brand-slate-muted hover:text-brand-slate'}`}
        >
          Authorized Actors ({users.length})
        </button>
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="card p-3.5 border-l-4 border-l-brand-navy">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Instruments</div>
              <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{analytics.overview.totalInstruments}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-brand-brass">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Owners</div>
              <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{analytics.overview.totalOwners}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-brand-navy">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Officers</div>
              <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{analytics.overview.totalOfficers}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-brand-green">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Inspections</div>
              <div className="text-2xl font-bold text-brand-navy mt-1 tabular-nums">{analytics.overview.totalInspections}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-brand-green">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Pass Rate</div>
              <div className="text-2xl font-bold text-brand-green mt-1 tabular-nums">{analytics.inspections.passRate}%</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-brand-red">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Revocations</div>
              <div className="text-2xl font-bold text-brand-red mt-1 tabular-nums">{analytics.certificates.revoked}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-brand-navy mb-4">State Instrument Status Breakdown</h3>
              <div className="space-y-3 text-xs">
                {Object.entries(analytics.instrumentStatusDistribution || {}).map(([st, cnt]) => (
                  <div key={st}>
                    <div className="flex justify-between font-medium mb-1">
                      <span className="capitalize">{st.toLowerCase()}</span>
                      <span className="tabular-nums font-bold text-brand-navy">{cnt}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded overflow-hidden">
                      <div
                        className={`h-full ${st === 'VERIFIED' ? 'bg-brand-green' : st === 'PENDING' ? 'bg-brand-brass' : st === 'REGISTERED' ? 'bg-slate-400' : 'bg-brand-red'}`}
                        style={{ width: `${analytics.overview.totalInstruments > 0 ? (cnt / analytics.overview.totalInstruments) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-brand-navy mb-4">Equipment by Category</h3>
              <div className="space-y-3 text-xs">
                {Object.entries(analytics.instrumentTypeDistribution || {}).map(([tp, cnt]) => (
                  <div key={tp} className="flex justify-between items-center p-2 rounded bg-slate-50 border border-brand-slate-border">
                    <span className="font-medium text-brand-slate">{tp}</span>
                    <span className="font-mono font-bold text-brand-navy px-2 py-0.5 bg-white border border-brand-slate-border-dark rounded tabular-nums">{cnt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: State Federation & Sync Node */}
      {activeTab === 'federation' && federation && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4 border-l-4 border-l-brand-green">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Node Status</div>
              <div className="text-xl font-bold text-brand-green mt-1">{federation.adapterStatus}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Protocol: {federation.protocolVersion}</div>
            </div>
            <div className="card p-4 border-l-4 border-l-brand-navy">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Active Gateway Targets</div>
              <div className="text-xl font-bold text-brand-navy mt-1">{federation.targetNodes.length} Nodes Connected</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Avg Latency: ~22ms</div>
            </div>
            <div className="card p-4 border-l-4 border-l-brand-brass">
              <div className="text-[10px] text-brand-slate-muted font-bold uppercase">Federated Exchanges</div>
              <div className="text-xl font-bold text-brand-brass mt-1 tabular-nums">{federation.totalFederatedExchanges} Transmitted</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">National Ledger Sync</div>
            </div>
          </div>

          {/* Connected Gateway Nodes */}
          <div className="card p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-brand-navy">Federation Target Network Nodes</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {federation.targetNodes.map(node => (
                <div key={node.id} className="p-3 border border-brand-slate-border rounded bg-slate-50 space-y-1">
                  <div className="flex items-center justify-between font-bold text-brand-slate">
                    <span>{node.name}</span>
                    <span className="text-[10px] px-1.5 py-0.2 bg-green-100 text-green-800 rounded font-mono">{node.status}</span>
                  </div>
                  <div className="text-[10px] font-mono text-brand-slate-muted">ID: {node.id} • Latency: {node.latencyMs}ms</div>
                </div>
              ))}
            </div>
          </div>

          {/* Test Certificate Federation Export */}
          <div className="card p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-brand-navy">Simulate National Repository Certificate Synchronization</h3>
            <p className="text-xs text-brand-slate-muted">Standardizes an internal stamped certificate into the national Legal Metrology Exchange schema (DOCA-LM-CENTRAL-NODE-01).</p>
            
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                placeholder="Enter Certificate No. (e.g. CERT-2026-901)"
                value={exportingCert}
                onChange={e => setExportingCert(e.target.value)}
                className="input-field text-xs font-mono"
              />
              <button onClick={handleTestFederationExport} className="btn-primary text-xs shrink-0">
                Export to National Node
              </button>
            </div>

            {exportResult && (
              <div className="p-4 bg-slate-50 border border-brand-slate-border-dark rounded space-y-2 text-xs">
                <div className="flex items-center justify-between text-brand-green font-bold">
                  <span>✓ Standardized Data Contract Transmitted Successfully</span>
                  <span className="font-mono text-[10px]">{exportResult.transactionReference}</span>
                </div>
                <pre className="p-3 bg-slate-900 text-emerald-400 font-mono text-[10px] rounded overflow-x-auto">
                  {JSON.stringify(exportResult.contract, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="card">
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse tabular-nums text-xs">
              <thead>
                <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Statutory Action</th>
                  <th className="p-3">Target Entity</th>
                  <th className="p-3">Metadata Audit Record</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(l => (
                  <tr key={l.id} className="border-b border-brand-slate-border hover:bg-slate-50">
                    <td className="p-3 text-brand-slate-muted whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="p-3 font-medium text-brand-navy">
                      <div>{l.actor?.name || 'System / Auto'}</div>
                      <div className="text-[10px] text-brand-slate-muted">{l.actor?.email}</div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono font-bold text-[11px] text-brand-navy bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {l.action}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-[11px]">{l.entity} ({l.entityId.slice(0, 8)}...)</td>
                    <td className="p-3 font-mono text-[10px] text-brand-slate-muted max-w-xs truncate">{l.metadata}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Calibration Rules */}
      {activeTab === 'rules' && (
        <div className="card">
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                  <th className="p-3">Rule Version</th>
                  <th className="p-3">Instrument Category</th>
                  <th className="p-3">Tolerance Factor</th>
                  <th className="p-3">Max Allowed Error</th>
                  <th className="p-3">Standard Description</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-brand-slate-border">
                    <td className="p-3 font-mono font-bold text-brand-navy">{r.ruleVersion}</td>
                    <td className="p-3">
                      <div className="font-bold text-brand-slate">{r.name}</div>
                      <div className="text-[10px] text-brand-slate-muted">{r.category}</div>
                    </td>
                    <td className="p-3 font-mono">{r.mpeMultiplier} &times; e</td>
                    <td className="p-3 font-mono">{r.maxAllowedErrorPct ? `${r.maxAllowedErrorPct}%` : 'Class MPE bound'}</td>
                    <td className="p-3 text-[11px] text-brand-slate-muted max-w-sm">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Users */}
      {activeTab === 'users' && (
        <div className="card">
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b 2px border-brand-slate-border-dark bg-slate-50 text-[11px] uppercase tracking-wider text-brand-navy">
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Registered On</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-brand-slate-border">
                    <td className="p-3 font-bold text-brand-navy">{u.name}</td>
                    <td className="p-3 font-mono">{u.email}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : u.role === 'OFFICER' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-3 text-brand-slate-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// --- OFFICIAL DIGITAL CERTIFICATE ---
const DigitalCertificate = () => {
  const { id } = useParams();
  const [cert, setCert] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getCertificate(id).then(setCert).catch(err => setError(err.message));
  }, [id]);

  if (error) return <div className="p-8 text-center text-brand-red font-bold text-xs">{error}</div>;
  if (!cert) return <div className="p-8 text-center text-brand-slate-muted text-xs">Loading certificate record...</div>;

  const verifyUrl = `${window.location.origin}/verify/${cert.qrToken}`;

  return (
    <div className="min-h-screen bg-brand-bg py-6 px-4 flex flex-col items-center">
      <div className="w-full max-w-3xl flex justify-between items-center mb-4 print:hidden">
        <Link to="/" className="text-brand-navy font-bold text-xs hover:underline flex items-center gap-1">
          &larr; Return to Portal
        </Link>
        <button
          onClick={() => window.print()}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF Certificate
        </button>
      </div>

      <div className="w-full max-w-3xl bg-white border border-brand-slate-border-dark relative shadow-sm overflow-hidden p-8 sm:p-12">
        <div className="absolute inset-1.5 border-[2px] border-double border-brand-brass pointer-events-none opacity-60"></div>

        <div className="bg-slate-100 border border-slate-300 p-2 text-center text-[10px] text-slate-600 mb-6 font-mono tracking-wide uppercase">
          Prototype Verification Instrument • Smart India Hackathon 2026 • SIH26036 Legal Metrology Demonstration
        </div>

        {cert.status === 'REVOKED' && (
          <div className="mb-6 p-4 bg-brand-red-light border-2 border-brand-red text-brand-red rounded text-center">
            <div className="font-bold text-base uppercase tracking-widest flex items-center justify-center gap-2">
              <AlertTriangle className="h-5 w-5" /> CERTIFICATE REVOKED
            </div>
            <div className="text-xs mt-1">Grounds: {cert.revocationReason}</div>
            <div className="text-[10px] text-slate-500 mt-1">Revoked By: {cert.revokedBy} on {new Date(cert.revokedAt).toLocaleDateString()}</div>
          </div>
        )}

        <div className="text-center space-y-2 border-b-2 border-brand-navy pb-6">
          <Scale className="h-12 w-12 text-brand-navy mx-auto mb-2" />
          <h1 className="text-2xl font-bold text-brand-navy uppercase tracking-widest">Certificate of Verification</h1>
          <p className="text-xs font-bold text-brand-slate uppercase tracking-wider">Department of Legal Metrology</p>
          <p className="text-[11px] text-brand-slate-muted">Government of India • Verification Rule: {cert.inspection.ruleVersion}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-xs mt-6">
          <div>
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Certificate Identifier</div>
            <div className="font-mono font-bold text-brand-slate text-sm">{cert.certificateNumber}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Date of Physical Verification</div>
            <div className="font-medium text-brand-slate tabular-nums">{new Date(cert.issueDate).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Certified Owner</div>
            <div className="font-bold text-brand-slate">{cert.inspection.application.instrument.owner.name}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Statutory Validity Until</div>
            <div className={`font-bold tabular-nums text-sm ${cert.status === 'VALID' ? 'text-brand-green' : 'text-brand-red'}`}>
              {new Date(cert.expiryDate).toLocaleDateString()} ({cert.status})
            </div>
          </div>

          <div className="col-span-2 border-t border-brand-slate-border pt-4 mt-2">
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase mb-2">Instrument Specifications</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 p-3 border border-brand-slate-border rounded">
              <div><strong>Type:</strong> {cert.inspection.application.instrument.type}</div>
              <div><strong>Manufacturer:</strong> {cert.inspection.application.instrument.manufacturer}</div>
              <div><strong>Model:</strong> {cert.inspection.application.instrument.model}</div>
              <div><strong>Serial Number:</strong> <span className="font-mono">{cert.inspection.application.instrument.serialNumber}</span></div>
              <div><strong>Max Capacity:</strong> {cert.inspection.application.instrument.maxCapacity} &thinsp;kg</div>
              <div><strong>Interval (e):</strong> {cert.inspection.application.instrument.verificationInterval} &thinsp;kg</div>
            </div>
          </div>
        </div>

        {cert.inspection.readings && cert.inspection.readings.length > 0 && (
          <div className="mt-6 border-t border-brand-slate-border pt-4">
            <div className="text-[10px] font-bold text-brand-slate-muted uppercase mb-2">Physical Calibration Test Schedule</div>
            <table className="w-full text-left border border-brand-slate-border text-[11px] tabular-nums">
              <thead>
                <tr className="bg-slate-100 text-brand-navy font-bold border-b border-brand-slate-border">
                  <th className="p-2">Test Point</th>
                  <th className="p-2">Standard (kg)</th>
                  <th className="p-2">Observed (kg)</th>
                  <th className="p-2">Observed Error</th>
                  <th className="p-2">Permissible MPE</th>
                  <th className="p-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {cert.inspection.readings.map((r, i) => (
                  <tr key={r.id || i} className="border-b border-slate-100 last:border-b-0">
                    <td className="p-2">{r.pointName}</td>
                    <td className="p-2">{r.referenceLoad}</td>
                    <td className="p-2">{r.observedValue}</td>
                    <td className="p-2 font-mono">{r.error > 0 ? '+' : ''}{r.error.toFixed(4)} kg</td>
                    <td className="p-2 font-mono">&plusmn;{r.maxPermissibleError} kg</td>
                    <td className="p-2"><span className="badge-passed">{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between items-end border-t-2 border-brand-slate-border-dark pt-8 mt-8">
          <div>
            <div className="w-44 border-b border-brand-slate-border-dark mb-1 h-12 flex items-end justify-center">
              <span className="font-serif italic text-xl text-brand-navy">{cert.inspection.officer.name}</span>
            </div>
            <div className="text-[10px] font-bold text-brand-slate uppercase">Authorized Verification Officer</div>
            <div className="text-[9px] text-brand-slate-muted">{cert.inspection.officer.email}</div>
          </div>

          <div className="text-center space-y-1.5">
            <div className="p-1 border border-brand-navy inline-block bg-white">
              <QRCodeSVG value={verifyUrl} size={110} level="H" />
            </div>
            <div className="text-[9px] font-mono tracking-widest text-brand-slate-muted">SCAN TO AUTHENTICATE</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- PUBLIC QR VERIFICATION PORTAL ---
const PublicVerification = () => {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.verifyPublicQR(token)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4">
      <div className="text-center space-y-1.5 mb-6">
        <Scale className="h-10 w-10 text-brand-navy mx-auto" />
        <div className="text-base font-bold text-brand-navy">National Legal Metrology Registry</div>
        <div className="text-[11px] text-brand-slate-muted">Public Instrument Verification & Authenticity Portal</div>
      </div>

      {loading && (
        <div className="card p-8 max-w-md w-full text-center text-xs text-brand-slate-muted">
          Validating cryptographic verification token against state repository...
        </div>
      )}

      {error && (
        <div className="w-full max-w-md bg-white border border-brand-red rounded shadow-sm overflow-hidden">
          <div className="bg-brand-red-light border-b border-red-200 px-6 py-4 flex items-center justify-center gap-2">
            <XCircle className="text-brand-red h-6 w-6" />
            <h2 className="text-base font-bold text-brand-red tracking-wide uppercase">Invalid Verification Record</h2>
          </div>
          <div className="p-6 text-center space-y-2 text-xs text-brand-slate">
            <p className="font-semibold">No authentic legal metrology certificate matches this token.</p>
            <p className="text-slate-500">The QR token is unrecognized, altered, or was never issued by the state metrology office.</p>
          </div>
        </div>
      )}

      {data && (
        <div className="w-full max-w-md bg-white border border-brand-slate-border-dark shadow-sm rounded overflow-hidden">
          <div
            className={`px-6 py-4 flex items-center justify-center gap-2 border-b ${
              data.status === 'VALID'
                ? 'bg-brand-green-light border-green-200 text-brand-green'
                : data.status === 'EXPIRED'
                ? 'bg-brand-amber border-yellow-300 text-brand-amber-text'
                : 'bg-brand-red-light border-red-200 text-brand-red'
            }`}
          >
            {data.status === 'VALID' && <CheckCircle2 className="h-6 w-6" />}
            {data.status === 'EXPIRED' && <Clock className="h-6 w-6" />}
            {data.status === 'REVOKED' && <AlertTriangle className="h-6 w-6" />}
            <h2 className="text-base font-bold tracking-wider uppercase">
              {data.status === 'VALID' ? 'Verified & Valid Certificate' : data.status === 'EXPIRED' ? 'Expired Certificate' : 'Revoked Certificate'}
            </h2>
          </div>

          <div className="p-6 space-y-4 text-xs">
            {data.status === 'REVOKED' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-brand-red text-[11px]">
                <strong>Statutory Notice:</strong> This certificate was officially revoked. Commercial use is prohibited.
                {data.revocationReason && <div className="mt-1">Reason: {data.revocationReason}</div>}
              </div>
            )}

            {data.status === 'EXPIRED' && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-brand-amber-text text-[11px]">
                <strong>Warning:</strong> The validity period for this instrument has expired. Re-stamping is mandatory.
              </div>
            )}

            <div>
              <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Certificate Number</div>
              <div className="font-mono font-bold text-base text-brand-navy">{data.certificateNumber}</div>
            </div>

            <div className="pt-3 border-t border-brand-slate-border space-y-1">
              <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Instrument Particulars</div>
              <div className="font-bold text-brand-slate text-sm">{data.instrumentType}</div>
              <div className="text-brand-slate-muted">{data.manufacturer} • Model: {data.model}</div>
              <div className="font-mono text-xs font-semibold text-brand-navy">Serial: {data.serialNumber}</div>
              <div className="text-brand-slate-muted tabular-nums">Capacity: {data.maxCapacity} kg (e = {data.verificationInterval} kg)</div>
            </div>

            <div className="pt-3 border-t border-brand-slate-border space-y-1">
              <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Certified Owner</div>
              <div className="font-semibold text-brand-slate">{data.ownerOrganization}</div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-brand-slate-border tabular-nums">
              <div>
                <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Verified On</div>
                <div className="font-semibold text-sm">{new Date(data.issueDate).toLocaleDateString()}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-brand-slate-muted uppercase">Valid Until</div>
                <div className={`font-bold text-sm ${data.status === 'VALID' ? 'text-brand-green' : 'text-brand-red'}`}>
                  {new Date(data.expiryDate).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-brand-slate-border flex items-center justify-between text-[11px] text-brand-slate-muted">
              <div>Issuing Officer: <strong>{data.officerName}</strong></div>
              <div>Standard: <strong>{data.ruleVersion}</strong></div>
            </div>
          </div>

          <div className="bg-slate-50 border-t border-brand-slate-border p-3 text-center text-[10px] text-brand-slate-muted">
            Authenticated via State Legal Metrology Cryptographic Hash
          </div>
        </div>
      )}

      <div className="mt-8">
        <Link to="/" className="text-xs font-bold text-brand-navy hover:underline flex items-center gap-1">
          &larr; Access e-Maanak Portal
        </Link>
      </div>
    </div>
  );
};

// --- APP ROUTER ---
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Authentication Gateways */}
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Login />} />

          {/* Owner Role Routes */}
          <Route element={<ProtectedRoute allowedRoles={['OWNER']} />}>
            <Route path="/owner" element={<MainLayout role="owner" />}>
              <Route path="dashboard" element={<OwnerDashboard />} />
              <Route path="apply" element={<OwnerApply />} />
              <Route index element={<Navigate to="/owner/dashboard" replace />} />
            </Route>
            <Route path="/app/owner" element={<MainLayout role="owner" />}>
              <Route path="dashboard" element={<OwnerDashboard />} />
              <Route path="apply" element={<OwnerApply />} />
              <Route index element={<Navigate to="/owner/dashboard" replace />} />
            </Route>
          </Route>

          {/* Officer Role Routes (PWA Offline Enabled) */}
          <Route element={<ProtectedRoute allowedRoles={['OFFICER']} />}>
            <Route path="/officer" element={<MainLayout role="officer" />}>
              <Route path="dashboard" element={<OfficerDashboard />} />
              <Route path="inspect/:id" element={<InspectionBench />} />
              <Route index element={<Navigate to="/officer/dashboard" replace />} />
            </Route>
            <Route path="/app/officer" element={<MainLayout role="officer" />}>
              <Route path="dashboard" element={<OfficerDashboard />} />
              <Route path="inspect/:id" element={<InspectionBench />} />
              <Route index element={<Navigate to="/officer/dashboard" replace />} />
            </Route>
          </Route>

          {/* Admin Role Routes (Federation & Audit Oversight) */}
          <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
            <Route path="/admin" element={<MainLayout role="admin" />}>
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route index element={<Navigate to="/admin/dashboard" replace />} />
            </Route>
            <Route path="/app/admin" element={<MainLayout role="admin" />}>
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route index element={<Navigate to="/admin/dashboard" replace />} />
            </Route>
          </Route>

          {/* Authenticated Certificate View */}
          <Route element={<ProtectedRoute />}>
            <Route path="/certificate/:id" element={<DigitalCertificate />} />
          </Route>

          {/* Public QR Verification Portal (Unauthenticated Public Check) */}
          <Route path="/verify/:token" element={<PublicVerification />} />

          {/* Unmatched routes redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
