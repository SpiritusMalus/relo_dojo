// Web-checkout entry for premium ("Black Belt").
//
// Apple/Google forbid third-party payment for in-app digital goods, so the app never charges in
// app — it hands the buyer to a web checkout page (relodojo.app) carrying their session, and the
// backend flips premium via the provider webhook (YooKassa). See backend services/billing.
//
// OFF until EXPO_PUBLIC_CHECKOUT_URL is set (mirrors the backend's BILLING_ENABLED): the premium
// screen keeps its "coming soon" CTA until then, so shipping this code changes nothing for users.
import { BASE_URL } from "./api";

export const CHECKOUT_URL = process.env.EXPO_PUBLIC_CHECKOUT_URL ?? "";

export function billingEnabled(): boolean {
  return CHECKOUT_URL.length > 0;
}

// Build the checkout-page URL. The token + api base go in the URL FRAGMENT (after `#`): a browser
// never sends the fragment to a server and keeps it out of Referer/access logs, unlike a query
// string. The static page reads them from `location.hash`. Pure + unit-tested.
export function buildCheckoutUrl(
  token: string | null,
  lang: string,
  base: string = CHECKOUT_URL,
  api: string = BASE_URL,
): string {
  const parts = [`api=${encodeURIComponent(api)}`, `lang=${encodeURIComponent(lang)}`];
  if (token) parts.push(`token=${encodeURIComponent(token)}`);
  return `${base}#${parts.join("&")}`;
}
