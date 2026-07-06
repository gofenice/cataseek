import React, { useEffect, useState } from 'react';
import api from '../../services/api';

interface Stats {
    tenants: { total_tenants: number; active_tenants: number; trial_tenants: number; suspended_tenants: number };
    requests: { total_requests_all_time: number; requests_this_month: number };
    plans: { name: string; subscriber_count: number; price: number }[];
}

const StatCard: React.FC<{ label: string; value: string | number; icon: string; color: string }> = ({ label, value, icon, color }) => (
    <div className="glass" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{icon}</div>
        <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)' }}>{value}</div>
        </div>
    </div>
);

const AdminDashboard: React.FC = () => {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/admin/stats').then((r: { data: Stats }) => { setStats(r.data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading stats...</div>;
    if (!stats) return <div style={{ color: 'var(--error)', padding: '2rem' }}>Failed to load stats</div>;

    const t = stats.tenants;
    const r = stats.requests;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Admin Overview</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Platform-wide metrics</p>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <StatCard label="Total Tenants" value={t.total_tenants ?? 0} icon="🏪" color="#6366f1" />
                <StatCard label="Active Tenants" value={t.active_tenants ?? 0} icon="✅" color="#10b981" />
                <StatCard label="On Trial" value={t.trial_tenants ?? 0} icon="⏳" color="#f59e0b" />
                <StatCard label="Suspended" value={t.suspended_tenants ?? 0} icon="🚫" color="#ef4444" />
                <StatCard label="Searches This Month" value={(r.requests_this_month ?? 0).toLocaleString()} icon="🔍" color="#8b5cf6" />
                <StatCard label="Total Searches" value={(r.total_requests_all_time ?? 0).toLocaleString()} icon="📈" color="#0ea5e9" />
            </div>

            {/* Plans breakdown */}
            <div className="glass" style={{ padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem' }}>Plan Subscriptions</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    {stats.plans.map(p => (
                        <div key={p.name} style={{ background: 'rgba(20,32,26,0.06)', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>{p.name}</div>
                            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)' }}>{p.subscriber_count}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>${p.price}/mo</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
