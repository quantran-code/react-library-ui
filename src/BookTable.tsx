import { useEffect, useState } from "react";
import { borrowBook, fetchBooks, fetchLoans, returnLoan } from "./api";
import type { Book, Loan } from "./api";

// The catalogue: one row per book, with a single loading or error row while the
// gateway has nothing to show, and a Borrow or Return action per book. The
// outstanding loans are read from the gateway too, so a book that is already on
// loan still offers Return when the page is loaded afresh.
export default function BookTable(): JSX.Element {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<number | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);

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

    fetchLoans()
      .then((recordedLoans) => {
        if (!cancelled) {
          setLoans(recordedLoans);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setReturnError(
            reason instanceof Error ? reason.message : "loans unavailable",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const bookRows = books ?? [];

  // A book is on loan while the gateway reports a loan for it with no returnedAt.
  function outstandingLoanFor(bookId: number): Loan | undefined {
    return loans.find((loan) => loan.bookId === bookId && !loan.returnedAt);
  }

  // The catalogue is the source of truth: after a successful loan the books and
  // the loans are re-fetched so the row shows the availability the gateway now
  // reports and the loan that can be returned.
  async function handleBorrow(bookId: number): Promise<void> {
    setBorrowingId(bookId);
    setBorrowError(null);

    try {
      await borrowBook(bookId);
      const [catalogue, recordedLoans] = await Promise.all([
        fetchBooks(),
        fetchLoans(),
      ]);
      setBooks(catalogue);
      setLoans(recordedLoans);
    } catch (reason: unknown) {
      setBorrowError(
        reason instanceof Error ? reason.message : "borrow unavailable",
      );
    } finally {
      setBorrowingId(null);
    }
  }

  // Returning puts the book back on the shelf: the catalogue and the loans are
  // both re-fetched so the row shows Available Yes and offers Borrow again.
  async function handleReturn(loanId: number): Promise<void> {
    setReturningId(loanId);
    setReturnError(null);

    try {
      await returnLoan(loanId);
      const [catalogue, recordedLoans] = await Promise.all([
        fetchBooks(),
        fetchLoans(),
      ]);
      setBooks(catalogue);
      setLoans(recordedLoans);
    } catch (reason: unknown) {
      setReturnError(
        reason instanceof Error ? reason.message : "return unavailable",
      );
    } finally {
      setReturningId(null);
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
          <th>Actions</th>
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
        {returnError !== null ? (
          <tr className="error-row">
            <td colSpan={5} className="return-error">
              {returnError}
            </td>
          </tr>
        ) : null}
        {!loading && error === null
          ? bookRows.map((book) => {
              const outstandingLoan = outstandingLoanFor(book.id);

              return (
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
                    {outstandingLoan !== undefined ? (
                      <button
                        type="button"
                        className="return-button"
                        disabled={returningId === outstandingLoan.id}
                        onClick={() => handleReturn(outstandingLoan.id)}
                      >
                        Return
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })
          : null}
      </tbody>
    </table>
  );
}
