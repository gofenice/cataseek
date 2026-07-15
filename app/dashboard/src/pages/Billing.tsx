import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, CreditCard, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, FileText, PartyPopper, Receipt } from 'lucide-react';
import api from '../services/api';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Plan {
    id: number;
    name: string;
    description: string;
    price: number;
    billing_period: string;
    max_products: number;
    max_requests_per_month: number;
    features: string | string[];
}

interface Subscription {
    plan_name: string;
    price: number;
    billing_period: string;
    status: string;
    current_period_end: string;
    max_requests_per_month: number;
}

interface Usage {
    used: number;
    limit: number;
    planName: string;
    percentage: number;
    maxProducts: number;
}

interface Invoice {
    id: number;
    invoice_number: string;
    plan_name: string;
    billing_reason: string;
    amount: number;
    currency: string;
    status: 'paid' | 'pending' | 'failed';
    period_start: string | null;
    period_end: string | null;
    paid_at: string | null;
    created_at: string;
}

interface PaymentConfig {
    gateway: 'razorpay' | 'demo';
    key_id: string | null;
    currency: string;
    mode: 'test' | 'live';
}

interface Order {
    id: number;
    plan_name: string | null;
    razorpay_payment_id: string | null;
    amount: number;
    currency: string;
    status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
    method: string | null;
    created_at: string;
}

interface Confirmation {
    planName: string;
    price: number;
    billingPeriod: string;
    invoiceNumber: string;
    periodEnd: string;
    creditApplied?: number;
    firstCharge?: number;
}

declare global {
    interface Window { Razorpay: any; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseFeatures = (f: string | string[]): string[] => {
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
};

const CURRENCY_SYMBOLS: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SGD: 'S$',
};

// Load Razorpay Checkout script once
let razorpayScriptPromise: Promise<void> | null = null;
const loadRazorpayScript = (): Promise<void> => {
    if (window.Razorpay) return Promise.resolve();
    if (!razorpayScriptPromise) {
        razorpayScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = () => resolve();
            script.onerror = () => { razorpayScriptPromise = null; reject(new Error('Failed to load Razorpay')); };
            document.body.appendChild(script);
        });
    }
    return razorpayScriptPromise;
};

const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const UsageBar: React.FC<{ pct: number }> = ({ pct }) => {
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    return (
        <div style={{ background: 'rgba(20,32,26,0.04)', borderRadius: 99, height: 8, overflow: 'hidden', marginTop: 8 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
        </div>
    );
};

const StatusBadge: React.FC<{ status: Invoice['status'] }> = ({ status }) => {
    const map: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
        paid:    { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  icon: <CheckCircle size={12} />, label: 'Paid' },
        pending: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: <Clock size={12} />,        label: 'Pending' },
        failed:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: <XCircle size={12} />,     label: 'Failed' },
    };
    const s = map[status] || map.pending;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: s.bg, color: s.color,
            fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: 99,
        }}>
            {s.icon} {s.label}
        </span>
    );
};

