import { timingSafeEqual } from "node:crypto";
import { drain } from "@/lib/proptech/jobs";
import { registerProptechJobs } from "@/lib/proptech/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Runs PropTech's queued work that nobody is waiting on: retries after a failure, delayed portal status
// checks, listings whose page was closed mid-way. Call it every few minutes from Vercel Cron or any
// scheduler, with header "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends this itself).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  registerProptechJobs();
  const done = await drain(240_000);
  return Response.json({ ok: true, done });
}
