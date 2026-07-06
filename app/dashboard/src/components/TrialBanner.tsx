import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, AlertTriangle, MailWarning } from 'lucide-react';
import api from '../services/api';

// Shows email-verification prompt, a countdown while on trial, and a hard
// warning once the trial has ended.
const TrialBanner: React.FC = () => {
    const [info, setInfo] = useState<{ status: string; trial_ends_at: string | null; search_enabled?: boolean | number; email_verified?: boolean | number } | null>(null);
    const [pastDue, setPastDue] = useState(false);
    const [resent, setResent] = useState(false);
    const [resending, setResending] = useState(false);

    useEffect(() => {
        api.get('/tenants/profile')
            .then(res => setInfo(res.data.tenant))
            .catch(() => setInfo(null));
        // Detect a payment-retrying subscription (Razorpay marks it past_due)
        api.get('/plans/subscription')
            .then(res => setPastDue(res.data.subscription?.status === 'past_due'))
            .catch(() => setPastDue(false));
    }, []);

    const pastDueBanner = pastDue ? (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '0.7rem 2rem',
            background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.3)',
            fontSize: '0.875rem', color: '#92400e',
        }}>
            <AlertTriangle size={16} />
            <span><strong>Payment issue —</strong> your last renewal didn't go through. We're retrying; please make sure your payment method has funds to avoid service interruption.</span>
            <Link to="/billing" style={{ marginLeft: 'auto', flexShrink: 0, background: '#f59e0b', color: '#fff', padding: '0.35rem 1rem', borderRadius: 999, fontWeight: 600, fontSize: '0.8rem' }}>
                Manage Billing
            </Link>
        </div>
    ) : null;

    const handleResend = async () => {
        setResending(true);
        try {
            await api.post('/tenants/resend-verification');
            setResent(true);
        } catch { /* rate-limited or failed — keep button */ }
        setResending(false);
    };

    if (!info) return pastDueBanner;

    // Email verification banner (applies to all account types)
    const emailUnverified = info.email_verified !== undefined && info.email_verified !== null && !info.email_verified;
    const verifyBanner = emailUnverified ? (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0.6rem 2rem',
            background: 'rgba(5,150,105,0.06)',
            borderBottom: '1px solid rgba(5,150,105,0.2)',
            fontSize: '0.85rem', color: 'var(--text-muted)',
        }}>
            <MailWarning size={15} color="var(--primary)" />
            <span><strong style={{ color: 'var(--text-main)' }}>Verify your email address</strong> — check your inbox for the verification link.</span>
            <button
                onClick={handleResend}
                disabled={resending || resent}
                style={{
                    marginLeft: 'auto', flexShrink: 0,
                    background: 'transparent', color: 'var(--primary)', fontWeight: 600,
                    fontSize: '0.8rem', cursor: resent ? 'default' : 'pointer', textDecoration: 'underline',
                }}
            >
                {resent ? 'Sent ✓' : resending ? 'Sending…' : 'Resend email'}
            </button>
        </div>
    ) : null;

    const searchOff = info.search_enabled !== undefined && info.search_enabled !== null && !info.search_enabled;
    // Hosting-only clients don't use the search product — no trial nagging
    if (info.status !== 'trial' || !info.trial_ends_at || searchOff) return <>{pastDueBanner}{verifyBanner}</>;

    const msLeft = new Date(info.trial_ends_at).getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    const expired = msLeft <= 0;

    return (
        <>
        {pastDueBanner}
        {verifyBanner}
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0.7rem 2rem',
            background: expired ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            borderBottom: `1px solid ${expired ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
            fontSize: '0.875rem',
            color: expired ? '#b91c1c' : '#92400e',
        }}>
            {expired ? <AlertTriangle size={16} /> : <Clock size={16} />}
            {expired ? (
                <span>
                    <strong>Your free trial has ended.</strong> Search service is paused for your store —
                    choose a plan to reactivate it.
                </span>
            ) : (
                <span>
                    <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'} left</strong> in your free trial.
                    Pick a plan any time to keep your search running without interruption.
                </span>
            )}
            <Link to="/billing" style={{
                marginLeft: 'auto', flexShrink: 0,
                background: expired ? '#dc2626' : 'var(--primary)', color: '#fff',
                padding: '0.35rem 1rem', borderRadius: 999, fontWeight: 600, fontSize: '0.8rem',
            }}>
                {expired ? 'Choose a Plan' : 'View Plans'}
            </Link>
        </div>
        </>
    );
};

export default TrialBanner;
