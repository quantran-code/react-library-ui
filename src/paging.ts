// The arithmetic and wording the catalogue pager and its empty states need,
// kept free of React so the boundaries can be checked without a DOM.

// The page_size the gateway's contract defaults to; the UI asks for it openly
// rather than relying on the service's own default staying put.
export const DEFAULT_PAGE_SIZE = 20;

// How long a search box waits after the last keystroke before the page is read
// again, so a typed word costs one request rather than one per key.
export const SEARCH_DEBOUNCE_MS = 300;

// How many pages the whole match set spans; 0 when nothing matches, so a caller
// can tell "no results" from "one short page" and never divides by it.
export function totalPages(total: number, pageSize: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(total / pageSize));
}

// The pager's label, always describing the rows of the page it is given.
export function pageLabel(
  page: number,
  pageSize: number,
  total: number,
): string {
  return `Page ${page} of ${totalPages(total, pageSize)}`;
}

// There is something before the first page only after it.
export function canGoPrevious(page: number): boolean {
  return page > 1;
}

// The last page disables Next even though total is not zero, so a page that
// does not exist cannot be requested by clicking.
export function canGoNext(
  page: number,
  pageSize: number,
  total: number,
): boolean {
  return page < totalPages(total, pageSize);
}

// What an empty table says: a search that matched nothing reads differently
// from a catalogue that has no books in it at all. Rows on screen mean no
// message at all.
export function catalogueEmptyMessage(
  total: number,
  query: string,
): string | null {
  if (total > 0) {
    return null;
  }
  return query.trim() === "" ? "No books yet" : "No books match";
}
