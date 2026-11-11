// Upload rules shared by the browser (quick checks) and the server (checks the bytes, not just the name).
export type UploadKind = "form_a" | "photo" | "document" | "floorplan" | "audio";

export const LIMITS: Record<UploadKind, { maxMb: number; mimes: string[]; label: string }> = {
  form_a: { maxMb: 25, mimes: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"], label: "PDF, JPG, PNG or HEIC" },
  document: { maxMb: 25, mimes: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"], label: "PDF, JPG, PNG or HEIC" },
  floorplan: { maxMb: 25, mimes: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"], label: "PDF, JPG, PNG or HEIC" },
  photo: { maxMb: 25, mimes: ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"], label: "JPG, PNG, HEIC or WebP" },
  audio: { maxMb: 20, mimes: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"], label: "an audio file (m4a, mp3, webm, ogg, wav)" },
};
export const MAX_AUDIO_SECONDS = 180;
export const MAX_PHOTOS = 50;
export const MIN_PHOTOS = 5;

const EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp",
  webm: "audio/webm", ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
};
export const mimeFromName = (name: string) => EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
export const extFor = (mime: string) => Object.entries(EXT).find(([, m]) => m === mime)?.[0] ?? "bin";

/** The real type, from the first bytes of the file. */
export function sniff(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (s(0, 4) === "%PDF") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "audio/wav";
  if (s(4, 4) === "ftyp") {
    const brand = s(8, 4);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return "image/heic";
    if (/^(M4A |M4B |isom|mp42|mp41|iso2|dash)$/.test(brand)) return "audio/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return b[0] === 0xff && (b[1] & 0xf6) === 0xf0 ? "audio/aac" : "audio/mpeg";
  return null;
}

/** Check a file for an upload slot. Returns the mime type to store, or an error message. */
export function checkUpload(kind: UploadKind, name: string, size: number, head?: Uint8Array): { mime: string } | { error: string } {
  const lim = LIMITS[kind];
  if (!lim) return { error: "Unknown upload type." };
  if (size > lim.maxMb * 1024 * 1024) return { error: `${name} is over ${lim.maxMb} MB.` };
  if (size < 64) return { error: `${name} is empty.` };
  const real = head ? sniff(head) : null;
  const claimed = mimeFromName(name);
  const mime = real ?? claimed;
  const ok = (m: string) => lim.mimes.includes(m) || (kind === "audio" && m.startsWith("audio/"));
  if (head && !real) return { error: `${name} isn't a file type we accept. Upload ${lim.label}.` };
  if (!mime || !ok(mime)) return { error: `${name}: upload ${lim.label}.` };
  return { mime: mime === "image/heif" ? "image/heic" : mime };
}
