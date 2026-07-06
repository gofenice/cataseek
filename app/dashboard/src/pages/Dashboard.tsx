import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

interface Stats {
    productCount: number;
    productLimit: number;
    searchesThisMonth: number;
    searchLimit: number;
    usagePercent: number;
    planName: string;
    planStatus: string;
    renewsIn: number | null;
    trialEndsAt: string | null;
    usageHistory: { date: string; requests: number }[];
}

const SkeletonCard = () => (
    <div className="card" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>
        <div style={{ height: 12, width: '40%', background: 'rgba(20,32,26,0.04)', borderRadius: 6, marginBottom: 12 }} />
        <div style={{ height: 32, width: '60%', background: 'rgba(255,255,255,0.08)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 10, width: '50%', background: 'rgba(20,32,26,0.03)', borderRadius: 6 }} />
    </div>
);

const StatCard: React.FC<{
    label: string; value: string; sub: string; subColor?: string;
}> = ({ label, value, sub, subColor = 'var(--text-muted)' }) => (
    <div className="card">
        <h3 style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem', fontWeight: 600 }}>{label}</h3>
        <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.82rem', color: subColor, marginTop: '0.6rem' }}>{sub}</div>
    </div>
);

const UsageBar: React.FC<{ pct: number }> = ({ pct }) => {
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    return (
        <div style={{ background: 'rgba(20,32,26,0.04)', borderRadius: 99, height: 6, overflow: 'hidden', marginTop: 8 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.8s ease' }} />
        </div>
    );
};

const fmt = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const Dashboard: React.FC = () => {
    const { tenant } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Hosting-only clients have no search overview — send them to Hosting
        api.get('/tenants/profile')
            .then(r => {
                const se = r.data.tenant?.search_enabled;
                if (se !== undefined && se !== null && !se) navigate('/hosting', { replace: true });
            })
            .catch(() => { /* default: stay */ });

        api.get('/tenants/stats')
            .then(r => { setStats(r.data); setLoading(false); })
            .catch(() => setLoading(false));
    }, [navigate]);

    const maxBar = Math.max(...(stats?.usageHistory.map(d => d.requests) ?? [1]), 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                    Dashboard Overview
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Welcome back, {tenant?.storeName} — here's how your search is performing
                </p>
            </div>

            {/* Trial warning banner */}
            {stats?.planStatus === 'trial' && (
                <div style={{
                    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: 10, padding: '0.875rem 1.25rem', display: 'flex',
                    alignItems: 'center', justifyContent: 'space-between', gap: '1rem'
                }}>
                    <span style={{ color: '#f59e0b', fontSize: '0.9rem' }}>
                        ⏳ <strong>Trial mode</strong> — you have limited searches. Upgrade to a plan to remove limits.
                        {stats.trialEndsAt && ` Trial ends ${new Date(stats.trialEndsAt).toLocaleDateString()}.`}
                    </span>
                    <button
                        onClick={() => navigate('/billing')}
                        style={{ background: '#f59e0b', color: '#000', padding: '0.4rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                        View Plans →
                    </button>
                </div>
            )}

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                {loading ? (
                    <>{Array(4).fill(0).map((_, i) => <SkeletonCard key={i} />)}</>
                ) : stats ? (
                    <>
                        <StatCard
                            label="Total Products"
                            value={stats.productCount.toLocaleString()}
                            sub={`of ${stats.productLimit.toLocaleString()} indexed`}
                        />
                        <StatCard
                            label="Searches This Month"
                            value={fmt(stats.searchesThisMonth)}
                            sub={`of ${fmt(stats.searchLimit)} limit (${stats.usagePercent}%)`}
                            subColor={stats.usagePercent >= 90 ? '#ef4444' : stats.usagePercent >= 70 ? '#f59e0b' : 'var(--text-muted)'}
                        />
                        <StatCard
                            label="Usage"
                            value={`${stats.usagePercent}%`}
                            sub={stats.usagePercent >= 90 ? '⚠️ Near limit' : stats.usagePercent >= 70 ? 'Getting close' : 'Looking good'}
                            subColor={stats.usagePercent >= 90 ? '#ef4444' : stats.usagePercent >= 70 ? '#f59e0b' : '#10b981'}
                        />
                        <StatCard
                            label="Active Plan"
                            value={stats.planName}
                            sub={
                                stats.renewsIn !== null
                                    ? `Renews in ${stats.renewsIn} days`
                                    : stats.planStatus === 'trial'
                                        ? 'Trial — upgrade to unlock'
                                        : 'No active subscription'
                            }
                            subColor={stats.renewsIn !== null && stats.renewsIn <= 5 ? '#f59e0b' : 'var(--text-muted)'}
                        />
                    </>
                ) : (
                    <div style={{ color: 'var(--text-muted)', gridColumn: '1/-1' }}>Could not load stats.</div>
                )}
            </div>

            {/* Usage bar */}
            {stats && (
                <div className="glass" style={{ padding: '0.75rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                        <span>Monthly search usage</span>
                        <span>{stats.searchesThisMonth.toLocaleString()} / {stats.searchLimit.toLocaleString()}</span>
                    </div>
                    <UsageBar pct={stats.usagePercent} />
                </div>
            )}

            {/* 30-day activity chart */}
            <div className="glass" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1.25rem' }}>
                    Search Activity — Last 30 Days
                </h3>
                {loading ? (
                    <div style={{ height: 100, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px dashed var(--border)' }} />
                ) : stats && stats.usageHistory.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
                        {stats.usageHistory.map(day => (
                            <div
                                key={day.date}
                                title={`${new Date(day.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}: ${day.requests} searches`}
                                style={{
                                    flex: 1, minWidth: 4,
                                    height: `${Math.max(4, (day.requests / maxBar) * 100)}%`,
                                    background: 'var(--primary)',
                                    borderRadius: '3px 3px 0 0',
                                    opacity: 0.75,
                                    transition: 'opacity 0.15s',
                                    cursor: 'default',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
                            />
                        ))}
                    </div>
                ) : (
                    <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                        No search activity yet — your data will appear here once searches start coming in.
                    </div>
                )}
                {stats && stats.usageHistory.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <span>{new Date(stats.usageHistory[0]?.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                        <span>Today</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
