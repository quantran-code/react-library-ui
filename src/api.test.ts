import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BorrowError,
  ImportError,
  LendingError,
  REQUEST_ID_HEADER,
  borrowBook,
  downloadCsv,
  exportBooksCsv,
  exportLoansCsv,
  failureText,
  fetchBook,
  fetchBooks,
  fetchHealth,
  fetchLoan,
  fetchLoans,
  filenameFromDisposition,
  importBooks,
  newRequestId,
  returnLoan,
} from "./api";
import type { CsvDownload } from "./api";

// The API module is the one place the UI builds URLs; these tests pin the paths
// the gateway expects and the request id every call carries, without needing a
// browser or a running service.
afterEach(() => {
  vi.unstubAllGlobals();
});

// A minted id is 16 random bytes as 32 lowercase hex characters.
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;

// A 32-hex id standing in for the one the gateway echoes back.
const ANSWERED_ID = "9f2c4a1e8b7d4c3fa1b2c3d4e5f60718";

type FetchMock = ReturnType<typeof vi.fn>;

// The options a stubbed fetch was called with; the mock is untyped, so each
// argument is re-narrowed to the shape the API module passes.
function sentInit(
  fetchMock: FetchMock,
  callIndex = 0,
): RequestInit | undefined {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`fetch call ${callIndex} was never made`);
  }
  return call[1];
}

// The X-Request-Id each call sent, in call order.
function sentRequestIds(fetchMock: FetchMock): Array<string | null> {
  return fetchMock.mock.calls.map(
    (_call, callIndex) =>
      new Headers(sentInit(fetchMock, callIndex)?.headers).get(
        REQUEST_ID_HEADER,
      ),
  );
}

function sentRequestId(fetchMock: FetchMock): string | null {
  return sentRequestIds(fetchMock)[0] ?? null;
}

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

// The CSV a file picker could have chosen; the API sends the File itself, so a
// test can hand one in and assert the very same object came back out of the
// multipart body.
function csvFile(name = "books.csv"): File {
  return new File(["title,author,available\r\nDune,Herbert,true\r\n"], name, {
    type: "text/csv",
  });
}

// The multipart body a stubbed fetch was called with, failing the test when the
// call sent anything else.
function sentFormData(fetchMock: FetchMock, callIndex = 0): FormData {
  const body = sentInit(fetchMock, callIndex)?.body;
  if (!(body instanceof FormData)) {
    throw new Error(`fetch call ${callIndex} did not send FormData`);
  }
  return body;
}

// Collects the ImportError a refused import throws, failing the test if the
// call did not reject at all.
async function importFailure(file: File): Promise<ImportError> {
  try {
    await importBooks(file);
  } catch (reason: unknown) {
    if (reason instanceof ImportError) {
      return reason;
    }
    throw reason;
  }
  throw new Error("importBooks did not fail");
}

// Collects the LendingError a refused export throws, failing the test if the
// call did not reject at all.
async function exportFailure(
  exportCall: () => Promise<CsvDownload>,
): Promise<LendingError> {
  try {
    await exportCall();
  } catch (reason: unknown) {
    if (reason instanceof LendingError) {
      return reason;
    }
    throw reason;
  }
  throw new Error("the export did not fail");
}

// The URL a stubbed fetch was called with, parsed so its path and query can be
// asserted separately; the base is only there to make a relative path absolute.
function sentUrl(fetchMock: FetchMock, callIndex = 0): URL {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`fetch call ${callIndex} was never made`);
  }
  return new URL(call[0], "http://library.test");
}

