// Sixty extension · panel on Property Finder / Bayut pages. Fills the portal's own "add listing" form from
// the Sixty listing the agent picked, adds the photos, then records the result in Sixty. The agent always
// presses the portal's own Submit button: Sixty fills, a person checks and posts.
(() => {
  if (window.__sixtyPanel) return;
  window.__sixtyPanel = true;

  const send = (msg) => new Promise((res, rej) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? res(r.data) : rej(new Error(r?.error || chrome.runtime.lastError?.message || "No answer")))));
  const host = location.hostname.replace(/^www\./, "");
  const portalOfHost = (cfg) => Object.entries(cfg?.portals || {}).find(([, p]) => p.hosts.some((h) => host === h.replace(/^www\./, "") || host.endsWith(`.${h.replace(/^www\./, "")}`)))?.[0];

  const box = document.createElement("div");
  box.id = "sixty-ext-root";
  const shadow = box.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #0d0d0d; }
      .fab { background: #0d0d0d; color: #fff; border: 0; border-radius: 999px; padding: 10px 16px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.25); cursor: pointer; }
      .card { width: 340px; max-height: 70vh; display: flex; flex-direction: column; background: #fff; border: 1px solid #e7e6e4; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); overflow: hidden; }
      .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e7e6e4; }
      .hd b { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tag { font-size: 10px; font-weight: 700; color: #bd2120; letter-spacing: .06em; }
      .body { padding: 10px 12px; overflow-y: auto; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      button { font: inherit; cursor: pointer; border-radius: 9px; border: 1px solid #e7e6e4; background: #fff; padding: 7px 10px; color: #0d0d0d; }
      button.primary { background: #bd2120; color: #fff; border-color: transparent; font-weight: 600; flex: 1; }
      button.x { border: 0; background: none; font-size: 16px; padding: 2px 6px; color: #7c7c7c; }
      button:disabled { opacity: .5; cursor: default; }
      .msg { font-size: 12px; margin: 0 0 8px; color: #4b4b4b; }
      .ok { color: #059669; } .bad { color: #b91c1c; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid #f0efed; font-size: 12px; }
      li .k { width: 110px; color: #7c7c7c; flex-shrink: 0; }
      li .v { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      li .s { width: 16px; text-align: center; }
      li button { padding: 2px 7px; font-size: 11px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid #e7e6e4; border-radius: 9px; padding: 7px 9px; font: inherit; margin-bottom: 6px; }
      .pick li { cursor: default; }
    </style>
    <div class="wrap"></div>`;
  const wrap = shadow.querySelector(".wrap");
  document.documentElement.append(box);

  let state = { open: false, sheet: null, job: null, result: null, msg: "", cfg: null, portal: null, done: false };
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k.startsWith("on") ? (n[k] = v) : k === "class" ? (n.className = v) : n.setAttribute(k, v);
    n.append(...kids.filter((x) => x !== null && x !== undefined));
    return n;
  };

  async function boot() {
    const st = await send({ type: "state" }).catch(() => null);
    if (!st?.me) return render(); // not paired: stay hidden
    state.cfg = st.config;
    state.portal = portalOfHost(st.config);
    if (!state.portal) return;
    if (st.job && st.job.portal === state.portal) {
      state.job = st.job;
      state.open = true;
      await loadSheet();
    }
    render();
  }

  async function loadSheet() {
    try { state.sheet = await send({ type: "sheet", listingId: state.job.listingId, portal: state.portal }); state.msg = ""; }
    catch (e) { state.msg = e.message; }
  }

  const where = () => state.cfg.portals[state.portal]?.addListingHint || "the portal's Add listing page";
  const valuesFor = () => ({ ...state.sheet.values, reference: state.sheet.listing.reference });

  async function loadPhotos() {
    const files = [];
    for (const p of state.sheet.photos) {
      const r = await send({ type: "photo", listingId: state.job.listingId, mediaId: p.id });
      const bin = atob(r.base64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      files.push(new File([arr], p.name, { type: r.type }));
    }
    return files;
  }

  // The whole form: every step, photos, Next, until only the portal's Submit is left.
  async function fillAll() {
    state.running = true;
    state.msg = "Filling the form…"; render();
    const rules = state.cfg.portals[state.portal];
    let r;
    try {
      r = await window.SixtyFill.autopilot(document, rules, valuesFor(), {
        getPhotos: loadPhotos,
        onStep: (s) => { state.msg = `Step ${s.step}: ${s.filled} fields filled${s.photos ? `, ${s.photos} photos added` : ""}…`; render(); },
      });
    } catch (e) { r = { status: "error", error: e.message, filled: [] }; }
    state.running = false;
    state.result = { filled: r.filled || [], missing: r.missing || [] };
    const n = (r.filled || []).length, ph = r.photos ? ` and ${r.photos} photos` : "";
    state.msg = {
      not_form: `This page isn't a listing form, so nothing was filled. Open ${where()}, then press Fill everything.`,
      ready_to_submit: `Done: ${n} fields${ph} filled over ${r.steps} step${r.steps > 1 ? "s" : ""}. Check the listing, then press the portal's Submit button yourself.`,
      end: `Filled ${n} fields${ph}. Check the page, then submit it on the portal.`,
      blocked: `Filled ${n} fields${ph}, but the portal's Next button is still locked. Fill the highlighted boxes it needs (use Copy below), then press Fill everything again.`,
      stuck: `Filled ${n} fields${ph}. The portal didn't move to the next step: check for a red message on the page, then press Fill everything again.`,
      too_many_steps: `Filled ${n} fields${ph}. Stopped after many steps: check the page.`,
      error: `Something went wrong while filling: ${r.error}`,
    }[r.status] || `Filled ${n} fields.`;
    if (r.submit) r.submit.style.outline = "3px solid #bd2120";
    if (r.status !== "not_form") await send({ type: "report", listingId: state.job.listingId, portal: state.portal, data: { event: "filled", filled: n, missing: r.missing || [], steps: r.steps, photos: r.photos || 0, outcome: r.status, page: location.href } }).catch(() => {});
    render();
  }

  async function fillNow() {
    const rules = state.cfg.portals[state.portal];
    state.result = await window.SixtyFill.fillPage(document, rules, valuesFor());
    state.msg = state.result.notForm
      ? `This page isn't a listing form, so nothing was filled. Open ${where()}, then press Fill this page.`
      : state.result.filled.length
        ? `Filled ${state.result.filled.length} fields. Check them (green outline), fill the rest from the list below, then add photos.`
        : `Couldn't fill this page. Open ${where()}, then press Fill this page.`;
    if (state.result.notForm) { render(); return; }
    await send({ type: "report", listingId: state.job.listingId, portal: state.portal, data: { event: "filled", filled: state.result.filled.length, missing: state.result.missing, page: location.href } }).catch(() => {});
    render();
  }

  async function addPhotos(btn) {
    btn.disabled = true;
    state.msg = "Loading photos…"; render();
    try {
      const r = window.SixtyFill.attachPhotos(document, await loadPhotos());
      state.msg = r.ok ? `Added ${r.count} photo${r.count > 1 ? "s" : ""}${r.single ? " (this box takes one at a time: press again for the next)" : ""}. Cover first.` : r.reason;
    } catch (e) { state.msg = e.message; }
    render();
  }

  async function posted(url) {
    try {
      await send({ type: "report", listingId: state.job.listingId, portal: state.portal, data: { event: "posted", url, page: location.href } });
      await send({ type: "clearJob" });
      state.done = true;
      state.msg = "Recorded in Sixty: the listing now shows as Live on this portal.";
    } catch (e) { state.msg = e.message; }
    render();
  }

  async function chooseListing() {
    state.msg = "Loading…"; render();
    try {
      const q = await send({ type: "queue" });
      state.pick = q.waiting.filter((w) => w.portal === state.portal);
      state.msg = state.pick.length ? "" : "Nothing waiting for this portal. Approve a listing in Sixty first.";
    } catch (e) { state.msg = e.message; }
    render();
  }

  function render() {
    wrap.replaceChildren();
    if (!state.portal) return;
    if (!state.open) {
      wrap.append(el("button", { class: "fab", onclick: () => { state.open = true; if (!state.job) chooseListing(); else render(); } }, "Sixty"));
      return;
    }
    const s = state.sheet;
    const head = el("div", { class: "hd" }, el("span", { class: "tag" }, "SIXTY"), el("b", {}, s ? s.listing.title || "Listing" : "Pick a listing"), el("button", { class: "x", title: "Minimise", onclick: () => { state.open = false; render(); } }, "–"));
    const body = el("div", { class: "body" });
    if (state.msg) body.append(el("p", { class: `msg ${state.done ? "ok" : ""}` }, state.msg));

    if (!state.job) {
      const ul = el("ul", { class: "pick" });
      for (const w of state.pick || []) ul.append(el("li", {}, el("span", { class: "v" }, w.title), el("button", { onclick: async () => { await send({ type: "startJob", listingId: w.listingId, portal: w.portal }).catch(() => {}); } }, "Use")));
      body.append(ul);
    } else if (s && !state.done) {
      const run = el("button", { class: "primary", onclick: fillAll }, state.running ? "Filling…" : "Fill everything");
      if (state.running) run.disabled = true;
      body.append(el("div", { class: "row" }, run));
      const one = el("button", { onclick: fillNow }, "This page only");
      if (state.running) one.disabled = true;
      body.append(el("div", { class: "row" },
        one,
        el("button", { onclick: (e) => addPhotos(e.currentTarget) }, `Add ${s.photos.length} photos`)));
      const filled = new Set(state.result?.filled || []);
      const list = el("ul");
      for (const f of s.fields) {
        const key = f.key === "type" ? "property_type" : f.key === "status" ? "completion_status" : f.key === "size" ? "size_sqft" : f.key === "plot" ? "plot_sqft" : f.key === "period" ? "price_type" : f.key === "permit" ? "permit_number" : f.key === "brn" ? "agent_brn" : f.key;
        const done = filled.has(key);
        list.append(el("li", {},
          el("span", { class: "s", title: done ? "Filled" : "" }, done ? "✓" : ""),
          el("span", { class: "k" }, f.label), el("span", { class: "v", title: f.value }, f.value),
          el("button", { onclick: (e) => { navigator.clipboard.writeText(f.value); e.currentTarget.textContent = "Copied"; } }, "Copy")));
      }
      body.append(list);
      const url = el("input", { placeholder: "Link of the new listing (after you submit)", value: "" });
      body.append(el("div", { style: "margin-top:10px" }, el("p", { class: "msg" }, "After you press the portal's Submit button:"), url,
        el("button", { class: "primary", style: "width:100%", onclick: () => posted(url.value.trim() || location.href) }, "I've submitted it")));
    }
    wrap.append(el("div", { class: "card" }, head, body));
  }

  // Re-check when the job changes (started from the popup) or the page changes inside a single-page app.
  chrome.storage.onChanged.addListener((ch) => { if (ch.job || ch.me || ch.config) { state = { ...state, job: null, sheet: null, result: null, done: false, msg: "" }; boot(); } });
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; render(); } }, 1000);
  boot();
})();
