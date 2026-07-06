import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api.post('/tenants/forgot-password', { email });
            setSent(true);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)', padding: '2rem' }}>
            <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <Logo />

                <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                    padding: '2.25rem', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: '1.1rem',
                }}>
                    {sent ? (
                        <>
                            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0, letterSpacing: '-0.025em' }}>Check your inbox 📬</h1>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
                                If <strong>{email}</strong> is registered, we've sent a password reset link.
                                The link is valid for 1 hour.
                            </p>
                            <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.875rem' }}>← Back to login</Link>
                        </>
                    ) : (
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                            <div>
                                <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 4px', letterSpacing: '-0.025em' }}>Forgot your password?</h1>
                                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                                    Enter your account email and we'll send you a reset link.
                                </p>
                            </div>

                            {error && (
                                <div style={{ padding: '0.65rem 0.875rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.07)', color: 'var(--error)' }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email Address</label>
                                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
                            </div>

                            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', padding: '0.75rem' }}>
                                {loading ? 'Sending…' : 'Send Reset Link'}
                            </button>

                            <p style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--text-muted)', margin: 0 }}>
                                Remembered it? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500 }}>Login</Link>
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
