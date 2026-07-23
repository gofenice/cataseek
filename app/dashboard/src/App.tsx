import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';

// Merchant pages
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';
import APIKeys from './pages/APIKeys';
import Catalog from './pages/Catalogue';
import Preview from './pages/Preview';
import Billing from './pages/Billing';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
import Plugins from './pages/Plugins';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminTenants from './pages/admin/AdminTenants';
import AdminTenantDetail from './pages/admin/AdminTenantDetail';
import AdminPlans from './pages/admin/AdminPlans';
import AdminOrders from './pages/admin/AdminOrders';
import AdminPayments from './pages/admin/AdminPayments';
import AdminHosting from './pages/admin/AdminHosting';
import AdminModules from './pages/admin/AdminModules';
import Hosting from './pages/Hosting';

import { isAdminHost } from './utils/host';

import './assets/global.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={isAdminHost ? <Navigate to="/login" replace /> : <Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Admin Routes — only accessible with role=admin */}
          <Route path="/admin" element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }>
            <Route index element={<AdminDashboard />} />
            <Route path="tenants" element={<AdminTenants />} />
            <Route path="tenants/:id" element={<AdminTenantDetail />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="hosting" element={<AdminHosting />} />
            <Route path="modules" element={<AdminModules />} />
          </Route>

          {/* On the admin host, the root always leads to the admin area */}
          {isAdminHost && <Route path="/" element={<Navigate to="/admin" replace />} />}

          {/* Protected Merchant Dashboard Routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="keys" element={<APIKeys />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="preview" element={<Preview />} />
            <Route path="plugins" element={<Plugins />} />
            <Route path="billing" element={<Billing />} />
            <Route path="hosting" element={<Hosting />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
