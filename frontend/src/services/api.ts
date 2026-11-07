import axios, { type InternalAxiosRequestConfig } from "axios";
import { errorFr } from '../i18n/errors';

const TAB_SESSION_KEY = 'veille_tab_authenticated';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
});
let refreshRequest: Promise<unknown> | null = null;

api.interceptors.request.use((config) => {
  const path = config.url ?? '';
  const isPublicAuth = /^\/?auth\/(login|forgot-password|reset-password|validate-reset-token|logout)(?:\?|$)/.test(path);
  if (!isPublicAuth && sessionStorage.getItem(TAB_SESSION_KEY) !== '1') {
    config.headers.set('X-Tab-Unauthenticated', '1');
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const message = error.response?.data?.message;
    if (typeof message === 'string') {
      error.response.data.message = errorFr(message);
    } else if (Array.isArray(message)) {
      error.response.data.message = message.map((value: unknown) =>
        typeof value === 'string' ? errorFr(value) : value,
      ).join(' ');
    }
    if (typeof error.message === 'string') error.message = errorFr(error.message);
    if (error.response?.status === 401) {
      const request = error.config as
        (InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean }) | undefined;
      const path = request?.url ?? '';
      const isAuthRequest = /^\/?auth\/(login|refresh|logout|forgot-password|reset-password)(?:\?|$)/.test(path);
      const hasTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === '1';
      if (request && !request._retriedAfterRefresh && !isAuthRequest && hasTabSession) {
        request._retriedAfterRefresh = true;
        try {
          refreshRequest ??= refreshClient.post('/auth/refresh')
            .finally(() => { refreshRequest = null; });
          await refreshRequest;
          return api.request(request);
        } catch {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
      } else if (!isAuthRequest) {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }

    return Promise.reject(error);
  },
);

export default api;
