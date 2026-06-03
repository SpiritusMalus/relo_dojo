// API client for the Grammar Dojo backend.
//
// IMPORTANT: the phone reaches the MacBook over the LAN, so this must be the MacBook's
// local IP (NOT "localhost"/"127.0.0.1" — those resolve to the phone itself).
// Both devices must be on the same Wi-Fi. Update if the MacBook's IP changes.
export const BASE_URL = "http://10.239.241.128:8000";

export async function postEcho(text: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Backend error ${res.status}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}
