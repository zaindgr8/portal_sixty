import "server-only";
import { onJobFailure, registerJob, startJobWorker } from "./jobs";
import { processListing, regenerateCopy } from "./pipeline";
import { portalJobFailed, runPortalJob } from "./publish";
import { updateListing } from "./store";
import type { Tone } from "./types";

// Wires job kinds to their handlers and starts the worker. Imported once from instrumentation.ts.
export function startProptechWorker() {
  registerJob("process_listing", async (job) => { if (job.listing_id) await processListing(job.workspace_id, job.listing_id); });
  registerJob("regenerate_copy", async (job) => { if (job.listing_id) await regenerateCopy(job.workspace_id, job.listing_id, job.payload.tone as Tone | undefined); });
  for (const k of ["portal_publish", "portal_update", "portal_unpublish", "portal_status"] as const) registerJob(k, runPortalJob);
  onJobFailure(async (job, msg) => {
    if (job.kind === "process_listing" && job.listing_id) {
      await updateListing(job.workspace_id, job.listing_id, { status: "review", progress: { step: "done", label: "The AI step failed. Fill in the details by hand, or try again.", error: msg.slice(0, 300) } }).catch(() => {});
    }
    await portalJobFailed(job, msg).catch(() => {});
  });
  startJobWorker();
}
