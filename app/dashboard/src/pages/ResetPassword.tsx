import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const ResetPassword: React.FC = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token') || '';
    const email = params.get('email') || '';

    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (newPassword !== confirm) { setError('Passwords do not match'); return; }
        setLoading(true);
        try {
            await api.post('/tenants/reset-password', { email, token, newPassword });
            setDone(true);
            setTimeout(() => navigate('/login'), 2500);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to reset password.');
        } finally {
            setLoading(false);
        }
    };

    const invalidLink = !token || !email;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)', padding: '2rem' }}>
            <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <Logo />

                <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                    padding: '2.25rem', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: '1.1rem',
                }}>
                    {invalidLink ? (
                        <>
                            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0 }}>Invalid reset link</h1>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>This link is missing information. Request a new one.</p>
                            <Link to="/forgot-password" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.875rem' }}>Request new link →</Link>
                        </>
                    ) : done ? (
                        <>
                            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0 }}>Password updated ✅</h1>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Redirecting you to login…</p>
                            <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.875rem' }}>Go to login now →</Link>
                        </>
                    ) : (
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                            <div>
                                <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 4px', letterSpacing: '-0.025em' }}>Choose a new password</h1>
                                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>for <strong>{email}</strong></p>
                            </div>

                            {error && (
                                <div style={{ padding: '0.65rem 0.875rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.07)', color: 'var(--error)' }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>New Password</label>
                                <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 8 characters" minLength={8} required autoComplete="new-password" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Confirm Password</label>
                                <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={8} required autoComplete="new-password" />
                            </div>

                            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', padding: '0.75rem' }}>
                                {loading ? 'Saving…' : 'Reset Password'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;
