const BASE_URL = "https://api.massive.com";
const API_KEY = import.meta.env.VITE_MASSIVE_API_KEY as string | undefined;

export async function fetchPrevDayClose(ticker: string): Promise<number | null> {
  if (!API_KEY) {
    console.error("VITE_MASSIVE_API_KEY is not set");
    return null;
  }
  const url = `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`Massive API ${res.status} for ${ticker}`);
    return null;
  }
  const data = await res.json();
  return data?.results?.[0]?.c ?? null;
}
