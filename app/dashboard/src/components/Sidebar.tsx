import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    Key,
    Package,
    Search,
    CreditCard,
    Settings,
    LogOut,
    BarChart3,
    Server,
    Download,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const Logo = () => (
    <img src="/logo.png" alt="Cataseek" style={{ height: 22, width: 'auto', display: 'block', alignSelf: 'flex-start' }} />
);

const Sidebar: React.FC = () => {
    const { logout } = useAuth();
    const [hostingEnabled, setHostingEnabled] = useState(false);
    const [searchEnabled, setSearchEnabled] = useState(true);

    // Products are admin-controlled per store: hosting is opt-in, search can be
    // switched off for hosting-only clients.
    useEffect(() => {
        api.get('/hosting/plans')
            .then(res => setHostingEnabled(!!res.data.enabled))
            .catch(() => setHostingEnabled(false));
        api.get('/tenants/profile')
            .then(res => {
                const se = res.data.tenant?.search_enabled;
                setSearchEnabled(se === undefined || se === null ? true : !!se);
            })
            .catch(() => setSearchEnabled(true));
    }, []);

    const navItems = [
        ...(searchEnabled ? [
            { icon: <LayoutDashboard size={18} />, label: 'Overview',       path: '/'          },
            { icon: <BarChart3 size={18} />,       label: 'Analytics',      path: '/analytics' },
            { icon: <Key size={18} />,             label: 'API Keys',       path: '/keys'      },
            { icon: <Package size={18} />,         label: 'Catalog',        path: '/catalog'   },
            { icon: <Search size={18} />,          label: 'Search Preview', path: '/preview'   },
            { icon: <Download size={18} />,        label: 'Plugins',        path: '/plugins'   },
        ] : []),
        ...(hostingEnabled ? [{ icon: <Server size={18} />, label: 'Hosting', path: '/hosting' }] : []),
        { icon: <CreditCard size={18} />,      label: 'Billing',        path: '/billing'   },
        ...(searchEnabled ? [{ icon: <Settings size={18} />, label: 'Settings', path: '/settings' }] : []),
    ];

    const linkStyle = (isActive: boolean): React.CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        gap: '0.65rem',
        padding: '0.6rem 0.875rem',
        borderRadius: 'var(--radius-sm)',
        color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
        background: isActive ? 'rgba(192, 228, 87, 0.18)' : 'transparent',
        fontWeight: isActive ? 500 : 400,
        fontSize: '0.9rem',
        marginBottom: '2px',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'all 0.15s ease',
    });

    return (
        <aside style={{
            width: '240px',
            background: 'var(--bg-sidebar)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            padding: '1.5rem 0.875rem',
            position: 'sticky',
            top: 0,
            height: '100vh',
        }}>
            <div style={{ padding: '0 0.875rem 2rem' }}>
                <Logo />
            </div>

            <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === '/'}
                        style={({ isActive }) => linkStyle(isActive)}
                    >
                        {item.icon}
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <button
                    onClick={logout}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.65rem',
                        padding: '0.6rem 0.875rem',
                        color: 'var(--text-dim)',
                        fontSize: '0.9rem',
                        width: '100%',
                        borderRadius: 'var(--radius-sm)',
                        transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                >
                    <LogOut size={18} />
                    Logout
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
