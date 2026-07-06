import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { isConsoleHost } from '../utils/host';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const Login: React.FC = () => {
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await api.post('/tenants/login', formData);
            const tenantData = response.data.tenant;
            if (isConsoleHost && tenantData.role !== 'admin') {
                setError('This login is for Cataseek administrators only');
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
                        {isConsoleHost ? 'Super admin console' : 'Merchant dashboard'}
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
                            {isConsoleHost ? 'Super Admin' : 'Welcome back'}
                        </h1>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                            {isConsoleHost ? 'Sign in to the Cataseek control panel' : 'Log in to manage your store search'}
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
                        {loading ? 'Logging in…' : isConsoleHost ? 'Login to Console' : 'Login to Dashboard'}
                    </button>

                    {!isConsoleHost && (
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
