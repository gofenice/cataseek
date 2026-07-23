import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isAdminHost, isLocalDev } from '../utils/host';

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tenant, loading, isAdmin } = useAuth();

    // The admin area only exists on the admin subdomain (or local dev)
    if (!isAdminHost && !isLocalDev) return <Navigate to="/" replace />;

    // During the brief transition after login (state update not yet committed),
    // fall back to the role stored in localStorage to avoid a redirect flash.
    const cachedRole = localStorage.getItem('cataseek_role');
    const effectiveIsAdmin = isAdmin || cachedRole === 'admin';

    if (loading) return null;
    if (!tenant && !cachedRole) return <Navigate to="/login" replace />;
    if (!effectiveIsAdmin) return <Navigate to="/" replace />;

    return <>{children}</>;
};

export default AdminRoute;
