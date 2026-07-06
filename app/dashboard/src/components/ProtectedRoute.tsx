import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tenant, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="flex-center" style={{ height: '100vh' }}>
                <div className="gradient-text" style={{ fontSize: '1.5rem' }}>Loading Cataseek...</div>
            </div>
        );
    }

    if (!tenant) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
