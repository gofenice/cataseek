import React, { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';

const VerifyEmail: React.FC = () => {
    const [params] = useSearchParams();
    const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
    const [message, setMessage] = useState('Verifying your email…');
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return; // avoid double-fire in React StrictMode
        ran.current = true;

        const token = params.get('token') || '';
        const email = params.get('email') || '';
        if (!token || !email) {
            setState('error');
            setMessage('This verification link is invalid or incomplete.');
            return;
        }
        api.post('/tenants/verify-email', { token, email })
            .then(res => { setState('success'); setMessage(res.data.message); })
            .catch(err => { setState('error'); setMessage(err.response?.data?.error || 'Verification failed.'); });
    }, [params]);

    const icon = state === 'verifying' ? '⏳' : state === 'success' ? '✅' : '❌';

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)', padding: '2rem' }}>
            <div style={{
                width: '100%', maxWidth: 440, textAlign: 'center',
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                padding: '2.5rem', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: '1rem',
            }}>
                <div style={{ fontSize: '2.5rem' }}>{icon}</div>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
                    {state === 'verifying' ? 'Verifying…' : state === 'success' ? 'Email Verified' : 'Verification Failed'}
                </h1>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{message}</p>
                <Link to="/login" className="btn-primary" style={{ padding: '0.7rem 1.5rem', marginTop: '0.5rem' }}>
                    Continue to Login →
                </Link>
            </div>
        </div>
    );
};

export default VerifyEmail;
