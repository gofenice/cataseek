import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import TrialBanner from './TrialBanner';

const Layout: React.FC = () => {
    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-main)' }}>
            <Sidebar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Header />
                <TrialBanner />
                <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                    <div className="container">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default Layout;
