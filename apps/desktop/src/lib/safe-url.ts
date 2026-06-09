/**
 * Allowlist link schemes before they reach an <a href>. Backend/MCP tool
 * output (Stripe URLs, OCR-derived sms:/mailto: targets) is only as trustworthy
 * as the wrapper that produced it, so we never render `javascript:`/`data:`
 * URIs as active links. Returns the URL when its scheme is safe, else undefined
 * (render it as inert text instead).
 */
const SAFE_SCHEMES = /^(https:|mailto:|sms:|tel:)/i;

export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return SAFE_SCHEMES.test(trimmed) ? trimmed : undefined;
}
