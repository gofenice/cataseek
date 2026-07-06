import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const Register: React.FC = () => {
    const [formData, setFormData] = useState({
        storeName: '',
        storeDomain: '',
        email: '',
        password: '',
    });
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Legal pages live on the marketing site (main domain in production)
    const LEGAL_BASE = import.meta.env.VITE_LEGAL_URL || 'http://localhost:8090';

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
            const response = await api.post('/tenants/register', { ...formData, termsAccepted });
            login(response.data.token, response.data.tenant);
            navigate('/');
        } catch (err: any) {
            setError(
                err.response?.data?.error ||
                err.response?.data?.errors?.[0]?.msg ||
                'Registration failed. Please try again.'
            );
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
            <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Logo />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
                        14-day free trial · No credit card
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
                    gap: '1.1rem',
                }}>
                    <div>
                        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 4px', letterSpacing: '-0.025em' }}>
                            Create your account
                        </h1>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                            Set up AI-powered search for your store in minutes
                        </p>
                    </div>

                    {error && (
                        <div style={{
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Store Name</label>
                        <input
                            className="input"
                            type="text"
                            name="storeName"
                            value={formData.storeName}
                            onChange={handleChange}
                            placeholder="My Awesome Store"
                            required
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Store Domain</label>
                        <input
                            className="input"
                            type="text"
                            name="storeDomain"
                            value={formData.storeDomain}
                            onChange={handleChange}
                            placeholder="mystore.com"
                            required
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Password</label>
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

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.82rem', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1.45 }}>
                        <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={e => setTermsAccepted(e.target.checked)}
                            required
                            style={{ width: 15, height: 15, marginTop: 2, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
                        />
                        <span>
                            I agree to the{' '}
                            <a href={`${LEGAL_BASE}/terms.html`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 500 }}>Terms &amp; Conditions</a>,{' '}
                            <a href={`${LEGAL_BASE}/privacy.html`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 500 }}>Privacy Policy</a> and{' '}
                            <a href={`${LEGAL_BASE}/refund-policy.html`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 500 }}>Refund Policy</a>
                        </span>
                    </label>

                    <button
                        type="submit"
                        disabled={loading || !termsAccepted}
                        className="btn-primary"
                        style={{ marginTop: '0.25rem', width: '100%', padding: '0.75rem', opacity: termsAccepted ? 1 : 0.6 }}
                    >
                        {loading ? 'Creating account…' : 'Create Your Account'}
                    </button>

                    <p style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--text-muted)', margin: 0 }}>
                        Already have an account?{' '}
                        <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500 }}>
                            Login
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
};

export default Register;
