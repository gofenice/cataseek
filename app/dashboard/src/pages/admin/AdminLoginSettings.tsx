import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

interface GoogleAuthSettings {
    enabled: boolean;
    clientId: string;
}

const AdminLoginSettings: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ enabled: false, clientId: '' });

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/google-auth-settings');
            const s: GoogleAuthSettings = res.data.settings;
            setForm({ enabled: s.enabled, clientId: s.clientId });
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchSettings(); }, [fetchSettings]);

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            await api.put('/admin/google-auth-settings', form);
            setMsg('✅ Saved');
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
        background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 640 }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Sign-in Options</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Configure "Sign in / Sign up with Google" for merchants. Admin login always stays password-only.
                </p>
            </div>

            {loading ? (
                <div className="glass" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : (
                <div className="glass" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {msg && <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', fontSize: '0.87rem' }}>{msg}</div>}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input type="checkbox" id="google_enabled" checked={form.enabled}
                            onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                            style={{ width: 16, height: 16, cursor: 'pointer' }} />
                        <label htmlFor="google_enabled" style={{ color: 'var(--text-main)', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}>
                            Enable Google Sign-In
                        </label>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                            Google OAuth Client ID
                        </label>
                        <input type="text" placeholder="1234567890-abc123.apps.googleusercontent.com" value={form.clientId}
                            onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}
                            style={inputStyle} />
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                            From Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID
                            (type "Web application"). Add your dashboard domain(s) as Authorized JavaScript origins.
                            No client secret is needed — this flow only verifies signed ID tokens.
                        </div>
                    </div>

                    <button onClick={handleSave} disabled={saving}
                        style={{ alignSelf: 'flex-start', background: 'var(--primary)', color: '#fff', padding: '0.65rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default AdminLoginSettings;
