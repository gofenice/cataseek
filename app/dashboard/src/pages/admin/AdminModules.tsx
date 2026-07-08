import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { PLATFORMS, platformMeta, formatFileSize } from '../../utils/platforms';

interface AdminModule {
    id: number;
    platform: string;
    name: string;
    version: string;
    description: string | null;
    original_name: string;
    file_size: number;
    download_count: number;
    is_active: number;
    updated_at: string;
}

const emptyForm = { platform: 'prestashop', name: '', version: '1.0.0', description: '' };

const AdminModules: React.FC = () => {
    const [modules, setModules] = useState<AdminModule[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(emptyForm);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchModules = async () => {
        try {
            const res = await api.get('/admin/modules');
            setModules(res.data.modules || []);
        } catch {
            setError('Failed to load modules');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchModules(); }, []);

    const flash = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(''), 4000);
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!file) { setError('Choose the module .zip file first'); return; }
        if (!form.name.trim()) { setError('Module name is required'); return; }

        // Text fields MUST be appended before the file so the backend can read
        // the platform while naming the stored file.
        const data = new FormData();
        data.append('platform', form.platform);
        data.append('name', form.name.trim());
        data.append('version', form.version.trim() || '1.0.0');
        data.append('description', form.description.trim());
        data.append('file', file);

        try {
            setUploading(true);
            const res = await api.post('/admin/modules', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            flash(res.data.message || 'Module uploaded');
            setForm(emptyForm);
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            fetchModules();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleToggle = async (mod: AdminModule) => {
        try {
            await api.patch(`/admin/modules/${mod.id}`, { is_active: !mod.is_active });
            fetchModules();
        } catch {
            setError('Failed to update module');
        }
    };

    const handleDelete = async (mod: AdminModule) => {
        if (!window.confirm(`Delete the ${platformMeta(mod.platform).label} module? Merchants will no longer be able to download it.`)) return;
        try {
            await api.delete(`/admin/modules/${mod.id}`);
            flash('Module deleted');
            fetchModules();
        } catch {
            setError('Failed to delete module');
        }
    };

    const existingPlatform = modules.find(m => m.platform === form.platform);

    if (loading) return <div className="flex-center" style={{ height: 200 }}>Loading modules…</div>;

    return (
        <div>
            <h1 style={{ marginBottom: '0.5rem' }}>Platform Modules</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
                Upload the plugin zip for each e-commerce platform. Merchants download these from the Plugins page in their dashboard.
            </p>

            {successMsg && (
                <div className="glass" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--success)', color: 'var(--success)', fontWeight: 500 }}>
                    {successMsg}
                </div>
            )}
            {error && (
                <div className="glass" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--error)', color: 'var(--error)', fontWeight: 500 }}>
                    {error}
                </div>
            )}

            {/* Upload form */}
            <form onSubmit={handleUpload} className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.05rem' }}>Upload module</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: 4 }}>Platform</label>
                        <select
                            className="input"
                            value={form.platform}
                            onChange={e => setForm({ ...form, platform: e.target.value })}
                            style={{ width: '100%' }}
                        >
                            {Object.entries(PLATFORMS).map(([key, meta]) => (
                                <option key={key} value={key}>{meta.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: 4 }}>Module name</label>
                        <input
                            className="input"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder="Cataseek Search for PrestaShop"
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: 4 }}>Version</label>
                        <input
                            className="input"
                            value={form.version}
                            onChange={e => setForm({ ...form, version: e.target.value })}
                            placeholder="1.0.0"
                            style={{ width: '100%' }}
                        />
                    </div>
                </div>
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'block', marginBottom: 4 }}>Description (optional)</label>
                    <input
                        className="input"
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        placeholder="Shown to merchants on the download card"
                        style={{ width: '100%' }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip"
                        onChange={e => setFile(e.target.files?.[0] || null)}
                        style={{ fontSize: '0.85rem' }}
                    />
                    <button type="submit" className="btn-primary" disabled={uploading} style={{ padding: '0.6rem 1.5rem' }}>
                        {uploading ? 'Uploading…' : existingPlatform ? 'Replace module' : 'Upload module'}
                    </button>
                </div>
                {existingPlatform && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '0.75rem 0 0' }}>
                        ⚠️ {platformMeta(form.platform).label} already has <strong>v{existingPlatform.version}</strong> — uploading will replace it.
                    </p>
                )}
            </form>

            {/* Existing modules */}
            {modules.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No modules uploaded yet.
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
                    {modules.map(mod => {
                        const meta = platformMeta(mod.platform);
                        return (
                            <div key={mod.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', opacity: mod.is_active ? 1 : 0.6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                                        background: `${meta.color}1a`, border: `1px solid ${meta.color}40`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
                                    }}>
                                        {meta.icon}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontWeight: 600 }}>{meta.label}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {mod.name}
                                        </div>
                                    </div>
                                    <span className={mod.is_active ? 'badge-success' : 'badge-warning'} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 12, flexShrink: 0 }}>
                                        {mod.is_active ? 'Live' : 'Hidden'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <span>v{mod.version}</span>
                                    <span>·</span>
                                    <span>{formatFileSize(mod.file_size)}</span>
                                    <span>·</span>
                                    <span>{mod.download_count} downloads</span>
                                    <span>·</span>
                                    <span>{new Date(mod.updated_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>{mod.original_name}</div>
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                                    <button className="btn-outline" onClick={() => handleToggle(mod)} style={{ flex: 1, padding: '0.45rem', fontSize: '0.82rem' }}>
                                        {mod.is_active ? 'Hide' : 'Show'}
                                    </button>
                                    <button
                                        className="btn-outline"
                                        onClick={() => handleDelete(mod)}
                                        style={{ flex: 1, padding: '0.45rem', fontSize: '0.82rem', color: 'var(--error)', borderColor: 'rgba(239,68,68,0.35)' }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AdminModules;
