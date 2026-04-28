export async function fetchPrevDayClose(ticker: string): Promise<number | null> {
  // Route through Vite proxy (/massive-api → https://api.massive.com) — auth header injected server-side
  const url = `/massive-api/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Massive API ${res.status} for ${ticker}`);
    return null;
  }
  const data = await res.json();
  return data?.results?.[0]?.c ?? null;
}
