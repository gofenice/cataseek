import React, { useEffect, useState } from 'react';
import { Download, AlertCircle, Clock } from 'lucide-react';
import api from '../services/api';
import { PLATFORMS, platformMeta, formatFileSize } from '../utils/platforms';

interface PlatformModule {
    id: number;
    platform: string;
    name: string;
    version: string;
    description: string | null;
    original_name: string;
    file_size: number;
    updated_at: string;
}

const Plugins: React.FC = () => {
    const [modules, setModules] = useState<PlatformModule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloadingId, setDownloadingId] = useState<number | null>(null);

    useEffect(() => {
        api.get('/modules')
            .then(res => setModules(res.data.modules || []))
            .catch(() => setError('Could not load plugin downloads'))
            .finally(() => setLoading(false));
    }, []);

    const handleDownload = async (mod: PlatformModule) => {
        try {
            setDownloadingId(mod.id);
            setError('');
            const res = await api.get(`/modules/${mod.id}/download`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = mod.original_name || `${mod.platform}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch {
            setError('Download failed — please try again');
        } finally {
            setDownloadingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex-center" style={{ height: '300px', flexDirection: 'column', gap: '0.75rem', color: 'var(--text-muted)' }}>
                <svg className="spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Loading plugins…</span>
            </div>
        );
    }

    // Known platforms without an uploaded package show as "coming soon"
    const uploadedPlatforms = new Set(modules.map(m => m.platform));
    const comingSoon = Object.keys(PLATFORMS).filter(p => !uploadedPlatforms.has(p));

    return (
        <div>
            <h1 style={{ marginBottom: '0.5rem' }}>Plugins</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
                Download the Cataseek plugin for your e-commerce platform, install it on your store, and connect it with your API key.
            </p>

            {error && (
                <div className="glass" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--error)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <AlertCircle size={20} style={{ color: 'var(--error)' }} />
                    <span style={{ color: 'var(--error)', fontWeight: 500 }}>{error}</span>
                </div>
            )}

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1.25rem',
            }}>
                {modules.map(mod => {
                    const meta = platformMeta(mod.platform);
                    return (
                        <div key={mod.id} className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                <div style={{
                                    width: 46, height: 46, borderRadius: 'var(--radius-md)',
                                    background: `${meta.color}1a`, border: `1px solid ${meta.color}40`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
                                    flexShrink: 0,
                                }}>
                                    {meta.icon}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{meta.label}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {mod.name}
                                    </div>
                                </div>
                            </div>

                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, flex: 1 }}>
                                {mod.description || meta.blurb}
                            </p>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                                <span className="badge" style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}35` }}>
                                    v{mod.version}
                                </span>
                                <span>{formatFileSize(mod.file_size)}</span>
                                <span>·</span>
                                <span>Updated {new Date(mod.updated_at).toLocaleDateString()}</span>
                            </div>

                            <button
                                className="btn-primary"
                                onClick={() => handleDownload(mod)}
                                disabled={downloadingId === mod.id}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem' }}
                            >
                                <Download size={16} />
                                {downloadingId === mod.id ? 'Downloading…' : 'Download'}
                            </button>
                        </div>
                    );
                })}

                {comingSoon.map(platform => {
                    const meta = PLATFORMS[platform];
                    return (
                        <div key={platform} className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', opacity: 0.6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                <div style={{
                                    width: 46, height: 46, borderRadius: 'var(--radius-md)',
                                    background: 'var(--bg-main)', border: '1px solid var(--border)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
                                    flexShrink: 0, filter: 'grayscale(1)',
                                }}>
                                    {meta.icon}
                                </div>
                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{meta.label}</div>
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, flex: 1 }}>{meta.blurb}</p>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '0.65rem', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)',
                                color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 500,
                            }}>
                                <Clock size={15} /> Coming soon
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Plugins;
