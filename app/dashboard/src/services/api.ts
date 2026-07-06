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

// Add a response interceptor to handle 401 errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('cataseek_token');
            // We don't redirect here to avoid circular dependencies, 
            // the AuthContext will handle the state change.
        }
        return Promise.reject(error);
    }
);

export default api;
