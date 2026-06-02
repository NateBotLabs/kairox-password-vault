/**
 * Origin validation for autofill.
 *
 * Security properties enforced here:
 *  - Only HTTPS pages can receive autofill (no HTTP — phishing vector).
 *  - Domain matching uses normalised registered-domain comparison, not naive string match.
 *  - Subdomains of a stored entry's domain ARE allowed (app.example.com matches example.com).
 *  - The reverse is NOT allowed (example.com page does NOT match login.evil.example.com entry).
 *  - Port must match (default 443 for https).
 *  - The browser's URL API normalises punycode/IDN automatically, defeating homoglyph tricks.
 */

/** Strip a leading `www.` and lowercase. */
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

/**
 * Returns true when `pageUrl` should receive autofill credentials stored for `entryUrl`.
 *
 * Matching rules (in priority order):
 *  1. Both must be HTTPS.
 *  2. Ports must match (443 is the default for https).
 *  3. pageHost === entryHost  (exact match, after www-strip)
 *  4. pageHost ends with '.' + entryHost  (pageHost is a subdomain of entryHost)
 */
export function matchesOrigin(pageUrl: string, entryUrl: string | undefined): boolean {
  if (!entryUrl) return false;

  let page: URL, entry: URL;
  try {
    page  = new URL(pageUrl);
    entry = new URL(entryUrl);
  } catch {
    return false;
  }

  if (page.protocol !== 'https:')  return false;
  if (entry.protocol !== 'https:') return false;

  const pagePort  = page.port  || '443';
  const entryPort = entry.port || '443';
  if (pagePort !== entryPort) return false;

  const pageHost  = normalizeHostname(page.hostname);
  const entryHost = normalizeHostname(entry.hostname);

  if (pageHost === entryHost)                   return true;
  if (pageHost.endsWith('.' + entryHost))       return true;

  return false;
}

/** Parse just the HTTPS origin (scheme + host + port) or null if invalid. */
export function httpsOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
