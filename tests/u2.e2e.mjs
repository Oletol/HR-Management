// Unit 2 «The Effective Communicator» with the real course.json: import, student answers, teacher checks, screenshots.
// Run: python3 -m http.server 5055 -d docs &  node tests/u1.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-u2";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const course = JSON.parse(courseText);
const u1 = course.units.find((u) => u.id === "u2");
const ex = (id) => u1.sections.flatMap((s) => s.blocks).find((b) => b.id === id);
const ans = (id, it) => { const a = ex(id).items.find((x) => x.id === it).answer; return Array.isArray(a) ? a[0] : a; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("https://rutube.ru/**", (r) => r.fulfill({ contentType: "text/html", body: "<body style='background:#222;color:#fff;font:20px sans-serif;display:grid;place-items:center'>Rutube player</body>" }));
const errors = [];
const page = async (url, c = ctx) => {
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url);
  return p;
};
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const step = (t) => console.log("•", t);
const sel = (e, it) => `[data-ex="${e}"][data-item="${it}"]`;

const t = await page("/teacher.html");
await t.evaluate(() => {
  localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } }));
  localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "Teacher" } }));
});
await t.reload();
await t.fill("#auth-form [name=email]", "teacher@uni.ru");
await t.fill("#auth-form [name=password]", "secret1");
await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");

step("Import of content-private/course.json");
await t.click('a[href="#tools/content"]');
await t.waitForSelector("#import-text");
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]");
await t.waitForSelector('td:has-text("Models and Processes of Communication")');
const db = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
const pub = JSON.stringify(db["unitContent/u1"]);
for (const bad of ['"answer"', "Script for Audio", "Daniel Ferreira", "Key:", "Model answer"]) assert.ok(!pub.includes(bad), "public content contains " + bad);
assert.equal(db["answerKeys/u1"].exercises.g3["1a"], "was speaking");
await shot(t, "00-teacher-import");

step("Group, student, unit opened");
await t.click('a[href="#tools/groups"]');
await t.waitForSelector("#g-name");
await t.fill("#g-name", "HR-1");
await t.fill("#g-code", "hr-1");
await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('HR-1')");
const s = await page("/index.html");
await s.click("[data-mode=register]");
await s.fill("[name=name]", "Anna Ivanova");
await s.fill("[name=email]", "anna@uni.ru");
await s.fill("[name=password]", "pass123");
await s.fill("[name=group]", "hr-1");
await s.click("#auth-submit");
await s.waitForSelector("text=No units are open yet");
assert.equal(await s.locator(".sb-uh").count(), 5);
await t.click('a[href="#tools/access"]');
await t.click("[data-act=toggle-open][data-unit=u2]");
await s.waitForSelector('.sb-uh[data-unit="u2"][data-can-open="1"]', { timeout: 5000 });
await s.click('.sb-uh[data-unit="u2"]');

await s.click('.sb-item:has-text("Warm-up")');
await s.waitForSelector("#ex-w2");
const text = await s.evaluate(() => document.body.innerText);
assert.ok(!/Key:|Teaching notes|Model answer/.test(text), "key visible");
assert.ok(!/[\u2190\u2192\u21d2\u00ab\u00bb\u203a\u25b6]/.test(text), "arrow");
await shot(s, "s0-top", true);
step("Student answers");
for (const it of ex("w2").items) await s.fill(sel("w2", it.id), ans("w2", it.id));
await s.fill(sel("w2", "1"), "charisma");
for (const it of ex("w4").items) await s.selectOption(sel("w4", it.id), ans("w4", it.id));
await s.fill(sel("w3", "10"), "ill advised");
await s.fill(sel("w3", "4"), "overwhelmed");
await s.selectOption(sel("w5", "1"), "logos");
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 5000 });
step("Teacher checks");
await t.click('.sb-uh[data-unit="u2"]').catch(() => {});
const check = async (id, expect) => {
  await t.click('.sb-item[href$="u2/warmup"]');
  await t.waitForSelector(`[data-act="check-ex"][data-ex="${id}"]`);
  await t.click(`[data-act="check-ex"][data-ex="${id}"]`);
  await s.waitForSelector(`#ex-${id} .ex-score`, { timeout: 5000 });
  assert.equal((await s.textContent(`#ex-${id} .ex-score`)).trim(), expect, id);
};
await check("w2", "7 / 8");
await check("w4", "7 / 7");
await check("w3", "1 / 10");
await check("w5", "1 / 8");
for (const id of ["w2", "w3", "w4", "w5", "w6"]) await s.locator(`#ex-${id}`).screenshot({ path: `${SHOTS}/c-${id}.png` });
await t.waitForSelector("#view .tnote");
await shot(t, "t-warmup", true);
assert.deepEqual(errors, [], "page errors");
console.log("\nALL STEPS PASSED");
await browser.close();
