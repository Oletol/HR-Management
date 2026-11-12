// HR Management: Unit 3 Reading, the grammar check (course rules + LanguageTool + Harper),
// unit grammar in the feedback and in Writing progress, Analytics with drafts, Word export.
// Run: python3 -m http.server 5055 -d docs &  node tests/hr-u3.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-hr-u3";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const course = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
let ltCalls = 0;
await ctx.route("https://api.languagetool.org/**", async (r) => {
  ltCalls++;
  const text = new URLSearchParams(r.request().postData()).get("text") || "";
  const i = text.indexOf("was took");
  const matches = i < 0 ? [] : [{ offset: i, length: 8, message: "LT: wrong participle.", shortMessage: "", replacements: [{ value: "was taken" }],
    rule: { issueType: "grammar", category: { name: "Grammar" } } }];
  await r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ matches }) });
});
const errors = [];
const page = async (url) => {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(url + " console: " + m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url);
  return p;
};
const step = (x) => console.log("•", x);
const sel = (ex, it) => `[data-ex="${ex}"][data-item="${it}"]`;

const t = await page("/teacher.html");
await t.evaluate(() => {
  localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } }));
  localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "Teacher" } }));
});
await t.reload();
await t.fill("#auth-form [name=email]", "teacher@uni.ru"); await t.fill("#auth-form [name=password]", "secret1"); await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");

step("Import of the course");
await t.click('a[href="#tools/content"]');
await t.waitForSelector("#import-text");
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, course);
await t.click("[data-act=import]");
await t.waitForSelector('td:has-text("Interpersonal and Group Communication")');
const db0 = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
assert.deepEqual(db0["unitContent/u3"].grammar, ["passive", "infinitive"], "unit grammar kept in the content");
assert.ok(!JSON.stringify(db0["unitContent/u3"]).includes('"answer":'), "no keys in unitContent");

step("A group; Unit 3 is opened");
await t.click('a[href="#tools/groups"]'); await t.waitForSelector("#g-name");
await t.fill("#g-name", "HR-1"); await t.fill("#g-code", "hr-1"); await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('HR-1')");
const s = await page("/index.html");
await s.click("[data-mode=register]");
await s.fill("[name=name]", "Anna Smith"); await s.fill("[name=email]", "anna@x.com"); await s.fill("[name=password]", "pass123"); await s.fill("[name=group]", "hr-1");
await s.click("#auth-submit");
await s.waitForSelector("text=No units are open yet");
await t.click('a[href="#tools/access"]');
await t.click("[data-act=toggle-open][data-unit=u3]");
await s.waitForSelector('.sb-uh[data-unit="u3"][data-can-open="1"]', { timeout: 5000 });
await s.click('.sb-uh[data-unit="u3"]');
await s.click('.sb-item[href^="#u3/"]:has-text("Reading")');
await s.waitForSelector("#ex-r16");
assert.equal(await s.locator(".rtext").count(), 3, "three texts");
assert.equal(await s.locator(".gapped").count(), 1, "sentences for the gapped text");
await s.locator(".rtext").first().screenshot({ path: `${SHOTS}/05-text-a.png` });
for (const id of ["r1", "r2", "r5", "r8", "r13"]) await s.locator("#ex-" + id).screenshot({ path: `${SHOTS}/06-${id}.png` });
assert.ok(await s.locator(`${sel("r4", "1")}[readonly]`).count() === 1, "the transcript cannot be typed");
assert.ok((await s.textContent("#content")).match(/→|←|›/) === null, "no arrows");

step("The learner answers (autosave)");
await s.selectOption(sel("r1", "1"), "D");
await s.selectOption(sel("r1", "2"), "B");
await s.fill(sel("r8", "1"), "is believed to have changed");
await s.fill(sel("r8", "5"), "is said to prepare");
await s.fill(sel("r13", "5"), "The employees must be told about the new rules before Monday.");
const essay = "I am agree with the statement only partly. It is said that men are task-oriented and interrupt more, but the decision about training was took too quickly. "
  + "Research seems to show that most differences are small, and people afraid to speak in meetings are found in both groups. "
  + "As I see it, all staff should be offered the same course, and clear rules are expected to help everyone. Having said that, managers tend to forget the rules.";
