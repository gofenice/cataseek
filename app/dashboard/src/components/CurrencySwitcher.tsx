import React, { useState } from 'react';
import api from '../services/api';
import { CURRENCY_NAMES } from '../services/money';

interface Props {
    currency: string;
    options: string[];
    locked: boolean;
    onChanged: () => void | Promise<void>;
    onError: (message: string) => void;
}

// Prices follow the visitor's country, but a card issued in another country
// needs another currency — so the customer can always pick it here. Fixed
// while a subscription is running.
const CurrencySwitcher: React.FC<Props> = ({ currency, options, locked, onChanged, onError }) => {
    const [saving, setSaving] = useState(false);
    if (!options || options.length < 2) return null;

    const change = async (next: string) => {
        if (next === currency) return;
        setSaving(true);
        try {
            await api.put('/billing/currency', { currency: next });
            await onChanged();
        } catch (e: any) {
            onError(e.response?.data?.error || 'Failed to change currency');
        }
        setSaving(false);
    };

    return (
        <label
            title={locked ? `Your subscription is billed in ${currency}. Cancel it to switch currency.` : 'Choose the currency of the card you will pay with'}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-muted)' }}
        >
            Currency
            <select
                value={currency}
                disabled={locked || saving}
                onChange={e => change(e.target.value)}
                style={{
                    padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'rgba(20,32,26,0.03)', color: 'var(--text-main)', fontWeight: 600,
                    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked || saving ? 0.6 : 1,
                }}
            >
                {options.map(c => (
                    <option key={c} value={c}>{c}{CURRENCY_NAMES[c] ? ` — ${CURRENCY_NAMES[c]}` : ''}</option>
                ))}
            </select>
        </label>
    );
};

export default CurrencySwitcher;
