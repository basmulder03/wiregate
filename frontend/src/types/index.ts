export interface User {
  id: number
  username: string
  email: string
  role: string
  totp_enabled: boolean
  last_login: string | null
  created_at: string
}

export interface WireGuardServer {
  id: number
  interface: string
  public_key: string
  listen_port: number
  address: string
  dns: string
  post_up: string
  post_down: string
  mtu: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface Client {
  id: number
  name: string
  description: string
  public_key: string
  allowed_ips: string
  dns: string
  mtu: number
  enabled: boolean
  expires_at: string | null
  server_id: number
  created_at: string
  updated_at: string
}

export interface ConnectedPeer {
  PublicKey: string
  Endpoint: string
  AllowedIPs: string
  LatestHandshake: string
  TransferRx: number
  TransferTx: number
  client_name?: string
  client_id?: number
}

export interface APIKey {
  id: number
  name: string
  key_prefix: string
  scopes: string
  expires_at: string | null
  last_used: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  username: string
  action: string
  resource: string
  details: string
  ip_address: string
  success: boolean
  created_at: string
}

export interface AuditLogListResponse {
  items: AuditLog[]
  total: number
  page: number
  page_size: number
  sort: string
  order: 'asc' | 'desc'
}

export interface ServerStatus {
  installed: boolean
  running: boolean
  status: string
  systemd_status: string
}

export interface SetupStatus {
  setup_required: boolean
  wg_installed: boolean
  wg_running: boolean
}

export interface LoginResponse {
  token: string
  user: User
  expires: string
  totp_required?: boolean
}

export interface OIDCProvider {
  id: number
  provider_name: string
}

export interface OIDCConfig {
  id?: number
  provider_name: string
  issuer_url: string
  client_id: string
  client_secret?: string
  redirect_url: string
  scopes: string
  enabled: boolean
  created_at?: string
  updated_at?: string
}

export type InstallMethod = 'systemd' | 'launchd' | 'docker' | 'manual'

export interface VersionInfo {
  version: string
  commit: string
  date: string
  install_method: InstallMethod
  latest_tag?: string
  latest_url?: string
  update_available?: boolean
}

export interface UpdateSettings {
  auto_update_enabled: boolean
  auto_update_window: string
}

/** WebSocket notification message pushed from the server. */
export interface WSNotification {
  type: 'notification'
  event: string
  kind: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  timestamp: number
  /** Only present on update_available events */
  latest_tag?: string
  install_url?: string
  install_method?: InstallMethod
}
