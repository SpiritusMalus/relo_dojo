// Mock the api module so this stays a pure unit (no expo-constants / BASE_URL resolution chain).
jest.mock("../api", () => ({ BASE_URL: "https://api.example" }));

import { buildCheckoutUrl } from "../billing";

describe("buildCheckoutUrl", () => {
  it("carries token + api + lang in the URL fragment, never the query string", () => {
    const url = buildCheckoutUrl("jwt-123", "ru", "https://relodojo.app/checkout", "https://api.relodojo.app");
    const [base, frag] = url.split("#");
    expect(base).toBe("https://relodojo.app/checkout"); // no query string — secrets stay out of logs
    expect(base).not.toContain("token");
    expect(frag).toContain("token=jwt-123");
    expect(frag).toContain("lang=ru");
    expect(frag).toContain("api=https%3A%2F%2Fapi.relodojo.app");
  });

  it("omits the token when anonymous", () => {
    const url = buildCheckoutUrl(null, "en", "https://relodojo.app/checkout", "https://api");
    expect(url).not.toContain("token=");
    expect(url).toBe("https://relodojo.app/checkout#api=https%3A%2F%2Fapi&lang=en");
  });

  it("url-encodes special characters in the token", () => {
    const url = buildCheckoutUrl("a b/c", "en", "https://x", "https://api");
    expect(url).toContain("token=a%20b%2Fc");
  });

  it("defaults base/api from the module (CHECKOUT_URL empty by default → off)", () => {
    // With no EXPO_PUBLIC_CHECKOUT_URL the base is "", so billing is disabled and the screen keeps
    // its "coming soon" CTA; buildCheckoutUrl still composes a fragment off the mocked BASE_URL.
    const url = buildCheckoutUrl("t", "en");
    expect(url.startsWith("#")).toBe(true);
    expect(url).toContain("api=https%3A%2F%2Fapi.example");
  });
});
