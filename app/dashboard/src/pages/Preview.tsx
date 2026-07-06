import React, { useState, useEffect } from 'react';
import { Search, Loader, Code, Image as ImageIcon, Globe } from 'lucide-react';
import api from '../services/api';

const Preview: React.FC = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [fullResponse, setFullResponse] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [searchTime, setSearchTime] = useState(0);
    const [languages, setLanguages] = useState<string[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState<string>('');

    // Fetch available languages on mount
    useEffect(() => {
        api.get('/products/languages')
            .then((res) => {
                const langs: string[] = res.data.languages || [];
                setLanguages(langs);
                if (langs.length > 0) setSelectedLanguage(langs[0]);
            })
            .catch((err) => console.error('Failed to fetch languages', err));
    }, []);

    // Debounce search — re-runs when query or language changes
    useEffect(() => {
        const timer = setTimeout(() => {
            handleSearch();
        }, 500);
        return () => clearTimeout(timer);
    }, [query, selectedLanguage]);

    const handleSearch = async () => {
        try {
            setLoading(true);
            const response = await api.post('/tenants/preview-search', {
                query,
                // Always filter by language so multi-language stores don't see duplicates.
                // The language filter is required to return 1 result per product.
                filters: selectedLanguage ? { language: selectedLanguage } : undefined,
                options: { limit: 12 }
            });

            setResults(response.data.hits || []);
            setFullResponse(response.data);
            setSearchTime(response.data.processingTimeMs || 0);
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ paddingBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ marginBottom: '0.5rem' }}>Search Preview</h1>
                    <p style={{ color: 'var(--text-muted)' }}>Test your search configuration in real-time.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {/* Language Selector */}
                    {languages.length > 1 && (
                        <div className="glass" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Globe size={16} style={{ color: 'var(--text-muted)' }} />
                            <select
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-main)',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                {languages.map((lang) => (
                                    <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="glass" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Latency:</span>
                        <span style={{ fontWeight: 600, color: searchTime < 50 ? 'var(--success)' : 'var(--warning)' }}>
                            {searchTime}ms
                        </span>
                    </div>
                </div>
            </div>

            {/* Search Bar */}
            <div className="glass" style={{ padding: '1rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Search size={24} style={{ color: 'var(--text-muted)' }} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for products (e.g. 'summer shirt')..."
                    style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-main)',
                        fontSize: '1.2rem',
                        outline: 'none'
                    }}
                    autoFocus
                />
                {loading && <Loader size={20} className="spin" style={{ color: 'var(--primary)' }} />}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
                {/* Left: Visual Results */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1.1rem' }}>Visual Results ({results.length})</h3>
                    </div>

                    {results.length === 0 ? (
                        <div className="flex-center" style={{ height: '300px', flexDirection: 'column', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '12px' }}>
                            <Search size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                            <p>No products found</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                            {results.map((product) => (
                                <div key={product.id} className="card" style={{ padding: '0.75rem' }}>
                                    <div style={{
                                        aspectRatio: '1',
                                        background: 'rgba(0,0,0,0.2)',
                                        borderRadius: '8px',
                                        marginBottom: '0.75rem',
                                        overflow: 'hidden',
                                        position: 'relative'
                                    }}>
                                        {product.images && product.images[0] ? (
                                            <img
                                                src={product.images[0]}
                                                alt={product.name}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        ) : (
                                            <div className="flex-center" style={{ width: '100%', height: '100%' }}>
                                                <ImageIcon size={32} style={{ opacity: 0.2 }} />
                                            </div>
                                        )}
                                        {product.compare_price > product.price && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '8px',
                                                right: '8px',
                                                background: 'var(--error)',
                                                color: 'white',
                                                fontSize: '0.7rem',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontWeight: 600
                                            }}>
                                                SALE
                                            </div>
                                        )}
                                    </div>
                                    <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {product.name}
                                    </h4>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 600 }}>${product.price}</span>
                                        {product.compare_price > product.price && (
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                                                ${product.compare_price}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right: JSON Debug */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                        <Code size={18} />
                        <h3 style={{ fontSize: '1.1rem' }}>JSON Response</h3>
                    </div>
                    <div className="card" style={{ padding: '0', overflow: 'hidden', background: '#1e1e1e' }}>
                        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status: 200 OK</span>
                        </div>
                        <pre style={{
                            padding: '1rem',
                            overflow: 'auto',
                            maxHeight: 'calc(100vh - 250px)',
                            fontSize: '0.85rem',
                            margin: 0,
                            color: '#d4d4d4'
                        }}>
                            {fullResponse ? JSON.stringify(fullResponse, null, 2) : '// data will appear here...'}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Preview;

