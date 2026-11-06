// One place for the gateway's address and the shapes the UI reads.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// The header the loans service echoes back, so one click can be traced from the
// browser through the gateway to the loan store.
const REQUEST_ID_HEADER = "X-Request-Id";

// A fresh id per call: it is never reused or memoised, so two clicks are two
// separate traces.
export function newRequestId(): string {
  return crypto.randomUUID();
}

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

// A recorded loan as the loans service sends it, forwarded by the gateway.
// returnedAt is absent (or null) until the loan has been returned.
export type Loan = {
  id: number;
  bookId: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string | null;
};

// The loans themselves: /api/loans is the gateway route, proxied by vite in dev.
// A caller passing an id continues an existing trace instead of starting one.
export async function fetchLoans(requestId?: string): Promise<Loan[]> {
  const response = await fetch(`${BASE_URL}/api/loans`, {
    headers: { [REQUEST_ID_HEADER]: requestId ?? newRequestId() },
  });
  if (!response.ok) {
    throw new Error(`loans answered ${response.status}`);
  }
  return (await response.json()) as Loan[];
}

// Borrowing records the loan, which takes the book out of the catalogue; the
// row's availability is refreshed from the catalogue afterwards.
export async function borrowBook(
  bookId: number,
  requestId?: string,
): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [REQUEST_ID_HEADER]: requestId ?? newRequestId(),
    },
    body: JSON.stringify({ bookId }),
  });
  if (!response.ok) {
    throw new Error(`loan for book ${bookId} answered ${response.status}`);
  }
  return (await response.json()) as Loan;
}

// Returning stamps the loan's returnedAt and puts the book back in the
// catalogue; the return call itself carries no body.
export async function returnLoan(
  id: number,
  requestId?: string,
): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans/${id}/return`, {
    method: "POST",
    headers: { [REQUEST_ID_HEADER]: requestId ?? newRequestId() },
  });
  if (!response.ok) {
    throw new Error(`return of loan ${id} answered ${response.status}`);
  }
  return (await response.json()) as Loan;
}
