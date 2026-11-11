import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBook, fetchBooks } from "./api";

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
});