await s.fill(sel("r16", "1"), essay);
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });

step("Teacher: Answers shown, choose the student");
await t.evaluate(() => { location.hash = "#u3/reading"; });
await t.waitForSelector("#view-as");
await t.waitForFunction(() => document.querySelector("#view-as")?.options.length > 1, null, { timeout: 6000 });
await t.selectOption("#view-as", { index: 1 });
await t.waitForFunction(() => (document.querySelector('[data-ex="r16"][data-item="1"]')?.value || "").startsWith("I am agree"), null, { timeout: 6000 });
await t.locator("#ex-r1").screenshot({ path: `${SHOTS}/01-teacher-answers-shown.png` });
await t.selectOption("#view-as", { index: 0 });

step("Check the writing: course rules + LanguageTool + Harper, unit grammar, level");
await t.click('[data-act="check-writing"][data-ex="r16"]');
await s.waitForSelector("#ex-r16 .wfb", { timeout: 60000 });
const fb = await s.textContent("#ex-r16 .wfb");
assert.ok(ltCalls >= 1, "LanguageTool was called");
assert.ok(/I am agree/.test(fb) && /course rule/i.test(fb), "course rule: I am agree");
assert.ok(/was took/.test(fb) && /was taken/.test(fb), "was took found");
assert.ok(/people afraid to/i.test(fb), "missing be found");
assert.ok(/Unit grammar used/.test(fb) && /Complex subject/.test(fb) && /is said/.test(fb), "unit grammar listed");
assert.ok(/Vocabulary level: [ABC][12]/.test(fb), "vocabulary level");
await s.locator("#ex-r16 .wfb").screenshot({ path: `${SHOTS}/02-feedback.png` });
const harperOk = await t.evaluate(async () => { try { const w = await import("./js/writing.js"); const r = await w.checkGrammar({ a: "She gave me many advices." }); return { n: r.issues.a.length, h: r.harperError }; } catch (e) { return { err: String(e) }; } });
console.log("   Harper in the browser:", JSON.stringify(harperOk));
assert.equal(harperOk.h, false, "Harper loaded in the browser");

step("Writing progress shows the text with unit grammar");
await t.evaluate(() => { location.hash = "#tools/writing"; });
await t.waitForSelector("th:has-text('Unit grammar')", { timeout: 15000 });
const wp = await t.textContent("#view");
assert.ok(/Your comment/.test(wp), "the comment is a writing task");
await t.screenshot({ path: `${SHOTS}/03-writing-progress.png`, fullPage: true });

step("Analytics counts drafts");
await t.evaluate(() => { location.hash = "#tools/stats"; });
await t.waitForTimeout(1500);
const an = await t.textContent("#view");
assert.ok(/Anna Smith/.test(an), "the student appears in Analytics without submitting");
await t.screenshot({ path: `${SHOTS}/04-analytics.png`, fullPage: false });

step("Teacher checks an auto exercise (Check this exercise now)");
await t.evaluate(() => { location.hash = "#u3/reading"; });
await t.waitForSelector('#ex-r1');
const chk = t.locator('#ex-r1 [data-act="check-ex"], #ex-r4 button:has-text("Check this exercise now")').first();
if (await chk.count()) { await chk.click(); await s.waitForSelector("#ex-r1 .ok, #ex-r1 .bad, #ex-r1 .res", { timeout: 10000 }).catch(() => {}); }

step("Word export of Unit 3 (Teacher's Book)");
const [dl] = await Promise.all([t.waitForEvent("download", { timeout: 30000 }), t.click('[data-act="docx"][data-unit="u3"][data-ver="teacher"]')]);
const fpath = `${SHOTS}/u3-teacher.docx`; await dl.saveAs(fpath);
console.log("   saved", dl.suggestedFilename());

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
assert.equal(errors.filter((e) => !/favicon|404/.test(e)).length, 0, "no page errors");
await browser.close();
console.log("HR U3 TEST PASSED");
