import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Package, Globe, ExternalLink, ChevronLeft, ChevronRight,
  Loader2, Image as ImageIcon, Search, Eye, EyeOff, X, RefreshCw, AlertTriangle
} from 'lucide-react';
import api from '../services/api';

interface Product {
  id: string;
  external_id: string;
  name: string;
  description: string;
  price: number;
  compare_price: number | null;
  quantity: number;
  sku: string;
  status: string;
  images: any;
  url: string;
  hidden: number; // 0 = visible, 1 = hidden from search
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const Catalog: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [storeDomain, setStoreDomain] = useState<string>('');
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 12, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visibility filter
  const [showHidden, setShowHidden] = useState(false);

  // Per-product toggle loading state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Reset Index state
  const [isResetting, setIsResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState({ text: '', type: '' });

  // ─── Fetch Languages ───────────────────────────────────────────────
  useEffect(() => {
    api.get('/products/languages')
      .then((res) => {
        const langs: string[] = res.data.languages || [];
        setLanguages(langs);
        if (langs.length > 0) setSelectedLanguage(langs[0]);
      })
      .catch((err) => console.error('Fetch languages error:', err));
  }, []);

  // ─── Debounce search input ─────────────────────────────────────────
  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchTerm(value.trim());
      setPagination((p) => ({ ...p, page: 1 }));
    }, 300);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
    setPagination((p) => ({ ...p, page: 1 }));
  };

  // ─── Fetch Products ────────────────────────────────────────────────
  const fetchProducts = useCallback(async (page: number, language: string, search: string, showHiddenFlag: boolean) => {
    setIsLoading(true);
    setError('');
    try {
      const params: any = { page, limit: 12 };
      if (language) params.language = language;
      if (search) params.search = search;
      if (showHiddenFlag) params.show_hidden = 'true';

      const response = await api.get('/products', { params });
      const data = response.data;

      const parsedProducts = data.products.map((p: any) => ({
        ...p,
        images: typeof p.images === 'string' ? JSON.parse(p.images) : p.images,
        hidden: Number(p.hidden ?? 0),
      }));

      setProducts(parsedProducts);
      setStoreDomain(data.storeDomain || '');
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts(pagination.page, selectedLanguage, searchTerm, showHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, selectedLanguage, searchTerm, showHidden]);

  // ─── Language change ───────────────────────────────────────────────
  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLanguage(e.target.value);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  // ─── Toggle Visibility ────────────────────────────────────────────
  const toggleVisibility = async (product: Product) => {
    const newHidden = product.hidden === 0;
    setTogglingId(product.id);
    try {
      await api.post('/products/toggle-visibility', {
        product_id: product.id,
        hidden: newHidden,
      });
      // Optimistic update
      setProducts((prev) =>
        prev.map((p) => p.id === product.id ? { ...p, hidden: newHidden ? 1 : 0 } : p)
      );
    } catch (err: any) {
      console.error('Toggle visibility failed:', err);
      setError(err.response?.data?.error || 'Failed to update visibility');
    } finally {
      setTogglingId(null);
    }
  };

  // ─── Reset Index ──────────────────────────────────────────────────
  const handleResetIndex = async () => {
    if (!window.confirm('WARNING: This will completely wipe your Cataseek product cache and search index. Your search widget will return no results until you go to your PrestaShop store and run a Full Sync again. Are you absolutely sure?')) {
      return;
    }

    setIsResetting(true);
    setResetMsg({ text: '', type: '' });

    try {
      const res = await api.post('/products/reset-index');
      setResetMsg({ text: res.data.message || 'Index successfully reset.', type: 'success' });
      setProducts([]); // Clear the local list immediately
      setPagination(p => ({ ...p, total: 0, totalPages: 0 }));
    } catch (err: any) {
      console.error('Reset index failed:', err);
      setResetMsg({ text: err.response?.data?.error || 'Failed to reset index', type: 'error' });
    } finally {
      setIsResetting(false);
    }
  };

  // ─── URL helper (Bug Fix #1) ───────────────────────────────────────
  // product.url is already a full absolute URL from the sync (PrestaShop sends the full URL).
  // Previously the code incorrectly prepended the domain again.
  const buildProductUrl = (productUrl: string): string => {
    if (!productUrl) return '#';
    if (productUrl.startsWith('http://') || productUrl.startsWith('https://')) {
      return productUrl; // already absolute — use as-is
    }
    // Relative URL — prepend protocol + domain as a fallback
    const domain = storeDomain.replace(/^https?:\/\//, '');
    return `https://${domain}/${productUrl.replace(/^\//, '')}`;
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
            Product Catalogue
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Browse and manage your synced search inventory
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Show Hidden Toggle */}
          <label
            className="glass"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer', userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => { setShowHidden(e.target.checked); setPagination((p) => ({ ...p, page: 1 })); }}
              style={{ accentColor: 'var(--primary)', width: 16, height: 16, cursor: 'pointer' }}
            />
            <EyeOff size={15} color="var(--text-muted)" />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              Show hidden
            </span>
          </label>

          {/* Language selector */}
          {languages.length > 0 && (
            <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem' }}>
              <Globe size={18} color="var(--text-muted)" />
              <select
                value={selectedLanguage}
                onChange={handleLanguageChange}
                style={{
                  background: 'transparent',
                  color: 'var(--text-main)',
                  border: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="">All Languages</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang} style={{ background: 'var(--bg-sidebar)' }}>
                    {lang.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div
        className="glass"
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1.1rem' }}
      >
        <Search size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchInput(e.target.value)}
          placeholder="Search by product name, SKU or ID…"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-main)',
            fontSize: '0.95rem',
            outline: 'none',
          }}
        />
        {searchInput && (
          <button
            onClick={clearSearch}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'flex' }}
            title="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>


      {/* ── Error ── */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--error)', color: 'var(--error)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
          {error}
        </div>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <div className="glass flex-center" style={{ padding: '5rem', flexDirection: 'column', gap: '1rem' }}>
          <Loader2 className="spin" size={32} color="var(--primary)" />
          <span style={{ color: 'var(--text-muted)' }}>Loading inventory…</span>
        </div>
      ) : products.length === 0 ? (
        <div className="glass flex-center" style={{ padding: '5rem', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
          <Package size={48} color="var(--text-dim)" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            {searchTerm ? `No products matching "${searchTerm}"` : 'No products found'}
          </h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400 }}>
            {searchTerm
              ? 'Try a different search term or clear the search to see all products.'
              : languages.length === 0
                ? 'Your catalogue is completely empty. Sync products from your store to get started.'
                : `No products available${selectedLanguage ? ` in ${selectedLanguage.toUpperCase()}` : ''}.`}
          </p>
        </div>
      ) : (
        <div className="glass" style={{ overflow: 'hidden' }}>
          {/* Result count */}
          {(searchTerm || showHidden) && (
            <div style={{ padding: '0.6rem 1.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {pagination.total} result{pagination.total !== 1 ? 's' : ''}
              {searchTerm ? ` for "${searchTerm}"` : ''}
              {showHidden ? ' (including hidden)' : ''}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Product</th>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>SKU</th>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Price</th>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Stock</th>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Status</th>
                  <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text-main)' }}>
                {products.map((product) => {
                  const isHidden = product.hidden === 1;
                  const isToggling = togglingId === product.id;
                  return (
                    <tr
                      key={product.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'var(--transition)',
                        opacity: isHidden ? 0.5 : 1,
                        background: isHidden ? 'rgba(0,0,0,0.15)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!isHidden) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isHidden ? 'rgba(0,0,0,0.15)' : 'transparent'; }}
                    >
                      {/* Product */}
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ width: 40, height: 40, background: 'rgba(20,32,26,0.03)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {product.images && product.images[0] ? (
                              <img src={product.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <ImageIcon size={18} color="var(--text-dim)" />
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }} title={product.name}>
                              {product.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {product.external_id}</div>
                          </div>
                          {isHidden && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(100,116,139,0.2)', color: 'var(--text-muted)', flexShrink: 0 }}>
                              HIDDEN
                            </span>
                          )}
                        </div>
                      </td>

                      {/* SKU */}
                      <td style={{ padding: '1rem 1.5rem', color: 'var(--text-muted)' }}>{product.sku || '—'}</td>

                      {/* Price */}
                      <td style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>${Number(product.price).toFixed(2)}</td>

                      {/* Stock */}
                      <td style={{ padding: '1rem 1.5rem' }}>
                        {product.quantity > 0 ? (
                          <span style={{ color: 'var(--success)', fontWeight: 500 }}>{product.quantity}</span>
                        ) : (
                          <span style={{ color: 'var(--error)' }}>Out of stock</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <span style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: 20,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: product.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
                          color: product.status === 'active' ? 'var(--success)' : 'var(--text-muted)',
                          border: `1px solid ${product.status === 'active' ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)'}`,
                        }}>
                          {product.status.toUpperCase()}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>

                          {/* Hide / Show button */}
                          <button
                            onClick={() => !isToggling && toggleVisibility(product)}
                            disabled={isToggling}
                            title={isHidden ? 'Show in search' : 'Hide from search'}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              borderRadius: 6,
                              border: `1px solid ${isHidden ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.3)'}`,
                              background: isHidden ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.08)',
                              color: isHidden ? 'var(--success)' : 'var(--text-muted)',
                              cursor: isToggling ? 'wait' : 'pointer',
                              opacity: isToggling ? 0.6 : 1,
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isToggling ? (
                              <Loader2 size={13} className="spin" />
                            ) : isHidden ? (
                              <Eye size={13} />
                            ) : (
                              <EyeOff size={13} />
                            )}
                            {isHidden ? 'Show' : 'Hide'}
                          </button>

                          {/* View button — Bug Fix: use product.url directly if already absolute */}
                          {product.url ? (
                            <a
                              href={buildProductUrl(product.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-primary"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: 6, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                            >
                              View <ExternalLink size={13} />
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>No URL</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {pagination.totalPages > 1 && (
            <div style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} results
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                  style={{ padding: '0.4rem 0.75rem', background: 'rgba(20,32,26,0.03)', borderRadius: 6, border: '1px solid var(--border)', color: pagination.page <= 1 ? 'var(--text-dim)' : 'var(--text-main)', opacity: pagination.page <= 1 ? 0.5 : 1 }}
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.5rem', fontSize: '0.875rem' }}>
                  Page {pagination.page} of {pagination.totalPages}
                </div>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                  style={{ padding: '0.4rem 0.75rem', background: 'rgba(20,32,26,0.03)', borderRadius: 6, border: '1px solid var(--border)', color: pagination.page >= pagination.totalPages ? 'var(--text-dim)' : 'var(--text-main)', opacity: pagination.page >= pagination.totalPages ? 0.5 : 1 }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Troubleshooting Box ── */}
      <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '1rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
        <div style={{ background: 'rgba(245,158,11,0.1)', padding: '0.6rem', borderRadius: '50%' }}>
          <AlertTriangle size={20} color="#f59e0b" />
        </div>
        <div style={{ flex: 1, minWidth: 250 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>Search showing old/deleted products?</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>If your catalog is out of sync, you can reset the search index. You must run a full sync from your store module immediately after.</div>
          {resetMsg.text && (
            <div style={{ marginTop: 8, fontSize: '0.8rem', color: resetMsg.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
              {resetMsg.text}
            </div>
          )}
        </div>
        <button
          onClick={handleResetIndex}
          disabled={isResetting}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem',
            background: 'rgba(239,68,68,0.1)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.3)', cursor: isResetting ? 'wait' : 'pointer',
            opacity: isResetting ? 0.6 : 1, transition: 'all 0.15s'
          }}
        >
          {isResetting ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          {isResetting ? 'Resetting...' : 'Reset Search Index'}
        </button>
      </div>
    </div>
  );
};

export default Catalog;
