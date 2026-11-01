// Local learning-data ownership only. Decoding a JWT here does not validate or authorize it;
// the API remains authoritative. No bearer token is ever used as a storage key.
export type AccountScope = Readonly<{ owner: string | null; epoch: number }>;
let sessionToken: string | null = null;
let current: AccountScope = Object.freeze({ owner: "guest", epoch: 0 });
const listeners = new Set<() => void>();

function userOwner(id: unknown): string | null {
  if (typeof id !== "string" && typeof id !== "number") return null;
  if (typeof id === "number" && !Number.isFinite(id)) return null;
  const value = String(id).trim();
  return value && value.length <= 200 ? `user:${value}` : null;
}

function tokenOwner(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload || payload.length > 16000 || !/^[A-Za-z0-9_-]+={0,2}$/.test(payload)) return null;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0;
    let accumulator = 0;
    let encoded = "";
    for (const char of payload.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")) {
      accumulator = (accumulator << 6) | alphabet.indexOf(char);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        encoded += "%" + ((accumulator >>> bits) & 255).toString(16).padStart(2, "0");
      }
    }
    return userOwner(JSON.parse(decodeURIComponent(encoded)).sub);
  } catch {
    return null; // Signed in without a usable identity: fail closed until /auth/me resolves.
  }
}

function publish(owner: string | null): void {
  current = Object.freeze({ owner, epoch: current.epoch + 1 });
  for (const listener of listeners) listener();
}

export function captureAccountScope(): AccountScope { return current; }
export function isCurrentAccountScope(scope: AccountScope): boolean { return scope === current; }
export function subscribeAccountScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called synchronously by the API token setter, before any React token effect can run. */
export function setAccountToken(token: string | null): void {
  if (sessionToken === token) return;
  sessionToken = token;
  publish(token === null ? "guest" : tokenOwner(token));
}

/** A guarded /auth/me response can supply identity for opaque/older tokens. */
export function bindAccountUser(id: unknown, expected: AccountScope): void {
  if (sessionToken === null || !isCurrentAccountScope(expected)) return;
  const owner = userOwner(id);
  if (owner && owner !== current.owner) publish(owner);
}
