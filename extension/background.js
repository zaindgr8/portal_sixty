// Sixty extension · background. Holds the pairing (portal address + token) and makes every call to the
// Sixty portal, so the token never reaches the portal websites' pages.

const get = (k) => chrome.storage.local.get(k);

async function api(path, init = {}) {
  const { portalUrl, token } = await get(["portalUrl", "token"]);
  if (!portalUrl || !token) throw new Error("Not paired with Sixty yet. Open the extension and paste your pairing code.");
  const res = await fetch(`${portalUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (path.includes("/photo/")) {
    if (!res.ok) throw new Error(`Couldn't load a photo (${res.status}).`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), type: res.headers.get("content-type") || "image/jpeg" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Sixty said ${res.status}`);
  return data;
}

/** Pairing code from PropTech → Chrome extension: base64 of {"u": portal url, "t": token}. */
async function pair(code) {
  let parsed;
  try { parsed = JSON.parse(atob(code.trim())); } catch { throw new Error("That doesn't look like a Sixty pairing code. Copy it again from PropTech → Chrome extension in Sixty."); }
  if (!/^https?:\/\//.test(parsed.u || "") || !/^sx1\./.test(parsed.t || "")) throw new Error("That pairing code is incomplete. Copy it again.");
  await chrome.storage.local.set({ portalUrl: parsed.u.replace(/\/$/, ""), token: parsed.t });
  try {
    const me = await api("/api/ext/me");
    const config = await api("/api/ext/config");
    await chrome.storage.local.set({ me, config });
    return me;
  } catch (e) {
    await chrome.storage.local.remove(["portalUrl", "token"]);
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "pair": return pair(msg.code);
      case "unpair": await chrome.storage.local.clear(); return { ok: true };
      case "state": return get(["portalUrl", "me", "config", "job"]);
      case "refreshConfig": { const config = await api("/api/ext/config"); await chrome.storage.local.set({ config }); return config; }
      case "queue": return api("/api/ext/queue");
      case "sheet": return api(`/api/ext/listings/${msg.listingId}?portal=${msg.portal}`);
      case "photo": return api(`/api/ext/listings/${msg.listingId}/photo/${msg.mediaId}`);
      case "report": return api(`/api/ext/listings/${msg.listingId}/report`, { method: "POST", body: JSON.stringify({ portal: msg.portal, ...msg.data }) });
      // The listing the agent chose to post; the panel on the portal page picks it up.
      case "startJob": {
        await chrome.storage.local.set({ job: { listingId: msg.listingId, portal: msg.portal, at: Date.now() } });
        const { config } = await get("config");
        const url = config?.portals?.[msg.portal]?.startUrl || (msg.portal === "bayut" ? "https://www.bayut.com" : "https://www.propertyfinder.ae");
        await chrome.tabs.create({ url });
        return { ok: true };
      }
      case "clearJob": await chrome.storage.local.remove("job"); return { ok: true };
      default: throw new Error(`Unknown message ${msg.type}`);
    }
  })().then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e.message || String(e) }));
  return true; // reply asynchronously
});
