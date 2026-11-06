import { afterEach, describe, expect, it, vi } from "vitest";
import { borrowBook, fetchBooks, fetchLoans, returnLoan } from "./api";

// The API module is the one place the UI builds URLs; these tests pin the paths
// the gateway expects without needing a browser or a running service.
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("borrows through POST /api/loans with the book id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, bookId: 3, borrowedAt: "now", dueAt: "later" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const loan = await borrowBook(3);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/loans",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ bookId: 3 }) }),
    );
    expect(loan.bookId).toBe(3);
  });

  it("surfaces a failed request as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    await expect(borrowBook(3)).rejects.toThrow(/409/);
  });
});

describe("loans API", () => {
  it("reads loans from /api/loans", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, bookId: 3, borrowedAt: "now", dueAt: "later" },
        { id: 2, bookId: 4, borrowedAt: "now", dueAt: "later", returnedAt: "then" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const loans = await fetchLoans();

    expect(fetchMock).toHaveBeenCalledWith("/api/loans");
    expect(loans).toHaveLength(2);
    // An outstanding loan carries no returnedAt; a returned one carries its timestamp.
    expect(loans[0].returnedAt).toBeUndefined();
    expect(loans[1].returnedAt).toBe("then");
  });

  it("returns a loan through POST /api/loans/:id/return", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 3,
        bookId: 1,
        borrowedAt: "now",
        dueAt: "later",
        returnedAt: "now",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const loan = await returnLoan(3);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/loans/3/return",
      expect.objectContaining({ method: "POST" }),
    );
    // The return call carries no request body.
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
    expect(loan.returnedAt).toBe("now");
  });

  it("surfaces a failed return as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    await expect(returnLoan(3)).rejects.toThrow(/409/);
  });
});
