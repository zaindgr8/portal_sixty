import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { guard, handle, fail } from "@/lib/proptech/access";
import { getListingRow, listMediaRows, maskOwner, readOwner, toListing } from "@/lib/proptech/store";
import { getObject } from "@/lib/proptech/storage";
import { permitBlock } from "@/lib/proptech/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type P = { params: Promise<{ id: string }> };

// One PDF for the permit application: a details sheet, then Form A and any title deed / Oqood pages.
export const GET = handle(async (req: Request, { params }: P) => {
  const c = await guard(req);
  if (c instanceof Response) return c;
  const id = (await params).id;
  const row = await getListingRow(c.ws.id, id);
  if (!row) return fail("Listing not found.", 404);
  const l = toListing(row);
  const owner = readOwner(row);
  const pdf = await PDFDocument.create();
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Details sheet (latin text only: standard PDF fonts can't draw Arabic).
  const text = permitBlock(l, c.admin ? owner : maskOwner(owner), c.ws.name).replace(/[^\x20-\x7E\n]/g, "?");
  let page = pdf.addPage([595, 842]);
  page.drawText("Listing details sheet", { x: 40, y: 800, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1) });
  let y = 770;
  for (const line of text.split("\n")) {
    if (y < 50) { page = pdf.addPage([595, 842]); y = 800; }
    page.drawText(line.slice(0, 90), { x: 40, y, size: 9.5, font: mono });
    y -= 14;
  }

  const docs = (await listMediaRows(c.ws.id, id)).filter((m) => !m.removed && (m.kind === "form_a" || m.kind === "document"));
  for (const d of docs) {
    const buf = await getObject(c.ws.id, String(d.path));
    try {
      if (d.mime_type === "application/pdf") {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        for (const p of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(p);
      } else {
        const jpg = await sharp(buf).rotate().resize({ width: 1600, height: 2200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        const img = await pdf.embedJpg(jpg);
        const s = Math.min(555 / img.width, 802 / img.height);
        pdf.addPage([595, 842]).drawImage(img, { x: (595 - img.width * s) / 2, y: (842 - img.height * s) / 2, width: img.width * s, height: img.height * s });
      }
    } catch {
      pdf.addPage([595, 842]).drawText(`Couldn't include ${String(d.file_name).replace(/[^\x20-\x7E]/g, "?")}; download it from the listing.`, { x: 40, y: 800, size: 11, font: bold });
    }
  }
  const bytes = await pdf.save();
  const name = `permit-bundle-${(l.building || l.community || "listing").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}.pdf`;
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
});
