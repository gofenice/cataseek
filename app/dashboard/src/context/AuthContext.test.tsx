/**
 * Session-persistence cover for the "unexpected logout from Console" bug.
 *
 * The session used to be dropped whenever the startup profile request failed
 * for ANY reason. Reloading or navigating cancels in-flight requests, and
 * /tenants/profile is requested from eight places (AuthContext, Sidebar and its
 * hover prefetches, TrialBanner, Dashboard, Profile, APIKeys, Billing), so a
 * cancelled or failed one was easy to hit — and it signed the user out.
 *
 * The rule these tests lock in: only the server explicitly rejecting the token
 * (401) ends a session. Nothing else does.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../services/api', () => ({
  default: { get: (...a: any[]) => mockGet(...a) },
}));

import { AuthProvider, useAuth } from './AuthContext';

const TOKEN = 'stored.jwt.token';
const PROFILE = {
  data: {
    tenant: {
      id: 7, email: 'merchant@example.com', store_name: 'Test Store',
      store_domain: 'teststore.com', status: 'active', role: 'merchant',
    },
  },
};

const Probe = () => {
  const { tenant, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div data-testid="state">{tenant ? `in:${tenant.storeName}` : 'out'}</div>;
};

const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const settled = async () => {
  await waitFor(() => expect(screen.getByTestId('state')).toBeTruthy(), { timeout: 4000 });
  return screen.getByTestId('state').textContent;
};

const axiosErr = (status?: number) => {
  const e: any = new Error(status ? `status ${status}` : 'Network Error');
  if (status) e.response = { status };
  return e;
};

beforeEach(() => {
  localStorage.clear();
  mockGet.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('session survives everything that is not an auth rejection', () => {
  it('restores the session on reload when the profile loads', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    mockGet.mockResolvedValue(PROFILE);
    mount();
    expect(await settled()).toBe('in:Test Store');
    expect(localStorage.getItem('cataseek_token')).toBe(TOKEN);
  });

  it('keeps the token when the request is cancelled by navigation', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    // A cancelled/aborted request has no `response` at all — the exact shape
    // that used to wipe the session on reload.
    mockGet.mockRejectedValue(axiosErr(undefined));
    mount();
    await settled();
    expect(localStorage.getItem('cataseek_token')).toBe(TOKEN);
  });

  it('keeps the token when the server is briefly unavailable (503)', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    mockGet.mockRejectedValue(axiosErr(503));
    mount();
    await settled();
    expect(localStorage.getItem('cataseek_token')).toBe(TOKEN);
  });

  it('keeps the token on a 500', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    mockGet.mockRejectedValue(axiosErr(500));
    mount();
    await settled();
    expect(localStorage.getItem('cataseek_token')).toBe(TOKEN);
  });

  it('recovers the session when a blip is followed by success', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    mockGet
      .mockRejectedValueOnce(axiosErr(503))
      .mockResolvedValue(PROFILE);
    mount();
    expect(await settled()).toBe('in:Test Store');
    expect(localStorage.getItem('cataseek_token')).toBe(TOKEN);
  });
});

describe('a real auth rejection still ends the session', () => {
  it('clears the token on 401', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    localStorage.setItem('cataseek_role', 'merchant');
    mockGet.mockRejectedValue(axiosErr(401));
    mount();
    expect(await settled()).toBe('out');
    expect(localStorage.getItem('cataseek_token')).toBeNull();
    expect(localStorage.getItem('cataseek_role')).toBeNull();
  });

  it('does not retry a 401 — one rejection is final', async () => {
    localStorage.setItem('cataseek_token', TOKEN);
    mockGet.mockRejectedValue(axiosErr(401));
    mount();
    await settled();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('no stored session', () => {
  it('does not call the API and lands logged out', async () => {
    mount();
    expect(await settled()).toBe('out');
    expect(mockGet).not.toHaveBeenCalled();
  });
});
