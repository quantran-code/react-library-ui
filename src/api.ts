import { DEFAULT_PAGE_SIZE } from "./paging";

// One place for the gateway's address and the shapes the UI reads.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// Every hop of the chain reports the same id, so a failed action can be traced
// from the browser banner to the service that answered it.
export const REQUEST_ID_HEADER = "X-Request-Id";

// One user action mints one id: 16 cryptographically random bytes render as 32
// lowercase hex characters, which is the value every hop echoes back verbatim.
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export type Health = { status: string };

// A catalogue record as the gateway sends it.
export type Book = {
  id: number;
  title: string;
  author: string;
  available: boolean;
};

// One page of the catalogue as the gateway sends it: items holds only the rows
// of this page, while total counts every match before paging, so the UI can
// derive the page count rather than infer it from a short page.
export type BookPage = {
  items: Book[];
  total: number;
  page: number;
  page_size: number;
};

// A recorded loan as the gateway sends it: the timestamps are RFC 3339 in UTC,
// left as strings for whoever displays them. The services omit returnedAt on a
// loan that is still out rather than sending null, so it stays optional.
export type Loan = {
  id: number;
  bookId: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string;
};

// The API answers a refused call with its own wording and status, so both
// travel together and a caller can branch on 404 or 409 without parsing text.
// The request id travels with them too, so every error surface can show the id
// the log lines of that one action are keyed on.
export class LendingError extends Error {
  readonly status: number;
  // The id the entry point reported for the failed request; it is the id the
  // request was sent with when the answer carries no header of its own.
  readonly requestId: string;

  constructor(status: number, message: string, requestId: string) {
    super(message);
    this.name = "LendingError";
    this.status = status;
    this.requestId = requestId;
  }
}

// A refused borrow keeps its own name on that shape, so a caller that reaches
// for BorrowError still recognises it.
export class BorrowError extends LendingError {
  constructor(status: number, message: string, requestId: string) {
    super(status, message, requestId);
    this.name = "BorrowError";
  }
}

// What a successful import answered: the rows that became books and the rows
// that were skipped as duplicates.
export type ImportResult = {
  imported: number;
  skipped: number;
};

// The four states an import job moves through: it is queued until a consumer
// claims its first batch, processing while batches are being written, and then
// completed or failed for good.
export type ImportJobStatus = "queued" | "processing" | "completed" | "failed";

// An asynchronous import job as the status route reports it: the counts rise
// batch by batch, errors aggregates the per-row refusals of the batches written
// so far (capped, with more saying the cap truncated the list), and error
// carries the job-level wording once the job has failed, which is why it is
// optional and absent while the job is still going.
export type ImportJob = {
  jobId: string;
  status: ImportJobStatus;
  totalRows: number;
  processedRows: number;
  imported: number;
  skipped: number;
  batches: number;
  completedBatches: number;
  errors: ImportRowError[];
  more: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

// What a 202 answered with: the job the service queued and the shape of the work
// it accepted, which the page shows and then polls the status route for.
export type ImportJobAccepted = {
  jobId: string;
  status: ImportJobStatus;
  totalRows: number;
  batchSize: number;
  batches: number;
};

// One row the service refused, as an import body reports it: the 1-based line
// the record starts on in the uploaded file, and why that row did not import.
export type ImportRowError = {
  line: number;
  error: string;
};

// A refused import carries the rows it could not take, so the catalogue page
// can list each one beside the controls instead of replacing the table. A
// refusal that is not about rows (415, 413) has no rows and more is false.
export class ImportError extends LendingError {
  readonly rows: ImportRowError[];
  // True when the service capped the list it sent, so the page can say the
  // list of rows is not the whole story.
  readonly more: boolean;

  constructor(
    status: number,
    message: string,
    requestId: string,
    rows: ImportRowError[],
    more: boolean,
  ) {
    super(status, message, requestId);
    this.name = "ImportError";
    this.rows = rows;
    this.more = more;
  }
}

// An export answer: the CSV exactly as the service rendered it, kept as the
// blob that arrived so nothing in the browser re-serialises it, plus the name
// its Content-Disposition asked for.
export type CsvDownload = {
  blob: Blob;
  filename: string;
};

// The name an export is saved under: the one its Content-Disposition carries,
// or the caller's fallback when the header is missing or names no file.
export function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (header === null) {
    return fallback;
  }
  const quoted = /filename="([^"]*)"/i.exec(header);
  if (quoted !== null && quoted[1] !== "") {
    return quoted[1];
  }
  const bare = /filename=(?!")([^;]+)/i.exec(header);
  if (bare !== null && bare[1].trim() !== "") {
    return bare[1].trim();
  }
  return fallback;
}

