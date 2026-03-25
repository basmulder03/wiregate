import api from './client'
import type {
  LoginResponse,
  User,
  WireGuardServer,
  Client,
  ConnectedPeer,
  APIKey,
  AuditLogListResponse,
  ServerStatus,
  SetupStatus,
  OIDCProvider,
  OIDCConfig,
  VersionInfo,
  UpdateSettings,
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

  listOIDCProviders: () => api.get<OIDCProvider[]>('/auth/oidc/providers'),

  createAPIKey: (name: string, scopes?: string, expiresAt?: string) =>
    api.post<{ key: string; api_key: APIKey }>('/auth/api-keys', { name, scopes, expires_at: expiresAt }, {
      _toast: {
        success: true,
        error: true,
        successTitle: 'API key created',
        successMessage: 'Copy and store the new key now.',
        errorTitle: 'Create failed',
      },
    }),
  listAPIKeys: () => api.get<APIKey[]>('/auth/api-keys'),
  deleteAPIKey: (id: number) => api.delete(`/auth/api-keys/${id}`, {
    _toast: {
      success: true,
      error: true,
      successTitle: 'API key deleted',
      errorTitle: 'Delete failed',
    },
  }),
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
  start: () => api.post('/server/start', {}, { _toast: { error: true, errorTitle: 'Start failed' } }),
  stop: () => api.post('/server/stop', {}, { _toast: { error: true, errorTitle: 'Stop failed' } }),
  restart: () => api.post('/server/restart', {}, { _toast: { error: true, errorTitle: 'Restart failed' } }),
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
  }) => api.post<Client>('/clients', data, {
    _toast: {
      success: true,
      error: true,
      successTitle: 'Client added',
      successMessage: 'Configuration and QR code are ready to use.',
      errorTitle: 'Create failed',
    },
  }),
  update: (id: number, data: Partial<Client>) => api.put<Client>(`/clients/${id}`, data, {
    _toast: {
      success: true,
      error: true,
      successTitle: data.enabled === true ? 'Client enabled' : data.enabled === false ? 'Client disabled' : 'Client updated',
      errorTitle: 'Update failed',
    },
  }),
  delete: (id: number) => api.delete(`/clients/${id}`, {
    _toast: {
      success: true,
      error: true,
      successTitle: 'Client deleted',
      errorTitle: 'Delete failed',
    },
  }),
  getConfig: (id: number) => api.get<{ config: string; filename: string }>(`/clients/${id}/config`),
  getQR: (id: number) => api.get<Blob>(`/clients/${id}/qr`, { responseType: 'blob' }),
}

// Connections
export const connectionsApi = {
  list: () => api.get<ConnectedPeer[]>('/connections'),
  disconnect: (pubkey: string) =>
    api.delete(`/connections/${encodeURIComponent(pubkey)}`, {
      _toast: {
        success: true,
        error: true,
        successTitle: 'Peer disconnected',
        errorTitle: 'Disconnect failed',
      },
    }),
}

// Audit
export const auditApi = {
  list: (params?: {
    q?: string
    status?: 'success' | 'failed'
    action?: string
    username?: string
    sort?: 'created_at' | 'username' | 'action' | 'resource' | 'ip_address' | 'success'
    order?: 'asc' | 'desc'
    page?: number
    page_size?: number
    limit?: number
  }) => api.get<AuditLogListResponse>('/audit', { params }),
}

// Settings
export const settingsApi = {
  getEndpoint: () => api.get<{ endpoint: string }>('/settings/endpoint'),
  setEndpoint: (endpoint: string) => api.put<{ endpoint: string }>('/settings/endpoint', { endpoint }),
  getOIDCConfigs: () => api.get<OIDCConfig[]>('/settings/oidc'),
  upsertOIDCConfig: (data: OIDCConfig) => api.post<OIDCConfig>('/settings/oidc', data),
  deleteOIDCConfig: (id: number) => api.delete(`/settings/oidc/${id}`),
  getUpdateSettings: () => api.get<UpdateSettings>('/settings/updates'),
  setUpdateSettings: (data: UpdateSettings) => api.put<UpdateSettings>('/settings/updates', data),
}

// Users
export const usersApi = {
  list: () => api.get<User[]>('/users'),
  get: (id: number) => api.get<User>(`/users/${id}`),
  create: (data: { username: string; password: string; email?: string; role?: string }) =>
    api.post<User>('/users', data),
  update: (id: number, data: { email?: string; role?: string; password?: string }) =>
    api.put<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
}

// Version / updates
export const versionApi = {
  get: () => api.get<VersionInfo>('/version'),
  triggerUpdate: () => api.post<{ message: string; target?: string }>('/system/update'),
}
