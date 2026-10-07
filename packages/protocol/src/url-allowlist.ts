import { getDomain } from 'tldts';

// The allowlist rules of section 5.4. The API uses them when a parent saves an entry and the
// tablet's native SafeBrowser plugin ports them to Kotlin; both run test-vectors/url-allowlist.json.

export type UrlMatch = 'exact' | 'domain' | 'prefix';

export interface AllowlistRule {
  match: UrlMatch;
  /** Punycode, lower case, no port. */
  host: string;
  path_prefix: string;
}

export interface NormalizedUrl {
  host: string;
  path: string;
}

/** Percent-encoded unreserved characters are decoded so `/%6Bids` cannot dodge `/kids`. */
function normalizePath(pathname: string): string {
  const decoded = pathname.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${hex.toUpperCase()}`;
  });
  return decoded || '/';
}

/**
 * https only, no credentials, no explicit port, no IP literal. The WHATWG URL parser already
 * lower-cases the host, converts IDN to punycode, drops the default port and resolves dot-segments.
 */
export function normalizeUrl(input: string): NormalizedUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/\.$/, '');
  if (!host || host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.')) return null;
  return { host, path: normalizePath(url.pathname) };
}

const hostMatches = (ruleHost: string, host: string) => host === ruleHost || host.endsWith(`.${ruleHost}`);

const pathMatches = (prefix: string, path: string) =>
  prefix === '/' || path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

export function ruleMatches(rule: AllowlistRule, url: NormalizedUrl): boolean {
  switch (rule.match) {
    case 'exact':
      return url.host === rule.host && url.path === rule.path_prefix;
    case 'domain':
      return hostMatches(rule.host, url.host);
    case 'prefix':
      return hostMatches(rule.host, url.host) && pathMatches(rule.path_prefix, url.path);
  }
}

/** The single question the SafeBrowser asks before every top-level navigation. */
export function isUrlAllowed(input: string, rules: readonly AllowlistRule[]): boolean {
  const url = normalizeUrl(input);
  return url !== null && rules.some((rule) => ruleMatches(rule, url));
}

/**
 * Turns what a parent typed into a stored rule. A domain rule must be a registrable domain or
 * deeper (checked against the Public Suffix List), so nobody can allow all of `co.uk`.
 */
export function buildAllowlistRule(
  input: string,
  match: UrlMatch,
): { ok: true; rule: AllowlistRule } | { ok: false; reason: string } {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input : `https://${input.trim()}`;
  const url = normalizeUrl(withScheme);
  if (!url) return { ok: false, reason: 'Enter a valid https address' };
  if (!getDomain(url.host)) return { ok: false, reason: 'That is not a website a family can allow' };

  if (match === 'domain') return { ok: true, rule: { match, host: url.host, path_prefix: '/' } };
  const path = match === 'prefix' && url.path.length > 1 ? url.path.replace(/\/+$/, '') : url.path;
  return { ok: true, rule: { match, host: url.host, path_prefix: path } };
}
