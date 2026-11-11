export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("./lib/whatsapp/poller");
    startPoller();
    // PropTech background jobs (AI processing of new listings, portal publishing).
    const { startProptechWorker } = await import("./lib/proptech/worker");
    startProptechWorker();
  }
}
