import React, { useEffect, useState, useCallback } from 'react';
import { Server, HardDrive, MemoryStick, Wifi, CheckCircle, PartyPopper, AlertCircle } from 'lucide-react';
import api from '../services/api';

interface HostingPlan {
    id: number;
    name: string;
    price: number;
    storage_gb: number;
    ram_gb: number;
    bandwidth: string;
    billing_period: 'monthly' | 'yearly';
}

interface HostingSubscription {
    plan_name: string;
    price: number;
    storage_gb: number;
    ram_gb: number;
    bandwidth: string;
    billing_period: string;
    status: string;
    current_period_end: string;
}

interface PaymentConfig {
    gateway: 'razorpay' | 'demo';
    key_id: string | null;
    currency: string;
    mode: 'test' | 'live';
}

interface Confirmation {
    planName: string;
    price: number;
    billingPeriod: string;
    invoiceNumber: string;
    periodEnd: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SGD: 'S$',
};

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

const Hosting: React.FC = () => {
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [plans, setPlans] = useState<HostingPlan[]>([]);
    const [subscription, setSubscription] = useState<HostingSubscription | null>(null);
    const [payConfig, setPayConfig] = useState<PaymentConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [subscribing, setSubscribing] = useState<number | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [message, setMessage] = useState('');
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [hostRes, cfgRes] = await Promise.all([
                api.get('/hosting/plans'),
                api.get('/billing/payment-config'),
            ]);
            setEnabled(hostRes.data.enabled);
            setPlans(hostRes.data.plans || []);
            setSubscription(hostRes.data.subscription);
            setPayConfig(cfgRes.data);
        } catch (e) { console.error(e); setEnabled(false); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const currencySymbol = CURRENCY_SYMBOLS[payConfig?.currency || 'USD'] || '$';

    const handleRazorpayCheckout = async (planId: number) => {
        const res = await api.post('/hosting/razorpay/subscribe', { planId });
        const { subscriptionId, keyId, plan, prefill } = res.data;

        await loadRazorpayScript();
        await new Promise<void>((resolve, reject) => {
            const rzp = new window.Razorpay({
                key: keyId,
                subscription_id: subscriptionId,
                name: 'Cataseek Hosting',
                description: `Hosting — ${plan.name} (${plan.billing_period})`,
                prefill: { email: prefill?.email || '', name: prefill?.name || '' },
                theme: { color: '#059669' },
                handler: async (response: any) => {
                    try {
                        const verifyRes = await api.post('/hosting/razorpay/verify', {
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
                        });
                        resolve();
                    } catch (err: any) {
                        reject(new Error(err.response?.data?.error || 'Payment verification failed'));
                    }
                },
                modal: { ondismiss: () => reject(new Error('Checkout cancelled')) },
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
                const res = await api.post('/hosting/subscribe', { planId });
                setConfirmation({
                    planName: res.data.plan.name,
                    price: res.data.plan.price,
                    billingPeriod: res.data.plan.billing_period,
                    invoiceNumber: res.data.invoiceNumber,
                    periodEnd: res.data.periodEnd,
                });
            }
            await fetchData();
        } catch (e: any) {
            const msg = e.response?.data?.error || e.message || 'Failed to purchase';
            if (msg !== 'Checkout cancelled') setMessage(`❌ ${msg}`);
        }
        setSubscribing(null);
    };

    const handleCancel = async () => {
        if (!window.confirm('Cancel your hosting subscription? Service continues until the end of the billing period.')) return;
        setCancelling(true);
        setMessage('');
        try {
            const res = await api.post('/hosting/cancel');
            setMessage(`✅ ${res.data.message}`);
            await fetchData();
        } catch (e: any) {
            setMessage(`❌ ${e.response?.data?.error || 'Failed to cancel'}`);
        }
        setCancelling(false);
    };

    if (loading) return (
        <div className="skeleton-page">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="skeleton" style={{ height: 28, width: 160 }} />
                <div className="skeleton" style={{ height: 14, width: 280, maxWidth: '80%' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="skeleton" style={{ height: 16, width: 90 }} />
                        <div className="skeleton" style={{ height: 32, width: 110 }} />
                        {[1, 2, 3].map(j => <div key={j} className="skeleton" style={{ height: 11, width: '75%' }} />)}
                        <div className="skeleton" style={{ height: 38, borderRadius: 999 }} />
                    </div>
                ))}
            </div>
        </div>
    );

    // Not enabled for this store
    if (!enabled) {
        return (
            <div style={{ maxWidth: 560, margin: '4rem auto', textAlign: 'center' }}>
                <div style={{
                    width: 72, height: 72, borderRadius: '50%', margin: '0 auto 1.25rem',
                    background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Server size={32} color="var(--text-dim)" />
                </div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>Hosting not available</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
                    Managed hosting is an on-demand service that isn't enabled for your store yet.
                    Contact support if you'd like access.
                </p>
            </div>
        );
    }

    const currentPlanName = subscription?.plan_name;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Confirmation modal */}
            {confirmation && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass" style={{ padding: '2.5rem', width: 440, maxWidth: '90vw', borderRadius: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.25rem', border: '1px solid rgba(16,185,129,0.35)', background: '#fff' }}>
                        <div style={{
                            width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
                            background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.4)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <PartyPopper size={34} color="#10b981" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 6px' }}>Hosting Activated!</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
                                Your hosting plan is live. The invoice has been emailed to you.
                            </p>
                        </div>
                        <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                            {[
                                ['Plan', `Hosting — ${confirmation.planName}`],
                                ['Amount', `${currencySymbol}${confirmation.price} / ${confirmation.billingPeriod}`],
                                ['Invoice', confirmation.invoiceNumber],
                                ['Next billing date', fmt(confirmation.periodEnd)],
                            ].map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                                    <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{v}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => setConfirmation(null)}
                            style={{ padding: '0.7rem', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Server size={26} color="var(--primary)" /> Hosting
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Managed hosting for your store — pick a plan and go live</p>
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

            {/* Current hosting subscription */}
            {subscription && (
                <div className="glass" style={{ padding: '1.5rem', border: '1px solid rgba(16,185,129,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Current Hosting Plan</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>{subscription.plan_name}</div>
                            <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle size={12} /> Active · renews {fmt(subscription.current_period_end)}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            {[
                                { icon: <HardDrive size={15} />, label: 'Size', value: `${subscription.storage_gb} GB` },
                                { icon: <MemoryStick size={15} />, label: 'RAM', value: `${Number(subscription.ram_gb)} GB` },
                                { icon: <Wifi size={15} />, label: 'Data', value: subscription.bandwidth },
                            ].map(s => (
                                <div key={s.label} style={{ textAlign: 'center' }}>
                                    <div style={{ color: 'var(--primary)', marginBottom: 4, display: 'flex', justifyContent: 'center' }}>{s.icon}</div>
                                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{s.value}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.label}</div>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={handleCancel}
                            disabled={cancelling}
                            style={{
                                padding: '0.5rem 1rem', borderRadius: 6,
                                background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                                border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.8rem',
                                fontWeight: 600, cursor: 'pointer', opacity: cancelling ? 0.6 : 1,
                            }}
                        >
                            {cancelling ? 'Cancelling…' : 'Cancel Hosting'}
                        </button>
                    </div>
                </div>
            )}

            {/* Plans */}
            <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem' }}>
                    {subscription ? 'Switch Plan' : 'Available Hosting Plans'}
                </h2>
                {plans.length === 0 ? (
                    <div className="glass" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        No hosting plans available right now. Check back soon.
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                        {plans.map(plan => {
                            const isCurrent = plan.name === currentPlanName;
                            return (
                                <div key={plan.id} className="glass" style={{
                                    padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.1rem',
                                    border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border)',
                                    position: 'relative', borderRadius: 12,
                                }}>
                                    {isCurrent && (
                                        <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#10b981', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.75rem', borderRadius: 99 }}>CURRENT</div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Server size={18} color="var(--primary)" />
                                        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>{plan.name}</span>
                                    </div>
                                    <div>
                                        <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-main)' }}>{currencySymbol}{plan.price}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>/{plan.billing_period === 'yearly' ? 'year' : 'month'}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                                        {[
                                            { icon: <HardDrive size={15} />, label: 'Storage', value: `${plan.storage_gb} GB SSD` },
                                            { icon: <MemoryStick size={15} />, label: 'RAM', value: `${Number(plan.ram_gb)} GB` },
                                            { icon: <Wifi size={15} />, label: 'Data Transfer', value: plan.bandwidth },
                                        ].map(s => (
                                            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--primary)' }}>{s.icon}</span>
                                                <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                                                <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text-main)' }}>{s.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handleSelect(plan.id)}
                                        disabled={isCurrent || subscribing !== null}
                                        style={{
                                            padding: '0.7rem', borderRadius: 8, fontWeight: 600, fontSize: '0.9rem',
                                            cursor: isCurrent ? 'default' : 'pointer',
                                            background: isCurrent ? 'rgba(16,185,129,0.12)' : 'var(--primary)',
                                            color: isCurrent ? '#10b981' : '#fff',
                                            opacity: subscribing !== null && subscribing !== plan.id ? 0.5 : 1,
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        {isCurrent ? 'Current Plan' : subscribing === plan.id ? 'Processing…' : payConfig?.gateway === 'razorpay' ? 'Buy Now' : 'Activate'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Notice */}
            <div style={{ background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 10, padding: '1rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} color="var(--primary)" />
                <span>
                    Hosting renews automatically each billing period and is billed separately from your search plan.
                    Invoices appear under <strong style={{ color: 'var(--text-main)' }}>Billing → Billing History</strong>.
                    {payConfig?.gateway !== 'razorpay' && ' Currently in demo mode — no real charges.'}
                </span>
            </div>
        </div>
    );
};

export default Hosting;
