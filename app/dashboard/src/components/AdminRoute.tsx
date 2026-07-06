import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tenant, loading, isAdmin } = useAuth();

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
