// Session tokens: who a request is from, signed by the server so it can't be forged. A token says which user, in which
// workspace, until when, and is checked on every request (`verifySession`). Whatever logs people in (an identity
// provider, an invite link) mints them with `signSession`; the sync engine only reads them.
//
// The format is `s1.<claims>.<signature>`: the claims as base64url JSON, signed with HMAC-SHA256.

export type SessionClaims = { userId: string; workspace: string; expiresAtMs: number };

const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const key = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

export async function signSession(secret: string, claims: SessionClaims): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return `s1.${body}.${base64url(new Uint8Array(signature))}`;
}

// The token's claims when it's genuine, for this workspace and not expired; otherwise undefined.
export async function verifySession(
  secret: string,
  token: string,
  workspace: string,
  nowMs = Date.now(),
): Promise<SessionClaims | undefined> {
  const [version, body, signature] = token.split(".");
  if (version !== "s1" || body === undefined || signature === undefined) return undefined;
  let valid = false;
  try {
    // HMAC verification compares in constant time.
    valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromBase64url(signature),
      encoder.encode(body),
    );
  } catch {
    return undefined;
  }
  if (!valid) return undefined;
  const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionClaims;
  if (claims.workspace !== workspace || claims.expiresAtMs <= nowMs) return undefined;
  return claims;
}
