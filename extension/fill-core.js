// Sixty extension · form-filling engine. Drives a portal's own "add listing" form the way a person would:
// types into boxes, clicks choice buttons, opens drop-downs and picks options, picks the location from the
// suggestions, adds photos and presses Next, step after step. It never presses Submit / Publish: a person
// checks the listing and submits it. No network access here.
(function (root) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[‏‎*:()]/g, " ").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The text that describes a form control: <label for>, wrapping label, aria-label(ledby), placeholder, name, nearby text. */
  function describe(el, doc) {
    const parts = [];
    if (el.id) {
      const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(l.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    parts.push(el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.getAttribute("data-testid"), el.id);
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) parts.push((doc.getElementById ? doc.getElementById(id) : null)?.textContent);
    // Text just above or before the control (common in custom form layouts).
    let p = el.parentElement;
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      const t = [...p.childNodes].filter((n) => n !== el && !n.contains?.(el)).map((n) => n.textContent || "").join(" ");
      if (t.trim()) { parts.push(t.slice(0, 120)); break; }
    }
    return norm(parts.filter(Boolean).join(" | "));
  }

  const CONTROLS = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, select, [contenteditable="true"]';
  const CLICKABLE = 'button, [role=button], [role=radio], [role=tab], [role=option], [role=menuitem], [role=checkbox], label, li, a, [tabindex]';
  const OPTION = '[role=option], [role=menuitem], [role=radio], [role=listbox] li, ul li, button, label, [tabindex], div[class*="option" i], div[class*="item" i]';

  /** Portal search bars (site header, "City, community or building") are never part of an add-listing form. */
  function isSearchControl(el) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (type === "search" || role === "searchbox") return true;
    return Boolean(el.closest && el.closest('header, nav, [role="search"], [role="navigation"], form[action*="search"]'));
  }

  /** Fewer matches than this on the first step and the page isn't a listing form (e.g. the portal's home page). */
  const MIN_MATCHES = 3;
  const NEXT = /^(next|continue|save (and|&) continue|proceed|next step|go to next)\b/;
  const SUBMIT = /^(submit|publish|post( listing| property| ad)?|list (my |this )?property|send|finish|done|confirm|go live)\b/;

  function visible(el) {
    if (!el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }
  const textOf = (el) => norm(el.innerText || el.textContent || el.value || "");

  /** Where to look: an open dialog (Bayut opens its form in one), else the whole page. */
  function scope(doc) {
    const dialogs = [...doc.querySelectorAll('[role=dialog], [aria-modal="true"], dialog[open]')].filter(visible);
    return dialogs[dialogs.length - 1] || doc;
  }

  /** Press like a person: pointer and mouse events, then click (React, Vue and plain pages all notice). */
  function realClick(el) {
    el.scrollIntoView?.({ block: "center" });
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (t.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent)(t, o));
    el.click();
  }

  /** Best control for a field: a selector from the config first, else the control whose description best matches a label. */
  function findControl(doc, rule, used) {
    for (const sel of rule.selectors || []) {
      try {
        const el = doc.querySelector(sel);
        if (el && !used.has(el)) return el;
      } catch { /* bad selector in config */ }
    }
    const labels = (rule.labels || []).map(norm).filter(Boolean);
    if (!labels.length) return null;
    let best = null, bestScore = 0;
    for (const el of doc.querySelectorAll(CONTROLS)) {
      if (used.has(el) || el.disabled || el.readOnly || !visible(el) || isSearchControl(el)) continue;
      const d = describe(el, el.ownerDocument || doc);
      for (const l of labels) {
        // Exact label beats "contains"; longer labels beat short ones like "type".
        const score = d === l ? 100 + l.length : d.startsWith(l) ? 60 + l.length : d.includes(l) ? 30 + l.length : 0;
        if (score > bestScore) { best = el; bestScore = score; }
      }
    }
    return best;
  }

  /** Set a value so frameworks see it (native setter + input/change events). */
  function setValue(el, value) {
    const v = String(value);
    if (el.isContentEditable) {
      el.focus();
      el.textContent = v;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  /** Does a piece of visible text match one of our wordings? Exact first, then "2" ~ "2 Bedrooms". */
  function matches(text, wants, loose) {
    if (!text) return false;
    if (wants.includes(text)) return true;
    return loose && wants.some((w) => w && (text.startsWith(`${w} `) || (w.length > 3 && text.includes(w))));
  }

  /** Pick a <select> option by the portal's wording for our value. */
  function chooseOption(select, candidates) {
    const wants = candidates.map(norm).filter(Boolean);
    const opts = [...select.options];
    const hit = opts.find((o) => wants.includes(norm(o.textContent)) || wants.includes(norm(o.value)))
      || opts.find((o) => matches(norm(o.textContent), wants, true));
    if (!hit) return false;
    return setValue(select, hit.value);
  }

  /** Our stored value → what to type / which option to pick. */
  function candidatesFor(key, raw, rule) {
    if (raw === null || raw === undefined || raw === "") return [];
    if (Array.isArray(raw)) return [raw.join(", ")];
    const mapped = rule.options && rule.options[String(raw)];
    return mapped ? [...mapped, String(raw)] : [String(raw)];
  }

  /** Short text elements that name a field ("Bedrooms*", "Category & Type*", "Property size"). */
  function labelNodes(root, labels) {
    const out = [];
    for (const el of root.querySelectorAll("label, legend, h1, h2, h3, h4, h5, h6, p, span, div, dt, strong")) {
      if (el.children.length > 3 || !visible(el)) continue;
      const t = textOf(el);
      if (!t || t.length > 40) continue;
      if (labels.some((l) => t === l || t.startsWith(`${l} `) || t.startsWith(`${l}&`) || t.startsWith(`${l} &`))) out.push(el);
    }
    return out;
  }

  const isChosen = (el) => el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" || (el.control && el.control.checked) || el.checked === true;

  /** Click the choice button / chip / radio for a field ("Rent out", "Apartment", "2", "sqft"). */
  function clickChoice(root, rule, cands) {
    const labels = (rule.labels || []).map(norm).filter(Boolean);
    const wants = cands.map(norm).filter(Boolean);
    const pick = (opts) => opts.find((o) => matches(textOf(o), wants, false)) || null;
    for (const lab of labelNodes(root, labels)) {
      let box = lab.parentElement;
      for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
        const opts = [...box.querySelectorAll(CLICKABLE)].filter((e) => e !== lab && !e.contains(lab) && visible(e) && !isSearchControl(e));
        const hit = pick(opts);
        if (hit) { if (!isChosen(hit)) realClick(hit); return true; }
        if (opts.length > 60) break;
      }
    }
    // No heading for it (e.g. Sell / Rent out at the top): click a unique, wordy match anywhere in the form.
    const wordy = wants.filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    if (!wordy.length) return false;
    const all = [...root.querySelectorAll(CLICKABLE)].filter((e) => visible(e) && !isSearchControl(e) && wordy.includes(textOf(e)));
    const uniq = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
    if (uniq.length === 1) { if (!isChosen(uniq[0])) realClick(uniq[0]); return true; }
    return false;
  }

  /** Visible options in an open list, anywhere on the page (lists often render outside the form). */
  function findOption(doc, wants) {
    const opts = [...doc.querySelectorAll(OPTION)].filter((o) => visible(o) && !isSearchControl(o));
    return opts.find((o) => matches(textOf(o), wants, false)) || opts.find((o) => matches(textOf(o), wants, true)) || null;
  }

  /** A custom drop-down ("Property type ⌄", "Furnishing: Select ⌄"): open it, pick the option. */
  async function pickFromDropdown(doc, root, rule, cands) {
    const labels = (rule.labels || []).map(norm).filter(Boolean);
    const wants = cands.map(norm).filter(Boolean);
    const triggerSel = 'button, [role=button], [role=combobox], [aria-haspopup], [tabindex]';
    const triggers = [...root.querySelectorAll(triggerSel)].filter((e) => visible(e) && !isSearchControl(e) && labels.some((l) => textOf(e).startsWith(l)));
    for (const lab of labelNodes(root, labels)) {
      let box = lab.parentElement;
      for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
        const t = [...box.querySelectorAll(triggerSel)].find((e) => visible(e) && !e.contains(lab) && !isSearchControl(e) && /select|choose|⌄|▾/i.test(e.textContent || "") );
        if (t) { triggers.push(t); break; }
      }
    }
    for (const t of triggers) {
      realClick(t);
      await sleep(450);
      const opt = findOption(doc, wants);
      if (opt) { realClick(opt); await sleep(250); return true; }
      realClick(t); // close it again
      await sleep(150);
    }
    return false;
  }

  /** Location boxes are search-as-you-type: type, wait for the suggestions, click the best one. */
  async function typeAndPick(doc, el, text) {
    setValue(el, text);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: text.slice(-1), bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: text.slice(-1), bubbles: true }));
    const first = norm(text).split(" ").filter((w) => w.length > 2)[0] || norm(text);
    for (let i = 0; i < 16; i++) {
      await sleep(250);
      const opts = [...doc.querySelectorAll('[role=option], [role=listbox] li, [role=listbox] [tabindex], ul li, [class*="suggest" i] li, [class*="suggest" i] [tabindex], [class*="option" i]')]
        .filter((o) => visible(o) && o !== el && textOf(o).includes(first) && textOf(o).length < 160);
      if (opts.length) {
        const exact = opts.find((o) => textOf(o).startsWith(norm(text)));
        realClick(exact || opts[0]);
        await sleep(300);
        return true;
      }
    }
    return false;
  }

  /**
   * Fill whatever of the listing is on this step. `done` carries fields filled on earlier steps so a choice is
   * never clicked twice (clicking a chip again can switch it off). Returns what it filled and what's left.
   */
  async function fillStep(doc, portalRules, values, done = new Set(), opts = {}) {
    const root = scope(doc);
    const used = new Set();
    const filled = [], missing = [];
    const plan = Object.entries(portalRules.fields || {}).filter(([key]) => !done.has(key));
    // Count what this page offers before touching anything, so a non-listing page is left alone.
    if (opts.guard) {
      let n = 0;
      for (const [key, rule] of plan) {
        const cands = candidatesFor(key, values[key], rule);
        if (!cands.length) continue;
        const probe = new Set();
        if (findControl(root, rule, probe) || labelNodes(root, (rule.labels || []).map(norm)).length) n++;
      }
      // A listing form has a way forward (Next / Save / Submit). A home page or search page doesn't.
      const forward = findButton(doc, NEXT) || findButton(doc, SUBMIT) || findButton(doc, /^save\b/);
      if (n < MIN_MATCHES || !forward) return { filled, missing: plan.map(([k]) => k), notForm: true };
    }
    for (const [key, rule] of plan) {
      const cands = candidatesFor(key, values[key], rule);
      if (!cands.length) continue;
      let ok = false;
      if (rule.kind === "choice") {
        // Choice fields are usually buttons; a real drop-down (<select>) still works.
        const el = findControl(root, rule, used);
        if (el instanceof HTMLSelectElement) { used.add(el); ok = chooseOption(el, cands); if (ok) el.classList.add("sixty-filled"); }
      } else {
        const el = findControl(root, rule, used);
        if (el) {
          used.add(el);
          if (el instanceof HTMLSelectElement) ok = chooseOption(el, cands);
          else if (rule.kind === "location") ok = await typeAndPick(doc, el, cands[0]);
          else ok = setValue(el, cands[0]);
          if (ok) el.classList.add("sixty-filled");
        }
      }
      // Only choice fields click buttons. A price or a size must never click "Rent out" because a label says "rent".
      const clicks = rule.kind === "choice" || (rule.kind !== "text" && rule.kind !== "location" && rule.options);
      if (!ok && clicks) ok = clickChoice(root, rule, cands);
      if (!ok && clicks) ok = await pickFromDropdown(doc, root, rule, cands);
      if (ok) { filled.push(key); done.add(key); await sleep(120); } else missing.push(key);
    }
    return { filled, missing, notForm: false };
  }

  /** Put photos into the page's image upload input (as if the agent picked them). */
  function attachPhotos(doc, files) {
    const input = [...doc.querySelectorAll('input[type=file]')].find((i) => !i.accept || /image|jpe?g|png/i.test(i.accept));
    if (!input) return { ok: false, reason: "No photo upload box on this page yet. Go to the photos step and press Add photos again." };
    const dt = new DataTransfer();
    for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, count: dt.files.length, single: !input.multiple };
  }
  const hasPhotoInput = (doc) => [...doc.querySelectorAll('input[type=file]')].some((i) => !i.accept || /image|jpe?g|png/i.test(i.accept));

  /** Buttons the portal uses to move on or to finish. Our own panel lives in a shadow root, so it's never matched. */
  function findButton(doc, re) {
    return [...doc.querySelectorAll('button, [role=button], input[type=submit], a')]
      .filter((b) => visible(b) && !isSearchControl(b))
      .find((b) => re.test(norm(b.innerText || b.value || b.textContent))) || null;
  }
  const isDisabled = (b) => b.disabled || b.getAttribute("aria-disabled") === "true" || /disabled/i.test(b.className || "");

  /** Something on the page changed (next step loaded): URL, headings or the set of fields. */
  const signature = (doc) => `${location.href}|${[...doc.querySelectorAll("h1,h2,h3,legend")].filter(visible).map(textOf).join("/")}|${doc.querySelectorAll(CONTROLS).length}`;
  async function waitForChange(doc, before, ms = 4000) {
    for (let t = 0; t < ms; t += 200) { await sleep(200); if (signature(doc) !== before) { await sleep(400); return true; } }
    return false;
  }

  /**
   * Autopilot: fill every step, add photos on the photo step, press Next, and stop when only Submit is left
   * (or when the portal won't go on without something we don't have). Never presses Submit.
   * `getPhotos` loads the listing's photos only when a photo box appears. `onStep` reports progress.
   */
  async function autopilot(doc, portalRules, values, { getPhotos, onStep, maxSteps = 12 } = {}) {
    const done = new Set();
    const filledAll = [];
    let photos = null, photosAdded = 0, steps = 0;
    for (; steps < maxSteps; steps++) {
      const r = await fillStep(doc, portalRules, values, done, { guard: steps === 0 });
      if (r.notForm) return { status: "not_form", steps, filled: filledAll };
      filledAll.push(...r.filled);
      if (!photosAdded && getPhotos && hasPhotoInput(doc)) {
        photos = photos || await getPhotos();
        const a = attachPhotos(doc, photos);
        if (a.ok) photosAdded = a.count;
        await sleep(800);
      }
      onStep?.({ step: steps + 1, filled: filledAll.length, photos: photosAdded });
      await sleep(500);
      const next = findButton(doc, NEXT);
      const submit = findButton(doc, SUBMIT);
      if (!next) return { status: submit ? "ready_to_submit" : "end", steps: steps + 1, filled: filledAll, photos: photosAdded, submit, missing: r.missing };
      if (isDisabled(next)) return { status: "blocked", steps: steps + 1, filled: filledAll, photos: photosAdded, missing: r.missing };
      const before = signature(doc);
      realClick(next);
      if (!(await waitForChange(doc, before))) return { status: "stuck", steps: steps + 1, filled: filledAll, photos: photosAdded, missing: r.missing };
    }
    return { status: "too_many_steps", steps, filled: filledAll, photos: photosAdded };
  }

  /** One page only, no Next (the "Fill this page" button). */
  async function fillPage(doc, portalRules, values) {
    return fillStep(doc, portalRules, values, new Set(), { guard: true });
  }

  const api = { norm, describe, findControl, setValue, chooseOption, candidatesFor, matches, fillStep, fillPage, autopilot, attachPhotos, isSearchControl, MIN_MATCHES, NEXT, SUBMIT };
  root.SixtyFill = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
