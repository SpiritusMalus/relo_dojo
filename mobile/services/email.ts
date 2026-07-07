// Email auth policy. Google-owned mail domains (gmail.com, its googlemail.com alias, google.com,
// googlegroups.com) are blocked for BOTH sign-up and sign-in per the RU restriction, so we reject
// them on the client before submit and also on the backend (defense in depth). Dots and "+tag"
// don't change the domain, so a plain domain check is enough; Google Workspace custom domains are
// indistinguishable from any other domain and are intentionally not blocked.
export const BLOCKED_EMAIL_DOMAINS = ["gmail.com", "googlemail.com", "google.com", "googlegroups.com"];

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

export function isBlockedEmail(email: string): boolean {
  return BLOCKED_EMAIL_DOMAINS.includes(emailDomain(email));
}
