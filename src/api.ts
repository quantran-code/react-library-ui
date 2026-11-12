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

// A recorded loan as the gateway sends it: the timestamps are RFC 3339 in UTC,
// left as strings for whoever displays them.
export type Loan = {
  id: number;
  bookId: number;
  borrowedAt: string;
  dueAt: string;
};

// The API answers a refused borrow with its own wording and status, so both
// travel together and a caller can branch on 404 or 409 without parsing text.
export class BorrowError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BorrowError";
    this.status = status;
  }
}

// Borrowing: POST /api/loans takes the copy off the shelf and records the loan.
export async function borrowBook(bookId: number): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId }),
  });
  if (!response.ok) {
    let message = `borrow answered ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        message = body.error;
      }
    } catch {
      // A body that is not JSON keeps the status message above.
    }
    throw new BorrowError(response.status, message);
  }
  return (await response.json()) as Loan;
}
