import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

interface Order {
    id: number;
    tenant_id: number;
    store_name: string;
    tenant_email: string;
    plan_name: string | null;
    razorpay_subscription_id: string | null;
    razorpay_payment_id: string | null;
    amount: number;
    currency: string;
    status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
    method: string | null;
    created_at: string;
}

interface Summary {
    total_orders: number;
    total_revenue: number | null;
    revenue_this_month: number | null;
    failed_count: number;
}

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
    captured:   { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  label: 'Paid' },
    created:    { color: '#059669', bg: 'rgba(5,150,105,0.1)',  label: 'Initiated' },
    authorized: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Authorized' },
    failed:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Failed' },
    refunded:   { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', label: 'Refunded' },
};

const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const AdminOrders: React.FC = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/orders', { params: { search, status, page, limit: 20 } });
            setOrders(res.data.orders || []);
            setSummary(res.data.summary || null);
            setPages(res.data.pagination?.pages || 1);
            setTotal(res.data.pagination?.total || 0);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, [search, status, page]);

    useEffect(() => {
        const t = setTimeout(fetchOrders, search ? 300 : 0); // debounce search
        return () => clearTimeout(t);
    }, [fetchOrders, search]);

    const cards = [
        { label: 'Total Orders', value: summary?.total_orders ?? 0, color: '#059669' },
        { label: 'Total Revenue', value: `${Number(summary?.total_revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: '#10b981' },
        { label: 'Revenue This Month', value: `${Number(summary?.revenue_this_month || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: '#f59e0b' },
        { label: 'Failed Payments', value: summary?.failed_count ?? 0, color: '#ef4444' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Orders</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>All subscription payments collected via Razorpay</p>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                {cards.map(c => (
                    <div key={c.label} className="glass" style={{ padding: '1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{c.label}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    placeholder="Search store, email, payment ID..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    style={{
                        flex: 1, minWidth: 220, padding: '0.6rem 0.85rem', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)',
                    }}
                />
                <select
                    value={status}
                    onChange={e => { setStatus(e.target.value); setPage(1); }}
                    style={{ padding: '0.6rem 0.85rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }}
                >
                    <option value="">All statuses</option>
                    <option value="captured">Paid</option>
                    <option value="created">Initiated</option>
                    <option value="authorized">Authorized</option>
                    <option value="failed">Failed</option>
                    <option value="refunded">Refunded</option>
                </select>
            </div>

            {/* Orders table */}
            <div className="glass" style={{ overflow: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading orders...</div>
                ) : orders.length === 0 ? (
                    <div style={{ padding: '2.5rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.9rem' }}>
                        No orders yet. Payments will appear here once merchants subscribe via Razorpay.
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['#', 'Store', 'Plan', 'Amount', 'Status', 'Method', 'Payment ID', 'Date'].map(h => (
                                    <th key={h} style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map(o => {
                                const s = STATUS_STYLES[o.status] || STATUS_STYLES.created;
                                return (
                                    <tr key={o.id} style={{ borderBottom: '1px solid rgba(20,32,26,0.06)' }}>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{o.id}</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.875rem' }}>{o.store_name}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.tenant_email}</div>
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontSize: '0.875rem' }}>{o.plan_name || '—'}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>
                                            {Number(o.amount).toFixed(2)} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>{o.currency}</span>
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>
                                                {s.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'capitalize' }}>{o.method || '—'}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{o.razorpay_payment_id || '—'}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmt(o.created_at)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{total} orders · page {page} of {pages}</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                            style={{ padding: '0.45rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: page <= 1 ? 'var(--text-dim)' : 'var(--text-main)', cursor: page <= 1 ? 'default' : 'pointer' }}
                        >
                            ← Prev
                        </button>
                        <button
                            disabled={page >= pages}
                            onClick={() => setPage(p => p + 1)}
                            style={{ padding: '0.45rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: page >= pages ? 'var(--text-dim)' : 'var(--text-main)', cursor: page >= pages ? 'default' : 'pointer' }}
                        >
                            Next →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminOrders;
