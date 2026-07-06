import React, { useEffect, useState } from 'react';
import { Search, TrendingUp, AlertTriangle, Loader2, Hash, BarChart3 } from 'lucide-react';
import api from '../services/api';

interface SearchTerm {
  query: string;
  count: number;
  avg_results: number;
}

interface AnalyticsData {
  topSearches: SearchTerm[];
  lowResultSearches: SearchTerm[];
  summary: {
    totalSearches: number;
    uniqueQueries: number;
    zeroResultRate: number;
  };
  period: {
    days: number;
    from: string;
    to: string;
  };
}

const PERIOD_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

const Analytics: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api.get('/tenants/analytics', { params: { days } })
      .then((res) => setData(res.data))
      .catch((err) => console.error('Analytics fetch error:', err))
      .finally(() => setLoading(false));
  }, [days]);

  const maxTopCount = data?.topSearches?.[0]?.count || 1;
  const maxLowCount = data?.lowResultSearches?.[0]?.count || 1;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
            Search Analytics
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Understand what your customers are searching for
          </p>
        </div>

        {/* Period selector */}
        <div className="glass" style={{ display: 'flex', gap: '0.25rem', padding: '4px' }}>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              style={{
                padding: '0.4rem 0.9rem',
                fontSize: '0.82rem',
                fontWeight: days === opt.value ? 600 : 400,
                borderRadius: 6,
                border: 'none',
                background: days === opt.value ? 'var(--primary)' : 'transparent',
                color: days === opt.value ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary chips ── */}
      {loading ? (
        <div className="glass flex-center" style={{ padding: '5rem', flexDirection: 'column', gap: '1rem' }}>
          <Loader2 className="spin" size={32} color="var(--primary)" />
          <span style={{ color: 'var(--text-muted)' }}>Loading analytics…</span>
        </div>
      ) : data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
            <SummaryCard
              icon={<Search size={18} />}
              label="Total Searches"
              value={data.summary.totalSearches.toLocaleString()}
              sub={`Last ${data.period.days} days`}
            />
            <SummaryCard
              icon={<Hash size={18} />}
              label="Unique Terms"
              value={data.summary.uniqueQueries.toLocaleString()}
              sub="Distinct search queries"
            />
            <SummaryCard
              icon={<AlertTriangle size={18} />}
              label="Zero-Result Rate"
              value={`${data.summary.zeroResultRate}%`}
              sub={data.summary.zeroResultRate > 20 ? '⚠️ Consider expanding catalogue' : 'Looking good'}
              valueColor={data.summary.zeroResultRate > 20 ? '#f59e0b' : '#10b981'}
            />
          </div>

          {/* ── Two panels ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

            {/* Left — Top Searches */}
            <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <TrendingUp size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>Top Searches</h3>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  What customers search for most
                </span>
              </div>

              {data.topSearches.length === 0 ? (
                <EmptyState message="No search data yet — analytics will appear once your shoppers start searching." />
              ) : (
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  {data.topSearches.map((term, i) => (
                    <TermRow
                      key={term.query}
                      rank={i + 1}
                      term={term}
                      maxCount={maxTopCount}
                      barColor="var(--primary)"
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right — Low-Result Searches */}
            <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <AlertTriangle size={18} color="#f59e0b" />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>Low-Result Searches</h3>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Consider adding these products
                </span>
              </div>

              {data.lowResultSearches.length === 0 ? (
                <EmptyState message="Great news — all searched terms returned plenty of results!" />
              ) : (
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  {data.lowResultSearches.map((term, i) => (
                    <TermRow
                      key={term.query}
                      rank={i + 1}
                      term={term}
                      maxCount={maxLowCount}
                      barColor="#f59e0b"
                      showAvg
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="glass flex-center" style={{ padding: '5rem', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
          <BarChart3 size={48} color="var(--text-dim)" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Could not load analytics</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400 }}>
            Please try refreshing the page or check your server connection.
          </p>
        </div>
      )}
    </div>
  );
};

/* ─── Sub-components ────────────────────────────────────────────────────────── */

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}> = ({ icon, label, value, sub, valueColor = 'var(--text-main)' }) => (
  <div className="card">
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <h3 style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        {label}
      </h3>
    </div>
    <div style={{ fontSize: '2rem', fontWeight: 700, color: valueColor, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>{sub}</div>
  </div>
);

const TermRow: React.FC<{
  rank: number;
  term: SearchTerm;
  maxCount: number;
  barColor: string;
  showAvg?: boolean;
}> = ({ rank, term, maxCount, barColor, showAvg = false }) => {
  const pct = Math.max(4, (term.count / maxCount) * 100);
  return (
    <div
      style={{
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Rank */}
      <span style={{
        width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.72rem', fontWeight: 700, borderRadius: 6,
        background: rank <= 3 ? 'rgba(5,150,105,0.15)' : 'rgba(20,32,26,0.03)',
        color: rank <= 3 ? 'var(--primary)' : 'var(--text-muted)',
        flexShrink: 0,
      }}>
        {rank}
      </span>

      {/* Term + bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {term.query}
        </div>
        <div style={{ background: 'rgba(20,32,26,0.04)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Count */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{term.count.toLocaleString()}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>searches</div>
      </div>

      {/* Avg results (only for low-result panel) */}
      {showAvg && (
        <div style={{
          textAlign: 'center', flexShrink: 0,
          padding: '0.2rem 0.5rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
          background: term.avg_results === 0 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
          color: term.avg_results === 0 ? '#ef4444' : '#f59e0b',
        }}>
          {term.avg_results === 0 ? 'No results' : `~${term.avg_results} hits`}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div style={{
    padding: '3rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)',
  }}>
    <Search size={40} style={{ opacity: 0.15, marginBottom: '1rem' }} />
    <p style={{ maxWidth: 300, fontSize: '0.9rem' }}>{message}</p>
  </div>
);

export default Analytics;
