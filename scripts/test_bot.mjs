/**
 * Live accuracy tests against a running bot.
 *
 *   npm start                 (in one terminal)
 *   npm run test:bot          (in another)
 *
 * Run this after changing the prompt, the knowledge JSON, or the Drive
 * documents. It checks the things that actually matter to an applicant: that
 * the fee is the real fee, that a Thai question gets a Thai answer, that LINE
 * replies contain no markdown, and that a question the guide does not cover
 * gets an honest "not specified" instead of an invented answer.
 *
 * Payloads are built in Node and sent as UTF-8 on purpose — passing Thai
 * through the Windows shell mangles it into "???" and the bot then correctly
 * reports that it cannot read the question.
 */

// Accepts a port for local testing, or a full URL to check a deployment:
//   npm run test:bot 3000
//   npm run test:bot https://mfu-admission-bot-chi.vercel.app
const TARGET = process.argv[2] ?? process.env.PORT ?? "3000";
const BASE = TARGET.startsWith("http") ? TARGET : `http://localhost:${TARGET}`;
const URL = `${BASE.replace(/\/$/, "")}/api/chat`;

const CASES = [
  {
    q: "ค่าเทอม Software Engineering เท่าไหร่",
    channel: "line",
    expectLang: "th",
    must: ["39,000"],
  },
  {
    q: "มฟล. มีหอพักให้ไหม ค่าหอเท่าไหร่",
    channel: "line",
    expectLang: "th",
    must: ["4,000", "8,000"],
  },
  {
    q: "How much is tuition for Nursing Science?",
    channel: "line",
    expectLang: "en",
    must: ["49,400"],
  },
  {
    q: "ป.โท Dermatology เรียนที่ไหน ค่าเทอมเท่าไหร่",
    channel: "line",
    expectLang: "th",
    must: ["117,000"],
  },
  {
    q: "มฟล. มีสนามกอล์ฟไหม แล้วหอพักมีแอร์ทุกห้องหรือเปล่า",
    channel: "line",
    expectLang: "th",
    must: ["interadmission@mfu.ac.th"],
    note: "ไม่มีในคู่มือ - ต้องไม่มั่ว",
  },
];

const isThai = (s) => /[฀-๿]/.test(s);
// Han characters, Hangul, Hiragana/Katakana, Cyrillic — none belong in a Thai
// or English reply, so any hit is the third-language leak we saw in testing.
const hasForeign = (s) =>
  /[一-鿿가-힯぀-ヿЀ-ӿ]/.test(s);

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ message: c.q, channel: c.channel }),
  });
  const data = await res.json();

  console.log("═".repeat(70));
  console.log(`❓ [${c.channel}] ${c.q}`);
  if (c.note) console.log(`   (${c.note})`);
  console.log("─".repeat(70));

  if (data.error) {
    console.log("ERROR:", JSON.stringify(data.error).slice(0, 250));
    fail++;
    continue;
  }

  console.log(data.text);
  console.log("─".repeat(70));

  const checks = [];
  const gotThai = isThai(data.text);
  const langOK = c.expectLang === "th" ? gotThai : !gotThai;
  checks.push([`ตอบเป็นภาษา ${c.expectLang}`, langOK]);

  for (const m of c.must) checks.push([`มี "${m}"`, data.text.includes(m)]);
  checks.push(["ไม่มีภาษาแปลกปลอม", !hasForeign(data.text)]);
  checks.push(["ไม่มี markdown (LINE)", !/\*\*|^#{1,3} |^\s*\|/m.test(data.text)]);
  checks.push([`ยาวไม่เกิน 1500 ตัวอักษร (${data.text.length})`, data.text.length <= 1500]);

  for (const [label, ok] of checks) {
    console.log(`   ${ok ? "✅" : "❌"} ${label}`);
    ok ? pass++ : fail++;
  }
  console.log("");
}

console.log("═".repeat(70));
console.log(`สรุป: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);

// Non-zero exit on failure so this can gate a deploy.
process.exit(fail === 0 ? 0 : 1);
