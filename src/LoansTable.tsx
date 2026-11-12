import { Fragment, useEffect, useRef, useState } from "react";
import { fetchLoans, returnLoan } from "./api";
import type { Book, Loan } from "./api";

// What the loan rows render; the page holds the catalogue so a title can be
// resolved from the books it already fetched and a return can flip the shelf.
type LoansTableProps = {
  books: Book[];
  onAvailabilityChange: (bookId: number, available: boolean) => void;
};

// An RFC 3339 timestamp as the services send it, shown as a readable date; a
// value the browser cannot parse is shown as it arrived rather than throwing.
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

// The loans on record: one row per loan, with the borrowed and due dates and a
// Return button while the copy is still out.
export default function LoansTable(props: LoansTableProps): JSX.Element {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The ids whose return request is still in flight, so each row's button can be
  // disabled until the gateway answers.
  const [returningIds, setReturningIds] = useState<number[]>([]);
  // The message to show beside a loan whose return the API refused.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // A double click can land before React re-renders the disabled button, so the
  // guard that second click meets is this ref rather than the rendered state.
  const returnInFlight = useRef<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    fetchLoans()
      .then((record) => {
        if (!cancelled) {
          setLoans(record);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "loans unavailable",
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

  const loanRows = loans ?? [];

  // The loans carry only a bookId, so the title comes from the catalogue the
  // page already holds; a loan for a book the catalogue lost still renders.
  function bookTitle(bookId: number): string {
    const book = props.books.find((candidate) => candidate.id === bookId);
    return book === undefined ? `#${bookId}` : book.title;
  }

  // Returning puts the copy back on the shelf through the gateway; the row takes
  // the loan the API answered with, so it gains its return date and loses its
  // button, while the catalogue table reads the same answer through the page.
  async function handleReturn(loanId: number): Promise<void> {
    if (returnInFlight.current.has(loanId)) {
      return;
    }
    returnInFlight.current.add(loanId);
    setReturningIds((ids) => [...ids, loanId]);
    setRowErrors((errors) => {
      const next = { ...errors };
      delete next[loanId];
      return next;
    });

    try {
      const returned = await returnLoan(loanId);
      setLoans((current) =>
        current === null
          ? current
          : current.map((loan) => (loan.id === loanId ? returned : loan)),
      );
      props.onAvailabilityChange(returned.bookId, true);
    } catch (reason: unknown) {
      setRowErrors((errors) => ({
        ...errors,
        [loanId]: reason instanceof Error ? reason.message : "return failed",
      }));
    } finally {
      returnInFlight.current.delete(loanId);
      setReturningIds((ids) => ids.filter((id) => id !== loanId));
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Book</th>
          <th>Borrowed</th>
          <th>Due</th>
          <th>Returned</th>
          <th>Return</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr className="loading-row">
            <td colSpan={5}>Loading loans…</td>
          </tr>
        ) : null}
        {!loading && error !== null ? (
          <tr className="error-row">
            <td colSpan={5}>{error}</td>
          </tr>
        ) : null}
        {!loading && error === null && loanRows.length === 0 ? (
          <tr>
            <td colSpan={5}>No loans on record.</td>
          </tr>
        ) : null}
        {!loading && error === null
          ? loanRows.map((loan) => {
              const rowError: string | undefined = rowErrors[loan.id];
              return (
                <Fragment key={loan.id}>
                  <tr className="loan-row">
                    <td>{bookTitle(loan.bookId)}</td>
                    <td>{formatDate(loan.borrowedAt)}</td>
                    <td>{formatDate(loan.dueAt)}</td>
                    <td>
                      {loan.returnedAt === undefined ? null : (
                        <span className="loan-returned-date">
                          {formatDate(loan.returnedAt)}
                        </span>
                      )}
                    </td>
                    <td>
                      {loan.returnedAt === undefined ? (
                        <button
                          type="button"
                          className="loan-return-button"
                          disabled={returningIds.includes(loan.id)}
                          onClick={() => handleReturn(loan.id)}
                        >
                          Return
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {rowError !== undefined ? (
                    <tr className="loan-row-error">
                      <td colSpan={5}>{rowError}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          : null}
      </tbody>
    </table>
  );
}
