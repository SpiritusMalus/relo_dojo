// API client for the Grammar Dojo backend.
//
// IMPORTANT: the phone reaches the MacBook over the LAN, so this must be the MacBook's
// local IP (NOT "localhost"/"127.0.0.1" — those resolve to the phone itself).
// Both devices must be on the same Wi-Fi. Update if the MacBook's IP changes.
export const BASE_URL = "http://10.239.241.128:8000";

export async function postChat(message: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    // Backend returns {detail: "..."} for errors (e.g. 503 when Ollama is down).
    let detail = `Backend error ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as { reply: string };
  return data.reply;
}
