const $ = id => document.getElementById(id);
const STATUSES = ["New", "Contacted", "Converted", "Lost"];
const COLORS = { New: "#06b6d4", Contacted: "#f59e0b", Converted: "#22c55e", Lost: "#ef4444" };
const BADGE = {
  New: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40", Contacted: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Converted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", Lost: "bg-red-500/15 text-red-300 border-red-500/40"
};
const z = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
const money = n => "R " + Math.round(n).toLocaleString("en-US");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- SUPABASE ----------
const CFG = window.APP_CONFIG || {};
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:#cbd5e1">Open config.js and add your Supabase URL and anon key.</p>';
  throw new Error("Supabase config missing");
}
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
let leads = [], channel = null, booted = false;

const fromRow = r => ({ id: r.id, name: r.full_name, phone: r.whatsapp_number, email: r.email_address || "", status: r.status,
  value: Number(r.deal_value) || 0, source: r.source || "", campaign: r.campaign || "", ad: r.ad || "", interest: r.interest || "",
  medium: r.utm_medium || "", term: r.utm_term || "", fbclid: r.fbclid || "",
  score: r.score || 0, temp: r.temperature || "Cold", notes: r.notes || "", contacted_at: r.contacted_at,
  created_at: r.created_at, date: ymd(new Date(r.created_at)) });

async function loadLeads() {
  let all = [], from = 0;
  for (;;) { // fetch in pages of 1000 (Supabase default limit)
    const { data, error } = await sb.from("leads").select("*").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  leads = all.map(fromRow);
}
function setLive(ok) {
  $("live").innerHTML = '<span class="inline-block h-2 w-2 rounded-full ' + (ok ? "bg-emerald-400" : "bg-slate-500") + '"></span> ' + (ok ? "Live" : "Offline");
}
function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-xl " + (bad ? "bg-red-500 text-white" : "bg-cyan-500 text-slate-950");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ---------- STATE ----------
let range = "30";
function rangeStart() {
  const n = new Date(); n.setHours(0, 0, 0, 0);
  if (range === "30") { n.setDate(n.getDate() - 30); return n; }
  if (range === "q") return new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1);
  return new Date(n.getFullYear(), 0, 1);
}
const inRange = () => { const s = ymd(rangeStart()); return leads.filter(l => l.date >= s); };

// ---------- CHARTS ----------
Chart.defaults.color = "#94a3b8";
Chart.defaults.font.family = "ui-sans-serif, system-ui, sans-serif";
const grid = { color: "rgba(148,163,184,.08)" };
const trend = new Chart($("trend"), {
  type: "line",
  data: { labels: [], datasets: [{ label: "Revenue (ZAR)", data: [], borderColor: "#06b6d4", borderWidth: 3, fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: "#06b6d4",
    backgroundColor: c => { const a = c.chart.chartArea; if (!a) return null; const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, "rgba(6,182,212,.4)"); g.addColorStop(1, "rgba(6,182,212,0)"); return g; } }] },
  options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => " " + money(c.parsed.y) } } },
    scales: { x: { grid }, y: { grid, beginAtZero: true, ticks: { callback: v => v.toLocaleString("en-US") } } } }
});
const donut = new Chart($("donut"), {
  type: "doughnut",
  data: { labels: STATUSES, datasets: [{ data: [0, 0, 0, 0], backgroundColor: STATUSES.map(s => COLORS[s]), borderColor: "#0F172A", borderWidth: 3 }] },
  options: { maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, padding: 16 } } } }
});

// ---------- RENDER ----------
function render() {
  const data = inRange();
  const conv = data.filter(l => l.status === "Converted");
  const rev = conv.reduce((a, l) => a + l.value, 0);
  $("s-rev").textContent = money(rev);
  $("s-rev-sub").textContent = conv.length + " converted deal" + (conv.length === 1 ? "" : "s");
  $("s-leads").textContent = data.length;
  $("s-leads-sub").textContent = data.filter(l => l.status === "New").length + " still new";
  $("s-conv").textContent = (data.length ? (conv.length / data.length * 100).toFixed(1) : "0.0") + "%";
  $("s-conv-sub").textContent = conv.length + " of " + data.length + " converted";
  $("s-avg").textContent = money(conv.length ? rev / conv.length : 0);

  donut.data.datasets[0].data = STATUSES.map(s => data.filter(l => l.status === s).length);
  donut.update();

  const now = new Date(), labels = [], keys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(d.getFullYear() + "-" + z(d.getMonth() + 1)); labels.push(d.toLocaleString("en-US", { month: "short" }));
  }
  trend.data.labels = labels;
  trend.data.datasets[0].data = keys.map(k => leads.filter(l => l.status === "Converted" && l.date.startsWith(k)).reduce((a, l) => a + l.value, 0));
  trend.update();

  extras(data);
  renderTable();
}

