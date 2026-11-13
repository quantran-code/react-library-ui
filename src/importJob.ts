// The decisions an import job panel needs, kept free of React so the polling
// boundary and the wording the librarian reads can be checked without a DOM.

import type { ImportJob, ImportJobStatus } from "./api";

// How long the catalogue page waits after one status answer before it reads the
// job again, so one second of polling costs one status request however slow the
// service is to answer.
export const IMPORT_JOB_POLL_MS = 1000;

// A job has settled only once it is completed or failed; queued and processing
// both mean the page must keep reading, which is what the poller keys off.
export function isTerminalStatus(status: ImportJobStatus): boolean {
  return status === "completed" || status === "failed";
}

// How far the job has got, named as the rows the service has processed against
// the rows the file held, so the label rises as batches are written.
export function jobProgressLabel(job: ImportJob): string {
  return `Processed ${job.processedRows} of ${job.totalRows} rows`;
}

// What the written batches did, kept apart from the progress label because a
// processed row may have been imported or skipped as a duplicate.
export function jobSummaryLabel(job: ImportJob): string {
  return `Imported ${job.imported} books, skipped ${job.skipped}`;
}

// The service caps the row errors it aggregates at 20, so a truncated list says
// so rather than reading like the whole story.
export function jobMoreNote(job: ImportJob): string | null {
  if (!job.more) {
    return null;
  }
  return "Only the first 20 row errors are shown.";
}
