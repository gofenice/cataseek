import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { User, Store, Globe, Mail, Save, CreditCard, Lock, CheckCircle, AlertCircle, CalendarClock, Trash2 } from 'lucide-react';

interface Subscription {
    plan_name: string;
    price: number;
    billing_period: string;
    status: string;
    current_period_end: string;
}

interface ProfileInfo {
    status: string;
    trial_ends_at: string | null;
    created_at: string;
    plan_name: string | null;
}

const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const Profile: React.FC = () => {
    const { tenant, updateTenant, logout } = useAuth();
    const navigate = useNavigate();

    // delete account
    const [showDelete, setShowDelete] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');

    const [storeName, setStoreName] = useState('');
    const [storeDomain, setStoreDomain] = useState('');
    const [email, setEmail] = useState('');

    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [info, setInfo] = useState<ProfileInfo | null>(null);

    // change password
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [pwLoading, setPwLoading] = useState(false);
    const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (tenant) {
            setStoreName(tenant.storeName || '');
            setStoreDomain(tenant.storeDomain || '');
            setEmail(tenant.email || '');
        }
    }, [tenant]);

    const fetchAccount = useCallback(async () => {
        try {
            const [subRes, profRes] = await Promise.all([
                api.get('/plans/subscription'),
                api.get('/tenants/profile'),
            ]);
            setSubscription(subRes.data.subscription);
            setInfo(profRes.data.tenant);
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { fetchAccount(); }, [fetchAccount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            const res = await api.put('/tenants/profile', {
                storeName,
                storeDomain,
                email
            });

            if (res.data.success) {
                setMessage({ type: 'success', text: res.data.message });
                updateTenant({ storeName, storeDomain, email });
            }
        } catch (err: any) {
            setMessage({
                type: 'error',
                text: err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to update profile'
            });
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwMessage(null);

        if (newPassword !== confirmPassword) {
            setPwMessage({ type: 'error', text: 'New passwords do not match' });
            return;
        }
        if (newPassword.length < 8) {
            setPwMessage({ type: 'error', text: 'New password must be at least 8 characters' });
            return;
        }

        setPwLoading(true);
        try {
            const res = await api.put('/tenants/password', { currentPassword, newPassword });
            setPwMessage({ type: 'success', text: res.data.message });
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        } catch (err: any) {
            setPwMessage({
                type: 'error',
                text: err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to change password'
            });
        } finally {
            setPwLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeleting(true);
        setDeleteError('');
        try {
            await api.delete('/tenants/account', { data: { password: deletePassword } });
            logout();
            navigate('/login');
        } catch (err: any) {
            setDeleteError(err.response?.data?.error || 'Failed to delete account');
            setDeleting(false);
        }
    };

    const inputGroupStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.85rem',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'rgba(20,32,26,0.02)',
        color: 'var(--text-main)',
        fontSize: '1rem',
        transition: 'all 0.2s',
        outline: 'none'
    };

    const buttonStyle: React.CSSProperties = {
        background: 'var(--primary)',
        color: '#fff',
        padding: '0.75rem 2rem',
        borderRadius: '8px',
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        border: 'none',
        transition: 'all 0.2s'
    };

    const alertBox = (m: { type: 'success' | 'error', text: string }) => (
        <div style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            background: m.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${m.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: m.type === 'success' ? '#10b981' : '#ef4444',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
        }}>
            {m.type === 'success' ? '✅' : '❌'} {m.text}
        </div>
    );

    const accountStatus = info?.status || 'trial';
    const statusColors: Record<string, string> = { active: '#10b981', trial: '#f59e0b', suspended: '#ef4444', cancelled: '#6b7280' };

    return (
        <div style={{ maxWidth: '680px', width: '100%', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <User size={28} color="var(--primary)" />
                    My Account
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                    Manage your store identity, subscription, and security settings.
                </p>
            </div>

            {/* ── Subscription summary ── */}
            <div className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CreditCard size={16} color="var(--primary)" />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subscription</span>
                    </div>
                    <span style={{
                        background: `${statusColors[accountStatus] || '#6b7280'}1a`,
                        color: statusColors[accountStatus] || '#6b7280',
                        padding: '0.2rem 0.7rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, textTransform: 'capitalize',
                    }}>
                        {accountStatus}
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Current Plan</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                            {subscription?.plan_name || info?.plan_name || 'Trial'}
                        </div>
                    </div>
                    {subscription && (
                        <>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Price</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                    {subscription.price} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ {subscription.billing_period}</span>
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <CalendarClock size={12} /> Renews
                                </div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>{fmt(subscription.current_period_end)}</div>
                            </div>
                        </>
                    )}
                    {!subscription && info?.trial_ends_at && (
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Trial Ends</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b' }}>{fmt(info.trial_ends_at)}</div>
                        </div>
                    )}
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Member Since</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>{fmt(info?.created_at || null)}</div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    {subscription ? (
                        <span style={{ fontSize: '0.82rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={13} /> Your subscription is active and renews automatically.
                        </span>
                    ) : (
                        <span style={{ fontSize: '0.82rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertCircle size={13} /> No active subscription.
                        </span>
                    )}
                    <Link to="/billing" style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>
                        Manage Billing →
                    </Link>
                </div>
            </div>

            {/* ── Store profile ── */}
            {message && alertBox(message)}
            <form onSubmit={handleSubmit} className="glass" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Store size={18} color="var(--primary)" /> Store Profile
                </h2>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>
                        <Store size={16} />
                        Store Name
                    </label>
                    <input
                        type="text"
                        value={storeName}
                        onChange={e => setStoreName(e.target.value)}
                        required
                        style={inputStyle}
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>
                        <Globe size={16} />
                        Store Domain
                    </label>
                    <input
                        type="text"
                        value={storeDomain}
                        onChange={e => setStoreDomain(e.target.value)}
                        required
                        style={inputStyle}
                        placeholder="e.g. mystore.com"
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>
                        <Mail size={16} />
                        Account Email
                    </label>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        style={inputStyle}
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>

                <div style={{ paddingTop: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" disabled={loading} style={{ ...buttonStyle, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                        <Save size={18} />
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>

            {/* ── Change password ── */}
            {pwMessage && alertBox(pwMessage)}
            <form onSubmit={handlePasswordChange} className="glass" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Lock size={18} color="var(--primary)" /> Change Password
                </h2>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>Current Password</label>
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        required
                        style={inputStyle}
                        autoComplete="current-password"
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>New Password</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            minLength={8}
                            style={inputStyle}
                            autoComplete="new-password"
                            placeholder="Min. 8 characters"
                            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                        />
                    </div>
                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>Confirm New Password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                            style={inputStyle}
                            autoComplete="new-password"
                            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                        />
                    </div>
                </div>

                <div style={{ paddingTop: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" disabled={pwLoading} style={{ ...buttonStyle, cursor: pwLoading ? 'not-allowed' : 'pointer', opacity: pwLoading ? 0.7 : 1 }}>
                        <Lock size={18} />
                        {pwLoading ? 'Updating...' : 'Update Password'}
                    </button>
                </div>
            </form>

            {/* ── Danger zone ── */}
            <div className="glass" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid rgba(239,68,68,0.3)' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ef4444', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Trash2 size={18} /> Delete Account
                </h2>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                    Permanently delete your account and <strong>all</strong> data — products, search index, subscriptions, invoices and settings.
                    Active subscriptions are cancelled. <strong style={{ color: '#ef4444' }}>This cannot be undone.</strong>
                </p>

                {!showDelete ? (
                    <button
                        onClick={() => { setShowDelete(true); setDeleteError(''); setDeletePassword(''); }}
                        style={{ alignSelf: 'flex-start', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '0.6rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                    >
                        Delete my account
                    </button>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '1rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Confirm your password to delete:</label>
                        <input
                            type="password"
                            value={deletePassword}
                            onChange={e => setDeletePassword(e.target.value)}
                            placeholder="Your password"
                            autoComplete="current-password"
                            style={{ ...inputStyle, maxWidth: 320 }}
                        />
                        {deleteError && <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>❌ {deleteError}</span>}
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={handleDeleteAccount}
                                disabled={deleting || !deletePassword}
                                style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '0.6rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: deleting || !deletePassword ? 'not-allowed' : 'pointer', opacity: deleting || !deletePassword ? 0.6 : 1 }}
                            >
                                {deleting ? 'Deleting…' : 'Permanently Delete'}
                            </button>
                            <button
                                onClick={() => setShowDelete(false)}
                                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '0.6rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Profile;
