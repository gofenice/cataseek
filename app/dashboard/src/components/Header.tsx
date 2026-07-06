import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Bell, User } from 'lucide-react';

const Header: React.FC = () => {
    const { tenant } = useAuth();
    const navigate = useNavigate();

    return (
        <header style={{
            height: '64px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 2rem',
            background: 'var(--bg-card)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
        }}>
            <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                    {tenant?.storeName || 'Store Dashboard'}
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', margin: 0 }}>
                    Welcome back to Cataseek
                </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button style={{
                    color: 'var(--text-dim)',
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'var(--transition)',
                }}>
                    <Bell size={18} />
                </button>

                <div
                    onClick={() => navigate('/profile')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        paddingLeft: '1rem',
                        borderLeft: '1px solid var(--border)',
                        cursor: 'pointer',
                    }}
                >
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{tenant?.email}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--success)' }}>
                            {tenant?.status === 'trial' ? 'Trial active' : 'Plan active'}
                        </div>
                    </div>
                    <div className="flex-center" style={{
                        width: '36px',
                        height: '36px',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--border)',
                        borderRadius: '50%',
                    }}>
                        <User size={16} color="var(--text-muted)" />
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
