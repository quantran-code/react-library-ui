import { useEffect, useState } from "react";
import { fetchBooks } from "./api";
import type { Book } from "./api";

// The catalogue: one row per book, with a single loading or error row while the
// gateway has nothing to show.
export default function BookTable(): JSX.Element {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <table>
      <thead>
        <tr>
          <th>Id</th>
          <th>Title</th>
          <th>Author</th>
          <th>Available</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr className="loading-row">
            <td colSpan={4}>Loading catalogue…</td>
          </tr>
        ) : null}
        {!loading && error !== null ? (
          <tr className="error-row">
            <td colSpan={4}>{error}</td>
          </tr>
        ) : null}
        {!loading && error === null && bookRows.length === 0 ? (
          <tr>
            <td colSpan={4}>No books in the catalogue.</td>
          </tr>
        ) : null}
        {!loading && error === null
          ? bookRows.map((book) => (
              <tr key={book.id}>
                <td>{book.id}</td>
                <td>{book.title}</td>
                <td>{book.author}</td>
                <td>{book.available ? "Yes" : "No"}</td>
              </tr>
            ))
          : null}
      </tbody>
    </table>
  );
}
