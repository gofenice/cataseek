// Shared metadata for the e-commerce platforms Cataseek ships plugins for.
// Used by the merchant Plugins page and the admin Modules page.

export interface PlatformMeta {
    label: string;
    icon: string;
    color: string;
    blurb: string;
}

export const PLATFORMS: Record<string, PlatformMeta> = {
    prestashop: {
        label: 'PrestaShop',
        icon: '🛒',
        color: '#df0067',
        blurb: 'Install as a standard PrestaShop module and connect with your API key.',
    },
    woocommerce: {
        label: 'WooCommerce',
        icon: '🔌',
        color: '#7f54b3',
        blurb: 'WordPress plugin — upload the zip in Plugins → Add New.',
    },
    shopify: {
        label: 'Shopify',
        icon: '🛍️',
        color: '#95bf47',
        blurb: 'Theme app extension package for your Shopify storefront.',
    },
    magento: {
        label: 'Magento',
        icon: '🧲',
        color: '#f26322',
        blurb: 'Magento 2 extension — install via the extension manager or composer.',
    },
    opencart: {
        label: 'OpenCart',
        icon: '🧩',
        color: '#23a1d1',
        blurb: 'OpenCart extension — install from the admin extension installer.',
    },
    custom: {
        label: 'Custom / API',
        icon: '⚙️',
        color: '#64748b',
        blurb: 'JavaScript snippet and REST API docs for any custom storefront.',
    },
};

export const platformMeta = (platform: string): PlatformMeta =>
    PLATFORMS[platform] || {
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        icon: '📦',
        color: '#64748b',
        blurb: 'Integration package for your store.',
    };

export const formatFileSize = (bytes: number): string => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
