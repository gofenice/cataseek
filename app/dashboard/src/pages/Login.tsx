import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { isAdminHost, isLocalDev } from '../utils/host';
import { renderGoogleButton } from '../utils/googleAuth';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const Login: React.FC = () => {
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleConfig, setGoogleConfig] = useState<{ enabled: boolean; clientId: string } | null>(null);
    const googleButtonRef = useRef<HTMLDivElement>(null);

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    useEffect(() => {
        if (isAdminHost) return; // admin login stays password-only
        api.get('/tenants/google-config').then(res => setGoogleConfig(res.data)).catch(() => {});
    }, []);

    const handleGoogleCredential = async (credential: string) => {
        setError('');
        setLoading(true);
        try {
            const response = await api.post('/tenants/google', { credential });
            const tenantData = response.data.tenant;
            login(response.data.token, tenantData);
            navigate(tenantData.role === 'admin' ? '/admin' : '/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Google sign-in failed');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!googleConfig?.enabled || !googleButtonRef.current) return;
        renderGoogleButton({
            clientId: googleConfig.clientId,
            container: googleButtonRef.current,
            onCredential: handleGoogleCredential,
        }).catch(() => {});
    }, [googleConfig]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await api.post('/tenants/login', formData);
            const tenantData = response.data.tenant;
            if (isAdminHost && tenantData.role !== 'admin') {
                setError('This login is for Cataseek administrators only');
                return;
            }
            // Mirror guard: super-admin accounts only sign in on the admin subdomain
            if (!isAdminHost && !isLocalDev && tenantData.role === 'admin') {
                setError('Super admin accounts must sign in at the admin subdomain');
                return;
            }
            login(response.data.token, tenantData);
            navigate(tenantData.role === 'admin' ? '/admin' : '/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Invalid email or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-main)',
            padding: '2rem',
        }}>
            <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Logo />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
                        {isAdminHost ? 'Super admin console' : 'Merchant dashboard'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '2.25rem',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.25rem',
                }}>
                    <div>
                        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 4px', letterSpacing: '-0.025em' }}>
                            {isAdminHost ? 'Super Admin' : 'Welcome back'}
                        </h1>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                            {isAdminHost ? 'Sign in to the Cataseek control panel' : 'Log in to manage your store search'}
                        </p>
                    </div>

                    {error && (
                        <div className="badge-error" style={{
                            padding: '0.65rem 0.875rem',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.875rem',
                            border: '1px solid rgba(239,68,68,0.25)',
                            background: 'rgba(239,68,68,0.07)',
                            color: 'var(--error)',
                        }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email Address</label>
                        <input
                            className="input"
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="store@example.com"
                            required
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Password</label>
                            <Link to="/forgot-password" style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 500 }}>
                                Forgot password?
                            </Link>
                        </div>
                        <input
                            className="input"
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary"
                        style={{ marginTop: '0.25rem', width: '100%', padding: '0.75rem' }}
                    >
                        {loading ? 'Logging in…' : isAdminHost ? 'Login to Console' : 'Login to Dashboard'}
                    </button>

                    {googleConfig?.enabled && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.25rem 0' }}>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>or</span>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                            </div>
                            <div ref={googleButtonRef} style={{ display: 'flex', justifyContent: 'center' }} />
                            <p style={{ fontSize: '0.75rem', textAlign: 'center', color: 'var(--text-dim)', margin: 0 }}>
                                By continuing you agree to our Terms &amp; Privacy Policy
                            </p>
                        </>
                    )}

                    {!isAdminHost && (
                        <p style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--text-muted)', margin: 0 }}>
                            No account?{' '}
                            <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 500 }}>
                                Start free trial
                            </Link>
                        </p>
                    )}
                </form>
            </div>
        </div>
    );
};

export default Login;