// One place turns a refused answer into a message: the API sends its wording in
// an `error` field, and a body that is not JSON falls back to the status.
async function failureMessage(
  response: Response,
  action: string,
): Promise<string> {
  let message = `${action} answered ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      message = body.error;
    }
  } catch {
    // A body that is not JSON keeps the status message above.
  }
  return message;
}

// What every error surface renders for a failed action: the API's own wording
// with the full request id appended, so a screenshot is enough to find the
// matching log lines. Anything that is not a LendingError has no id to show.
export function failureText(reason: unknown, fallback: string): string {
  if (reason instanceof LendingError) {
    return `${reason.message} (Request ${reason.requestId} failed)`;
  }
  return reason instanceof Error ? reason.message : fallback;
}

// The io every request takes: it mints an id unless the caller is retrying the
// same action with the id it already used, sends it as X-Request-Id and hands
// the answer back whatever its status, so a caller that needs the failure body
// (the import's per-row reasons) can read it instead of losing it.
async function dispatch(
  path: string,
  action: string,
  init?: RequestInit,
  requestId?: string,
): Promise<Response> {
  const sentId = requestId ?? newRequestId();
  const headers = new Headers(init?.headers);
  headers.set(REQUEST_ID_HEADER, sentId);

  return fetch(path, { ...init, headers });
}

// The single exit every request takes that has nothing to read out of a
// refusal: it sends through dispatch and keeps whatever id came back, so a
// failure can report the id the log lines of that action are keyed on.
async function sendRequest(
  path: string,
  action: string,
  init?: RequestInit,
  requestId?: string,
): Promise<Response> {
  const sentId = requestId ?? newRequestId();
  const response = await dispatch(path, action, init, sentId);
  if (!response.ok) {
    const answeredId = response.headers?.get(REQUEST_ID_HEADER) ?? "";
    throw new LendingError(
      response.status,
      await failureMessage(response, action),
      answeredId === "" ? sentId : answeredId,
    );
  }
  return response;
}

export async function fetchHealth(requestId?: string): Promise<Health> {
  const response = await sendRequest(
    `${BASE_URL}/health`,
    "health",
    undefined,
    requestId,
  );
  return (await response.json()) as Health;
}

// The catalogue itself: /api/books is the gateway route, proxied by vite in dev.
// page and page_size always travel, while q is sent only for a real search so a
// blank box reads the catalogue rather than searching it for nothing.
export async function fetchBooks(
  page: number,
  search: string,
  requestId?: string,
): Promise<BookPage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(DEFAULT_PAGE_SIZE),
  });
  const trimmed = search.trim();
  if (trimmed !== "") {
    params.set("q", trimmed);
  }

  const response = await sendRequest(
    `${BASE_URL}/api/books?${params.toString()}`,
    "books",
    undefined,
    requestId,
  );
  return (await response.json()) as BookPage;
}

export async function fetchBook(
  id: number,
  requestId?: string,
): Promise<Book> {
  const response = await sendRequest(
    `${BASE_URL}/api/books/${id}`,
    `book ${id}`,
    undefined,
    requestId,
  );
  return (await response.json()) as Book;
}

// Borrowing: POST /api/loans takes the copy off the shelf and records the loan.
export async function borrowBook(
  bookId: number,
  requestId?: string,
): Promise<Loan> {
  let response: Response;
  try {
    response = await sendRequest(
      `${BASE_URL}/api/loans`,
      "borrow",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      },
      requestId,
    );
  } catch (reason: unknown) {
    // A refused borrow keeps the shape it has always had, with the id that was
    // sent or echoed on it.
    if (reason instanceof LendingError && !(reason instanceof BorrowError)) {
      throw new BorrowError(reason.status, reason.message, reason.requestId);
    }
    throw reason;
  }
  return (await response.json()) as Loan;
}

// The per-row reasons a refused import listed, ignoring anything shaped
// differently so a body from a hop that carries no rows still reads cleanly.
function importRowErrors(value: unknown): ImportRowError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: unknown[] = value;
  const rows: ImportRowError[] = [];
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "line" in entry &&
      typeof entry.line === "number" &&
      "error" in entry &&
      typeof entry.error === "string"
    ) {
      rows.push({ line: entry.line, error: entry.error });
    }
  }
  return rows;
}

// A refused import is read once, because the error is built from its body: the
// API's wording, the rows it could not take and whether that list was capped.
async function readImportFailure(
  response: Response,
  sentId: string,
): Promise<ImportError> {
  let message = `import answered ${response.status}`;
  let rows: ImportRowError[] = [];
  let more = false;

  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      if ("error" in body && typeof body.error === "string") {
        message = body.error;
      }
      if ("rows" in body) {
        rows = importRowErrors(body.rows);
      }
      if ("more" in body && typeof body.more === "boolean") {
        more = body.more;
      }
    }
  } catch {
    // A body that is not JSON keeps the status message above.
  }

  const answeredId = response.headers?.get(REQUEST_ID_HEADER) ?? "";
  return new ImportError(
    response.status,
    message,
    answeredId === "" ? sentId : answeredId,
    rows,
    more,
  );
}

// Importing the catalogue: POST /api/books/import takes exactly one CSV file
// part. The browser writes the multipart Content-Type and its boundary itself,
// so none is set here, and the id is minted here so a refusal can report it.
export async function importBooks(
  file: File,
  requestId?: string,
): Promise<ImportResult> {
  const sentId = requestId ?? newRequestId();
  const body = new FormData();
  body.append("file", file);

  const response = await dispatch(
    `${BASE_URL}/api/books/import`,
    "import",
    { method: "POST", body },
    sentId,
  );
  if (!response.ok) {
    throw await readImportFailure(response, sentId);
  }
  return (await response.json()) as ImportResult;
}

// Starting an import job: POST /api/books/import-jobs takes the same single CSV
// file part as the synchronous import and answers 202 with the job the service
// queued, instead of storing the rows on this request. The browser writes the
// multipart Content-Type and its boundary itself, so none is set here; a
// refusal (a service with no queue answers 503) throws the LendingError every
// error surface renders, carrying the API's own wording.
export async function submitImportJob(
  file: File,
  requestId?: string,
): Promise<ImportJobAccepted> {
  const body = new FormData();
  body.append("file", file);

  const response = await sendRequest(
    `${BASE_URL}/api/books/import-jobs`,
    "import job",
    { method: "POST", body },
    requestId,
  );
  return (await response.json()) as ImportJobAccepted;
}

// One poll of a job: the status body the catalogue page renders, including the
// rows the batches refused and whether that list was capped. A refusal (an
// unknown or expired job) throws the LendingError, so the poller can stop on a
// status the page can show rather than reading a body that is not a job.
export async function fetchImportJob(
  jobId: string,
  requestId?: string,
): Promise<ImportJob> {
  const response = await sendRequest(
    `${BASE_URL}/api/books/import-jobs/${jobId}`,
    `import job ${jobId}`,
    undefined,
    requestId,
  );
  return (await response.json()) as ImportJob;
}

// The loans on record, newest first; the service answers [] when there are none.
export async function fetchLoans(requestId?: string): Promise<Loan[]> {
  const response = await sendRequest(
    `${BASE_URL}/api/loans`,
    "loans",
    undefined,
    requestId,
  );
  return (await response.json()) as Loan[];
}

export async function fetchLoan(
  id: number,
  requestId?: string,
): Promise<Loan> {
  const response = await sendRequest(
    `${BASE_URL}/api/loans/${id}`,
    `loan ${id}`,
    undefined,
    requestId,
  );
  return (await response.json()) as Loan;
}

// Returning: POST /api/loans/{id}/return puts the copy back on the shelf. The
// service reads the id from the path, so the request carries no body.
export async function returnLoan(
  id: number,
  requestId?: string,
): Promise<Loan> {
  const response = await sendRequest(
    `${BASE_URL}/api/loans/${id}/return`,
    `return ${id}`,
    { method: "POST" },
    requestId,
  );
  return (await response.json()) as Loan;
}

// The names the two exports are saved under when the answer carries no
// Content-Disposition of its own.
const BOOKS_EXPORT_FILENAME = "books.csv";
const LOANS_EXPORT_FILENAME = "loans.csv";

// One export read: the service renders the CSV, so the answer is kept as the
// blob that arrived and only the name to save it under is read here. A refusal
// throws the LendingError every error surface renders, so a failed export can
// never be turned into a download.
async function csvDownload(
  path: string,
  action: string,
  fallbackFilename: string,
  requestId?: string,
): Promise<CsvDownload> {
  const response = await sendRequest(path, action, undefined, requestId);
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(
      response.headers?.get("Content-Disposition") ?? null,
      fallbackFilename,
    ),
  };
}

// The catalogue as a CSV the service rendered; every book, in id order.
export async function exportBooksCsv(
  requestId?: string,
): Promise<CsvDownload> {
  return csvDownload(
    `${BASE_URL}/api/books/export`,
    "books export",
    BOOKS_EXPORT_FILENAME,
    requestId,
  );
}

// The loan records as a CSV the service rendered, newest loan first.
export async function exportLoansCsv(
  requestId?: string,
): Promise<CsvDownload> {
  return csvDownload(
    `${BASE_URL}/api/loans/export`,
    "loans export",
    LOANS_EXPORT_FILENAME,
    requestId,
  );
}

// Saving a download: the blob the service sent is handed straight to the
// browser, so the CSV text is never parsed, rebuilt or re-serialised here.
export function downloadCsv(download: CsvDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
