// Sixty extension · form-filling engine. Finds a portal's form fields by CSS selector or by their visible
// label, and sets values the way a person typing would (so React/Vue forms notice). No network access here.
(function (root) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[‏‎*:()]/g, " ").replace(/\s+/g, " ").trim();

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
    if (by) for (const id of by.split(/\s+/)) parts.push(doc.getElementById(id)?.textContent);
    // Text just above or before the control (common in custom form layouts).
    let p = el.parentElement;
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      const t = [...p.childNodes].filter((n) => n !== el && !n.contains?.(el)).map((n) => n.textContent || "").join(" ");
      if (t.trim()) { parts.push(t.slice(0, 120)); break; }
    }
    return norm(parts.filter(Boolean).join(" | "));
  }

  const CONTROLS = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, select, [contenteditable="true"]';

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
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
      if (used.has(el) || el.disabled || el.readOnly || !visible(el)) continue;
      const d = describe(el, doc);
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

  /** Pick a <select> option by the portal's wording for our value. */
  function chooseOption(select, candidates) {
    const wants = candidates.map(norm).filter(Boolean);
    const opts = [...select.options];
    const hit = opts.find((o) => wants.includes(norm(o.textContent)) || wants.includes(norm(o.value)))
      || opts.find((o) => wants.some((w) => norm(o.textContent).includes(w)));
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

  /**
   * Fill a page. Returns what was filled and what the agent still has to do by hand (custom dropdowns,
   * location pickers…), so the panel can offer a Copy button for those.
   */
  function fillPage(doc, portalRules, values) {
    const used = new Set();
    const filled = [], missing = [];
    for (const [key, rule] of Object.entries(portalRules.fields || {})) {
      const raw = values[key];
      const cands = candidatesFor(key, raw, rule);
      if (!cands.length) continue;
      const el = findControl(doc, rule, used);
      if (!el) { missing.push(key); continue; }
      const ok = el instanceof HTMLSelectElement ? chooseOption(el, cands) : setValue(el, cands[0]);
      if (ok) { used.add(el); filled.push(key); el.classList.add("sixty-filled"); } else missing.push(key);
    }
    return { filled, missing };
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

  const api = { norm, describe, findControl, setValue, chooseOption, candidatesFor, fillPage, attachPhotos };
  root.SixtyFill = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
