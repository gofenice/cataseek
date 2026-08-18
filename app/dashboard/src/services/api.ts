import axios from 'axios';

// Use a relative URL so it always resolves to the same server that served the dashboard.
// Override with VITE_API_URL env var if the API lives on a different host.
const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add a request interceptor to include the JWT token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('cataseek_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add a response interceptor to handle genuine auth failures.
//
// This used to drop the token on ANY 401. The server returned 401 for
// infrastructure problems too (a dropped DB connection, for instance), so a
// transient blip silently signed the user out mid-session. The server now
// distinguishes the two — 401 means the token really is bad, 5xx means try
// again — and anything without a response at all (offline, timeout, request
// cancelled on navigation) must never clear the session.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('cataseek_token');
            localStorage.removeItem('cataseek_role');
            // We don't redirect here to avoid circular dependencies,
            // the AuthContext will handle the state change.
        }
        return Promise.reject(error);
    }
);

export default api;
