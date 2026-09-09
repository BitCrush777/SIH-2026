import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ''
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.PROD ? '/api/v1' : 'http://localhost:5000/api/v1');

/**
 * Centralized API Client with automated Supabase token attachment,
 * 401 Session Expiration interception, and 403 Forbidden handling.
 */
export async function apiClient(endpoint, options = {}) {
  let token = null;

  // 1. Resolve token from active Supabase Auth session
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      token = data.session.access_token;
    }
  } catch (authErr) {
    // Silent failover to stored token
  }

  // Fallback to localStorage token if session token is not yet ready or offline
  if (!token) {
    token = localStorage.getItem('token');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (netErr) {
    console.error('API Client Network Error:', netErr);
    throw new Error('Network connection failure. Server is unreachable.');
  }

  // Handle 401 Unauthorized: Session expiration / invalid token (except on login attempt)
  if (res.status === 401 && !endpoint.includes('/auth/login')) {
    localStorage.removeItem('token');
    await supabase.auth.signOut().catch(() => {});
    window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { reason: 'session_expired' } }));
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Your session has expired. Please sign in again.');
  }

  // Handle 403 Forbidden
  if (res.status === 403) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Access Restricted: Insufficient statutory role privileges.');
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Request failed with status ${res.status}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

export const api = {
  // Auth
  login: async (email, password) => {
    return apiClient('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim(), password })
    });
  },
  
  getMe: async () => {
    return apiClient('/auth/me');
  },

  getUsers: async () => {
    return apiClient('/auth/users');
  },

  // Instruments
  getInstruments: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.status) params.append('status', filters.status);
    if (filters.type) params.append('type', filters.type);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient(`/instruments${query}`);
  },

  createInstrument: async (data) => {
    return apiClient('/instruments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Verifications
  applyVerification: async (instrumentId) => {
    return apiClient('/verifications/apply', {
      method: 'POST',
      body: JSON.stringify({ instrumentId })
    });
  },

  getPendingApplications: async () => {
    return apiClient('/verifications/pending');
  },

  getApplicationDetails: async (id) => {
    return apiClient(`/verifications/application/${id}`);
  },

  getVerificationRules: async () => {
    return apiClient('/verifications/rules');
  },

  submitInspection: async (applicationId, readings, remarks, clientOperationId) => {
    return apiClient('/verifications/inspect', {
      method: 'POST',
      body: JSON.stringify({ applicationId, readings, remarks, clientOperationId })
    });
  },

  // Certificates
  getCertificates: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.search) params.append('search', filters.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient(`/certificates${query}`);
  },

  getCertificate: async (certNumber) => {
    return apiClient(`/certificates/${certNumber}`);
  },

  revokeCertificate: async (certNumber, reason) => {
    return apiClient(`/certificates/${certNumber}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  verifyPublicQR: async (token) => {
    return apiClient(`/certificates/public/verify/${token}`);
  },

  // Notifications
  getNotifications: async () => {
    return apiClient('/notifications');
  },

  markNotificationRead: async (id) => {
    return apiClient(`/notifications/${id}/read`, {
      method: 'POST'
    });
  },

  markAllNotificationsRead: async () => {
    return apiClient('/notifications/mark-all-read', {
      method: 'POST'
    });
  },

  // Analytics
  getOwnerAnalytics: async () => {
    return apiClient('/analytics/owner');
  },

  getOfficerAnalytics: async () => {
    return apiClient('/analytics/officer');
  },

  getAdminAnalytics: async () => {
    return apiClient('/analytics/admin');
  },

  // Audit Logs
  getAuditLogs: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.action) params.append('action', filters.action);
    if (filters.entity) params.append('entity', filters.entity);
    if (filters.search) params.append('search', filters.search);
    if (filters.limit) params.append('limit', filters.limit);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient(`/audit-logs${query}`);
  },

  // Offline Field Synchronization (v1)
  syncOfflineInspection: async (payload) => {
    return apiClient('/verifications/sync', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // State Repository Federation
  getFederationHealth: async () => {
    return apiClient('/federation/health');
  },

  exportCertificateFederation: async (certNumber, targetRepository) => {
    return apiClient(`/federation/export/${certNumber}`, {
      method: 'POST',
      body: JSON.stringify({ targetRepository })
    });
  }
};
