import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

interface PaymentSettings {
    enabled: boolean;
    mode: 'test' | 'live';
    key_id: string;
    key_secret_masked: string;
    webhook_secret_masked: string;
    currency: string;
    has_key_secret: boolean;
    has_webhook_secret: boolean;
}

const AdminPayments: React.FC = () => {
    const [settings, setSettings] = useState<PaymentSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [msg, setMsg] = useState('');

    // form state — secrets start empty; empty = "keep existing"
    const [form, setForm] = useState({
        enabled: false,
        mode: 'test' as 'test' | 'live',
        key_id: '',
        key_secret: '',
        webhook_secret: '',
        currency: 'INR',
    });

    // company / tax (invoice) settings
    const [company, setCompany] = useState({
        company_name: '', company_email: '', company_address: '',
        company_gstin: '', tax_rate: '0', tax_label: 'GST',
    });
    const [savingCompany, setSavingCompany] = useState(false);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const [payRes, compRes] = await Promise.all([
                api.get('/admin/payment-settings'),
                api.get('/admin/company-settings'),
            ]);
            const s: PaymentSettings = payRes.data.settings;
            setSettings(s);
            setForm(prev => ({
                ...prev,
                enabled: s.enabled,
                mode: s.mode,
                key_id: s.key_id,
                currency: s.currency,
                key_secret: '',
                webhook_secret: '',
            }));
            const c = compRes.data.settings;
            setCompany({
                company_name: c.company_name || '', company_email: c.company_email || '',
                company_address: c.company_address || '', company_gstin: c.company_gstin || '',
                tax_rate: String(c.tax_rate ?? 0), tax_label: c.tax_label || 'GST',
            });
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchSettings(); }, [fetchSettings]);

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            await api.put('/admin/payment-settings', form);
            setMsg('✅ Payment settings saved');
            await fetchSettings();
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const handleSaveCompany = async () => {
        setSavingCompany(true); setMsg('');
        try {
            await api.put('/admin/company-settings', { ...company, tax_rate: parseFloat(company.tax_rate) || 0 });
            setMsg('✅ Company & tax settings saved');
            await fetchSettings();
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSavingCompany(false);
    };

    const handleTest = async () => {
        setTesting(true); setMsg('');
        try {
            const res = await api.post('/admin/payment-settings/test');
            setMsg('✅ ' + res.data.message);
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Connection test failed'));
        }
        setTesting(false);
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
        background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box',
        fontFamily: 'monospace', fontSize: '0.85rem',
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
        textTransform: 'uppercase', display: 'block', marginBottom: 4,
    };

    if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading payment settings...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 720 }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Payment Settings</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Configure Razorpay to collect recurring subscription payments from merchants
                </p>
            </div>

            {msg && (
                <div style={{
                    color: msg.startsWith('✅') ? '#10b981' : '#ef4444',
                    background: msg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${msg.startsWith('✅') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.9rem',
                }}>
                    {msg}
                </div>
            )}

            {/* Status banner */}
            <div className="glass" style={{
                padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                border: `1px solid ${settings?.enabled ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: settings?.enabled ? '#10b981' : '#f59e0b',
                        boxShadow: `0 0 8px ${settings?.enabled ? '#10b981' : '#f59e0b'}`,
                    }} />
                    <span style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.95rem' }}>
                        {settings?.enabled ? 'Razorpay payments are LIVE' : 'Payments in demo mode'}
                    </span>
                    <span style={{
                        background: form.mode === 'live' ? 'rgba(239,68,68,0.12)' : 'rgba(5,150,105,0.12)',
                        color: form.mode === 'live' ? '#ef4444' : '#059669',
                        padding: '0.15rem 0.6rem', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                    }}>
                        {form.mode} mode
                    </span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    Enable Razorpay checkout
                </label>
            </div>

            {/* Credentials */}
            <div className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>API Credentials</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                    Get these from <span style={{ color: 'var(--primary)' }}>Razorpay Dashboard → Account &amp; Settings → API Keys</span>.
                    Test keys start with <code>rzp_test_</code>, live keys with <code>rzp_live_</code>.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={labelStyle}>Mode</label>
                        <select
                            value={form.mode}
                            onChange={e => setForm(p => ({ ...p, mode: e.target.value as 'test' | 'live' }))}
                            style={{ ...inputStyle, fontFamily: 'inherit' }}
                        >
                            <option value="test">Test (sandbox)</option>
                            <option value="live">Live (real payments)</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Currency</label>
                        <select
                            value={form.currency}
                            onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                            style={{ ...inputStyle, fontFamily: 'inherit' }}
                        >
                            <option value="INR">INR — Indian Rupee</option>
                            <option value="USD">USD — US Dollar</option>
                            <option value="EUR">EUR — Euro</option>
                            <option value="GBP">GBP — British Pound</option>
                            <option value="AED">AED — UAE Dirham</option>
                            <option value="SGD">SGD — Singapore Dollar</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label style={labelStyle}>Key ID</label>
                    <input
                        type="text"
                        placeholder="rzp_test_xxxxxxxxxxxx"
                        value={form.key_id}
                        onChange={e => setForm(p => ({ ...p, key_id: e.target.value }))}
                        style={inputStyle}
                    />
                </div>

                <div>
                    <label style={labelStyle}>
                        Key Secret {settings?.has_key_secret && <span style={{ color: '#10b981', textTransform: 'none' }}>· saved: {settings.key_secret_masked}</span>}
                    </label>
                    <input
                        type="password"
                        placeholder={settings?.has_key_secret ? 'Leave blank to keep existing secret' : 'Enter key secret'}
                        value={form.key_secret}
                        onChange={e => setForm(p => ({ ...p, key_secret: e.target.value }))}
                        style={inputStyle}
                        autoComplete="new-password"
                    />
                </div>

                <div>
                    <label style={labelStyle}>
                        Webhook Secret {settings?.has_webhook_secret && <span style={{ color: '#10b981', textTransform: 'none' }}>· saved: {settings.webhook_secret_masked}</span>}
                    </label>
                    <input
                        type="password"
                        placeholder={settings?.has_webhook_secret ? 'Leave blank to keep existing secret' : 'Enter webhook secret'}
                        value={form.webhook_secret}
                        onChange={e => setForm(p => ({ ...p, webhook_secret: e.target.value }))}
                        style={inputStyle}
                        autoComplete="new-password"
                    />
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        Set the same secret in Razorpay Dashboard → Webhooks. Webhook URL:{' '}
                        <code style={{ background: 'rgba(20,32,26,0.04)', padding: '2px 6px', borderRadius: 4 }}>
                            {window.location.origin}/api/billing/razorpay/webhook
                        </code>
                        <br />
                        Subscribe to events: <code>subscription.charged</code>, <code>subscription.cancelled</code>,{' '}
                        <code>subscription.halted</code>, <code>payment.failed</code>
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{ background: 'var(--primary)', color: '#fff', padding: '0.7rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
                    >
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    <button
                        onClick={handleTest}
                        disabled={testing}
                        style={{ background: 'rgba(5,150,105,0.1)', color: '#059669', border: '1px solid rgba(5,150,105,0.3)', padding: '0.7rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: testing ? 0.7 : 1 }}
                    >
                        {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
            </div>

            {/* Company & Tax (invoice) settings */}
            <div className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <div>
                    <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Company &amp; Tax (Invoices)</h2>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                        Shown on every invoice PDF. Set your GSTIN and tax rate if you're a registered business.
                    </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={labelStyle}>Company Name</label>
                        <input type="text" value={company.company_name} placeholder="Gofenice"
                            onChange={e => setCompany(c => ({ ...c, company_name: e.target.value }))}
                            style={{ ...inputStyle, fontFamily: 'inherit' }} />
                    </div>
                    <div>
                        <label style={labelStyle}>Billing Email</label>
                        <input type="email" value={company.company_email} placeholder="billing@yourdomain.com"
                            onChange={e => setCompany(c => ({ ...c, company_email: e.target.value }))}
                            style={{ ...inputStyle, fontFamily: 'inherit' }} />
                    </div>
                </div>

                <div>
                    <label style={labelStyle}>Registered Address</label>
                    <textarea rows={2} value={company.company_address} placeholder="Street, City, State, PIN"
                        onChange={e => setCompany(c => ({ ...c, company_address: e.target.value }))}
                        style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={labelStyle}>GSTIN (optional)</label>
                        <input type="text" value={company.company_gstin} placeholder="22AAAAA0000A1Z5"
                            onChange={e => setCompany(c => ({ ...c, company_gstin: e.target.value.toUpperCase() }))}
                            style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Tax Label</label>
                        <input type="text" value={company.tax_label} placeholder="GST"
                            onChange={e => setCompany(c => ({ ...c, tax_label: e.target.value }))}
                            style={{ ...inputStyle, fontFamily: 'inherit' }} />
                    </div>
                    <div>
                        <label style={labelStyle}>Tax Rate %</label>
                        <input type="number" value={company.tax_rate} placeholder="18" min={0} max={100} step="0.01"
                            onChange={e => setCompany(c => ({ ...c, tax_rate: e.target.value }))}
                            style={inputStyle} />
                    </div>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                    Tax rate <code>0</code> hides the tax line. When set, plan prices are treated as <strong>tax-inclusive</strong> and the invoice shows a taxable-value + {company.tax_label || 'tax'} breakdown.
                </p>

                <button onClick={handleSaveCompany} disabled={savingCompany}
                    style={{ alignSelf: 'flex-start', background: 'var(--primary)', color: '#fff', padding: '0.7rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: savingCompany ? 0.7 : 1 }}>
                    {savingCompany ? 'Saving...' : 'Save Company & Tax'}
                </button>
            </div>

            {/* How it works */}
            <div className="glass" style={{ padding: '1.25rem 1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>How recurring billing works</h3>
                <ol style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.83rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <li>Merchant picks a plan on their Billing page → Razorpay Checkout opens.</li>
                    <li>A Razorpay subscription plan is auto-created for each Cataseek plan (re-created when you change the price).</li>
                    <li>First payment is verified server-side, the subscription activates, and an invoice is emailed.</li>
                    <li>Renewals arrive via the <code>subscription.charged</code> webhook — period extends and a new invoice is issued automatically.</li>
                    <li>All payments appear under <strong style={{ color: 'var(--text-main)' }}>Orders</strong> in this admin panel.</li>
                </ol>
            </div>
        </div>
    );
};

export default AdminPayments;
