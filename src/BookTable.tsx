import { useEffect, useRef, useState } from "react";
import { borrowBook, fetchBook, fetchBooks } from "./api";
import type { Book } from "./api";

// The catalogue: one row per book, with a single loading or error row while the
// gateway has nothing to show, and a Borrow action per available book.
export default function BookTable(): JSX.Element {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [bookDetail, setBookDetail] = useState<Book | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // A selection made while an earlier detail read is still in flight must win,
  // so only the newest request is allowed to write the detail state.
  const detailRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    fetchBooks()
      .then((catalogue) => {
        if (!cancelled) {
          setBooks(catalogue);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "catalogue unavailable",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const bookRows = books ?? [];

  // The catalogue is the source of truth: after a successful loan the list is
  // re-fetched so the row shows the availability the gateway now reports.
  async function handleBorrow(bookId: number): Promise<void> {
    setBorrowingId(bookId);
    setBorrowError(null);

    try {
      await borrowBook(bookId);
      const catalogue = await fetchBooks();
      setBooks(catalogue);
    } catch (reason: unknown) {
      setBorrowError(
        reason instanceof Error ? reason.message : "borrow unavailable",
      );
    } finally {
      setBorrowingId(null);
    }
  }

  // Selecting a row reads that one book through the gateway's detail route, so
  // the detail area below the table always shows what the service reports.
  async function handleSelect(bookId: number): Promise<void> {
    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;

    setSelectedBookId(bookId);
    setBookDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const book = await fetchBook(bookId);
      if (detailRequestId.current === requestId) {
        setBookDetail(book);
      }
    } catch (reason: unknown) {
      if (detailRequestId.current === requestId) {
        setDetailError(
          reason instanceof Error ? reason.message : "book unavailable",
        );
      }
    } finally {
      if (detailRequestId.current === requestId) {
        setDetailLoading(false);
      }
    }
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Title</th>
            <th>Author</th>
            <th>Available</th>
            <th>Borrow</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr className="loading-row">
              <td colSpan={5}>Loading catalogue…</td>
            </tr>
          ) : null}
          {!loading && error !== null ? (
            <tr className="error-row">
              <td colSpan={5}>{error}</td>
            </tr>
          ) : null}
          {!loading && error === null && bookRows.length === 0 ? (
            <tr>
              <td colSpan={5}>No books in the catalogue.</td>
            </tr>
          ) : null}
          {borrowError !== null ? (
            <tr className="error-row">
              <td colSpan={5} className="borrow-error">
                {borrowError}
              </td>
            </tr>
          ) : null}
          {!loading && error === null
            ? bookRows.map((book) => (
                <tr
                  key={book.id}
                  className={
                    book.id === selectedBookId ? "book-row selected" : "book-row"
                  }
                >
                  <td>{book.id}</td>
                  <td>
                    <button
                      type="button"
                      className="book-select"
                      onClick={() => handleSelect(book.id)}
                    >
                      {book.title}
                    </button>
                  </td>
                  <td>{book.author}</td>
                  <td>{book.available ? "Yes" : "No"}</td>
                  <td>
                    {book.available ? (
                      <button
                        type="button"
                        className="borrow-button"
                        disabled={borrowingId === book.id}
                        onClick={() => handleBorrow(book.id)}
                      >
                        Borrow
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>
      {selectedBookId !== null ? (
        <section className="book-detail" aria-live="polite">
          {detailLoading ? (
            <p className="book-detail-status">Loading book {selectedBookId}…</p>
          ) : null}
          {!detailLoading && detailError !== null ? (
            <p className="book-detail-error">{detailError}</p>
          ) : null}
          {!detailLoading && detailError === null && bookDetail !== null ? (
            <>
              <h2>Book {bookDetail.id}</h2>
              <dl>
                <dt>Title</dt>
                <dd>{bookDetail.title}</dd>
                <dt>Author</dt>
                <dd>{bookDetail.author}</dd>
                <dt>Available</dt>
                <dd>{bookDetail.available ? "Yes" : "No"}</dd>
              </dl>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