// ---------- LEAD TOOLS: temperature, WhatsApp, follow-up, metrics ----------
const TEMP = {
  Hot: ["🔥 HOT", "bg-red-500/15 text-red-300 border-red-500/40"],
  Warm: ["⚡ WARM", "bg-amber-500/15 text-amber-300 border-amber-500/40"],
  Cold: ["❄️ COLD", "bg-sky-500/15 text-sky-300 border-sky-500/40"]
};
let followOnly = false;
const needsFollowUp = l => !l.contacted_at && l.status === "New";
const firstName = n => n.trim().split(/\s+/)[0] || n;
function waLink(l) {
  let d = l.phone.replace(/\D/g, ""); if (d.startsWith("0")) d = "27" + d.slice(1);
  const topic = l.interest === "Products" ? "the products" : l.interest === "Business" ? "how the business side works" : "the products and the business side";
  const msg = "Hi " + firstName(l.name) + ", it's " + (CFG.OWNER_NAME || "Bailey") + " 😊 Thanks for requesting a free chat about " + topic +
    ". When is a good time for a quick chat?";
  return "https://wa.me/" + d + "?text=" + encodeURIComponent(msg);
}
function fmtDur(ms) {
  const m = Math.round(ms / 60000); if (m < 1) return "<1 min"; if (m < 60) return m + " min";
  const h = m / 60; return h < 24 ? h.toFixed(1) + " hrs" : (h / 24).toFixed(1) + " days";
}
async function markContacted(l) {
  const patch = { contacted_at: new Date().toISOString() }; if (l.status === "New") patch.status = "Contacted";
  const { error } = await sb.from("leads").update(patch).eq("id", l.id);
  if (error) return toast("Could not save: " + error.message, true);
  l.contacted_at = patch.contacted_at; if (patch.status) l.status = "Contacted"; render();
}

function visibleLeads() {
  const q = $("search").value.trim().toLowerCase(), st = $("filter").value, tp = $("temp-filter").value, sort = $("sort").value;
  const qd = q.replace(/\D/g, "");
  const base = followOnly ? leads : inRange(); // "Follow up today" ignores the date range: nobody gets forgotten
  const byNew = (a, b) => b.created_at.localeCompare(a.created_at);
  return base.filter(l => (!st || l.status === st) && (!tp || l.temp === tp) && (!followOnly || needsFollowUp(l)) &&
    (!q || l.name.toLowerCase().includes(q) || (l.email || "").toLowerCase().includes(q) || (qd && l.phone.replace(/\D/g, "").includes(qd)) || l.phone.toLowerCase().includes(q)))
    .sort(sort === "new" ? byNew : sort === "old" ? (a, b) => byNew(b, a) : (a, b) => (b.score - a.score) || byNew(a, b));
}

