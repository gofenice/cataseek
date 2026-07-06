import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminLayout: React.FC = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);

    const handleLogout = () => { logout(); navigate('/login'); };

    const navItems = [
        { to: '/admin', label: 'Overview', icon: '📊', end: true },
        { to: '/admin/tenants', label: 'Tenants', icon: '🏪', end: false },
        { to: '/admin/plans', label: 'Plans', icon: '📋', end: false },
        { to: '/admin/hosting', label: 'Hosting', icon: '🖥️', end: false },
        { to: '/admin/orders', label: 'Orders', icon: '🧾', end: false },
        { to: '/admin/payments', label: 'Payment Settings', icon: '💳', end: false },
    ];

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-main)' }}>
            {/* Sidebar */}
            <aside style={{
                width: collapsed ? 64 : 240,
                background: 'var(--bg-sidebar)',
                borderRight: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column',
                transition: 'width 0.2s ease',
                overflow: 'hidden',
                flexShrink: 0,
            }}>
                {/* Brand */}
                <div style={{ padding: '1.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <img src="/favicon.png" alt="Cataseek" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
                    {!collapsed && (
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>Cataseek Admin</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Control Panel</div>
                        </div>
                    )}
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, padding: '1rem 0.5rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {navItems.map(item => (
                        <NavLink key={item.to} to={item.to} end={item.end} style={({ isActive }) => ({
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.6rem 0.75rem', borderRadius: 8, textDecoration: 'none',
                            fontSize: '0.9rem', fontWeight: 500, transition: 'all 0.15s',
                            background: isActive ? 'rgba(5,150,105,0.10)' : 'transparent',
                            color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                        })}>
                            <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                            {!collapsed && item.label}
                        </NavLink>
                    ))}
                </nav>

                {/* Bottom */}
                <div style={{ padding: '1rem 0.5rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => setCollapsed(c => !c)} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', borderRadius: 8, background: 'transparent',
                        color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer',
                    }}>
                        <span style={{ fontSize: 18 }}>{collapsed ? '→' : '←'}</span>
                        {!collapsed && 'Collapse'}
                    </button>
                    <button onClick={handleLogout} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', borderRadius: 8, background: 'transparent',
                        color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer',
                    }}>
                        <span style={{ fontSize: 18 }}>🚪</span>
                        {!collapsed && 'Logout'}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Top bar */}
                <header style={{
                    height: 60, borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 2rem', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
                    flexShrink: 0,
                }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cataseek — Admin Panel</span>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.3)',
                        padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.8rem', color: 'var(--primary)',
                    }}>
                        ⚡ Admin Mode
                    </div>
                </header>
                <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
