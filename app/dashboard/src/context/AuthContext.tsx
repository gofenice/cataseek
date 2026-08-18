import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

interface Tenant {
    id: number;
    email: string;
    storeName: string;
    storeDomain: string;
    status: string;
    role: string;
}

interface AuthContextType {
    tenant: Tenant | null;
    loading: boolean;
    login: (token: string, tenant: Tenant) => void;
    logout: () => void;
    updateTenant: (updates: Partial<Tenant>) => void;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Runs on every page load. It used to clear the token whenever this
        // request failed for ANY reason — a flaky network, a server 5xx, a
        // request cancelled by navigating away — which is why reloading or
        // sitting idle could sign you out. Only an explicit 401 (the server
        // rejecting the token) ends the session now; everything else is
        // retried, keeping the session alive across blips.
        const initAuth = async () => {
            const token = localStorage.getItem('cataseek_token');
            if (!token) {
                setLoading(false);
                return;
            }

            const RETRY_DELAYS_MS = [400, 1200];

            for (let attempt = 0; ; attempt++) {
                try {
                    const response = await api.get('/tenants/profile');
                    const t = response.data.tenant;
                    setTenant({
                        id: t.id,
                        email: t.email,
                        storeName: t.store_name,
                        storeDomain: t.store_domain,
                        status: t.status,
                        role: t.role
                    });
                    break;
                } catch (error: any) {
                    const status = error?.response?.status;

                    if (status === 401) {
                        // The token is genuinely invalid or expired.
                        localStorage.removeItem('cataseek_token');
                        localStorage.removeItem('cataseek_role');
                        break;
                    }

                    if (attempt < RETRY_DELAYS_MS.length) {
                        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
                        continue;
                    }

                    // Still failing, but this is not an auth rejection — keep the
                    // token. A later request can recover the session rather than
                    // forcing the user to log in again.
                    console.error('Could not load profile; keeping session:', error);
                    break;
                }
            }

            setLoading(false);
        };

        initAuth();
    }, []);

    const login = (token: string, tenantData: Tenant) => {
        localStorage.setItem('cataseek_token', token);
        localStorage.setItem('cataseek_role', tenantData.role);  // cache role synchronously
        setTenant(tenantData);
    };

    const logout = () => {
        localStorage.removeItem('cataseek_token');
        localStorage.removeItem('cataseek_role');
        setTenant(null);
    };

    const updateTenant = (updates: Partial<Tenant>) => {
        setTenant(prev => prev ? { ...prev, ...updates } : null);
    };

    return (
        <AuthContext.Provider value={{ tenant, loading, login, logout, updateTenant, isAdmin: tenant?.role === 'admin' }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
