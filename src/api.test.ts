import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BorrowError,
  LendingError,
  borrowBook,
  fetchBook,
  fetchBooks,
  fetchLoan,
  fetchLoans,
  returnLoan,
} from "./api";

// The API module is the one place the UI builds URLs; these tests pin the paths
// the gateway expects without needing a browser or a running service.
afterEach(() => {
  vi.unstubAllGlobals();
});

// Collects the BorrowError a refused borrow throws, failing the test if the
// call did not reject at all.
async function borrowFailure(bookId: number): Promise<BorrowError> {
  try {
    await borrowBook(bookId);
  } catch (reason: unknown) {
    if (reason instanceof BorrowError) {
      return reason;
    }
    throw reason;
  }
  throw new Error(`borrowBook(${bookId}) did not fail`);
}

// Collects the LendingError a refused return throws, failing the test if the
// call did not reject at all.
async function returnFailure(loanId: number): Promise<LendingError> {
  try {
    await returnLoan(loanId);
  } catch (reason: unknown) {
    if (reason instanceof LendingError) {
      return reason;
    }
    throw reason;
  }
  throw new Error(`returnLoan(${loanId}) did not fail`);
}

describe("catalogue API", () => {
  it("reads the catalogue from /api/books", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, title: "Dune", author: "Herbert", available: true }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const books = await fetchBooks();

    expect(fetchMock).toHaveBeenCalledWith("/api/books");
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Dune");
  });


  it("reads one book from /api/books/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, title: "Dune", author: "Herbert", available: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const book = await fetchBook(3);

    expect(fetchMock).toHaveBeenCalledWith("/api/books/3");
    expect(book.id).toBe(3);
    expect(book.title).toBe("Dune");
    expect(book.author).toBe("Herbert");
    expect(book.available).toBe(true);
  });

  it("surfaces a missing book with the status it answered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchBook(3)).rejects.toThrow(/404/);
  });

  it("borrowBook posts the book id to /api/loans", async () => {
    const loan = {
      id: 1,
      bookId: 1,
      borrowedAt: "2024-05-01T10:00:00Z",
      dueAt: "2024-05-15T10:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => loan,
    });
    vi.stubGlobal("fetch", fetchMock);

    const borrowed = await borrowBook(1);

    expect(fetchMock).toHaveBeenCalledWith("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: 1 }),
    });
    expect(borrowed.id).toBe(1);
    expect(borrowed.bookId).toBe(1);
    expect(borrowed.borrowedAt).toBe("2024-05-01T10:00:00Z");
    expect(borrowed.dueAt).toBe("2024-05-15T10:00:00Z");
  });

  it("borrowBook surfaces the API's message and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "book already on loan" }),
      }),
    );

    const conflict = await borrowFailure(1);

    expect(conflict.message).toBe("book already on loan");
    expect(conflict.status).toBe(409);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "book not found" }),
      }),
    );

    const missing = await borrowFailure(9999);

    expect(missing.message).toBe("book not found");
    expect(missing.status).toBe(404);
  });

  it("borrowBook falls back to a status message for a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    );

    const failure = await borrowFailure(1);

    expect(failure.message).toMatch(/502/);
    expect(failure.status).toBe(502);
  });

  it("reads every loan from /api/loans", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 2,
          bookId: 2,
          borrowedAt: "2024-05-02T10:00:00Z",
          dueAt: "2024-05-16T10:00:00Z",
        },
        {
          id: 1,
          bookId: 1,
          borrowedAt: "2024-05-01T10:00:00Z",
          dueAt: "2024-05-15T10:00:00Z",
          returnedAt: "2024-05-10T09:30:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const loans = await fetchLoans();

    expect(fetchMock).toHaveBeenCalledWith("/api/loans");
    expect(loans).toHaveLength(2);
    expect(loans[0].returnedAt).toBeUndefined();
    expect(loans[1].returnedAt).toBe("2024-05-10T09:30:00Z");
  });

  it("reads one loan from /api/loans/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 3,
        bookId: 1,
        borrowedAt: "2024-05-01T10:00:00Z",
        dueAt: "2024-05-15T10:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const loan = await fetchLoan(3);

    expect(fetchMock).toHaveBeenCalledWith("/api/loans/3");
    expect(loan.id).toBe(3);
    expect(loan.bookId).toBe(1);
  });

  it("returnLoan posts to /api/loans/:id/return", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 3,
        bookId: 1,
        borrowedAt: "2024-05-01T10:00:00Z",
        dueAt: "2024-05-15T10:00:00Z",
        returnedAt: "2024-05-10T09:30:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const returned = await returnLoan(3);

    expect(fetchMock).toHaveBeenCalledWith("/api/loans/3/return", {
      method: "POST",
    });
    expect(returned.id).toBe(3);
    expect(returned.returnedAt).toBe("2024-05-10T09:30:00Z");
  });

  it("returnLoan surfaces the API's message and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "loan already returned" }),
      }),
    );

    const conflict = await returnFailure(3);

    expect(conflict.message).toBe("loan already returned");
    expect(conflict.status).toBe(409);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid loan id" }),
      }),
    );

    const invalid = await returnFailure(0);

    expect(invalid.message).toBe("invalid loan id");
    expect(invalid.status).toBe(400);
  });

  it("returnLoan falls back to a status message for a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    );

    const failure = await returnFailure(3);

    expect(failure.message).toMatch(/502/);
    expect(failure.status).toBe(502);
  });
});
