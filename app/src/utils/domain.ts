/**
 * Canonical store-domain normalization.
 *
 * Domain verification only holds if the value written at registration/profile
 * time is normalized IDENTICALLY to the value compared at request time. When
 * the two differ, a tenant can store `https://www.victim.com/x`, sail past a
 * uniqueness check that compares raw strings, and still match `victim.com` once
 * the auth middleware strips it down. Every read and write of a store domain
 * must go through this function.
 */
export const normalizeDomain = (d: string): string => {
  if (!d) return '';
  let clean = d.toLowerCase().trim();
  clean = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return clean.split('/')[0].split('?')[0].split('#')[0];
};

/**
 * True when `domain` is already verified by a tenant other than `tenantId`.
 *
 * `tenants.store_domain` and `tenant_domains.domain` are each UNIQUE on their
 * own, but nothing spans the two tables — so without this check a tenant can
 * claim as its PRIMARY domain a domain another tenant has already verified,
 * and both then authenticate from the same origin.
 *
 * Pass `null` as tenantId when no tenant exists yet (registration).
 */
export const isDomainClaimedByOtherTenant = async (
  queryFn: (sql: string, params: any[]) => Promise<any>,
  domain: string,
  tenantId: number | null
): Promise<boolean> => {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  const rows: any = await queryFn(
    'SELECT tenant_id FROM tenant_domains WHERE domain = ? AND tenant_id != ?',
    [normalized, tenantId ?? 0]
  );
  return Array.isArray(rows) && rows.length > 0;
};
