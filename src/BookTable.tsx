import { useEffect, useState } from "react";
import { borrowBook, fetchBooks } from "./api";
import type { Book } from "./api";

// The catalogue: one row per book, with a single loading or error row while the
// gateway has nothing to show, and a Borrow action per available book.
export default function BookTable(): JSX.Element {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);
  const [borrowError, setBorrowError] = useState<string | null>(null);

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

  return (
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
              <tr key={book.id}>
                <td>{book.id}</td>
                <td>{book.title}</td>
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
  );
}
