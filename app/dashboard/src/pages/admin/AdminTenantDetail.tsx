import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';

interface TenantDetail {
    id: number; store_name: string; store_domain: string; email: string;
    status: string; plan_name: string; plan_price: number; sub_status: string;
    max_products: number; max_requests_per_month: number; meilisearch_index_name: string;
    created_at: string; trial_ends_at: string; current_period_end: string; plan_id: number;
    api_key: string; hosting_enabled?: boolean | number; search_enabled?: boolean | number;
}
interface UsageDay { date: string; requests: number; }

const statusColor: Record<string, string> = {
    active: '#10b981', trial: '#f59e0b', suspended: '#ef4444', cancelled: '#6b7280'
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
        {children}
    </div>
);

const AdminTenantDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [data, setData] = useState<{ tenant: TenantDetail; usage: UsageDay[]; productCount: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [plans, setPlans] = useState<{ id: number; name: string }[]>([]);
    const [form, setForm] = useState({ store_name: '', store_domain: '', status: '', plan_id: '', hosting_enabled: false, search_enabled: true });
    const [msg, setMsg] = useState('');

    useEffect(() => {
        Promise.all([
            api.get(`/admin/tenants/${id}`),
            api.get('/plans/plans'),
        ]).then(([detailRes, plansRes]) => {
            const t = detailRes.data.tenant;
            setData(detailRes.data);
            setForm({ store_name: t.store_name, store_domain: t.store_domain, status: t.status, plan_id: String(t.plan_id || ''), hosting_enabled: !!t.hosting_enabled, search_enabled: t.search_enabled === undefined ? true : !!t.search_enabled });
            setPlans(plansRes.data.plans || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [id]);

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            await api.patch(`/admin/tenants/${id}`, {
                store_name: form.store_name,
                store_domain: form.store_domain,
                status: form.status,
                plan_id: form.plan_id ? parseInt(form.plan_id) : undefined,
                hosting_enabled: form.hosting_enabled,
                search_enabled: form.search_enabled,
            });
            setMsg('✅ Saved successfully');
            // Refresh
            const r = await api.get(`/admin/tenants/${id}`);
            setData(r.data);
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const handleDelete = async () => {
        if (!window.confirm(
            `Permanently REMOVE "${data?.tenant.store_name}"?\n\nThis will:\n• Drop their product database table\n• Wipe their Meilisearch search index\n• Delete all subscriptions, invoices, and API usage data\n\nThis action CANNOT be undone.`
        )) return;
        if (!window.confirm(`Final confirmation: You are about to permanently delete "${data?.tenant.store_name}" (${data?.tenant.email}). Proceed?`)) return;
        try {
            await api.delete(`/admin/tenants/${id}?action=delete`);
            navigate('/admin/tenants');
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Failed to remove tenant'));
        }
    };

    if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading...</div>;
    if (!data) return <div style={{ color: 'var(--error)', padding: '2rem' }}>Tenant not found</div>;

    const t = data.tenant;
    const maxUsage = Math.max(...data.usage.map(u => u.requests), 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 900 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button onClick={() => navigate('/admin/tenants')} style={{ background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: '0.25rem 0.5rem' }}>←</button>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>{t.store_name}</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.email} · Joined {new Date(t.created_at).toLocaleDateString()}</p>
                </div>
                <span style={{ marginLeft: 'auto', background: `${statusColor[t.status] || '#6b7280'}22`, color: statusColor[t.status] || '#6b7280', padding: '0.3rem 0.9rem', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600 }}>
                    {t.status}
                </span>
            </div>

            {/* Quick stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                {[
                    { label: 'Plan', value: t.plan_name || 'None' },
                    { label: 'Products', value: data.productCount.toLocaleString() },
                    { label: 'Max Products', value: (t.max_products || 0).toLocaleString() },
                    { label: 'Max Req/mo', value: (t.max_requests_per_month || 0).toLocaleString() },
                ].map(s => (
                    <div key={s.label} className="glass" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-main)' }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Usage chart (30 days) */}
            <div className="glass" style={{ padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem' }}>API Usage — Last 30 days</h2>
                {data.usage.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No usage data yet</p>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
                        {data.usage.map(u => (
                            <div key={u.date} title={`${u.date}: ${u.requests}`} style={{
                                flex: 1, minWidth: 4, background: 'var(--primary)',
                                height: `${(u.requests / maxUsage) * 100}%`,
                                borderRadius: 3, opacity: 0.8, transition: 'opacity 0.15s',
                            }} />
                        ))}
                    </div>
                )}
            </div>

            {/* Edit form */}
            <div className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>Edit Tenant</h2>

                {msg && <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', fontSize: '0.9rem' }}>{msg}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <Field label="Store Name">
                        <input value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }} />
                    </Field>
                    <Field label="Store Domain">
                        <input value={form.store_domain} onChange={e => setForm(f => ({ ...f, store_domain: e.target.value }))}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }} />
                    </Field>
                    <Field label="Status">
                        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }}>
                            <option value="active">active</option>
                            <option value="trial">trial</option>
                            <option value="suspended">suspended</option>
                            <option value="cancelled">cancelled</option>
                        </select>
                    </Field>
                    <Field label="Plan">
                        <select value={form.plan_id} onChange={e => setForm(f => ({ ...f, plan_id: e.target.value }))}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }}>
                            <option value="">— No plan —</option>
                            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Cataseek Search Service">
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
                            background: form.search_enabled ? 'rgba(5,150,105,0.06)' : 'rgba(20,32,26,0.03)',
                        }}>
                            <span style={{ fontSize: '0.875rem', color: form.search_enabled ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                                {form.search_enabled ? '🟢 Enabled — full search product' : '⚪ Disabled — hosting-only client'}
                            </span>
                            <input
                                type="checkbox"
                                checked={form.search_enabled}
                                onChange={e => setForm(f => ({ ...f, search_enabled: e.target.checked }))}
                                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)' }}
                            />
                        </div>
                    </Field>
                    <Field label="Hosting Service (on-demand)">
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
                            background: form.hosting_enabled ? 'rgba(5,150,105,0.06)' : 'rgba(20,32,26,0.03)',
                        }}>
                            <span style={{ fontSize: '0.875rem', color: form.hosting_enabled ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                                {form.hosting_enabled ? '🟢 Enabled — store can buy hosting' : '⚪ Disabled — hidden from store'}
                            </span>
                            <input
                                type="checkbox"
                                checked={form.hosting_enabled}
                                onChange={e => setForm(f => ({ ...f, hosting_enabled: e.target.checked }))}
                                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)' }}
                            />
                        </div>
                    </Field>
                </div>

                <Field label="Meilisearch Index">
                    <input readOnly value={t.meilisearch_index_name || '—'}
                        style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.02)', color: 'var(--text-muted)', cursor: 'default' }} />
                </Field>
                <Field label="API Key">
                    <input readOnly value={t.api_key || '—'}
                        style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.02)', color: 'var(--text-muted)', cursor: 'default', fontFamily: 'monospace', fontSize: '0.8rem' }} />
                </Field>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <button onClick={handleSave} disabled={saving}
                        style={{ background: 'var(--primary)', color: '#fff', padding: '0.65rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={handleDelete}
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '0.65rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                        🗑 Remove Tenant
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminTenantDetail;
