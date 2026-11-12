import { Fragment, useEffect, useRef, useState } from "react";
import {
  borrowBook,
  downloadCsv,
  exportBooksCsv,
  failureText,
  fetchBook,
  importBooks,
  ImportError,
} from "./api";
import type { Book, BookPage, ImportRowError } from "./api";
import {
  canGoNext,
  canGoPrevious,
  catalogueEmptyMessage,
  pageLabel,
} from "./paging";

// What the catalogue rows render; App owns the fetch so a return made in the
// loan table can flip the same book's shelf state here. The whole page envelope
// arrives, not just its rows, because the pager is derived from its total and
// must keep describing the rows actually on screen.
type BookTableProps = {
  catalogue: BookPage | null;
  // The search the rows on screen answer, and what the search box shows while
  // it is being typed.
  query: string;
  searchValue: string;
  loading: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onAvailabilityChange: (bookId: number, available: boolean) => void;
  // Called after an import was accepted, so the page can empty the search, go
  // back to page 1 and read the catalogue again for the books just added.
  onImported: () => void;
};

// The catalogue: one row per book on the current page, with a single loading or
// error row while the gateway has nothing to show, the search box above it and
// the pager below.
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
  // The file the librarian picked; the Import button stays disabled until one is
  // chosen, and one click sends that one file as the request's only file part.
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  // What the import answered: the counts on success, the API's own refusal
  // otherwise, shown beside the controls so the table keeps its rows.
  const [importMessage, setImportMessage] = useState<string | null>(null);
  // One entry per record the service refused, each carrying the 1-based line the
  // record starts on; the service caps the list it sends at 20 entries.
  const [importRowErrors, setImportRowErrors] = useState<ImportRowError[]>([]);
  const [exportingBooks, setExportingBooks] = useState(false);
  // The API's wording for a refused books export, which starts no download.
  const [booksExportError, setBooksExportError] = useState<string | null>(null);
  // The same double-click guards as the borrow button, one per control.
  const importInFlight = useRef(false);
  const exportBooksInFlight = useRef(false);

  const catalogue = props.catalogue;
  const bookRows = catalogue?.items ?? [];
  const currentPage = catalogue?.page ?? 1;

  // A page or search change makes the selection and every row's borrow error
  // describe rows that are no longer on screen, so both are dropped; the detail
  // request id is bumped so a read still in flight for the old selection cannot
  // repopulate the detail section when it answers.
  useEffect(() => {
    detailRequestId.current += 1;
    setSelectedBookId(null);
    setBookDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setRowErrors({});
  }, [catalogue?.page, props.query]);

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

  // Importing sends the chosen file as the one file part the service takes, then
  // asks the page to read the catalogue again so the new books are listed. A
  // refusal lists the rows it could not take here and leaves the rows on screen,
  // the pager and the detail section exactly as they were.
  async function handleImport(): Promise<void> {
    if (importFile === null || importInFlight.current) {
      return;
    }
    importInFlight.current = true;
    setImporting(true);
    setImportMessage(null);
    setImportRowErrors([]);

    try {
      const result = await importBooks(importFile);
      setImportMessage(
        `Imported ${result.imported} books, skipped ${result.skipped}`,
      );
      props.onImported();
    } catch (reason: unknown) {
      setImportMessage(failureText(reason, "import failed"));
      setImportRowErrors(reason instanceof ImportError ? reason.rows : []);
    } finally {
      importInFlight.current = false;
      setImporting(false);
    }
  }

  // Exporting hands the CSV the service rendered to the browser as it arrived,
  // so nothing here rebuilds it; a refusal shows the API's message and never
  // starts a download, so no empty or partial file can be saved.
  async function handleExportBooks(): Promise<void> {
    if (exportBooksInFlight.current) {
      return;
    }
    exportBooksInFlight.current = true;
    setExportingBooks(true);
    setBooksExportError(null);

    try {
      downloadCsv(await exportBooksCsv());
    } catch (reason: unknown) {
      setBooksExportError(failureText(reason, "books export failed"));
    } finally {
      exportBooksInFlight.current = false;
      setExportingBooks(false);
    }
  }

  // The empty catalogue reads differently from a search that matched nothing, so
  // the wording comes from the query the rows were fetched for. A refusal shows
  // the API's own message instead, never an empty list.
  const emptyMessage =
    props.error === null && !props.loading && catalogue !== null
      ? catalogueEmptyMessage(catalogue.total, props.query)
      : null;

  return (
    <>
      <div className="catalogue-search">
        <label htmlFor="catalogue-search-input">Search the catalogue</label>
        <input
          id="catalogue-search-input"
          type="search"
          value={props.searchValue}
          placeholder="Title or author"
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
      </div>
      <div className="catalogue-tools">
        <label htmlFor="catalogue-import-file">Import CSV</label>
        <input
          id="catalogue-import-file"
          type="file"
          accept=".csv"
          onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="catalogue-import-button"
          disabled={importFile === null || importing}
          onClick={handleImport}
        >
          Import
        </button>
        <button
          type="button"
          className="catalogue-export-button"
          disabled={exportingBooks}
          onClick={handleExportBooks}
        >
          Export books
        </button>
      </div>
      {importMessage !== null ? (
        <p className="catalogue-tools-status">{importMessage}</p>
      ) : null}
      {importRowErrors.length > 0 ? (
        <ul className="catalogue-tools-rows">
          {importRowErrors.slice(0, 20).map((row) => (
            <li key={`${row.line}:${row.error}`}>
              line {row.line}: {row.error}
            </li>
          ))}
        </ul>
      ) : null}
      {booksExportError !== null ? (
        <p className="catalogue-tools-error">{booksExportError}</p>
      ) : null}
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
          {props.loading && bookRows.length === 0 ? (
            <tr className="loading-row">
              <td colSpan={5}>Loading catalogue…</td>
            </tr>
          ) : null}
          {props.error !== null ? (
            <tr className="error-row">
              <td colSpan={5}>{props.error}</td>
            </tr>
          ) : null}
          {emptyMessage !== null ? (
            <tr>
              <td colSpan={5}>{emptyMessage}</td>
            </tr>
          ) : null}
          {bookRows.map((book) => {
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
          })}
        </tbody>
      </table>
      {catalogue !== null && catalogue.total > 0 ? (
        <div className="pager">
          <button
            type="button"
            className="pager-button"
            disabled={props.loading || !canGoPrevious(currentPage)}
            onClick={props.onPrevious}
          >
            Previous
          </button>
          <span className="pager-text">
            {pageLabel(currentPage, catalogue.page_size, catalogue.total)}
          </span>
          <button
            type="button"
            className="pager-button"
            disabled={
              props.loading ||
              !canGoNext(currentPage, catalogue.page_size, catalogue.total)
            }
            onClick={props.onNext}
          >
            Next
          </button>
        </div>
      ) : null}
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
