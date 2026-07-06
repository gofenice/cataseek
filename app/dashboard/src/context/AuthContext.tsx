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
        const initAuth = async () => {
            const token = localStorage.getItem('cataseek_token');
            if (token) {
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
                } catch (error) {
                    console.error('Failed to fetch profile:', error);
                    localStorage.removeItem('cataseek_token');
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
