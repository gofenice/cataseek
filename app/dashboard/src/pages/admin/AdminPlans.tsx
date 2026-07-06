import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

interface Plan {
    id: number; name: string; description: string;
    price: number; billing_period: string;
    max_products: number; max_requests_per_month: number;
    features: string | string[]; is_active: boolean;
}

const emptyForm = {
    name: '', description: '', price: '', billing_period: 'monthly',
    max_products: '', max_requests_per_month: '', features: '', is_active: true,
};

const parseFeatures = (f: string | string[]): string[] => {
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
};

const AdminPlans: React.FC = () => {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/plans');
            setPlans(res.data.plans || []);
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

    const openEdit = (p: Plan) => {
        setForm({
            name: p.name, description: p.description, price: String(p.price),
            billing_period: p.billing_period, max_products: String(p.max_products),
            max_requests_per_month: String(p.max_requests_per_month),
            features: parseFeatures(p.features).join('\n'),
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
                name: form.name, description: form.description,
                price: parseFloat(form.price), billing_period: form.billing_period,
                max_products: parseInt(form.max_products) || 0,
                max_requests_per_month: parseInt(form.max_requests_per_month),
                features: form.features.split('\n').map(s => s.trim()).filter(Boolean),
                is_active: form.is_active,
            };
            if (editingId) {
                await api.patch(`/admin/plans/${editingId}`, payload);
                setMsg('✅ Plan updated');
            } else {
                await api.post('/admin/plans', payload);
                setMsg('✅ Plan created');
            }
            await fetchPlans();
            setTimeout(() => setShowModal(false), 800);
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const handleDeactivate = async (id: number) => {
        if (!window.confirm('Deactivate this plan? Existing subscribers keep access until renewal.')) return;
        await api.delete(`/admin/plans/${id}`);
        fetchPlans();
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)',
        background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Plans</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Manage subscription plans and limits</p>
                </div>
                <button onClick={openCreate} style={{ background: 'var(--primary)', color: '#fff', padding: '0.65rem 1.25rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    + New Plan
                </button>
            </div>

            {/* Plans table */}
            <div className="glass" style={{ overflow: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Name', 'Price', 'Searches/mo', 'Max Products', 'Status', ''].map(h => (
                                    <th key={h} style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {plans.map(plan => (
                                <tr key={plan.id} style={{ borderBottom: '1px solid rgba(20,32,26,0.06)' }}>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{plan.name}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{plan.description}</div>
                                    </td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>${plan.price}<span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem' }}>/{plan.billing_period}</span></td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)' }}>{plan.max_requests_per_month.toLocaleString()}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)' }}>{plan.max_products.toLocaleString()}</td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <span style={{ background: plan.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)', color: plan.is_active ? '#10b981' : '#6b7280', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>
                                            {plan.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button onClick={() => openEdit(plan)} style={{ background: 'rgba(5,150,105,0.1)', color: '#059669', border: '1px solid rgba(5,150,105,0.3)', padding: '0.3rem 0.75rem', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}>Edit</button>
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

            {/* Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass" style={{ padding: '2rem', width: 480, maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '1.1rem' }}>{editingId ? 'Edit Plan' : 'New Plan'}</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
                        </div>

                        {msg && <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', fontSize: '0.87rem' }}>{msg}</div>}

                        {([
                            { label: 'Plan Name', key: 'name', type: 'text', placeholder: 'e.g. Starter' },
                            { label: 'Description', key: 'description', type: 'text', placeholder: 'Short description' },
                            { label: 'Price (USD)', key: 'price', type: 'number', placeholder: '29.99' },
                            { label: 'Max Searches/Month', key: 'max_requests_per_month', type: 'number', placeholder: '10000' },
                            { label: 'Max Products', key: 'max_products', type: 'number', placeholder: '1000' },
                        ] as { label: string; key: keyof typeof emptyForm; type: string; placeholder: string }[]).map(f => (
                            <div key={f.key}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{f.label}</label>
                                <input type={f.type} placeholder={f.placeholder} value={form[f.key] as string}
                                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                    style={inputStyle} />
                            </div>
                        ))}

                        <div>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Billing Period</label>
                            <select value={form.billing_period} onChange={e => setForm(prev => ({ ...prev, billing_period: e.target.value }))} style={inputStyle}>
                                <option value="monthly">Monthly</option>
                                <option value="yearly">Yearly</option>
                            </select>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Features (one per line)</label>
                            <textarea rows={4} placeholder={"AI Search\nMulti-language\nPriority support"} value={form.features}
                                onChange={e => setForm(prev => ({ ...prev, features: e.target.value }))}
                                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input type="checkbox" id="is_active" checked={form.is_active as boolean}
                                onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                            <label htmlFor="is_active" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', cursor: 'pointer' }}>Active (visible to merchants)</label>
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

export default AdminPlans;
