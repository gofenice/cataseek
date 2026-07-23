// The super-admin console is served from the admin.* subdomain
// (e.g. admin.cataseek.com). Same SPA bundle, host-aware UI.
export const isAdminHost = window.location.hostname.startsWith('admin.');

// Local dev has no subdomains — both areas stay accessible there.
export const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
