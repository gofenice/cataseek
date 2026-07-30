import api from './api';

interface CacheEntry {
    data: any;
    timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60 * 1000; // 5 minutes cache TTL

export function getCachedData<T = any>(url: string): T | null {
    const entry = cache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL) {
        cache.delete(url);
        return null;
    }
    return entry.data as T;
}

export function setCachedData(url: string, data: any): void {
    cache.set(url, { data, timestamp: Date.now() });
}

export function invalidateCache(urlPattern?: string): void {
    if (!urlPattern) {
        cache.clear();
        return;
    }
    for (const key of cache.keys()) {
        if (key.includes(urlPattern)) {
            cache.delete(key);
        }
    }
}

export function prefetch(url: string): void {
    const entry = cache.get(url);
    if (entry && Date.now() - entry.timestamp <= TTL) return;

    api.get(url)
        .then((res) => {
            setCachedData(url, res.data);
        })
        .catch(() => { /* silent fail on prefetch */ });
}
