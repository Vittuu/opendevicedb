// Directory search island. Loads /api/index.json lazily (first interaction, or at once when
// the URL already carries a query), then runs core's own `search` in the browser and renders
// one page of results at a time — never the whole index in the DOM.
import { search, type IndexEntry } from "@opendevicedb/core";
import { STATUS_LABEL, displayName } from "../lib/config.ts";

const PAGE = 50;
const root = document.getElementById("directory")!;
const form = root.querySelector<HTMLFormElement>("form")!;
const qEl = form.querySelector<HTMLInputElement>("#q")!;
const catEl = form.querySelector<HTMLSelectElement>("#category")!;
const stEl = form.querySelector<HTMLSelectElement>("#status")!;
const srcEl = form.querySelector<HTMLSelectElement>("#source")!;
const list = root.querySelector<HTMLElement>("#results")!;
const count = root.querySelector<HTMLElement>("#count")!;
const pager = root.querySelector<HTMLElement>("#pager")!;
const sourceNames: Record<string, string> = JSON.parse(root.dataset.sources || "{}");

let index: IndexEntry[] | null = null;
let loading: Promise<IndexEntry[]> | null = null;
let page = 1;

function load(): Promise<IndexEntry[]> {
  if (index) return Promise.resolve(index);
  if (!loading) {
    count.textContent = "Loading the index…";
    loading = fetch("/api/index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: IndexEntry[]) => (index = data))
      .catch((e) => { count.textContent = `Could not load the index (${e.message}).`; loading = null; throw e; });
  }
  return loading;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function row(e: IndexEntry): string {
  const href = `/devices/${e.id}/`;
  const src = e.sources.length ? ` · from ${esc(e.sources.map((s) => sourceNames[s] ?? s).join(", "))}` : "";
  const claims = e.claims ? ` · ${e.claims} live claim${e.claims > 1 ? "s" : ""}` : "";
  const verified = e.verified ? `<span class="badge verified">Verified</span>` : "";
  return `<li><div class="dev-row"><a class="name" href="${href}">${esc(displayName(e.vendor, e.model))}</a>` +
    `<span class="row"><span class="badge s-${e.status}">${STATUS_LABEL[e.status] ?? e.status}</span>${verified}</span>` +
    `<span class="meta">${esc(e.category)} · <span class="mono">${esc(e.id)}</span>${src}${claims}</span></div></li>`;
}

function syncUrl() {
  const p = new URLSearchParams();
  if (qEl.value.trim()) p.set("q", qEl.value.trim());
  if (catEl.value) p.set("category", catEl.value);
  if (stEl.value) p.set("status", stEl.value);
  if (srcEl.value) p.set("source", srcEl.value);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function render() {
  if (!index) return;
  const pool = srcEl.value ? index.filter((e) => e.sources.includes(srcEl.value)) : index;
  const hits = search(pool, qEl.value, {
    category: catEl.value || undefined,
    status: (stEl.value || undefined) as IndexEntry["status"] | undefined,
    limit: Infinity,
  });
  const pages = Math.max(1, Math.ceil(hits.length / PAGE));
  if (page > pages) page = pages;
  const slice = hits.slice((page - 1) * PAGE, page * PAGE);
  list.innerHTML = slice.length ? slice.map(row).join("") :
    `<li class="empty">Nothing matches. Nothing known about this device? <a href="/contribute/">Add it</a>, or <a href="/contribute/#claims">claim it</a> before you start reverse engineering it.</li>`;
  const n = hits.length.toLocaleString("en");
  count.textContent = `${n} device${hits.length === 1 ? "" : "s"}${index.length !== hits.length ? ` of ${index.length.toLocaleString("en")}` : ""}`;
  pager.innerHTML = pages > 1
    ? `<button class="btn" data-go="${page - 1}" ${page === 1 ? "disabled" : ""}>← Previous</button>` +
      `<span class="muted">Page ${page} of ${pages.toLocaleString("en")}</span>` +
      `<button class="btn" data-go="${page + 1}" ${page === pages ? "disabled" : ""}>Next →</button>`
    : "";
  syncUrl();
}

let timer: number | undefined;
function update(resetPage = true) {
  if (resetPage) page = 1;
  clearTimeout(timer);
  timer = window.setTimeout(() => load().then(render, () => {}), index ? 80 : 0);
}

form.addEventListener("submit", (ev) => { ev.preventDefault(); update(); });
qEl.addEventListener("input", () => update());
for (const el of [catEl, stEl, srcEl]) el.addEventListener("change", () => update());
qEl.addEventListener("focus", () => { load().catch(() => {}); }, { once: true });
pager.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-go]");
  if (!b || b.disabled) return;
  page = Number(b.dataset.go);
  update(false);
  root.scrollIntoView({ block: "start" });
});

// Restore state from the URL (links from the home page, category links on device pages).
const params = new URLSearchParams(location.search);
const setIf = (el: HTMLInputElement | HTMLSelectElement, k: string) => { const v = params.get(k); if (v !== null) el.value = v; };
setIf(qEl, "q"); setIf(catEl, "category"); setIf(stEl, "status"); setIf(srcEl, "source");
page = Math.max(1, Number(params.get("page")) || 1);
if ([...params.keys()].length) update(false);
