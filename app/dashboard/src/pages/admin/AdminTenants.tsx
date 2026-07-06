import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

interface Tenant {
    id: number; store_name: string; store_domain: string; email: string;
    status: string; plan_name: string; created_at: string; requests_this_month: number;
}

const statusColor: Record<string, string> = {
    active: '#10b981', trial: '#f59e0b', suspended: '#ef4444', cancelled: '#6b7280'
};

const AdminTenants: React.FC = () => {
    const navigate = useNavigate();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });

    const fetchTenants = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params: any = { page, limit: 20 };
            if (search) params.search = search;
            if (statusFilter) params.status = statusFilter;
            const res = await api.get('/admin/tenants', { params });
            setTenants(res.data.tenants);
            setPagination(res.data.pagination);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, [search, statusFilter]);

    useEffect(() => { fetchTenants(1); }, [fetchTenants]);

    const handleSuspend = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Suspend this tenant?')) return;
        await api.delete(`/admin/tenants/${id}?action=suspend`);
        fetchTenants(pagination.page);
    };

    const handleRemove = async (t: Tenant, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(
            `Permanently REMOVE "${t.store_name}"?\n\nThis will:\n• Drop their product database table\n• Wipe their Meilisearch search index\n• Delete all subscriptions, invoices, and API usage data\n\nThis action CANNOT be undone.`
        )) return;
        // Second confirmation for safety
        if (!window.confirm(`Final confirmation: Type-check yourself — you are about to permanently delete "${t.store_name}" (${t.email}). Proceed?`)) return;
        try {
            await api.delete(`/admin/tenants/${t.id}?action=delete`);
            fetchTenants(pagination.page);
        } catch (err: any) {
            alert('Error: ' + (err.response?.data?.error || 'Failed to remove tenant'));
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Tenants</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{pagination.total} total merchants</p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <input
                    placeholder="Search by name, email or domain..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    style={{ flex: 1, minWidth: 260, padding: '0.6rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }}
                />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    style={{ padding: '0.6rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)' }}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>

            {/* Table */}
            <div className="glass" style={{ overflow: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Store', 'Domain', 'Email', 'Plan', 'Status', 'Searches/mo', 'Joined', ''].map(h => (
                                    <th key={h} style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {tenants.length === 0 ? (
                                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No tenants found</td></tr>
                            ) : tenants.map(t => (
                                <tr key={t.id} onClick={() => navigate(`/admin/tenants/${t.id}`)}
                                    style={{ borderBottom: '1px solid rgba(20,32,26,0.06)', cursor: 'pointer', transition: 'background 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(20,32,26,0.06)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                    <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem' }}>{t.store_name}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.store_domain}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.email}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.plan_name || '—'}</td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <span style={{ background: `${statusColor[t.status] || '#6b7280'}22`, color: statusColor[t.status] || '#6b7280', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>
                                            {t.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{(t.requests_this_month || 0).toLocaleString()}</td>
                                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                                    <td style={{ padding: '0.85rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {t.status !== 'suspended' && (
                                                <button onClick={e => handleSuspend(t.id, e)} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                    Suspend
                                                </button>
                                            )}
                                            <button onClick={e => handleRemove(t, e)} title="Permanently remove this tenant and all their data" style={{ background: 'rgba(127,0,0,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                🗑 Remove
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                    {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
                        <button key={p} onClick={() => fetchTenants(p)} style={{
                            width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)',
                            background: p === pagination.page ? 'var(--primary)' : 'transparent',
                            color: p === pagination.page ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem',
                        }}>{p}</button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminTenants;
