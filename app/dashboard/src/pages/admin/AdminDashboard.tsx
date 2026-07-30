import React, { useEffect, useState } from 'react';
import {
    Store,
    CheckCircle2,
    Clock,
    Ban,
    Search,
    TrendingUp,
    Layers,
} from 'lucide-react';
import api from '../../services/api';

interface Stats {
    tenants: { total_tenants: number; active_tenants: number; trial_tenants: number; suspended_tenants: number };
    requests: { total_requests_all_time: number; requests_this_month: number };
    plans: { name: string; subscriber_count: number; price: number }[];
}

const StatCard: React.FC<{
    label: string;
    value: string | number;
    icon: React.ReactNode;
    color: string;
    bgGlow?: string;
}> = ({ label, value, icon, color, bgGlow }) => (
    <div
        className="glass"
        style={{
            padding: '1.4rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            background: bgGlow || 'var(--card)',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            boxShadow: 'var(--shadow-sm)',
        }}
    >
        <div
            style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: `${color}18`,
                border: `1px solid ${color}33`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: color,
                flexShrink: 0,
            }}
        >
            {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>
                {label}
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.1 }}>
                {value}
            </div>
        </div>
    </div>
);

const AdminDashboard: React.FC = () => {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/admin/stats')
            .then((r: { data: Stats }) => { setStats(r.data); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    if (loading) return (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="skeleton" style={{ width: 120, height: 20 }} />
        </div>
    );
    if (!stats) return <div style={{ color: 'var(--error)', padding: '2rem' }}>Failed to load stats</div>;

    const t = stats.tenants;
    const r = stats.requests;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4, letterSpacing: '-0.02em' }}>
                    Admin Overview
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Platform-wide merchant &amp; search metrics
                </p>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                <StatCard
                    label="Total Tenants"
                    value={t.total_tenants ?? 0}
                    icon={<Store size={22} />}
                    color="#6366f1"
                />
                <StatCard
                    label="Active Tenants"
                    value={t.active_tenants ?? 0}
                    icon={<CheckCircle2 size={22} />}
                    color="#99c124"
                />
                <StatCard
                    label="On Trial"
                    value={t.trial_tenants ?? 0}
                    icon={<Clock size={22} />}
                    color="#f59e0b"
                />
                <StatCard
                    label="Suspended"
                    value={t.suspended_tenants ?? 0}
                    icon={<Ban size={22} />}
                    color="#ef4444"
                />
                <StatCard
                    label="Searches This Month"
                    value={(r.requests_this_month ?? 0).toLocaleString()}
                    icon={<Search size={22} />}
                    color="#8b5cf6"
                />
                <StatCard
                    label="Total Searches"
                    value={(r.total_requests_all_time ?? 0).toLocaleString()}
                    icon={<TrendingUp size={22} />}
                    color="#0ea5e9"
                />
            </div>

            {/* Plans breakdown */}
            <div
                className="glass"
                style={{
                    padding: '1.75rem',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    boxShadow: 'var(--shadow-sm)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
                    <Layers size={20} color="var(--primary)" />
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                        Plan Subscriptions Breakdown
                    </h2>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' }}>
                    {stats.plans.map(p => (
                        <div
                            key={p.name}
                            style={{
                                background: 'var(--bg-2)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '1.25rem 1rem',
                                textAlign: 'center',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                                {p.name}
                            </div>
                            <div style={{ fontSize: '2.25rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
                                {p.subscriber_count}
                            </div>
                            <div
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 500,
                                    color: 'var(--text-dim)',
                                    display: 'inline-block',
                                    marginTop: 2,
                                }}
                            >
                                ${p.price}/mo per store
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;

