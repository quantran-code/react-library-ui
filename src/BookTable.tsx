import { Fragment, useEffect, useRef, useState } from "react";
import {
  borrowBook,
  downloadCsv,
  exportBooksCsv,
  exportBooksToS3,
  failureText,
  fetchBook,
  fetchImportJob,
  importBooks,
  importBooksFromS3,
  ImportError,
  submitImportJob,
  uploadFileToS3,
} from "./api";
import type {
  Book,
  BookPage,
  ImportJob,
  ImportRowError,
  StoredExport,
  StoredFile,
} from "./api";
import {
  IMPORT_JOB_POLL_MS,
  isTerminalStatus,
  jobMoreNote,
  jobProgressLabel,
  jobSummaryLabel,
} from "./importJob";
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
  // The asynchronous import job the page is tracking: the id the 202 answered
  // with, and the last status body read for it. The status body only ever comes
  // from a poll answer, so the labels below always describe the service.
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  // What a refused job submit (or a refused status read) answered, rendered
  // through failureText so a service with no queue reads "queue unavailable".
  const [jobSubmitError, setJobSubmitError] = useState<string | null>(null);
  // The same double-click guard as the other controls, and the job whose
  // completion was already handed to the page, so the catalogue is read again
  // once per job rather than once per render.
  const startJobInFlight = useRef(false);
  const refreshedJobId = useRef<string | null>(null);
  // The object the same file was uploaded to: the key the service minted and
  // the presigned link to it, which is the only way its bytes are reachable.
  const [uploadedFile, setUploadedFile] = useState<StoredFile | null>(null);
  const [uploadingS3, setUploadingS3] = useState(false);
  // The API's wording for a refused upload, shown beside the controls.
  const [s3UploadError, setS3UploadError] = useState<string | null>(null);
  // The key the Import from S3 control sends, prefilled from an upload so the
  // librarian can import the file they just stored without retyping it.
  const [s3Key, setS3Key] = useState("");
  const [importingS3, setImportingS3] = useState(false);
  // What importing a stored key answered: the counts, or the API's own refusal
  // with the rows it could not take, in the same lists the import uses.
  const [s3ImportMessage, setS3ImportMessage] = useState<string | null>(null);
  const [s3ImportError, setS3ImportError] = useState<string | null>(null);
  const [s3ImportRowErrors, setS3ImportRowErrors] = useState<ImportRowError[]>(
    [],
  );
  // The catalogue export stored in the bucket: its key, presigned link and the
  // moment that link stops working.
  const [booksS3Export, setBooksS3Export] = useState<StoredExport | null>(null);
  const [exportingBooksS3, setExportingBooksS3] = useState(false);
  const [booksS3ExportError, setBooksS3ExportError] = useState<string | null>(
    null,
  );
  // The same double-click guards as the other controls, one per S3 control.
  const uploadS3InFlight = useRef(false);
  const importS3InFlight = useRef(false);
  const exportBooksS3InFlight = useRef(false);

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

  // An accepted job is read once a second until it is completed or failed. The
  // chain re-arms with a timeout after each answer rather than with an interval,
  // so a slow status read cannot pile requests up; the timer is cleared when the
  // page unmounts or a newer job id replaces this one, and nothing is scheduled
  // once the status is terminal. A completed job asks the page to read the
  // catalogue again exactly once, which is what shows the imported books.
  useEffect(() => {
    if (jobId === null) {
      return;
    }
    // The poll chain closes over the id as a plain string, so every answer is
    // read for the job this effect was started for.
    const trackedJobId: string = jobId;

    let cancelled = false;
    let timer: number | undefined;

    async function poll(): Promise<void> {
      try {
        const answered = await fetchImportJob(trackedJobId);
        if (cancelled) {
          return;
        }
        setJob(answered);
        if (isTerminalStatus(answered.status)) {
          if (
            answered.status === "completed" &&
            refreshedJobId.current !== answered.jobId
          ) {
            refreshedJobId.current = answered.jobId;
            props.onImported();
          }
          return;
        }
      } catch (reason: unknown) {
        if (cancelled) {
          return;
        }
        setJobSubmitError(failureText(reason, "import job unavailable"));
        return;
      }

      timer = window.setTimeout(() => {
        void poll();
      }, IMPORT_JOB_POLL_MS);
    }

    timer = window.setTimeout(() => {
      void poll();
    }, IMPORT_JOB_POLL_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [jobId, props.onImported]);

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

  // Starting a job sends the same chosen file as the synchronous import does,
  // but the service answers 202 with the job it queued instead of storing the
  // rows on this request; the poll above then follows it to the end. A refusal
  // shows the API's own wording (a service with no queue says "queue
  // unavailable") and leaves the table, pager and detail exactly as they were.
  async function handleStartJob(): Promise<void> {
    if (importFile === null || startJobInFlight.current) {
      return;
    }
    startJobInFlight.current = true;
    setStartingJob(true);
    setJobSubmitError(null);
    setJobId(null);
    setJob(null);

    try {
      const accepted = await submitImportJob(importFile);
      setJobId(accepted.jobId);
    } catch (reason: unknown) {
      setJobSubmitError(failureText(reason, "import job failed"));
    } finally {
      startJobInFlight.current = false;
      setStartingJob(false);
    }
  }

  // Uploading the chosen file to the private bucket: the service mints the key
  // and answers with a presigned GET for it, so the key is shown here and
  // prefilled into the Import from S3 box, and the link is the only way the
  // bytes are reachable — this page never touches a credential.
  async function handleUploadToS3(): Promise<void> {
    if (importFile === null || uploadS3InFlight.current) {
      return;
    }
    uploadS3InFlight.current = true;
    setUploadingS3(true);
    setS3UploadError(null);
    setUploadedFile(null);

    try {
      const stored = await uploadFileToS3(importFile);
      setUploadedFile(stored);
      setS3Key(stored.key);
    } catch (reason: unknown) {
      setS3UploadError(failureText(reason, "upload to S3 failed"));
    } finally {
      uploadS3InFlight.current = false;
      setUploadingS3(false);
    }
  }

  // Importing a stored key asks the service to fetch that object itself and
  // apply the same CSV rules the synchronous import applies, so a refusal can
  // still list the rows it could not take. A success hands the catalogue back
  // to the page through onImported, exactly as a synchronous import does.
  async function handleImportFromS3(): Promise<void> {
    const key = s3Key.trim();
    if (key === "" || importS3InFlight.current) {
      return;
    }
    importS3InFlight.current = true;
    setImportingS3(true);
    setS3ImportMessage(null);
    setS3ImportError(null);
    setS3ImportRowErrors([]);

    try {
      const result = await importBooksFromS3(key);
      setS3ImportMessage(
        `Imported ${result.imported} books, skipped ${result.skipped}`,
      );
      props.onImported();
    } catch (reason: unknown) {
      setS3ImportError(failureText(reason, "import from S3 failed"));
      setS3ImportRowErrors(reason instanceof ImportError ? reason.rows : []);
    } finally {
      importS3InFlight.current = false;
      setImportingS3(false);
    }
  }

  // Exporting to the bucket stores the same CSV GET /books/export answers with
  // under a key the service minted, so the answer is only the key and a
  // presigned GET for it; a refusal starts nothing and leaves the rows alone.
  async function handleExportBooksToS3(): Promise<void> {
    if (exportBooksS3InFlight.current) {
      return;
    }
    exportBooksS3InFlight.current = true;
    setExportingBooksS3(true);
    setBooksS3ExportError(null);
    setBooksS3Export(null);

    try {
      setBooksS3Export(await exportBooksToS3());
    } catch (reason: unknown) {
      setBooksS3ExportError(failureText(reason, "books export to S3 failed"));
    } finally {
      exportBooksS3InFlight.current = false;
      setExportingBooksS3(false);
    }
  }

  // A job the page is tracking keeps its button disabled until it settles; the
  // window between the 202 and the first status answer counts as queued.
  const jobRunning =
    jobId !== null && (job === null || !isTerminalStatus(job.status));
  // The status line: the accepted job before its first answer, then what the
  // status route last reported, with the progress rising as batches complete.
  const jobStatusLine =
    job !== null
      ? `Job ${job.jobId}: ${job.status} — ${jobProgressLabel(job)}, ${jobSummaryLabel(job)}`
      : jobId !== null
        ? `Job ${jobId}: queued`
        : null;
  const jobMore = job === null ? null : jobMoreNote(job);
  const jobFailureText =
    job !== null && job.status === "failed"
      ? (job.error ?? "Import job failed")
      : null;

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
        <button
          type="button"
          className="catalogue-s3-upload-button"
          disabled={importFile === null || uploadingS3}
          onClick={handleUploadToS3}
        >
          Upload CSV to S3
        </button>
        <button
          type="button"
          className="catalogue-job-button"
          disabled={importFile === null || startingJob || jobRunning}
          onClick={handleStartJob}
        >
          Start import job
        </button>
      </div>
      {uploadedFile !== null ? (
        <p className="catalogue-s3-key">
          Stored {uploadedFile.key}
          {" — "}
          <a
            className="catalogue-s3-link"
            href={uploadedFile.url}
            target="_blank"
            rel="noreferrer"
          >
            Open uploaded file
          </a>
          {" — "}
          <span className="catalogue-s3-expiry">
            link expires {uploadedFile.expiresAt}
          </span>
        </p>
      ) : null}
      {s3UploadError !== null ? (
        <p className="catalogue-tools-error">{s3UploadError}</p>
      ) : null}
      <div className="catalogue-tools">
        <label htmlFor="catalogue-s3-key">Object key</label>
        <input
          id="catalogue-s3-key"
          type="text"
          value={s3Key}
          placeholder="uploads/…"
          onChange={(event) => setS3Key(event.target.value)}
        />
        <button
          type="button"
          className="catalogue-s3-button"
          disabled={s3Key.trim() === "" || importingS3}
          onClick={handleImportFromS3}
        >
          Import from S3
        </button>
        <button
          type="button"
          className="catalogue-s3-button"
          disabled={exportingBooksS3}
          onClick={handleExportBooksToS3}
        >
          Export books to S3
        </button>
      </div>
      {booksS3Export !== null ? (
        <p className="catalogue-s3-key">
          Stored {booksS3Export.key}
          {" — "}
          <a
            className="catalogue-s3-link"
            href={booksS3Export.url}
            target="_blank"
            rel="noreferrer"
          >
            Open exported books
          </a>
          {" — "}
          <span className="catalogue-s3-expiry">
            link expires {booksS3Export.expiresAt}
          </span>
        </p>
      ) : null}
      {booksS3ExportError !== null ? (
        <p className="catalogue-tools-error">{booksS3ExportError}</p>
      ) : null}
      {s3ImportMessage !== null ? (
        <p className="catalogue-tools-status">{s3ImportMessage}</p>
      ) : null}
      {s3ImportError !== null ? (
        <p className="catalogue-tools-error">{s3ImportError}</p>
      ) : null}
      {s3ImportRowErrors.length > 0 ? (
        <ul className="catalogue-tools-rows">
          {s3ImportRowErrors.slice(0, 20).map((row) => (
            <li key={`${row.line}:${row.error}`}>
              line {row.line}: {row.error}
            </li>
          ))}
        </ul>
      ) : null}
      {jobStatusLine !== null ? (
        <p className="catalogue-job-status">{jobStatusLine}</p>
      ) : null}
      {jobFailureText !== null ? (
        <p className="catalogue-job-error">{jobFailureText}</p>
      ) : null}
      {jobSubmitError !== null ? (
        <p className="catalogue-job-error">{jobSubmitError}</p>
      ) : null}
      {job !== null && job.errors.length > 0 ? (
        <ul className="catalogue-job-rows">
          {job.errors.slice(0, 20).map((row) => (
            <li key={`${row.line}:${row.error}`}>
              line {row.line}: {row.error}
            </li>
          ))}
        </ul>
      ) : null}
      {jobMore !== null ? (
        <p className="catalogue-job-status">{jobMore}</p>
      ) : null}
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
