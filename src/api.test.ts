import { afterEach, describe, expect, it, vi } from "vitest";
import { borrowBook, fetchBooks } from "./api";

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
