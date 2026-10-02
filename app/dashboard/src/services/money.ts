// Prices are stored per currency; whole amounts are shown without decimals (₹1,699, $5).
export const formatMoney = (amount: number | string | null | undefined, currency?: string | null): string => {
    const n = Number(amount) || 0;
    const code = (currency || 'USD').toUpperCase();
    try {
        return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
            maximumFractionDigits: 2,
        }).format(n);
    } catch {
        return `${n.toFixed(2)} ${code}`;
    }
};

export const CURRENCY_NAMES: Record<string, string> = {
    USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', INR: 'Indian Rupee',
};
