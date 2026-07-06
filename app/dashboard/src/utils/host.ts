// The super-admin console is served from the console.* subdomain
// (e.g. console.cataseek.com). Same SPA bundle, host-aware UI.
export const isConsoleHost = window.location.hostname.startsWith('console.');

// Local dev has no subdomains — both areas stay accessible there.
export const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
