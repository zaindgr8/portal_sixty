// Builds the Sixty Chrome extension for release:
//   dist/sixty-extension-<v>.zip           unzip, then Chrome → Extensions → Developer mode → Load unpacked
//   dist/sixty-extension-<v>-webstore.zip  upload in the Chrome Web Store developer dashboard (manifest at the root)
// Both point at the live portal only (the localhost entry used in development is removed).
// Usage: npm run ext:build
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "extension");
const dist = path.join(root, "dist");
const manifest = JSON.parse(readFileSync(path.join(src, "manifest.json"), "utf8"));
const v = manifest.version;

manifest.host_permissions = manifest.host_permissions.filter((h) => !/localhost|127\.0\.0\.1/.test(h));

const stage = path.join(dist, "stage");
rmSync(stage, { recursive: true, force: true });
const folder = path.join(stage, "sixty-extension");
mkdirSync(folder, { recursive: true });
cpSync(src, folder, { recursive: true, filter: (p) => !path.basename(p).startsWith(".") });
writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const unpacked = path.join(dist, `sixty-extension-${v}.zip`);
const store = path.join(dist, `sixty-extension-${v}-webstore.zip`);
rmSync(unpacked, { force: true });
rmSync(store, { force: true });
// -X: no extra macOS attributes; the Web Store wants manifest.json at the zip root.
execFileSync("zip", ["-rqX", unpacked, "sixty-extension"], { cwd: stage });
execFileSync("zip", ["-rqX", store, "."], { cwd: folder });
rmSync(stage, { recursive: true, force: true });

console.log(`Built v${v}\n  ${path.relative(root, unpacked)}  (Load unpacked)\n  ${path.relative(root, store)}  (Chrome Web Store)`);
