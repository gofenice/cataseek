import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

interface HostingPlan {
    id: number;
    name: string;
    price: number;
    storage_gb: number;
    ram_gb: number;
    bandwidth: string;
    billing_period: 'monthly' | 'yearly';
    is_active: boolean;
}

interface Stats {
    enabled_tenants: number;
    active_subscriptions: number;
}

const emptyForm = {
    name: '', price: '', storage_gb: '', ram_gb: '', bandwidth: 'Unlimited', billing_period: 'monthly', is_active: true,
};

const AdminHosting: React.FC = () => {
    const [plans, setPlans] = useState<HostingPlan[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/hosting-plans');
            setPlans(res.data.plans || []);
            setStats(res.data.stats || null);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchPlans(); }, [fetchPlans]);

    const openCreate = () => {
        setForm({ ...emptyForm });
        setEditingId(null);
        setMsg('');
        setShowModal(true);
    };

    const openEdit = (p: HostingPlan) => {
        setForm({
            name: p.name, price: String(p.price),
            storage_gb: String(p.storage_gb), ram_gb: String(p.ram_gb),
            bandwidth: p.bandwidth, billing_period: p.billing_period,
            is_active: p.is_active,
        });
        setEditingId(p.id);
        setMsg('');
        setShowModal(true);
    };

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            const payload = {
                name: form.name,
                price: parseFloat(form.price),
                storage_gb: parseInt(form.storage_gb) || 0,
                ram_gb: parseFloat(form.ram_gb) || 0,
                bandwidth: form.bandwidth || 'Unlimited',
                billing_period: form.billing_period,
                is_active: form.is_active,
            };
            if (editingId) {
                await api.patch(`/admin/hosting-plans/${editingId}`, payload);
                setMsg('✅ Hosting plan updated');
            } else {
                await api.post('/admin/hosting-plans', payload);
                setMsg('✅ Hosting plan created');
            }
            await fetchPlans();
            setTimeout(() => setShowModal(false), 800);
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const handleDeactivate = async (id: number) => {
        if (!window.confirm('Deactivate this hosting plan? Existing subscribers keep access until renewal.')) return;
        await api.delete(`/admin/hosting-plans/${id}`);
        fetchPlans();
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg-2)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Hosting Plans</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        On-demand hosting product. Enable it per store from the tenant detail page — only enabled stores can purchase.
                    </p>
                </div>
                <button onClick={openCreate} style={{ background: 'var(--primary)', color: '#fff', padding: '0.65rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + New Hosting Plan
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', maxWidth: 500 }}>
                <div className="glass" style={{ padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Stores With Access</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{stats?.enabled_tenants ?? 0}</div>
                </div>
                <div className="glass" style={{ padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Active Subscriptions</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>{stats?.active_subscriptions ?? 0}</div>
                </div>
            </div>

            {/* Plans table */}
            <div className="glass" style={{ overflow: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>
                ) : plans.length === 0 ? (
                    <div style={{ padding: '2.5rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.9rem' }}>
                        No hosting plans yet. Click "+ New Hosting Plan" to create the first one.
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Name', 'Amount', 'Size', 'RAM', 'Data', 'Billing', 'Status', ''].map(h => (
                                    <th key={h} style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {plans.map(plan => (
                                <tr key={plan.id} style={{ borderBottom: '1px solid rgba(20,32,26,0.06)' }}>
                                    <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-main)' }}>{plan.name}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>{Number(plan.price).toFixed(2)}<span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem' }}>/{plan.billing_period === 'yearly' ? 'yr' : 'mo'}</span></td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)' }}>{plan.storage_gb} GB</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)' }}>{Number(plan.ram_gb)} GB</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)' }}>{plan.bandwidth}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{plan.billing_period}</td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <span style={{ background: plan.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)', color: plan.is_active ? '#10b981' : '#6b7280', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>
                                            {plan.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button onClick={() => openEdit(plan)} style={{ background: 'rgba(5,150,105,0.1)', color: 'var(--primary)', border: '1px solid rgba(5,150,105,0.3)', padding: '0.3rem 0.75rem', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}>Edit</button>
                                            {plan.is_active && (
                                                <button onClick={() => handleDeactivate(plan.id)} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '0.3rem 0.75rem', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}>Deactivate</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* How it works */}
            <div className="glass" style={{ padding: '1.25rem 1.5rem', maxWidth: 720 }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>How the hosting product works</h3>
                <ol style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.83rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <li>Create hosting plans here (Amount, Size, RAM, Data).</li>
                    <li>Open <strong style={{ color: 'var(--text-main)' }}>Tenants → a store → Edit Tenant</strong> and switch <strong style={{ color: 'var(--text-main)' }}>Hosting Service</strong> to Enabled.</li>
                    <li>That store now sees a <strong style={{ color: 'var(--text-main)' }}>Hosting</strong> section in their dashboard and can purchase a plan.</li>
                    <li>Payments use the same gateway as search plans (Razorpay or demo mode) and appear under <strong style={{ color: 'var(--text-main)' }}>Orders</strong>.</li>
                </ol>
            </div>

            {/* Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass" style={{ padding: '2rem', width: 460, maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: '1rem', background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '1.1rem' }}>{editingId ? 'Edit Hosting Plan' : 'New Hosting Plan'}</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
                        </div>

                        {msg && <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', fontSize: '0.87rem' }}>{msg}</div>}

                        <div>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Plan Name</label>
                            <input type="text" placeholder="e.g. Basic Hosting" value={form.name}
                                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                style={inputStyle} />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Amount</label>
                                <input type="number" placeholder="9.99" value={form.price}
                                    onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
                                    style={inputStyle} />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Billing Period</label>
                                <select value={form.billing_period} onChange={e => setForm(prev => ({ ...prev, billing_period: e.target.value }))} style={inputStyle}>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Size (GB storage)</label>
                                <input type="number" placeholder="50" value={form.storage_gb}
                                    onChange={e => setForm(prev => ({ ...prev, storage_gb: e.target.value }))}
                                    style={inputStyle} />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>RAM (GB)</label>
                                <input type="number" placeholder="2" step="0.5" value={form.ram_gb}
                                    onChange={e => setForm(prev => ({ ...prev, ram_gb: e.target.value }))}
                                    style={inputStyle} />
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Data (bandwidth)</label>
                            <input type="text" placeholder="e.g. 1 TB or Unlimited" value={form.bandwidth}
                                onChange={e => setForm(prev => ({ ...prev, bandwidth: e.target.value }))}
                                style={inputStyle} />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input type="checkbox" id="hosting_is_active" checked={form.is_active as boolean}
                                onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                            <label htmlFor="hosting_is_active" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', cursor: 'pointer' }}>Active (purchasable by enabled stores)</label>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <button onClick={handleSave} disabled={saving}
                                style={{ flex: 1, background: 'var(--primary)', color: '#fff', padding: '0.7rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Plan'}
                            </button>
                            <button onClick={() => setShowModal(false)}
                                style={{ padding: '0.7rem 1.25rem', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminHosting;
