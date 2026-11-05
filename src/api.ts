// One place for the gateway's address and the shapes the UI reads.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type Health = { status: string };

export async function fetchHealth(): Promise<Health> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`health answered ${response.status}`);
  }
  return (await response.json()) as Health;
}
