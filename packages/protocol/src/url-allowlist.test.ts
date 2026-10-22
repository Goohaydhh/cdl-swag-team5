import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type AllowlistRule, buildAllowlistRule, isUrlAllowed, type UrlMatch } from './url-allowlist';

const vectors = JSON.parse(
  readFileSync(new URL('../test-vectors/url-allowlist.json', import.meta.url), 'utf8'),
) as {
  rules: AllowlistRule[];
  cases: { url: string; allowed: boolean; why: string }[];
  build: { input: string; match: UrlMatch; rule: AllowlistRule | null }[];
};

describe('isUrlAllowed (shared vectors)', () => {
  it.each(vectors.cases)('$url → $allowed ($why)', ({ url, allowed }) => {
    expect(isUrlAllowed(url, vectors.rules)).toBe(allowed);
  });
});

describe('buildAllowlistRule (shared vectors)', () => {
  it.each(vectors.build)('$input as $match', ({ input, match, rule }) => {
    const result = buildAllowlistRule(input, match);
    if (rule === null) expect(result.ok).toBe(false);
    else expect(result).toEqual({ ok: true, rule });
  });
});
