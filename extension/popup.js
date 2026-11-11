// Sixty extension · popup: pair with the portal, see what's waiting to be posted, start a listing.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res, rej) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? res(r.data) : rej(new Error(r?.error || chrome.runtime.lastError?.message || "No answer")))));
const NAME = { propertyfinder: "Property Finder", bayut: "Bayut" };
const aed = (n) => (n == null ? "" : `AED ${Math.round(n).toLocaleString("en-US")}`);

function error(msg) { $("error").hidden = !msg; $("error").textContent = msg || ""; }

function row(item, waiting) {
  const li = document.createElement("li");
  const t = document.createElement("div");
  t.className = "t";
  const b = document.createElement("b");
  b.textContent = item.title;
  const s = document.createElement("small");
  s.textContent = [NAME[item.portal], item.community, aed(item.price)].filter(Boolean).join(" · ");
  t.append(b, s);
  if (item.error) { const e = document.createElement("span"); e.className = "err"; e.textContent = item.error; t.append(e); }
  li.append(t);
  if (waiting) {
    const btn = document.createElement("button");
    btn.textContent = `Post on ${NAME[item.portal]}`;
    btn.onclick = async () => {
      btn.disabled = true;
      try { await send({ type: "startJob", listingId: item.listingId, portal: item.portal }); window.close(); }
      catch (e) { error(e.message); btn.disabled = false; }
    };
    li.append(btn);
  } else {
    const ok = document.createElement("span");
    ok.className = "ok";
    ok.textContent = item.status === "live" ? "✓ Live" : "Submitted";
    li.append(ok);
  }
  return li;
}

function fill(list, items, waiting, emptyText) {
  list.replaceChildren(...(items.length ? items.map((i) => row(i, waiting)) : [Object.assign(document.createElement("li"), { className: "empty", textContent: emptyText })]));
}

async function load() {
  error("");
  const st = await send({ type: "state" });
  const paired = Boolean(st.portalUrl && st.me);
  $("pair").hidden = paired;
  $("main").hidden = !paired;
  if (!paired) return;
  $("who").textContent = `${st.me.user.name} · ${st.me.workspace.name}`;
  $("openPortal").href = `${st.portalUrl}/proptech`;
  try {
    const q = await send({ type: "queue" });
    fill($("waiting"), q.waiting, true, "Nothing waiting. Approve a listing in Sixty and pick Property Finder or Bayut.");
    fill($("done"), q.done, false, "Nothing posted with the extension yet.");
  } catch (e) {
    error(e.message);
  }
}

$("pairBtn").onclick = async () => {
  $("pairBtn").disabled = true;
  try { await send({ type: "pair", code: $("code").value }); await load(); }
  catch (e) { error(e.message); }
  finally { $("pairBtn").disabled = false; }
};
$("unpair").onclick = async () => { await send({ type: "unpair" }); load(); };
$("refresh").onclick = async () => { await send({ type: "refreshConfig" }).catch(() => {}); load(); };
load();
