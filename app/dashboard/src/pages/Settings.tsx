import React, { useEffect, useState } from 'react';
import api from '../services/api';

interface AppSettings {
    theme_color: string;
    icon_color: string;
    modal_size: 'Large' | 'Medium' | 'Small';
    icon_position: 'left' | 'right' | 'header';
}

const DEFAULTS: AppSettings = {
    theme_color: '#059669',
    icon_color: '#059669',
    modal_size: 'Large',
    icon_position: 'header',
};

const Label: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => (
    <div style={{ marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{text}</span>
        {sub && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 8, opacity: 0.7 }}>{sub}</span>}
    </div>
);

const Radio: React.FC<{ options: {label: string, value: string}[]; value: string; onChange: (v: string) => void }> = ({ options, value, onChange }) => (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {options.map(opt => (
            <button key={opt.value} onClick={() => onChange(opt.value)}
                style={{ padding: '0.4rem 1rem', borderRadius: 8, fontSize: '0.85rem', cursor: 'pointer', fontWeight: value === opt.value ? 700 : 400, background: value === opt.value ? 'var(--primary)' : 'rgba(20,32,26,0.04)', color: value === opt.value ? '#fff' : 'var(--text-muted)', border: value === opt.value ? 'none' : '1px solid var(--border)', transition: 'all 0.15s' }}>
                {opt.label}
            </button>
        ))}
    </div>
);

// Mini live preview of the search widget
const Preview: React.FC<{ s: AppSettings }> = ({ s }) => {
    const size = s.modal_size === 'Large' ? 52 : s.modal_size === 'Medium' ? 44 : 36;
    return (
        <div style={{ background: 'rgba(20,32,26,0.02)', border: '1px dashed var(--border)', borderRadius: 12, padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live Preview</div>

            {/* Simulated store header */}
            <div style={{ width: '100%', background: 'rgba(20,32,26,0.06)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: s.icon_position === 'right' ? 'flex-end' : s.icon_position === 'left' ? 'flex-start' : 'center', gap: '1rem' }}>
                <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 99, display: s.icon_position === 'header' ? 'none' : 'block', order: s.icon_position === 'left' ? 1 : 0 }} />
                {/* Search Trigger */}
                <div style={{ width: size, height: size, borderRadius: '50%', background: s.theme_color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, order: s.icon_position === 'left' ? 0 : 1 }}>
                    <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke={s.icon_color !== s.theme_color ? s.icon_color : '#fff'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                </div>
            </div>

            {/* Modal size hint */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {(['Small', 'Medium', 'Large'] as const).map(sz => (
                    <div key={sz} style={{ width: sz === 'Large' ? 48 : sz === 'Medium' ? 36 : 24, height: 6, borderRadius: 99, background: s.modal_size === sz ? s.theme_color : 'rgba(255,255,255,0.08)' }} />
                ))}
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 4 }}>{s.modal_size} modal</span>
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                Position: <strong style={{ color: 'var(--text-main)' }}>{s.icon_position === 'header' ? 'Header' : `Floating ${s.icon_position === 'left' ? 'Left' : 'Right'}`}</strong>
            </div>
        </div>
    );
};

const Settings: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>({ ...DEFAULTS });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        api.get('/tenants/settings')
            .then(r => { setSettings({ ...DEFAULTS, ...r.data.settings }); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    const set = (key: keyof AppSettings) => (val: string) =>
        setSettings(prev => ({ ...prev, [key]: val }));

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            await api.put('/tenants/settings', settings);
            setMsg('✅ Settings saved! Changes will appear on your store within 1 hour.');
        } catch (e: any) {
            setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
        }
        setSaving(false);
    };

    const inputStyle: React.CSSProperties = {
        padding: '0.5rem 0.6rem', borderRadius: 8, border: '1px solid var(--border)',
        background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)', cursor: 'pointer',
        height: 38, width: 80,
    };

    if (loading) {
        return (
            <div className="skeleton-page" style={{ maxWidth: 860 }}>
                {/* Header */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="skeleton" style={{ height: 28, width: 180 }} />
                    <div className="skeleton" style={{ height: 14, width: 320, maxWidth: '80%' }} />
                </div>
                {/* Main form card */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="glass" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div className="skeleton" style={{ height: 16, width: 100 }} />
                        {/* Color pickers row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            {[1, 2].map(i => (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div className="skeleton" style={{ height: 12, width: 80 }} />
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                        <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 8 }} />
                                        <div className="skeleton" style={{ height: 12, width: 60 }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Radio rows */}
                        {[120, 160, 140].map((w, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div className="skeleton" style={{ height: 12, width: 100 }} />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {[1, 2, 3].map(j => <div key={j} className="skeleton" style={{ height: 32, width: w / 3, borderRadius: 8 }} />)}
                                </div>
                            </div>
                        ))}
                        {/* Save button */}
                        <div className="skeleton" style={{ height: 40, width: 120, borderRadius: 999, alignSelf: 'flex-end' }} />
                    </div>
                    {/* Preview panel */}
                    <div className="skeleton" style={{ height: 260, borderRadius: 12 }} />
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 860 }}>
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>Store Settings</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Customise how the Cataseek search widget looks on your store</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>
                {/* Settings form */}
                <div className="glass" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>Appearance</h2>

                    {msg && (
                        <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', background: msg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.startsWith('✅') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, padding: '0.65rem 1rem', borderRadius: 8, fontSize: '0.85rem' }}>
                            {msg}
                        </div>
                    )}

                    {/* Colors */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <div>
                            <Label text="Theme Color" sub="widget background" />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <input type="color" value={settings.theme_color} onChange={e => set('theme_color')(e.target.value)} style={inputStyle} />
                                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{settings.theme_color}</span>
                            </div>
                        </div>
                        <div>
                            <Label text="Icon Color" sub="search icon" />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <input type="color" value={settings.icon_color} onChange={e => set('icon_color')(e.target.value)} style={inputStyle} />
                                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{settings.icon_color}</span>
                            </div>
                        </div>
                    </div>

                    {/* Modal size */}
                    <div>
                        <Label text="Modal Size" />
                        <Radio 
                            options={[
                                {label: 'Small', value: 'Small'}, 
                                {label: 'Medium', value: 'Medium'}, 
                                {label: 'Large', value: 'Large'}
                            ]} 
                            value={settings.modal_size} 
                            onChange={set('modal_size')} 
                        />
                    </div>

                    {/* Icon position */}
                    <div>
                        <Label text="Search Position" />
                        <Radio 
                            options={[
                                {label: 'Floating Left', value: 'left'}, 
                                {label: 'Floating Right', value: 'right'}, 
                                {label: 'Display in Header', value: 'header'}
                            ]} 
                            value={settings.icon_position} 
                            onChange={set('icon_position')} 
                        />
                    </div>

                    <button onClick={handleSave} disabled={saving}
                        style={{ background: 'var(--primary)', color: '#fff', padding: '0.7rem 1.5rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', width: 'fit-content', opacity: saving ? 0.7 : 1, marginTop: '0.25rem' }}>
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>

                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '-0.5rem' }}>
                        ℹ️ Your PrestaShop store refreshes these settings automatically every hour.
                    </p>
                </div>

                {/* Live preview */}
                <Preview s={settings} />
            </div>
        </div>
    );
};

export default Settings;
