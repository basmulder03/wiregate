import axios from 'axios'
import { toast } from '@/lib/toast'

type ToastOptions = {
  success?: boolean
  error?: boolean
  successTitle?: string
  successMessage?: string
  errorTitle?: string
  errorMessage?: string
}

// Extend axios config so only explicitly user-triggered requests show toasts.
declare module 'axios' {
  interface AxiosRequestConfig {
    _toast?: boolean | ToastOptions
  }

  interface InternalAxiosRequestConfig {
    _toast?: boolean | ToastOptions
  }
}

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

function getToastOptions(value: boolean | ToastOptions | undefined): ToastOptions {
  if (value === true) return { success: true, error: true }
  if (!value) return { success: false, error: false }
  return {
    success: value.success ?? false,
    error: value.error ?? false,
    successTitle: value.successTitle,
    successMessage: value.successMessage,
    errorTitle: value.errorTitle,
    errorMessage: value.errorMessage,
  }
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wiregate_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor — handles auth errors + global mutation toasts
api.interceptors.response.use(
  (response) => {
    const method = response.config.method?.toLowerCase() ?? ''
    const toastOptions = getToastOptions(response.config._toast)

    if (toastOptions.success && MUTATING_METHODS.has(method)) {
      const titles: Record<string, string> = {
        post:   'Created successfully',
        put:    'Saved successfully',
        patch:  'Updated successfully',
        delete: 'Deleted successfully',
      }
      toast('success', toastOptions.successTitle ?? titles[method] ?? 'Done', toastOptions.successMessage)
    }

    return response
  },
  (error) => {
    // Always clear auth on 401
    if (error.response?.status === 401) {
      localStorage.removeItem('wiregate_token')
      localStorage.removeItem('wiregate_user')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    const method = error.config?.method?.toLowerCase() ?? ''
    const toastOptions = getToastOptions(error.config?._toast)

    if (toastOptions.error && MUTATING_METHODS.has(method)) {
      const serverMsg: string | undefined =
        error.response?.data?.error ?? error.response?.data?.message
      toast(
        'error',
        toastOptions.errorTitle ?? 'Request failed',
        toastOptions.errorMessage ?? serverMsg ?? error.message ?? 'An unexpected error occurred.',
      )
    }

    return Promise.reject(error)
  }
)

export default api