describe("catalogue API", () => {
  it("reads the catalogue from /api/books", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 1, title: "Dune", author: "Herbert", available: true },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalogue = await fetchBooks(1, "");

    const url = sentUrl(fetchMock);
    expect(url.pathname).toBe("/api/books");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("page_size")).toBe("20");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
    expect(catalogue.items).toHaveLength(1);
    expect(catalogue.items[0].title).toBe("Dune");
  });

  it("sends page, page_size and the search term to /api/books", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 2, page_size: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBooks(2, "dune");
    await fetchBooks(1, "");

    const searched = sentUrl(fetchMock);
    expect(searched.pathname).toBe("/api/books");
    expect(searched.searchParams.get("page")).toBe("2");
    expect(searched.searchParams.get("page_size")).toBe("20");
    expect(searched.searchParams.get("q")).toBe("dune");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);

    const unfiltered = sentUrl(fetchMock, 1);
    expect(unfiltered.searchParams.get("page")).toBe("1");
    expect(unfiltered.searchParams.get("page_size")).toBe("20");
    expect(unfiltered.searchParams.has("q")).toBe(false);
  });

  it("sends a search containing spaces and an ampersand verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBooks(1, "go & data");

    expect(sentUrl(fetchMock).searchParams.get("q")).toBe("go & data");
  });

  it("reads the envelope's rows, total, page and page size", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 3, title: "Dune", author: "Herbert", available: false },
        ],
        total: 3,
        page: 2,
        page_size: 20,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalogue = await fetchBooks(2, "dune");

    expect(catalogue.items).toHaveLength(1);
    expect(catalogue.items[0].id).toBe(3);
    expect(catalogue.total).toBe(3);
    expect(catalogue.page).toBe(2);
    expect(catalogue.page_size).toBe(20);
  });

  it("surfaces a bad paging answer as the API's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid paging" }),
      }),
    );

    let failure: LendingError | null = null;
    try {
      await fetchBooks(0, "");
    } catch (reason: unknown) {
      if (reason instanceof LendingError) {
        failure = reason;
      } else {
        throw reason;
      }
    }

    expect(failure?.message).toBe("invalid paging");
    expect(failure?.status).toBe(400);
  });


  it("reads one book from /api/books/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, title: "Dune", author: "Herbert", available: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const book = await fetchBook(3);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/books/3");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
    expect(book.id).toBe(3);
    expect(book.title).toBe("Dune");
    expect(book.author).toBe("Herbert");
    expect(book.available).toBe(true);
  });

  it("surfaces a missing book with the status it answered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchBook(3)).rejects.toThrow(/404/);
  });

  it("reads the gateway health from /health", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const health = await fetchHealth();

    expect(fetchMock.mock.calls[0][0]).toBe("/health");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
    expect(health.status).toBe("ok");
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

    const init = sentInit(fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/loans");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ bookId: 1 }));
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
    expect(borrowed.id).toBe(1);
    expect(borrowed.bookId).toBe(1);
    expect(borrowed.borrowedAt).toBe("2024-05-01T10:00:00Z");
    expect(borrowed.dueAt).toBe("2024-05-15T10:00:00Z");
  });

  it("borrowBook surfaces the API's message and status", async () => {
    const conflictMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "book already on loan" }),
    });
    vi.stubGlobal("fetch", conflictMock);

    const conflict = await borrowFailure(1);

    expect(conflict.message).toBe("book already on loan");
    expect(conflict.status).toBe(409);
    expect(conflict.requestId).toBe(sentRequestId(conflictMock));

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

    expect(fetchMock.mock.calls[0][0]).toBe("/api/loans");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
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

    expect(fetchMock.mock.calls[0][0]).toBe("/api/loans/3");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
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

    expect(fetchMock.mock.calls[0][0]).toBe("/api/loans/3/return");
    expect(sentInit(fetchMock)?.method).toBe("POST");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
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

  describe("importBooks", () => {
    it("posts the CSV to /api/books/import as one file part", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ imported: 2, skipped: 1 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const file = csvFile();
      const result = await importBooks(file);

      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/books/import");
      expect(sentInit(fetchMock)?.method).toBe("POST");
      // The browser writes the multipart Content-Type, boundary and all, so the
      // module must not set one of its own.
      expect(
        new Headers(sentInit(fetchMock)?.headers).has("Content-Type"),
      ).toBe(false);
      expect(sentFormData(fetchMock).get("file")).toBe(file);
      expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
    });

    it("surfaces an invalid import file with its row errors", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid import file",
          rows: [
            { line: 3, error: "author is required" },
            { line: 5, error: "available must be true, false, 1 or 0" },
          ],
          more: false,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const failure = await importFailure(csvFile());

      expect(failure).toBeInstanceOf(LendingError);
      expect(failure.message).toBe("invalid import file");
      expect(failure.status).toBe(400);
      expect(failure.rows).toEqual([
        { line: 3, error: "author is required" },
        { line: 5, error: "available must be true, false, 1 or 0" },
      ]);
      expect(failure.more).toBe(false);
      expect(failure.requestId).toMatch(REQUEST_ID_PATTERN);
      expect(failure.requestId).toBe(sentRequestId(fetchMock));
    });

    it("reads more as false when the body omits the flag", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({
            error: "invalid import file",
            rows: [{ line: 2, error: "title is required" }],
          }),
        }),
      );

      const failure = await importFailure(csvFile());

      expect(failure.rows).toEqual([{ line: 2, error: "title is required" }]);
      expect(failure.more).toBe(false);
    });

    it("keeps more true when the service capped its row list", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({
            error: "invalid import file",
            rows: [{ line: 2, error: "title is required" }],
            more: true,
          }),
        }),
      );

      const failure = await importFailure(csvFile());

      expect(failure.more).toBe(true);
    });

    it("surfaces a 415 and a 413 with the API's own message and no rows", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 415,
          json: async () => ({ error: "unsupported file type" }),
        }),
      );

      const unsupported = await importFailure(csvFile("books.txt"));

      expect(unsupported.message).toBe("unsupported file type");
      expect(unsupported.status).toBe(415);
      expect(unsupported.rows).toEqual([]);
      expect(unsupported.more).toBe(false);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 413,
          json: async () => ({ error: "file too large" }),
        }),
      );

      const tooLarge = await importFailure(csvFile());

      expect(tooLarge.message).toBe("file too large");
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.rows).toEqual([]);
    });
  });

  describe("exportBooksCsv", () => {
    it("downloads the blob from /api/books/export under its header name", async () => {
      const blob = new Blob(["id,title,author,available\r\n"], {
        type: "text/csv; charset=utf-8",
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="catalogue-2024.csv"',
        }),
        blob: async () => blob,
      });
      vi.stubGlobal("fetch", fetchMock);

      const download = await exportBooksCsv();

      expect(fetchMock.mock.calls[0][0]).toBe("/api/books/export");
      expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
      // The very blob the answer carried, never a CSV rebuilt from the rows.
      expect(download.blob).toBe(blob);
      expect(download.filename).toBe("catalogue-2024.csv");
    });

    it("falls back to books.csv when the answer names no file", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "text/csv; charset=utf-8" }),
          blob: async () => new Blob([""], { type: "text/csv; charset=utf-8" }),
        }),
      );

      const download = await exportBooksCsv();

      expect(download.filename).toBe("books.csv");
    });

    it("rejects with the API's message and reads no blob", async () => {
      const blob = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ error: "catalogue unreachable" }),
          blob,
        }),
      );

      const failure = await exportFailure(exportBooksCsv);

      expect(failure.message).toBe("catalogue unreachable");
      expect(failure.status).toBe(502);
      expect(blob).not.toHaveBeenCalled();
    });
  });

  describe("exportLoansCsv", () => {
    it("downloads the blob from /api/loans/export under its header name", async () => {
      const blob = new Blob(["id,bookId,borrowedAt,dueAt,returnedAt\r\n"], {
        type: "text/csv; charset=utf-8",
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="loans.csv"',
        }),
        blob: async () => blob,
      });
      vi.stubGlobal("fetch", fetchMock);

      const download = await exportLoansCsv();

      expect(fetchMock.mock.calls[0][0]).toBe("/api/loans/export");
      expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
      expect(download.blob).toBe(blob);
      expect(download.filename).toBe("loans.csv");
    });

    it("falls back to loans.csv when the header names no file", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "text/csv; charset=utf-8" }),
          blob: async () => new Blob([""], { type: "text/csv; charset=utf-8" }),
        }),
      );

      const download = await exportLoansCsv();

      expect(download.filename).toBe("loans.csv");
    });

    it("rejects with the API's message and reads no blob", async () => {
      const blob = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ error: "loans unreachable" }),
          blob,
        }),
      );

      const failure = await exportFailure(exportLoansCsv);

      expect(failure.message).toBe("loans unreachable");
      expect(failure.status).toBe(502);
      expect(blob).not.toHaveBeenCalled();
    });
  });
});

