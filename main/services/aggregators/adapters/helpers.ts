import { createHmac, timingSafeEqual } from 'crypto';

export function hmacHex(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Tolerant signature check across common header conventions (hex, base64, sha256= prefixed). */
export function verifyHmacHeaders(
  rawBody: string,
  headers: Record<string, string>,
  secret: string | null,
  headerNames: string[],
): boolean {
  if (!secret) return false;
  const expected = hmacHex(rawBody, secret);
  for (const name of headerNames) {
    const got = (headers[name] || headers[name.toLowerCase()] || '').trim();
    if (!got) continue;
    const cleaned = got.replace(/^sha256=/i, '');
    if (safeEq(cleaned, expected)) return true;
    try {
      const asHex = Buffer.from(cleaned, 'base64').toString('hex');
      if (safeEq(asHex, expected)) return true;
    } catch { /* not base64 */ }
  }
  return false;
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
