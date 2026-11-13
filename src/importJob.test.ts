import { describe, expect, it } from "vitest";
import type { ImportJob } from "./api";
import {
  IMPORT_JOB_POLL_MS,
  isTerminalStatus,
  jobMoreNote,
  jobProgressLabel,
  jobSummaryLabel,
} from "./importJob";

// A job as the status route reports it, so a test states only the fields it is
// actually about and the rest stay the shape the service sends.
function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    jobId: "3f7c1d92-5a64-4b8e-9c71-0d2fa6b45e18",
    status: "processing",
    totalRows: 250,
    processedRows: 100,
    imported: 98,
    skipped: 2,
    batches: 3,
    completedBatches: 1,
    errors: [],
    more: false,
    createdAt: "2024-05-01T10:00:00Z",
    updatedAt: "2024-05-01T10:00:01Z",
    ...overrides,
  };
}

describe("isTerminalStatus", () => {
  it("stops polling once the job is completed or failed", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("keeps polling while the job is queued or processing", () => {
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
  });
});

describe("jobProgressLabel", () => {
  it("names the rows processed and the rows the file held", () => {
    const label = jobProgressLabel(importJob());

    expect(label).toContain("100");
    expect(label).toContain("250");
  });
});

describe("jobSummaryLabel", () => {
  it("names the books imported and the rows skipped", () => {
    const label = jobSummaryLabel(importJob({ imported: 148, skipped: 2 }));

    expect(label).toContain("148");
    expect(label).toContain("2");
  });
});

describe("jobMoreNote", () => {
  it("notes the truncated list when more is true", () => {
    const note = jobMoreNote(importJob({ more: true, completedBatches: 3 }));

    expect(note).not.toBeNull();
    expect(note).toContain("20");
  });

  it("says nothing when the whole list is shown", () => {
    expect(jobMoreNote(importJob({ more: false }))).toBeNull();
  });
});

describe("IMPORT_JOB_POLL_MS", () => {
  it("polls the job once a second", () => {
    expect(IMPORT_JOB_POLL_MS).toBe(1000);
  });
});