describe("filenameFromDisposition", () => {
  it("reads a quoted and a bare filename", () => {
    expect(
      filenameFromDisposition('attachment; filename="books.csv"', "fallback"),
    ).toBe("books.csv");
    expect(
      filenameFromDisposition("attachment; filename=loans.csv", "fallback"),
    ).toBe("loans.csv");
  });

  it("falls back when the header names no file", () => {
    expect(filenameFromDisposition(null, "books.csv")).toBe("books.csv");
    expect(filenameFromDisposition("attachment", "loans.csv")).toBe("loans.csv");
    expect(
      filenameFromDisposition('attachment; filename=""', "loans.csv"),
    ).toBe("loans.csv");
  });
});

describe("downloadCsv", () => {
  it("saves the blob it was handed under its filename", () => {
    const blob = new Blob(["id,title,author,available\r\n"], {
      type: "text/csv; charset=utf-8",
    });
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: "", download: "", click, remove };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    const createObjectURL = vi.fn(() => "blob:library-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    downloadCsv({ blob, filename: "books.csv" });

    // The blob is handed to the browser as it arrived, so nothing re-serialises
    // the CSV text on the way out.
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:library-download");
    expect(anchor.download).toBe("books.csv");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:library-download");
  });
});

describe("request ids", () => {
  it("mints a 32-hex id that differs on every call", () => {
    const first = newRequestId();
    const second = newRequestId();

    expect(first).toMatch(REQUEST_ID_PATTERN);
    expect(second).toMatch(REQUEST_ID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("mints a different 32-hex id for each user action", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBooks(1, "");
    await fetchBooks(1, "");

    const [first, second] = sentRequestIds(fetchMock);
    expect(first).toMatch(REQUEST_ID_PATTERN);
    expect(second).toMatch(REQUEST_ID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("sends the id it is given so a retry reuses it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 1,
        bookId: 1,
        borrowedAt: "2024-05-01T10:00:00Z",
        dueAt: "2024-05-15T10:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const retriedId = newRequestId();
    await borrowBook(1, retriedId);

    expect(retriedId).toMatch(REQUEST_ID_PATTERN);
    expect(sentRequestId(fetchMock)).toBe(retriedId);
  });

  it("keeps the id the gateway answered with", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers({ [REQUEST_ID_HEADER]: ANSWERED_ID }),
      json: async () => ({ error: "book already on loan" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const conflict = await borrowFailure(1);

    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
    expect(conflict.requestId).toBe(ANSWERED_ID);
  });

  it("falls back to the id it sent when the answer carries none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "catalogue unreachable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const failure = await returnFailure(3);

    const sentId = sentRequestId(fetchMock);
    expect(sentId).toMatch(REQUEST_ID_PATTERN);
    expect(failure.requestId).toBe(sentId);
  });

  it("shows the full id on a failed action's message", () => {
    expect(
      failureText(
        new LendingError(409, "book already on loan", ANSWERED_ID),
        "borrow failed",
      ),
    ).toBe(`book already on loan (Request ${ANSWERED_ID} failed)`);
  });

  it("leaves a failure without an id as it was", () => {
    expect(failureText(new Error("network down"), "borrow failed")).toBe(
      "network down",
    );
    expect(failureText("not an error", "borrow failed")).toBe("borrow failed");
  });
});
