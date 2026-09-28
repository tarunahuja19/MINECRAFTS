const isCloud = typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname &&
  !window.location.hostname.includes('localhost') &&
  !window.location.hostname.includes('127.0.0.1');

export const SIM_BASE_URL: string = (function () {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const match = window.location.search.match(/[?&]sim=([^&]+)/);
    if (match) return decodeURIComponent(match[1]).replace(/\/+$/, '');
  }
  if (import.meta.env && import.meta.env.VITE_SIM_URL) {
    return import.meta.env.VITE_SIM_URL.replace(/\/+$/, '');
  }
  if (isCloud) {
    return 'https://minecrafts-simulation.onrender.com';
  }
  return '';
})();

export const BACKEND_URL: string = (function () {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const match = window.location.search.match(/[?&]backend=([^&]+)/);
    if (match) return decodeURIComponent(match[1]).replace(/\/+$/, '');
  }
  if (import.meta.env && import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL.replace(/\/+$/, '');
  }
  if (isCloud) {
    return 'https://minecrafts-backend.onrender.com';
  }
  return 'http://localhost:8080';
})();

export const SIM_WS_URL: string = (function () {
  if (SIM_BASE_URL) {
    return SIM_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';
  }
  const host = typeof window !== 'undefined' ? (window.location.hostname || 'localhost') : 'localhost';
  return `ws://${host}:8000/ws`;
})();
