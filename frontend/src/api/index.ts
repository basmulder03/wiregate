import api from './client'
import type {
  LoginResponse,
  User,
  WireGuardServer,
  Client,
  ConnectedPeer,
  APIKey,
  AuditLog,
  ServerStatus,
  SetupStatus,
} from '@/types'

// Auth
export const authApi = {
  login: (username: string, password: string, totpCode?: string) =>
    api.post<LoginResponse>('/auth/login', { username, password, totp_code: totpCode }),

  setup: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/setup', { username, password }),

  me: () => api.get<User>('/auth/me'),

  setupTOTP: () => api.post<{ secret: string; qr_url: string }>('/auth/totp/setup'),
  confirmTOTP: (code: string) => api.post('/auth/totp/confirm', { code }),
  disableTOTP: (code: string) => api.post('/auth/totp/disable', { code }),

  createAPIKey: (name: string, scopes?: string, expiresAt?: string) =>
    api.post<{ key: string; api_key: APIKey }>('/auth/api-keys', { name, scopes, expires_at: expiresAt }),
  listAPIKeys: () => api.get<APIKey[]>('/auth/api-keys'),
  deleteAPIKey: (id: number) => api.delete(`/auth/api-keys/${id}`),
}

// Setup status
export const setupApi = {
  status: () => api.get<SetupStatus>('/setup/status'),
}

// Server
export const serverApi = {
  get: () => api.get<WireGuardServer>('/server'),
  update: (data: Partial<WireGuardServer>) => api.put<WireGuardServer>('/server', data),
  status: () => api.get<ServerStatus>('/server/status'),
  start: () => api.post('/server/start'),
  stop: () => api.post('/server/stop'),
  restart: () => api.post('/server/restart'),
}

// Clients
export const clientsApi = {
  list: () => api.get<Client[]>('/clients'),
  get: (id: number) => api.get<Client>(`/clients/${id}`),
  create: (data: {
    name: string
    description?: string
    dns?: string
    mtu?: number
    allowed_ips?: string
    expires_at?: string
  }) => api.post<Client>('/clients', data),
  update: (id: number, data: Partial<Client>) => api.put<Client>(`/clients/${id}`, data),
  delete: (id: number) => api.delete(`/clients/${id}`),
  getConfig: (id: number) => api.get<{ config: string; filename: string }>(`/clients/${id}/config`),
  getQR: (id: number) => api.get<Blob>(`/clients/${id}/qr`, { responseType: 'blob' }),
}

// Connections
export const connectionsApi = {
  list: () => api.get<ConnectedPeer[]>('/connections'),
  disconnect: (pubkey: string) =>
    api.delete(`/connections/${encodeURIComponent(pubkey)}`),
}

// Audit
export const auditApi = {
  list: (limit?: number) => api.get<AuditLog[]>('/audit', { params: limit ? { limit } : undefined }),
}

// Settings
export const settingsApi = {
  getEndpoint: () => api.get<{ endpoint: string }>('/settings/endpoint'),
  setEndpoint: (endpoint: string) => api.put<{ endpoint: string }>('/settings/endpoint', { endpoint }),
}
