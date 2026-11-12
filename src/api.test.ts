import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BorrowError,
  LendingError,
  REQUEST_ID_HEADER,
  borrowBook,
  failureText,
  fetchBook,
  fetchBooks,
  fetchHealth,
  fetchLoan,
  fetchLoans,
  newRequestId,
  returnLoan,
} from "./api";

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

describe("catalogue API", () => {
  it("reads the catalogue from /api/books", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, title: "Dune", author: "Herbert", available: true }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const books = await fetchBooks();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/books");
    expect(sentRequestId(fetchMock)).toMatch(REQUEST_ID_PATTERN);
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
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBooks();
    await fetchBooks();

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