// ─── Component ────────────────────────────────────────────────────────────────
const Billing: React.FC = () => {
    const navigate = useNavigate();
    const [plans,        setPlans]        = useState<Plan[]>([]);
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [usage,        setUsage]        = useState<Usage | null>(null);
    const [invoices,     setInvoices]     = useState<Invoice[]>([]);
    const [orders,       setOrders]       = useState<Order[]>([]);
    const [payConfig,    setPayConfig]    = useState<PaymentConfig | null>(null);
    const [loading,      setLoading]      = useState(true);
    const [subscribing,  setSubscribing]  = useState<number | null>(null);
    const [cancelling,   setCancelling]   = useState(false);
    const [downloading,  setDownloading]  = useState<number | null>(null);
    const [message,      setMessage]      = useState('');
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [searchEnabled, setSearchEnabled] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [plansRes, subRes, usageRes, invRes, cfgRes, ordRes, profRes] = await Promise.all([
                api.get('/plans/plans'),
                api.get('/plans/subscription'),
                api.get('/plans/usage'),
                api.get('/billing/invoices'),
                api.get('/billing/payment-config'),
                api.get('/billing/orders'),
                api.get('/tenants/profile'),
            ]);
            setPlans(plansRes.data.plans || []);
            setSubscription(subRes.data.subscription);
            setUsage(usageRes.data);
            setInvoices(invRes.data.invoices || []);
            setPayConfig(cfgRes.data);
            setOrders(ordRes.data.orders || []);
            const se = profRes.data.tenant?.search_enabled;
            setSearchEnabled(se === undefined || se === null ? true : !!se);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const currencySymbol = CURRENCY_SYMBOLS[payConfig?.currency || 'USD'] || '$';

    // ── Razorpay checkout flow ──
    const handleRazorpayCheckout = async (planId: number) => {
        // 1. Create the Razorpay subscription server-side
        const res = await api.post('/billing/razorpay/subscribe', { planId });
        const { subscriptionId, keyId, plan, prefill } = res.data;

        // 2. Open Razorpay Checkout
        await loadRazorpayScript();
        await new Promise<void>((resolve, reject) => {
            const rzp = new window.Razorpay({
                key: keyId,
                subscription_id: subscriptionId,
                name: 'Cataseek',
                description: `${plan.name} Plan — ${plan.billing_period}`,
                prefill: { email: prefill?.email || '', name: prefill?.name || '' },
                theme: { color: '#059669' },
                handler: async (response: any) => {
                    // 3. Verify the payment signature server-side
                    try {
                        const verifyRes = await api.post('/billing/razorpay/verify', {
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_subscription_id: response.razorpay_subscription_id,
                            razorpay_signature: response.razorpay_signature,
                            planId,
                        });
                        setConfirmation({
                            planName: verifyRes.data.plan.name,
                            price: verifyRes.data.plan.price,
                            billingPeriod: verifyRes.data.plan.billing_period,
                            invoiceNumber: verifyRes.data.invoiceNumber,
                            periodEnd: verifyRes.data.periodEnd,
                            creditApplied: verifyRes.data.creditApplied,
                            firstCharge: verifyRes.data.firstCharge,
                        });
                        resolve();
                    } catch (err: any) {
                        reject(new Error(err.response?.data?.error || 'Payment verification failed'));
                    }
                },
                modal: {
                    ondismiss: () => reject(new Error('Checkout cancelled')),
                },
            });
            rzp.on('payment.failed', (resp: any) => {
                reject(new Error(resp?.error?.description || 'Payment failed'));
            });
            rzp.open();
        });
    };

    const handleSelect = async (planId: number) => {
        setSubscribing(planId);
        setMessage('');
        try {
            if (payConfig?.gateway === 'razorpay') {
                await handleRazorpayCheckout(planId);
            } else {
                const res = await api.post('/billing/subscribe', { planId });
                setConfirmation({
                    planName: res.data.plan.name,
                    price: res.data.plan.price,
                    billingPeriod: res.data.plan.billing_period,
                    invoiceNumber: res.data.invoiceNumber,
                    periodEnd: res.data.periodEnd,
                    creditApplied: res.data.creditApplied,
                    firstCharge: res.data.firstCharge,
                });
            }
            await fetchData();
        } catch (e: any) {
            const msg = e.response?.data?.error || e.message || 'Failed to subscribe';
            if (msg !== 'Checkout cancelled') setMessage(`❌ ${msg}`);
        }
        setSubscribing(null);
    };

    const handleCancel = async () => {
        if (!window.confirm('Cancel your subscription? You keep access until the end of the current billing period.')) return;
        setCancelling(true);
        setMessage('');
        try {
            const res = await api.post('/billing/cancel');
            setMessage(`✅ ${res.data.message}`);
            await fetchData();
        } catch (e: any) {
            setMessage(`❌ ${e.response?.data?.error || 'Failed to cancel subscription'}`);
        }
        setCancelling(false);
    };

    const handleDownload = async (inv: Invoice) => {
        setDownloading(inv.id);
        try {
            const res = await api.get(`/billing/invoices/${inv.id}/download`, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a   = document.createElement('a');
            a.href     = url;
            a.download = `${inv.invoice_number}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            alert('Failed to download invoice.');
        }
        setDownloading(null);
    };

    if (loading) return (
        <div className="skeleton-page">
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="skeleton" style={{ height: 28, width: 160 }} />
                <div className="skeleton" style={{ height: 14, width: 300, maxWidth: '80%' }} />
            </div>
            {/* Stat cards row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="skeleton" style={{ height: 12, width: 80 }} />
                        <div className="skeleton" style={{ height: 28, width: 100 }} />
                        <div className="skeleton" style={{ height: 6, borderRadius: 99 }} />
                    </div>
                ))}
            </div>
            {/* Plan cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="skeleton" style={{ height: 16, width: 90 }} />
                        <div className="skeleton" style={{ height: 32, width: 120 }} />
                        {[1, 2, 3].map(j => <div key={j} className="skeleton" style={{ height: 11, width: '80%' }} />)}
                        <div className="skeleton" style={{ height: 38, borderRadius: 999 }} />
                    </div>
                ))}
            </div>
            {/* Invoice table */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="skeleton" style={{ height: 16, width: 80 }} />
                {[1, 2, 3].map(i => (
                    <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', paddingTop: 8 }}>
                        <div className="skeleton" style={{ height: 12, flex: 2 }} />
                        <div className="skeleton" style={{ height: 12, flex: 1 }} />
                        <div className="skeleton" style={{ height: 12, flex: 1 }} />
                        <div className="skeleton" style={{ height: 24, width: 60, borderRadius: 99 }} />
                    </div>
                ))}
            </div>
        </div>
    );

    const currentPlanId = plans.find(p => p.name === subscription?.plan_name || p.name === usage?.planName)?.id;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Payment confirmation modal */}
            {confirmation && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass" style={{ padding: '2.5rem', width: 440, maxWidth: '90vw', borderRadius: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.25rem', border: '1px solid rgba(16,185,129,0.35)' }}>
                        <div style={{
                            width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
                            background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.4)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <PartyPopper size={34} color="#10b981" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 6px' }}>Payment Successful!</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
                                Your subscription is now active. A copy of the invoice has been emailed to you.
                            </p>
                        </div>
                        <div style={{ background: 'rgba(20,32,26,0.06)', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                            {[
                                ['Plan', `${confirmation.planName}`],
                                ['Amount', `${currencySymbol}${confirmation.price} / ${confirmation.billingPeriod}`],
                                ...(confirmation.creditApplied && confirmation.creditApplied > 0 ? [
                                    ['Unused plan credit', `−${currencySymbol}${Number(confirmation.creditApplied).toFixed(2)}`],
                                    ['First payment', `${currencySymbol}${Number(confirmation.firstCharge).toFixed(2)}`],
                                ] : []),
                                ['Invoice', confirmation.invoiceNumber],
                                ['Next billing date', fmt(confirmation.periodEnd)],
                            ].map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                                    <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{v}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => setConfirmation(null)}
                                style={{ flex: 1, padding: '0.7rem', borderRadius: 8, background: 'rgba(20,32,26,0.04)', border: '1px solid var(--border)', color: 'var(--text-main)', fontWeight: 600, cursor: 'pointer' }}
                            >
                                View Billing
                            </button>
                            <button
                                onClick={() => { setConfirmation(null); navigate('/'); }}
                                style={{ flex: 1, padding: '0.7rem', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Go to Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Billing & Plans</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Manage your subscription, monitor usage, and download invoices</p>
            </div>

            {/* Flash message */}
            {message && (
                <div style={{
                    color: message.startsWith('✅') ? '#10b981' : '#ef4444',
                    background: message.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${message.startsWith('✅') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.9rem',
                }}>
                    {message}
                </div>
            )}

            {/* Current plan + Usage row (search product only) */}
            {searchEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Current plan */}
                <div className="glass" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <CreditCard size={16} color="var(--primary)" />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Plan</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)' }}>{usage?.planName || 'Trial'}</div>
                    {subscription ? (
                        <>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                {currencySymbol}{subscription.price} / {subscription.billing_period}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle size={12} /> Active · renews {fmt(subscription.current_period_end)}
                            </div>
                            <button
                                onClick={handleCancel}
                                disabled={cancelling}
                                style={{
                                    marginTop: 12, padding: '0.4rem 0.9rem', borderRadius: 6,
                                    background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                                    border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.78rem',
                                    fontWeight: 600, cursor: 'pointer', opacity: cancelling ? 0.6 : 1,
                                    alignSelf: 'flex-start',
                                }}
                            >
                                {cancelling ? 'Cancelling…' : 'Cancel Subscription'}
                            </button>
                        </>
                    ) : (
                        <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertCircle size={12} /> Trial mode — select a plan below to upgrade
                        </div>
                    )}
                </div>

                {/* Usage */}
                <div className="glass" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <TrendingUp size={16} color="var(--primary)" />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Searches This Month</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {(usage?.used || 0).toLocaleString()}
                        <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 400 }}> / {(usage?.limit || 0).toLocaleString()}</span>
                    </div>
                    <UsageBar pct={usage?.percentage || 0} />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>{usage?.percentage || 0}% of monthly limit used</div>
                </div>
            </div>
            )}

            {/* Plan cards (search product only) */}
            {searchEnabled && (
            <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem' }}>Available Plans</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                    {plans.map((plan, i) => {
                        const isCurrent = plan.id === currentPlanId;
                        const isPopular = i === 1;
                        const features  = parseFeatures(plan.features);
                        return (
                            <div key={plan.id} className="glass" style={{
                                padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                                border: isCurrent ? '2px solid var(--primary)' : isPopular ? '1px solid rgba(5,150,105,0.4)' : '1px solid var(--border)',
                                position: 'relative', borderRadius: 12,
                            }}>
                                {isPopular && !isCurrent && (
                                    <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: 'var(--primary)', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.75rem', borderRadius: 99 }}>POPULAR</div>
                                )}
                                {isCurrent && (
                                    <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#10b981', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.75rem', borderRadius: 99 }}>CURRENT PLAN</div>
                                )}
                                <div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>{plan.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{plan.description}</div>
                                </div>
                                <div>
                                    <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-main)' }}>{currencySymbol}{plan.price}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>/{plan.billing_period}</span>
                                </div>
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                                    <li style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>✓ {plan.max_requests_per_month.toLocaleString()} searches/month</li>
                                    <li style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>✓ {plan.max_products.toLocaleString()} products</li>
                                    {features.map((f, fi) => (
                                        <li key={fi} style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>✓ {f}</li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => handleSelect(plan.id)}
                                    disabled={isCurrent || subscribing !== null}
                                    style={{
                                        padding: '0.7rem', borderRadius: 8, fontWeight: 600, fontSize: '0.9rem',
                                        cursor: isCurrent ? 'default' : 'pointer',
                                        background: isCurrent ? 'rgba(16,185,129,0.15)' : 'var(--primary)',
                                        color: isCurrent ? '#10b981' : '#fff',
                                        opacity: subscribing !== null && subscribing !== plan.id ? 0.5 : 1,
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {isCurrent ? 'Current Plan' : subscribing === plan.id ? 'Processing…' : payConfig?.gateway === 'razorpay' ? 'Subscribe Now' : 'Select Plan'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            )}

            {/* Invoice History */}
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                    <FileText size={18} color="var(--primary)" />
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Billing History</h2>
                </div>

                {invoices.length === 0 ? (
                    <div className="glass" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        No invoices yet. Invoices will appear here once you subscribe to a plan.
                    </div>
                ) : (
                    <div className="glass" style={{ overflow: 'hidden', borderRadius: 12 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Invoice #', 'Plan', 'Period', 'Amount', 'Status', 'Date', ''].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv, i) => (
                                    <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.15s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(20,32,26,0.02)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--primary)', fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8rem' }}>{inv.invoice_number}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 500 }}>{inv.plan_name}</td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                            {inv.period_start && inv.period_end ? `${fmt(inv.period_start)} – ${fmt(inv.period_end)}` : '—'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>${Number(inv.amount).toFixed(2)} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>{inv.currency}</span></td>
                                        <td style={{ padding: '0.85rem 1rem' }}><StatusBadge status={inv.status} /></td>
                                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmt(inv.created_at)}</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <button
                                                onClick={() => handleDownload(inv)}
                                                disabled={downloading === inv.id}
                                                title="Download PDF"
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                                    padding: '5px 12px', borderRadius: 6,
                                                    background: 'rgba(5,150,105,0.12)', color: 'var(--primary)',
                                                    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                                                    border: '1px solid rgba(5,150,105,0.3)',
                                                    transition: 'all 0.15s',
                                                    opacity: downloading === inv.id ? 0.5 : 1,
                                                }}
                                            >
                                                <Download size={12} />
                                                {downloading === inv.id ? 'Generating…' : 'PDF'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Payment history (gateway transactions) */}
            {orders.length > 0 && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                        <Receipt size={18} color="var(--primary)" />
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Payment History</h2>
                    </div>
                    <div className="glass" style={{ overflow: 'hidden', borderRadius: 12 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Date', 'Plan', 'Amount', 'Method', 'Payment ID', 'Status'].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map((o, i) => {
                                    const sMap: Record<string, { color: string; label: string }> = {
                                        captured: { color: '#10b981', label: 'Paid' },
                                        created: { color: '#059669', label: 'Initiated' },
                                        authorized: { color: '#f59e0b', label: 'Authorized' },
                                        failed: { color: '#ef4444', label: 'Failed' },
                                        refunded: { color: '#6b7280', label: 'Refunded' },
                                    };
                                    const s = sMap[o.status] || sMap.created;
                                    return (
                                        <tr key={o.id} style={{ borderBottom: i < orders.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                            <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmt(o.created_at)}</td>
                                            <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 500 }}>{o.plan_name || '—'}</td>
                                            <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>
                                                {Number(o.amount).toFixed(2)} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>{o.currency}</span>
                                            </td>
                                            <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'capitalize' }}>{o.method || '—'}</td>
                                            <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{o.razorpay_payment_id || '—'}</td>
                                            <td style={{ padding: '0.85rem 1rem' }}>
                                                <span style={{ color: s.color, fontWeight: 600, fontSize: '0.8rem' }}>{s.label}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Payment notice */}
            {payConfig?.gateway === 'razorpay' ? (
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '1rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    🔒 <strong style={{ color: 'var(--text-main)' }}>Secure payments by Razorpay.</strong> Subscriptions renew automatically each {plans[0]?.billing_period === 'yearly' ? 'year' : 'month'} and invoices are emailed to you. Cancel anytime — access continues until the end of the paid period.
                    {payConfig.mode === 'test' && <span style={{ color: '#f59e0b' }}> (Test mode — no real charges)</span>}
                </div>
            ) : (
                <div style={{ background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 10, padding: '1rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    💳 <strong style={{ color: 'var(--text-main)' }}>Payment gateway coming soon.</strong> Plans are currently activated in demo mode. When your payment gateway is configured, subscriptions will be charged automatically and invoices will be issued and emailed to you.
                </div>
            )}
        </div>
    );
};

export default Billing;
