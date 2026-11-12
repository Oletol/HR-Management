// Teacher: AI grammar check with the teacher's own key (Groq mocked), the Grammar checker page, and the rule that
// students see the correct answer only in gap fills, multiple choice and matching (not in key word transformations).
// Run: python3 -m http.server 5055 -d docs &  node tests/ai.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-ai";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("https://api.languagetool.org/**", (r) => r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"matches":[]}' }));
const groqCalls = [];
await ctx.route("https://api.groq.com/**", async (r) => {
  const req = r.request();
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData() || "{}");
  groqCalls.push({ auth: req.headers().authorization, body });
  const user = body.messages.at(-1).content;
  const reply = /"ok": true/.test(user) && !/STUDENT'S ANSWERS/.test(user)
    ? '{"ok": true}'
    : JSON.stringify({ items: { 1: {
        errors: [{ quote: "discuss about", fix: "discuss", explain: "Discuss takes a direct object: no preposition.", type: "grammar" },
                 { quote: "words that are not in the text", fix: "x", explain: "invented", type: "grammar" }],
        target: [{ quote: "had decided", structure: "used-to", ok: true }],
        comment: "Clear structure; check verbs with prepositions.", level: "B2" } } });
  return r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
});
const errors = [];
const t = await ctx.newPage();
t.on("pageerror", (e) => errors.push(e.message)); t.on("dialog", (d) => d.accept());
const step = (x) => console.log("•", x);
await t.goto(BASE + "/teacher.html");
await t.evaluate(() => { localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } })); localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "Teacher" } })); });
await t.reload();
await t.fill("#auth-form [name=email]", "teacher@uni.ru"); await t.fill("#auth-form [name=password]", "secret1"); await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");
await t.click('a[href="#tools/content"]');
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]"); await t.waitForSelector("#import-status:has-text('Imported')");
await t.click('a[href="#tools/groups"]'); await t.waitForSelector("#g-name");
await t.fill("#g-name", "PA-21"); await t.fill("#g-code", "PA-21"); await t.click("[data-act=create-group]");
await t.waitForSelector("td:has-text('PA-21')");

step("Seeding two students");
await t.evaluate(() => {
  const db = JSON.parse(localStorage.getItem("mock:db"));
  const gid = Object.keys(db).find((k) => k.startsWith("groups/")).split("/")[1];
  db["groups/" + gid].openUnits = ["u2"];
  for (const [uid, name] of [["S1", "Amara Okafor"], ["S2", "Lukas Brandt"]]) {
    db["users/" + uid] = { name, email: uid.toLowerCase() + "@uni.ru", groupId: gid };
    db[`submissions/u2__${uid}`] = { uid, groupId: gid, unitId: "u2", status: "draft", updatedAt: { __ts: Date.now() },
      answers: {
        p11: { 1: "Introduction. The aim of this proposal is to discuss about internal communication. The head of the department had decided to change the schedule." },
        g1: { 1: "go", 2: "was explaining" },
        g3: { 1: "first time she spoke", 2: "had already started" },
      } };
  }
  localStorage.setItem("mock:db", JSON.stringify(db));
});
await t.reload(); await t.waitForSelector("#tool-nav .sb-item");

step("Grammar checker: switch on the AI, paste the key, test it");
await t.click('a[href="#tools/checker"]');
await t.waitForSelector("text=Which checker");
await t.check('input[name="ai-on"][value="1"]');
await t.waitForSelector("#ai-key");
await t.fill("#ai-key", "gsk_test_key_123");
await t.press("#ai-key", "Tab");
await t.click("[data-act=ai-test]");
await t.waitForSelector("#ai-status:has-text('The key works')");
assert.equal(groqCalls.at(-1).auth, "Bearer gsk_test_key_123");
assert.equal(groqCalls.at(-1).body.model, "openai/gpt-oss-120b");
await t.screenshot({ path: SHOTS + "/1-checker.png", fullPage: true });

step("Try it on the Grammar checker page");
await t.fill("#try-text", "We should discuss about the new schedule.");
await t.click("[data-act=try-check]");
await t.waitForSelector("#try-out .wfb-comment");
assert.ok(await t.isVisible("#try-out >> text=Estimated level (AI, for the teacher)"));

step("Check the writing now uses the AI");
await t.evaluate(() => { location.hash = "#u2/writing"; });
await t.waitForSelector('[data-act=check-writing][data-ex=p11]');
assert.ok(await t.isVisible("text=AI · Groq"), "the bar says which checker is on");
await t.click('[data-act=check-writing][data-ex=p11]');
await t.waitForFunction(() => { const db = JSON.parse(localStorage.getItem("mock:db")); return db["exerciseResults/u2__S2"]?.feedback?.p11; }, null, { timeout: 30000 });
const fb = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db"))["exerciseResults/u2__S1"].feedback.p11[1]);
assert.equal(fb.engine, "ai");
assert.equal(fb.comment, "Clear structure; check verbs with prepositions.");
assert.equal(fb.aiLevel, "B2");
assert.ok(fb.issues.some((x) => x.src === "ai" && fb.text.substr(x.offset, x.length) === "discuss about"), "AI issue located in the text");
assert.ok(!fb.issues.some((x) => /invented/.test(x.message)), "a quote not in the text is dropped");
const dbText = await t.evaluate(() => localStorage.getItem("mock:db"));
assert.ok(!dbText.includes("gsk_test_key_123"), "the key never goes into the database");
assert.ok(groqCalls.some((c) => /STUDENT'S ANSWERS/.test(c.body.messages.at(-1).content) && /B2–B2\+/.test(c.body.messages[0].content)));

step("Answers shown: the teacher sees the AI feedback of a student");
await t.selectOption("#view-as", "S1");
await t.waitForSelector(".wfb-comment");
await t.locator(".wfb").first().screenshot({ path: SHOTS + "/2-feedback.png" });
await t.selectOption("#view-as", "");

step("Check this exercise now: a typed gap shows the key, a key word transformation does not");
await t.evaluate(() => { location.hash = "#u2/grammar"; });
await t.waitForSelector('[data-act=check-ex][data-ex=g1]');
assert.ok(await t.isVisible('[data-act=check-ex][data-ex=g3] >> xpath=ancestor::div[contains(@class,"tb-row")] >> text=no correct answer for students'));
await t.click('[data-act=check-ex][data-ex=g1]');
await t.waitForFunction(() => JSON.parse(localStorage.getItem("mock:db"))["exerciseResults/u2__S1"]?.items?.g1);
await t.click('[data-act=check-ex][data-ex=g3]');
await t.waitForFunction(() => JSON.parse(localStorage.getItem("mock:db"))["exerciseResults/u2__S1"]?.items?.g3);
const exr = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db"))["exerciseResults/u2__S1"].items);
assert.equal(exr.g1[1].ok, false); assert.equal(exr.g1[1].correct, "went");
assert.equal(exr.g3[1].ok, false); assert.equal(exr.g3[1].correct, "", "no model answer for a key word transformation");

step("Switching back to LanguageTool");
await t.click('a[href="#tools/checker"]');
await t.check('input[name="ai-on"][value="0"]');
await t.waitForSelector("#ai-fields", { state: "hidden" });
await t.evaluate(() => { location.hash = "#u2/writing"; });
await t.waitForSelector("text=LanguageTool >> nth=0");

assert.deepEqual(errors, [], "no page errors");
console.log("OK ai.e2e");
await browser.close();
