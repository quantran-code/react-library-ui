import { useCallback, useEffect, useState } from "react";
import { failureText, fetchBooks, fetchHealth } from "./api";
import type { Book } from "./api";
import BookTable from "./BookTable";
import LoansTable from "./LoansTable";

// The shell of the library UI: it proves the browser can reach the gateway and
// owns the catalogue, so every table on the page sees the same availability.
export default function App() {
  const [status, setStatus] = useState("checking…");
  const [books, setBooks] = useState<Book[] | null>(null);
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then((health) => setStatus(health.status))
      .catch(() => setStatus("unreachable"));
  }, []);

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
          setBooksError(failureText(reason, "catalogue unavailable"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A borrow or a return changes one book's shelf state; the page holds the
  // catalogue, so one update keeps both tables in step without a refetch.
  const applyAvailability = useCallback(
    (bookId: number, available: boolean): void => {
      setBooks((current) =>
        current === null
          ? current
          : current.map((book) =>
              book.id === bookId ? { ...book, available } : book,
            ),
      );
    },
    [],
  );

  return (
    <main>
      <h1>Library</h1>
      <p>
        Gateway: <strong>{status}</strong>
      </p>
      <BookTable
        books={books}
        loading={booksLoading}
        error={booksError}
        onAvailabilityChange={applyAvailability}
      />
      <LoansTable
        books={books ?? []}
        onAvailabilityChange={applyAvailability}
      />
    </main>
  );
}
