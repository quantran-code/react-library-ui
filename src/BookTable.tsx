import { Fragment, useRef, useState } from "react";
import { borrowBook, failureText, fetchBook } from "./api";
import type { Book } from "./api";

// What the catalogue rows render; App owns the fetch so a return made in the
// loan table can flip the same book's shelf state here.
type BookTableProps = {
  books: Book[] | null;
  loading: boolean;
  error: string | null;
  onAvailabilityChange: (bookId: number, available: boolean) => void;
};

// The catalogue: one row per book, with a single loading or error row while the
// gateway has nothing to show.
export default function BookTable(props: BookTableProps): JSX.Element {
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [bookDetail, setBookDetail] = useState<Book | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // A selection made while an earlier detail read is still in flight must win,
  // so only the newest request is allowed to write the detail state.
  const detailRequestId = useRef(0);
  // The ids whose borrow request is still in flight, so each row's button can be
  // disabled until the gateway answers.
  const [borrowingIds, setBorrowingIds] = useState<number[]>([]);
  // The message to show beside a row whose borrow the API refused.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // A double click can land before React re-renders the disabled button, so the
  // guard that second click meets is this ref rather than the rendered state.
  const borrowInFlight = useRef<Set<number>>(new Set());

  const bookRows = props.books ?? [];

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
        setDetailError(failureText(reason, "book unavailable"));
      }
    } finally {
      if (detailRequestId.current === requestId) {
        setDetailLoading(false);
      }
    }
  }

  // Borrowing takes the copy off the shelf through the gateway and records the
  // loan; the row flips to unavailable from the answer, with no refetch.
  async function handleBorrow(bookId: number): Promise<void> {
    if (borrowInFlight.current.has(bookId)) {
      return;
    }
    borrowInFlight.current.add(bookId);
    setBorrowingIds((ids) => [...ids, bookId]);
    setRowErrors((errors) => {
      const next = { ...errors };
      delete next[bookId];
      return next;
    });

    try {
      await borrowBook(bookId);
      props.onAvailabilityChange(bookId, false);
      setBookDetail((current) =>
        current !== null && current.id === bookId
          ? { ...current, available: false }
          : current,
      );
    } catch (reason: unknown) {
      setRowErrors((errors) => ({
        ...errors,
        [bookId]: failureText(reason, "borrow failed"),
      }));
    } finally {
      borrowInFlight.current.delete(bookId);
      setBorrowingIds((ids) => ids.filter((id) => id !== bookId));
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
          {props.loading ? (
            <tr className="loading-row">
              <td colSpan={5}>Loading catalogue…</td>
            </tr>
          ) : null}
          {!props.loading && props.error !== null ? (
            <tr className="error-row">
              <td colSpan={5}>{props.error}</td>
            </tr>
          ) : null}
          {!props.loading && props.error === null && bookRows.length === 0 ? (
            <tr>
              <td colSpan={5}>No books in the catalogue.</td>
            </tr>
          ) : null}
          {!props.loading && props.error === null
            ? bookRows.map((book) => {
                const rowError: string | undefined = rowErrors[book.id];
                return (
                  <Fragment key={book.id}>
                    <tr
                      className={
                        book.id === selectedBookId
                          ? "book-row selected"
                          : "book-row"
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
                            disabled={borrowingIds.includes(book.id)}
                            onClick={() => handleBorrow(book.id)}
                          >
                            Borrow
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {rowError !== undefined ? (
                      <tr className="borrow-error-row">
                        <td colSpan={5}>{rowError}</td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
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