const statusSelect = l => `<select data-id="${esc(l.id)}" class="rounded-full border px-3 py-1.5 text-xs font-semibold focus:outline-none ${BADGE[l.status]}">${STATUSES.map(s => `<option${s === l.status ? " selected" : ""}>${s}</option>`).join("")}</select>`;
const rowHtml = l => {
  const t = TEMP[l.temp] || TEMP.Cold;
  return `
    <tr class="transition hover:bg-slate-800/40">
      <td class="py-3 pr-3"><span class="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${t[1]}" title="Score ${l.score} of 3">${t[0]}</span></td>
      <td class="pr-3 font-medium text-white">${esc(l.name)}${l.email ? '<div class="text-xs font-normal text-slate-500">' + esc(l.email) + '</div>' : ''}${l.interest ? '<div class="text-xs font-normal text-cyan-300/80">' + esc(l.interest) + '</div>' : ''}${l.notes ? '<div class="text-xs font-normal text-slate-500">📝 ' + esc(l.notes.slice(0, 60)) + '</div>' : ''}</td>
      <td class="pr-3 text-slate-300">${esc(l.phone)}</td>
      <td class="pr-3">${statusSelect(l)}</td>
      <td class="pr-3"><button data-val="${esc(l.id)}" class="text-slate-200 transition hover:text-cyan-400" title="Edit deal value">${money(l.value)} <i class="fa-solid fa-pen text-[10px] text-slate-600"></i></button></td>
      <td class="pr-3 text-slate-400">${esc(l.date)}${l.contacted_at ? '<div class="text-xs text-emerald-400">✓ contacted</div>' : ''}</td>
      <td class="whitespace-nowrap text-right">
        <a data-wa="${esc(l.id)}" href="${esc(waLink(l))}" target="_blank" rel="noopener" class="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-green-500" title="Open WhatsApp with a ready message"><i class="fa-brands fa-whatsapp"></i> Message</a>
        <button data-note="${esc(l.id)}" class="rounded-md px-2 py-1 text-slate-500 transition hover:text-cyan-400" title="Notes"><i class="fa-solid fa-note-sticky"></i></button>
        <button data-del="${esc(l.id)}" class="rounded-md px-2 py-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400" title="Delete lead"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
};
// Phone layout: one card per lead, big WhatsApp button
const cardHtml = l => {
  const t = TEMP[l.temp] || TEMP.Cold;
  return `<div class="rounded-2xl border border-slate-800 bg-[#020617]/60 p-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0"><p class="truncate font-semibold text-white">${esc(l.name)}</p><p class="text-xs text-cyan-300/80">${esc(l.interest || "No answer")}</p></div>
      <span class="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${t[1]}">${t[0]}</span></div>
    <p class="mt-2 text-sm text-slate-300">${esc(l.phone)}</p>${l.email ? '<p class="truncate text-xs text-slate-500">' + esc(l.email) + '</p>' : ''}
    <div class="mt-3 flex items-center justify-between gap-2">${statusSelect(l)}
      <button data-val="${esc(l.id)}" class="text-sm text-slate-200">${money(l.value)} <i class="fa-solid fa-pen text-[10px] text-slate-600"></i></button></div>
    <div class="mt-3 flex items-center gap-2">
      <a data-wa="${esc(l.id)}" href="${esc(waLink(l))}" target="_blank" rel="noopener" class="flex-1 rounded-xl bg-green-600 py-3 text-center font-bold text-white"><i class="fa-brands fa-whatsapp"></i> Message on WhatsApp</a>
      <button data-note="${esc(l.id)}" class="rounded-lg border border-slate-700 px-3 py-3 text-slate-400" title="Notes"><i class="fa-solid fa-note-sticky"></i></button>
      <button data-del="${esc(l.id)}" class="rounded-lg border border-slate-700 px-3 py-3 text-slate-500" title="Delete lead"><i class="fa-solid fa-trash"></i></button></div>
    <p class="mt-2 text-xs text-slate-500">${esc(l.date)}${l.contacted_at ? ' · <span class="text-emerald-400">✓ contacted</span>' : ''}${l.notes ? ' · 📝 ' + esc(l.notes.slice(0, 40)) : ''}</p></div>`;
};

function renderTable() {
  const list = visibleLeads();
  $("rows").innerHTML = list.map(rowHtml).join("");
  $("cards").innerHTML = list.map(cardHtml).join("");
  $("empty").classList.toggle("hidden", list.length > 0);
  $("empty").textContent = leads.length ? "No leads match your filters." : "No leads yet. Tap Add Lead to log your first one.";
  $("count").textContent = "Showing " + list.length + " of " + (followOnly ? leads.length : inRange().length) + " leads" + (followOnly ? " (all time)" : " in this period");
}

function extras(data) {
  const waiting = leads.filter(needsFollowUp), hot = waiting.filter(l => l.temp === "Hot").length;
  $("follow-count").textContent = waiting.length;
  $("hot-bar").textContent = "🔥 " + hot + " hot lead" + (hot === 1 ? " hasn't" : "s haven't") + " been messaged yet. Tap to see them.";
  $("hot-bar").classList.toggle("hidden", hot === 0);
  const done = data.filter(l => l.contacted_at);
  const avg = done.length ? done.reduce((a, l) => a + Math.max(0, new Date(l.contacted_at) - new Date(l.created_at)), 0) / done.length : 0;
  $("s-resp").textContent = done.length ? fmtDur(avg) : "–";
  $("s-resp-sub").textContent = waiting.length + " waiting for a first message";
  const g = {};
  data.forEach(l => {
    const k = (l.campaign || "Direct / unknown") + (l.ad ? " · " + l.ad : ""), r = g[k] || (g[k] = { n: 0, hot: 0, conv: 0, rev: 0 });
    r.n++; if (l.temp === "Hot") r.hot++; if (l.status === "Converted") { r.conv++; r.rev += l.value; }
  });
  const rows = Object.entries(g).sort((a, b) => b[1].n - a[1].n);
  $("by-campaign").innerHTML = rows.length ? rows.map(([k, r]) => `<tr><td class="py-2 pr-3 text-white">${esc(k)}</td><td class="pr-3">${r.n}</td><td class="pr-3 text-red-300">${r.hot}</td><td class="pr-3 text-emerald-300">${r.conv}</td><td>${money(r.rev)}</td></tr>`).join("")
    : '<tr><td class="py-4 text-slate-500" colspan="5">No leads in this period yet.</td></tr>';
}

// ---------- REAL-TIME + AUTH ----------
function onChange(p) {
  if (p.eventType === "INSERT") {
    const l = fromRow(p.new);
    if (!leads.some(x => x.id === l.id)) { leads.unshift(l); toast("New lead: " + l.name); }
  } else if (p.eventType === "UPDATE") {
    const l = fromRow(p.new), i = leads.findIndex(x => x.id === l.id);
    if (i >= 0) leads[i] = l; else leads.unshift(l);
  } else if (p.eventType === "DELETE") {
    leads = leads.filter(x => x.id !== p.old.id);
  }
  render();
}
async function boot() {
  if (booted) return; booted = true;
  // RLS is the real guard; this just explains the empty dashboard to a non-allowlisted account.
  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (!adminErr && isAdmin === false) {
    booted = false; toast("This account is not allowed to view leads.", true); sb.auth.signOut(); return;
  }
  try { await loadLeads(); render(); } catch (e) { toast("Could not load leads: " + e.message, true); }
  channel = sb.channel("leads-live").on("postgres_changes", { event: "*", schema: "public", table: "leads" }, onChange)
    .subscribe(s => setLive(s === "SUBSCRIBED"));
}
function teardown() {
  booted = false;
  if (channel) { sb.removeChannel(channel); channel = null; }
  leads = []; render(); setLive(false);
}

// ---------- EVENTS ----------
document.querySelectorAll(".range-btn").forEach(b => b.addEventListener("click", () => {
  range = b.dataset.range;
  document.querySelectorAll(".range-btn").forEach(x => { x.classList.toggle("active", x === b); x.classList.toggle("text-slate-300", x !== b); });
  render();
}));
$("search").addEventListener("input", renderTable);
$("filter").addEventListener("change", renderTable);
["temp-filter", "sort"].forEach(id => $(id).addEventListener("change", renderTable));
function toggleFollow(on) { followOnly = on; $("follow-btn").classList.toggle("ring-2", on); $("follow-btn").classList.toggle("ring-cyan-400", on); renderTable(); }
$("follow-btn").addEventListener("click", () => toggleFollow(!followOnly));
$("hot-bar").addEventListener("click", () => { $("temp-filter").value = ""; $("sort").value = "hot"; toggleFollow(true); $("rows").scrollIntoView({ behavior: "smooth" }); });

document.addEventListener("change", async e => {
  const id = e.target.dataset.id; if (!id) return;
  const l = leads.find(x => x.id === id); if (!l) return;
  const status = e.target.value, patch = { status };
  if (status !== "New" && !l.contacted_at) patch.contacted_at = new Date().toISOString();
  if (status === "Converted" && !l.value) {
    const v = Number(prompt("Deal value in rand (e.g. 1800)?", ""));
    if (v > 0) patch.deal_value = Math.round(v);
  }
  const { error } = await sb.from("leads").update(patch).eq("id", id);
  if (error) toast("Could not update: " + error.message, true);
  else { l.status = status; if (patch.deal_value) l.value = patch.deal_value; if (patch.contacted_at) l.contacted_at = patch.contacted_at; }
  render();
});
document.addEventListener("click", async e => {
  const del = e.target.closest("[data-del]"), val = e.target.closest("[data-val]"), wa = e.target.closest("[data-wa]"), note = e.target.closest("[data-note]");
  if (wa) { const l = leads.find(x => x.id === wa.dataset.wa); if (l && !l.contacted_at) markContacted(l); return; }
  if (note) { openNote(note.dataset.note); return; }
  if (del) {
    if (!confirm("Delete this lead?")) return;
    const { error } = await sb.from("leads").delete().eq("id", del.dataset.del);
    if (error) return toast("Could not delete: " + error.message, true);
    leads = leads.filter(x => x.id !== del.dataset.del); render();
  } else if (val) {
    const l = leads.find(x => x.id === val.dataset.val); if (!l) return;
    const v = prompt("Deal value in rand:", l.value || ""); if (v === null) return;
    const n = Number(v); if (!(n >= 0)) return toast("Enter a valid amount", true);
    const { error } = await sb.from("leads").update({ deal_value: Math.round(n) }).eq("id", l.id);
    if (error) return toast("Could not update: " + error.message, true);
    l.value = Math.round(n); render();
  }
});

// Notes (call history)
let noteId = null;
function openNote(id) {
  const l = leads.find(x => x.id === id); if (!l) return;
  noteId = id; $("note-title").textContent = "Notes: " + l.name; $("note-text").value = l.notes;
  $("note-modal").classList.remove("hidden"); $("note-modal").classList.add("flex"); $("note-text").focus();
}
const closeNote = () => { $("note-modal").classList.add("hidden"); $("note-modal").classList.remove("flex"); };
$("note-cancel").addEventListener("click", closeNote);
$("note-form").addEventListener("submit", async e => {
  e.preventDefault();
  const l = leads.find(x => x.id === noteId); if (!l) return;
  const notes = $("note-text").value.trim();
  const { error } = await sb.from("leads").update({ notes }).eq("id", noteId);
  if (error) return toast("Could not save notes: " + error.message, true);
  l.notes = notes; closeNote(); render();
});

// Modal
const modal = $("modal");
const openModal = () => { $("lead-form").reset(); $("f-err").classList.add("hidden"); modal.classList.remove("hidden"); modal.classList.add("flex"); $("f-name").focus(); };
const closeModal = () => { modal.classList.add("hidden"); modal.classList.remove("flex"); };
$("add-btn").addEventListener("click", openModal);
$("close-modal").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeNote(); } });
$("lead-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("f-err"), name = $("f-name").value.trim(), email = $("f-email").value.trim(), value = Number($("f-value").value);
  let phone = $("f-phone").value.replace(/[\s\-()]/g, "");
  if (phone.startsWith("0")) phone = "+27" + phone.slice(1);
  if (name.length < 2 || !/^\+?\d{9,15}$/.test(phone) || (email && !/^\S+@\S+\.\S+$/.test(email)) || !(value >= 0)) {
    err.textContent = "Please enter a valid name, phone number, email (optional) and deal value."; err.classList.remove("hidden"); return;
  }
  const { data, error } = await sb.from("leads").insert({ full_name: name, whatsapp_number: phone, email_address: email || null,
    status: $("f-status").value, deal_value: Math.round(value), source: "dashboard",
    interest: $("f-interest").value || null }).select().single();
  if (error) { err.textContent = "Could not save: " + error.message; err.classList.remove("hidden"); return; }
  if (!leads.some(x => x.id === data.id)) leads.unshift(fromRow(data));
  closeModal(); render();
});

// CSV export (rows currently shown in the table)
$("export-btn").addEventListener("click", () => {
  const cell = v => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const rows = [["Name", "Phone", "Email", "Status", "Temperature", "Interest", "Deal Value (ZAR)", "Source", "Medium", "Campaign", "Ad", "Ad Set", "fbclid", "Date Added"]]
    .concat(visibleLeads().map(l => [l.name, l.phone, l.email, l.status, l.temp, l.interest, l.value, l.source, l.medium, l.campaign, l.ad, l.term, l.fbclid, l.date]));
  const blob = new Blob(["\ufeff" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "leads-" + ymd(new Date()) + ".csv";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Login / logout
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("l-err"); err.classList.add("hidden");
  const { error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value });
  if (error) { err.textContent = "Incorrect email or password."; err.classList.remove("hidden"); } else $("l-pass").value = "";
});
$("signout").addEventListener("click", () => sb.auth.signOut());
// Phones resume from the background with a dead connection: refresh when the app is opened again
document.addEventListener("visibilitychange", () => { if (!document.hidden && booted) loadLeads().then(render).catch(() => {}); });

// Don't await Supabase calls inside this callback (use setTimeout), per Supabase guidance
sb.auth.onAuthStateChange((event, session) => {
  if (session) { $("login").classList.add("hidden"); $("who").textContent = session.user.email; setTimeout(boot, 0); }
  else { $("login").classList.remove("hidden"); teardown(); }
});

// PWA: offline shell + installable app
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
