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
// left as strings for whoever displays them. The services omit returnedAt on a
// loan that is still out rather than sending null, so it stays optional.
export type Loan = {
  id: number;
  bookId: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string;
};

// The API answers a refused call with its own wording and status, so both
// travel together and a caller can branch on 404 or 409 without parsing text.
export class LendingError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LendingError";
    this.status = status;
  }
}

// A refused borrow keeps its own name on that shape, so a caller that reaches
// for BorrowError still recognises it.
export class BorrowError extends LendingError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "BorrowError";
  }
}

// One place turns a refused answer into a message: the API sends its wording in
// an `error` field, and a body that is not JSON falls back to the status.
async function failureMessage(
  response: Response,
  action: string,
): Promise<string> {
  let message = `${action} answered ${response.status}`;
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
  return message;
}

// Borrowing: POST /api/loans takes the copy off the shelf and records the loan.
export async function borrowBook(bookId: number): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId }),
  });
  if (!response.ok) {
    throw new BorrowError(
      response.status,
      await failureMessage(response, "borrow"),
    );
  }
  return (await response.json()) as Loan;
}

// The loans on record, newest first; the service answers [] when there are none.
export async function fetchLoans(): Promise<Loan[]> {
  const response = await fetch(`${BASE_URL}/api/loans`);
  if (!response.ok) {
    throw new LendingError(
      response.status,
      await failureMessage(response, "loans"),
    );
  }
  return (await response.json()) as Loan[];
}

export async function fetchLoan(id: number): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans/${id}`);
  if (!response.ok) {
    throw new LendingError(
      response.status,
      await failureMessage(response, `loan ${id}`),
    );
  }
  return (await response.json()) as Loan;
}

// Returning: POST /api/loans/{id}/return puts the copy back on the shelf. The
// service reads the id from the path, so the request carries no body.
export async function returnLoan(id: number): Promise<Loan> {
  const response = await fetch(`${BASE_URL}/api/loans/${id}/return`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new LendingError(
      response.status,
      await failureMessage(response, `return ${id}`),
    );
  }
  return (await response.json()) as Loan;
}
