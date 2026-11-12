import { useCallback, useEffect, useRef, useState } from "react";
import { failureText, fetchBooks, fetchHealth } from "./api";
import type { BookPage } from "./api";
import { SEARCH_DEBOUNCE_MS, totalPages } from "./paging";
import BookTable from "./BookTable";
import LoansTable from "./LoansTable";

// The shell of the library UI: it proves the browser can reach the gateway and
// owns the catalogue, so every table on the page sees the same availability.
export default function App() {
  const [status, setStatus] = useState("checking…");
  // What the search box shows on every keystroke; query is the search the rows
  // on screen answer, and only the debounce effect below writes it.
  const [searchValue, setSearchValue] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  // The last page the gateway answered with. A new request never clears it, so
  // the previous rows stay on screen while the next answer is still in flight.
  const [catalogue, setCatalogue] = useState<BookPage | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  // A slow answer for an old page or search must not overwrite a newer one, so
  // only the newest request sequence may write the catalogue, error and loading.
  const requestSequence = useRef(0);

  useEffect(() => {
    fetchHealth()
      .then((health) => setStatus(health.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  // A burst of keystrokes changes searchValue many times but query once, when
  // the typing pauses; the new search starts again from page 1 in the same
  // update, so the effect below reads one page for one search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchValue.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchValue]);

  // The one place the catalogue is read: a page or search change asks for it,
  // and only the newest answer lands. A refusal keeps the last good page on
  // screen and shows the API's own wording, which is what a 400 paging
  // refusal carries.
  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setCatalogueLoading(true);

    fetchBooks(page, query)
      .then((answered) => {
        if (requestSequence.current === sequence) {
          setCatalogue(answered);
          setCatalogueError(null);
        }
      })
      .catch((reason: unknown) => {
        if (requestSequence.current === sequence) {
          setCatalogueError(failureText(reason, "catalogue unavailable"));
        }
      })
      .finally(() => {
        if (requestSequence.current === sequence) {
          setCatalogueLoading(false);
        }
      });
  }, [page, query]);

  // A borrow or a return changes one book's shelf state; the page holds the
  // catalogue, so one update keeps both tables in step without a refetch.
  const applyAvailability = useCallback(
    (bookId: number, available: boolean): void => {
      setCatalogue((current) =>
        current === null
          ? current
          : {
              ...current,
              items: current.items.map((book) =>
                book.id === bookId ? { ...book, available } : book,
              ),
            },
      );
    },
    [],
  );

  // The pager's buttons are disabled at both ends, but a click can land before
  // the render that disables it, so the handlers guard the page as well.
  const handlePrevious = useCallback((): void => {
    setPage((current) => (current > 1 ? current - 1 : current));
  }, []);

  function handleNext(): void {
    if (catalogue === null) {
      return;
    }
    const lastPage = totalPages(catalogue.total, catalogue.page_size);
    setPage((current) => (current < lastPage ? current + 1 : current));
  }

  return (
    <main>
      <h1>Library</h1>
      <p>
        Gateway: <strong>{status}</strong>
      </p>
      <BookTable
        catalogue={catalogue}
        query={query}
        searchValue={searchValue}
        loading={catalogueLoading}
        error={catalogueError}
        onSearchChange={setSearchValue}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onAvailabilityChange={applyAvailability}
      />
      <LoansTable
        books={catalogue?.items ?? []}
        onAvailabilityChange={applyAvailability}
      />
    </main>
  );
}
