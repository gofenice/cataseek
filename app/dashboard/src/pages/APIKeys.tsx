import React, { useState, useEffect } from 'react';
import { Key, Copy, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../services/api';

const APIKeys: React.FC = () => {
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [newApiPassword, setNewApiPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const response = await api.get('/tenants/profile');
            setApiKey(response.data.tenant.api_key || 'No key generated yet');
        } catch (err: any) {
            console.error('Failed to fetch profile:', err);
            setError('Could not load API keys');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        if (!apiKey) return;
        navigator.clipboard.writeText(apiKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleGenerateKey = async () => {
        if (!newApiPassword || newApiPassword.length < 8) {
            setError('API Password must be at least 8 characters');
            return;
        }

        try {
            setIsUpdating(true);
            setError('');
            const response = await api.post('/tenants/generate-api-key', { apiPassword: newApiPassword });
            setApiKey(response.data.apiKey);
            setSuccessMsg('API Key and Password updated successfully!');
            setNewApiPassword('');
            setShowPasswordForm(false);
            setTimeout(() => setSuccessMsg(''), 5000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to generate key');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleRegenerate = async () => {
        if (!window.confirm('Warning: Regenerating your API key will break your current integrations (like PrestaShop/WooCommerce). Continue?')) return;

        try {
            setIsUpdating(true);
            const response = await api.post('/tenants/regenerate-api-key');
            setApiKey(response.data.apiKey);
            setSuccessMsg('API Key regenerated successfully!');
            setTimeout(() => setSuccessMsg(''), 5000);
        } catch (err: any) {
            setError('Failed to regenerate key');
        } finally {
            setIsUpdating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex-center" style={{ height: '300px', flexDirection: 'column', gap: '0.75rem', color: 'var(--text-muted)' }}>
                <svg className="spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Loading API keys…</span>
            </div>
        );
    }

    return (
        <div>
            <h1 style={{ marginBottom: '0.5rem' }}>API Management</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Manage your keys to connect Cataseek to your store</p>

            {successMsg && (
                <div className="glass" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--success)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                    <span style={{ color: 'var(--success)', fontWeight: 500 }}>{successMsg}</span>
                </div>
            )}

            {error && (
                <div className="glass" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--error)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <AlertCircle size={20} style={{ color: 'var(--error)' }} />
                    <span style={{ color: 'var(--error)', fontWeight: 500 }}>{error}</span>
                </div>
            )}

            <div className="card" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="flex-center" style={{ width: '48px', height: '48px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '12px', color: 'var(--primary)' }}>
                        <Key size={24} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '1.1rem' }}>Production API Key</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Use this key in your PrestaShop or WooCommerce plugin.</p>
                    </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <code style={{ fontSize: '0.9rem', color: 'var(--accent)', wordBreak: 'break-all', maxWidth: '80%' }}>
                        {apiKey}
                    </code>
                    <button
                        onClick={handleCopy}
                        style={{ color: copied ? 'var(--success)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                        <Copy size={16} /> {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>

                {!showPasswordForm ? (
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            onClick={() => setShowPasswordForm(true)}
                            className="btn-primary"
                            style={{ padding: '0.6rem 1.2rem', fontSize: '0.9rem' }}
                        >
                            Set API Password
                        </button>
                        <button
                            onClick={handleRegenerate}
                            disabled={isUpdating}
                            style={{ border: '1px solid var(--border)', color: 'var(--text-main)', background: 'none', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                        >
                            <RefreshCw size={16} className={isUpdating ? 'spin' : ''} /> Regenerate Key
                        </button>
                    </div>
                ) : (
                    <div className="glass" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                        <h4 style={{ marginBottom: '1rem' }}>Set API Password</h4>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                            Choose a strong password for your API integrations. This is separate from your login password.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <input
                                type="password"
                                value={newApiPassword}
                                onChange={(e) => setNewApiPassword(e.target.value)}
                                placeholder="Enter at least 8 characters"
                                style={{ flex: 1, padding: '0.6rem', background: 'rgba(20,32,26,0.03)', border: '1px solid var(--border)', borderRadius: '4px', color: 'black' }}
                            />
                            <button
                                onClick={handleGenerateKey}
                                disabled={isUpdating}
                                className="btn-primary"
                                style={{ padding: '0.6rem 1.2rem' }}
                            >
                                {isUpdating ? 'Saving...' : 'Save & Update'}
                            </button>
                            <button
                                onClick={() => { setShowPasswordForm(false); setError(''); }}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="glass" style={{ padding: '1.5rem', borderLeft: '4px solid var(--warning)' }}>
                <h4 style={{ color: 'var(--warning)', marginBottom: '0.5rem' }}>Security Warning</h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Never share your API keys or passwords in public places. Cataseek will never ask for your password via email.</p>
            </div>
        </div>
    );
};

export default APIKeys;
