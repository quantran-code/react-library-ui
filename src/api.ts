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

// A catalogue record as the gateway sends it.
export type Book = {
  id: number;
  title: string;
  author: string;
  available: boolean;
};

// The catalogue itself: /api/books is the gateway route, proxied by vite in dev.
export async function fetchBooks(): Promise<Book[]> {
  const response = await fetch(`${BASE_URL}/api/books`);
  if (!response.ok) {
    throw new Error(`books answered ${response.status}`);
  }
  return (await response.json()) as Book[];
}

export async function fetchBook(id: number): Promise<Book> {
  const response = await fetch(`${BASE_URL}/api/books/${id}`);
  if (!response.ok) {
    throw new Error(`book ${id} answered ${response.status}`);
  }
  return (await response.json()) as Book;
}
