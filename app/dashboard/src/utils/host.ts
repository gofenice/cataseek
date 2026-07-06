// The super-admin console is served from the console.* subdomain
// (e.g. console.cataseek.com). Same SPA bundle, host-aware UI.
export const isConsoleHost = window.location.hostname.startsWith('console.');
