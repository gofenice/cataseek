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
        icon: '/uploads/ecommerce-logos/prestashop.png',
        color: '#df0067',
        blurb: 'Install as a standard PrestaShop module and connect with your API key.',
    },
    woocommerce: {
        label: 'WordPress',
        icon: '/uploads/ecommerce-logos/wordpress.png',
        color: '#21759b',
        blurb: 'WordPress plugin — upload the zip in Plugins → Add New.',
    },

    shopify: {
        label: 'Shopify',
        icon: '/uploads/ecommerce-logos/shopify.png',
        color: '#95bf47',
        blurb: 'Theme app extension package for your Shopify storefront.',
    },
    magento: {
        label: 'Magento',
        icon: '/uploads/ecommerce-logos/magento.png',
        color: '#f26322',
        blurb: 'Magento 2 extension — install via the extension manager or composer.',
    },
    opencart: {
        label: 'OpenCart',
        icon: '/uploads/ecommerce-logos/opencart.png',
        color: '#23a1d1',
        blurb: 'OpenCart extension — install from the admin extension installer.',
    },
    bigcommerce: {
        label: 'BigCommerce',
        icon: '/uploads/ecommerce-logos/bigcommerce.png',
        color: '#121212',
        blurb: 'BigCommerce app — connect via the BigCommerce App Store.',
    },
    custom: {
        label: 'Custom / API',
        icon: '⚙️',
        color: '#64748b',
        blurb: 'JavaScript snippet and REST API docs for any custom storefront.',
    },
};

export const platformMeta = (platform: string): PlatformMeta => {
    const key = platform === 'wordpress' ? 'woocommerce' : platform;
    return PLATFORMS[key] || {
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        icon: '📦',
        color: '#64748b',
        blurb: 'Integration package for your store.',
    };
};

export const formatFileSize = (bytes: number): string => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
