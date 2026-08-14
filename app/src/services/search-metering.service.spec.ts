/**
 * Billing rules for search metering.
 *
 * These assertions are the contract the storefront is charged against, so they
 * pin down both directions: what must be billed, and what must never be.
 */

const mockQuery = jest.fn();
jest.mock('../config/database', () => ({ query: (...args: any[]) => mockQuery(...args) }));

import {
  meterSearch,
  flushMetering,
  getBufferedUsage,
  isBotRequest,
  normalizeQuery,
  __resetMeteringState,
} from './search-metering.service';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let insertId = 1;

beforeEach(() => {
  __resetMeteringState();
  mockQuery.mockReset();
  insertId = 1;
  mockQuery.mockImplementation((sql: string) => {
    if (/^\s*INSERT INTO search_analytics/i.test(sql)) return Promise.resolve({ insertId: insertId++ });
    return Promise.resolve([]);
  });
});

const search = (over: Partial<Parameters<typeof meterSearch>[0]> = {}) =>
  meterSearch({
    tenantId: 1,
    rawQuery: 'nike',
    resultCount: 5,
    sessionId: 'session-a',
    ip: '203.0.113.9',
    userAgent: BROWSER_UA,
    ...over,
  });

describe('typing bursts', () => {
  it('bills a progressive burst once, not once per keystroke', async () => {
    const results = [];
    for (const q of ['nik', 'nike', 'nike ', 'nike a', 'nike air']) {
      results.push(await search({ rawQuery: q }));
    }
    expect(results.map((r) => r.billed)).toEqual([true, false, false, false, false]);
    expect(getBufferedUsage(1)).toBe(1);
  });

  it('treats backspacing as the same burst', async () => {
    expect((await search({ rawQuery: 'hoodie' })).billed).toBe(true);
    expect((await search({ rawQuery: 'hood' })).billed).toBe(false);
    expect((await search({ rawQuery: 'hoo' })).billed).toBe(false);
    expect(getBufferedUsage(1)).toBe(1);
  });

  it('bills a genuinely different term', async () => {
    expect((await search({ rawQuery: 'hoodie' })).billed).toBe(true);
    expect((await search({ rawQuery: 'beanie' })).billed).toBe(true);
    expect(getBufferedUsage(1)).toBe(2);
  });

  it('records the longest form of the burst, not the first fragment', async () => {
    await search({ rawQuery: 'nik' });
    await search({ rawQuery: 'nike air' });
    await flushMetering();

    const update = mockQuery.mock.calls.find(([sql]) => /UPDATE search_analytics/i.test(sql));
    expect(update).toBeDefined();
    expect(update![1][0]).toBe('nike air');
  });
});

describe('non-search activity', () => {
  it('does not bill filter changes or pagination (same query re-sent)', async () => {
    expect((await search({ rawQuery: 'shirt' })).billed).toBe(true);
    // filter applied, then page 2 — the widget re-sends the same query text
    expect((await search({ rawQuery: 'shirt', resultCount: 12 })).billed).toBe(false);
    expect((await search({ rawQuery: 'shirt', resultCount: 12 })).billed).toBe(false);
    expect(getBufferedUsage(1)).toBe(1);
  });

  it('does not bill the empty discovery fetch on modal open', async () => {
    expect((await search({ rawQuery: '' })).reason).toBe('empty');
    expect(getBufferedUsage(1)).toBe(0);
  });

  it('does not bill fragments under three characters', async () => {
    expect((await search({ rawQuery: 'ni' })).reason).toBe('too-short');
    expect(getBufferedUsage(1)).toBe(0);
  });
});

describe('abuse resistance', () => {
  it('bills separate shoppers separately even on identical queries', async () => {
    expect((await search({ sessionId: 'a' })).billed).toBe(true);
    expect((await search({ sessionId: 'b' })).billed).toBe(true);
    expect((await search({ sessionId: 'c' })).billed).toBe(true);
    expect(getBufferedUsage(1)).toBe(3);
  });

  it('cannot be zero-rated by omitting a session id', async () => {
    expect((await search({ sessionId: undefined })).billed).toBe(true);
    expect(getBufferedUsage(1)).toBe(1);
  });

  it('keeps tenants isolated', async () => {
    await search({ tenantId: 1 });
    await search({ tenantId: 2 });
    expect(getBufferedUsage(1)).toBe(1);
    expect(getBufferedUsage(2)).toBe(1);
  });

  it('skips crawlers so they do not consume tenant quota', async () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'python-requests/2.31.0',
      'curl/8.4.0',
      'Scrapy/2.11 (+https://scrapy.org)',
    ];
    for (const ua of bots) {
      expect((await search({ userAgent: ua })).reason).toBe('bot');
    }
    expect(getBufferedUsage(1)).toBe(0);
  });

  it('treats a missing user-agent as non-human', () => {
    expect(isBotRequest(undefined)).toBe(true);
    expect(isBotRequest('')).toBe(true);
    expect(isBotRequest(BROWSER_UA)).toBe(false);
  });
});

describe('flush behaviour', () => {
  it('collapses many searches into one batched upsert', async () => {
    for (const q of ['shirt', 'beanie', 'hoodie']) await search({ rawQuery: q });
    mockQuery.mockClear();
    await flushMetering();

    const upserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO api_usage/i.test(sql));
    expect(upserts).toHaveLength(1);
    expect(getBufferedUsage(1)).toBe(0);
  });

  it('retains counts when the flush fails, so billing data is not lost', async () => {
    await search({ rawQuery: 'shirt' });
    expect(getBufferedUsage(1)).toBe(1);

    mockQuery.mockImplementation((sql: string) => {
      if (/INSERT INTO api_usage/i.test(sql)) return Promise.reject(new Error('db down'));
      return Promise.resolve([]);
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await flushMetering();
    spy.mockRestore();

    expect(getBufferedUsage(1)).toBe(1);
  });

  it('still serves the search when the analytics insert fails', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/INSERT INTO search_analytics/i.test(sql)) return Promise.reject(new Error('nope'));
      return Promise.resolve([]);
    });
    await expect(search({ rawQuery: 'shirt' })).resolves.toMatchObject({ billed: true });
    expect(getBufferedUsage(1)).toBe(1);
  });
});

describe('normalizeQuery', () => {
  it('folds case and collapses whitespace so variants share one burst', () => {
    expect(normalizeQuery('  Nike   AIR  ')).toBe('nike air');
  });
});
