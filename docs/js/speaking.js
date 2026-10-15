// Speaking: timers with an in-browser voice recorder (from the msupm2 course engine).
// The recording never leaves the browser: it is kept in memory as a blob, played back here and,
// if the student wants, saved to their own computer with "Download". Reloading the page clears it.
import { registerSpeaking, esc } from "./common.js?v=20261015h5";

const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SPK = new Map();   // key -> state (survives re-rendering of the page)
const fmtT = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const RING = 2 * Math.PI * 14;

function speakingHTML(t, key) {
  const sec = Number(t.sec || 0), rec = t.record !== false;
  return `<div class="spk" data-spk="${esc(key)}" data-sec="${sec}" data-rec="${rec ? 1 : 0}" translate="no">
    ${t.label ? `<span class="spk-lab">${esc(t.label)}</span>` : ""}
    ${sec ? `<svg class="spk-ring" viewBox="0 0 34 34" aria-hidden="true"><circle class="bgc" cx="17" cy="17" r="14"/><circle class="fgc" cx="17" cy="17" r="14" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
      <span class="spk-time">${fmtT(sec)}</span>` : ""}
    <div class="spk-btns">
      ${sec ? `<button class="btn small" type="button" data-spk-act="start">Start</button><button class="btn small" type="button" data-spk-act="reset">Reset</button>` : ""}
      ${rec ? `<button class="btn small rec" type="button" data-spk-act="rec"><span class="rec-dot"></span><span class="rl">Record</span></button>` : ""}
    </div>
    ${rec ? `<div class="spk-takes"></div><p class="spk-note">${sec ? "Record also starts the timer. " : ""}Your recording stays in this browser: nobody else hears it, and it disappears when you reload or close the page. Use Download to keep a copy or to send it to your teacher.</p>` : ""}
  </div>`;
}
registerSpeaking(speakingHTML);

function state(el) {
  const key = el.dataset.spk;
  if (!SPK.has(key)) SPK.set(key, { sec: +el.dataset.sec, left: +el.dataset.sec, running: false, timer: null, rec: null, stream: null, takes: [], err: "" });
  return SPK.get(key);
}
const nodesOf = (key) => $$(`.spk[data-spk="${CSS.escape(key)}"]`);

function syncSpk(el) {
  const st = state(el);
  el.classList.toggle("run", st.running);
  el.classList.toggle("end", st.sec > 0 && st.left <= 0);
  const tm = el.querySelector(".spk-time");
  if (tm) tm.textContent = fmtT(st.left);
  const ring = el.querySelector(".fgc");
  if (ring) ring.setAttribute("stroke-dashoffset", String(RING * (1 - (st.sec ? st.left / st.sec : 0))));
  const sb = el.querySelector('[data-spk-act="start"]');
  if (sb) sb.textContent = st.running ? "Pause" : st.left < st.sec && st.left > 0 ? "Continue" : "Start";
  const rb = el.querySelector('[data-spk-act="rec"]');
  if (rb) { rb.classList.toggle("on", !!st.rec); rb.querySelector(".rl").textContent = st.rec ? "Stop recording" : "Record"; }
  const box = el.querySelector(".spk-takes");
  if (box) {
    const sig = st.takes.map((t) => t.url).join("|") + st.err;
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = (st.err ? `<div class="spk-take" style="color:var(--bad)">${esc(st.err)}</div>` : "")
        + st.takes.map((t, i) => `<div class="spk-take"><span class="tk-n">Take ${i + 1}</span><audio controls src="${t.url}"></audio>
          <span class="muted" style="font-size:12px">${fmtT(Math.round(t.dur))}</span>
          <a href="${t.url}" download="${esc(t.name)}">Download</a></div>`).join("");
    }
  }
}
const syncKey = (key) => nodesOf(key).forEach(syncSpk);

function tick(key) {
  const st = SPK.get(key);
  st.left -= 1;
  if (st.left <= 0) {
    st.left = 0; stopTimer(st); beep();
    if (st.rec) stopRec(key);
  }
  syncKey(key);
}
function startTimer(key) {
  const st = SPK.get(key);
  if (!st.sec || st.running) return;
  if (st.left <= 0) st.left = st.sec;
  st.running = true;
  st.timer = setInterval(() => tick(key), 1000);
}
function stopTimer(st) { st.running = false; clearInterval(st.timer); st.timer = null; }

async function spkAction(b) {
  const el = b.closest(".spk"), key = el.dataset.spk, st = state(el), act = b.dataset.spkAct;
  if (act === "start") { st.running ? stopTimer(st) : startTimer(key); }
  if (act === "reset") { stopTimer(st); st.left = st.sec; if (st.rec) stopRec(key); }
  if (act === "rec") { st.rec ? stopRec(key) : await startRec(key); }
  syncKey(key);
}

function pickType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
async function startRec(key) {
  const st = SPK.get(key);
  st.err = "";
  const type = pickType();
  if (type === null || !navigator.mediaDevices?.getUserMedia) { st.err = "This browser cannot record sound. Please try Chrome, Edge, Firefox or Safari."; return; }
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    st.err = "The microphone is not available. Allow access to the microphone in the browser (the icon in the address bar) and try again.";
    return;
  }
  const rec = new MediaRecorder(st.stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const mime = rec.mimeType || type || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    const ext = /mp4/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
    const url = URL.createObjectURL(blob);
    st.takes.push({ url, dur: (Date.now() - t0) / 1000, name: `speaking-${key}-take${st.takes.length + 1}.${ext}` });
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    syncKey(key);
  };
  rec.start(1000);
  st.rec = rec;
  if (st.sec && !st.running) startTimer(key);
}
function stopRec(key) {
  const st = SPK.get(key);
  if (!st?.rec) return;
  try { st.rec.stop(); } catch {}
  st.rec = null;
  if (st.running) stopTimer(st);
}

let actx = null;
function beep() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.35);
  } catch {}
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-spk-act]");
  if (b) { e.preventDefault(); e.stopPropagation(); spkAction(b); }
}, true);
// after the page has been drawn again, restore the timers' state (but not after our own updates)
let pending = false;
new MutationObserver((ms) => {
  if (pending || !ms.some((m) => m.target.nodeType === 1 && !m.target.closest(".spk"))) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; $$(".spk").forEach(syncSpk); });
}).observe(document.documentElement, { childList: true, subtree: true });
