import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  canGoNext,
  canGoPrevious,
  catalogueEmptyMessage,
  pageLabel,
  totalPages,
} from "./paging";

// The pager's arithmetic decides which page count is shown and which of its two
// buttons can be clicked, so the boundaries at both ends are pinned here.
describe("paging", () => {
  it("counts the pages a match set spans", () => {
    expect(totalPages(0, 20)).toBe(0);
    expect(totalPages(3, 20)).toBe(1);
    expect(totalPages(40, 20)).toBe(2);
    expect(totalPages(41, 20)).toBe(3);
  });

  it("labels the current page with the page count", () => {
    expect(pageLabel(2, 20, 61)).toBe("Page 2 of 4");
    expect(pageLabel(1, 20, 3)).toBe("Page 1 of 1");
  });

  it("enables Previous only after the first page", () => {
    expect(canGoPrevious(1)).toBe(false);
    expect(canGoPrevious(2)).toBe(true);
  });

  it("enables Next until the last page", () => {
    expect(canGoNext(1, 20, 20)).toBe(false);
    expect(canGoNext(1, 20, 21)).toBe(true);
    expect(canGoNext(4, 20, 61)).toBe(false);
  });

  it("tells the two empty states apart", () => {
    expect(catalogueEmptyMessage(0, "")).toBe("No books yet");
    expect(catalogueEmptyMessage(0, "   ")).toBe("No books yet");
    expect(catalogueEmptyMessage(0, "dune")).toBe("No books match");
    expect(catalogueEmptyMessage(3, "")).toBeNull();
    expect(catalogueEmptyMessage(3, "dune")).toBeNull();
  });

  it("keeps the contract's page size and debounce delay", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });
});
