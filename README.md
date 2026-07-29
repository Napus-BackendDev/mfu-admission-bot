# MFU Admission Assistant

LINE chatbot ตอบคำถามการรับสมัครนักศึกษาต่างชาติ มหาวิทยาลัยแม่ฟ้าหลวง
อ้างอิงจาก **Admission Guide 2-2026** (ปริญญาตรี และ บัณฑิตศึกษา)

**ฟรีทั้งระบบ** — Gemini API free tier + Vercel free tier + LINE Messaging API free tier

---

## จุดเด่นที่ต้องรู้ก่อน

**เจ้าหน้าที่แก้ข้อมูลเองได้ ไม่ต้องเรียกโปรแกรมเมอร์**

แก้ Google Doc ใน Drive → กด save → บอทตอบข้อมูลใหม่ภายใน 5 นาที ไม่ต้อง deploy ใหม่

ถ้า Drive ล่มหรือยังไม่ได้ตั้งค่า บอทยังตอบได้จากคู่มือที่ฝังมากับตัวโปรแกรม — **ระบบไม่มีทางเงียบ**

---

## สถาปัตยกรรม

```
Google Drive (เจ้าหน้าที่แก้เอง)  ──▶ lib/knowledge.ts ─▶ lib/gemini.ts ─┐
                                                                         ├─▶ LINE
คู่มือที่ฝังในโค้ด (สำรองเมื่อ Drive ล่ม) ─┘                            └─▶ หน้าเว็บทดสอบ
```

### ทำไมไม่ใช้ Vector Database

ข้อมูลทั้งหมดประมาณ **10,000 tokens** ส่วน Gemini รับได้ **1,000,000 tokens**
จึงส่งข้อมูลทั้งหมดเข้าไปทุกครั้ง แทนที่จะค้นหาทีละชิ้น

ไม่ใช่การลัดขั้นตอน แต่**แม่นกว่า** — ระบบค้นหาอาจดึงปฏิทินการศึกษามาตอบคำถามเรื่องค่าเทอมได้
การส่งทั้งหมดตัดความเสี่ยงนั้นทิ้ง และประหยัดกว่าเพราะไม่ต้องเลี้ยง vector database

RAG แบบค้นหาจะเริ่มคุ้มเมื่อข้อมูลถึงระดับหลายพันหน้า ที่ 32 หน้ามีแต่จะเพิ่มจุดพัง

### ทำไมไม่ใช้ OCR

PDF ทั้งสองไฟล์มี text layer จริง (16 หน้า ไม่มีหน้าที่เป็นภาพสแกนเลย)
`scripts/extract_pdfs.py` อ่านตรงด้วย PyMuPDF ไม่มี OCR ในระบบนี้

---

## ติดตั้ง (ขั้นต่ำ 3 ขั้น)

### 1. ลง dependencies

```bash
npm install
```

### 2. ขอ Gemini API key (ฟรี ไม่ต้องผูกบัตร)

ไปที่ <https://aistudio.google.com/apikey> → **Create API key** → คัดลอกมา

```bash
cp .env.example .env.local
```

เปิด `.env.local` ใส่ค่าในช่อง `GEMINI_API_KEY`

### 3. รัน

```bash
npm run build && npm start
```

เปิด <http://localhost:3000> แล้วลองถาม — ใช้ได้ทันทีโดยยังไม่ต้องมี Drive หรือ LINE

> ⚠️ **บนเครื่องนี้ `npm run dev` ใช้ไม่ได้** — ดูหัวข้อ [ปัญหาที่ทราบแล้ว](#ปัญหาที่ทราบแล้ว) ให้ใช้ `npm run build && npm start` แทน

---

## เชื่อม Google Drive (ให้เจ้าหน้าที่แก้ข้อมูลเองได้)

**ตั้งค่าไว้แล้ว** — ระบบอ่านโฟลเดอร์
[ข้อมูลในการ RAG โปรเจค แม่ฟ้าหลวง](https://drive.google.com/drive/folders/1vMqL7Iudu5UGorz-Wl3yrnyQrBuE3vPd)
เป็นแหล่งข้อมูลเดียว ไม่ต้องมี Google Cloud, ไม่ต้องมี service account, ไม่ต้องมีคีย์

### วิธีที่ใช้อยู่ — โฟลเดอร์สาธารณะ

```
GOOGLE_DRIVE_FOLDER_ID=1vMqL7Iudu5UGorz-Wl3yrnyQrBuE3vPd
USE_BUNDLED_GUIDES=false
```

เงื่อนไขเดียว: โฟลเดอร์ต้องแชร์เป็น **"ทุกคนที่มีลิงก์"** สิทธิ์ **ผู้อ่าน**

**อาจารย์แก้ข้อมูลยังไง:** ลากไฟล์ใหม่เข้าโฟลเดอร์ / แก้ Google Doc ที่มีอยู่ / ลบไฟล์เก่า
บอทเห็นภายใน 5 นาที ไม่ต้อง deploy ไม่ต้องแตะโค้ด

### ไฟล์ที่รองรับ

| อ่านได้ ✅ | หมายเหตุ |
|---|---|
| **PDF** | ดึงข้อความจาก text layer อัตโนมัติ |
| Google Docs | |
| Google Sheets | อ่านเป็น CSV |
| `.txt` `.md` `.csv` | |

ไฟล์ที่อ่านไม่ได้ (รูป วิดีโอ PDF สแกน) จะขึ้นในช่อง `skipped` ของ `/api/status` — **ไม่เงียบหาย**

### ตรวจสอบ

```bash
curl http://localhost:3000/api/status
```

ผลจริงที่รันได้:

```
mode        : public-folder
reachable   : true
เจอเอกสาร   : 2 ไฟล์
   ✅ Admission Guide 2-2026 Postgrad.pdf — 13,819 ตัวอักษร
   ✅ Admission Guide 2-2026 Undergrad online.pdf — 17,756 ตัวอักษร
```

> **ความปลอดภัย:** ถ้าโฟลเดอร์ไม่ได้แชร์ Google จะตอบหน้า login กลับมาเป็น HTTP 200
> ระบบดักไว้แล้ว ไม่มีทางที่ HTML หน้า login จะหลุดเข้าไปให้ AI ตอบผู้สมัคร (ทดสอบแล้ว)

---

## ทางเลือกอื่น (ถ้าไม่อยากเปิดโฟลเดอร์สาธารณะ)

### วิธี B — Service Account (ทั้งโฟลเดอร์ ไม่ต้องเปิดสาธารณะ)

ทำครั้งเดียว ใช้เวลาประมาณ 10 นาที

### ขั้นที่ 1 — สร้าง Service Account

1. เข้า <https://console.cloud.google.com/> → สร้าง project ใหม่ (ตั้งชื่ออะไรก็ได้)
2. ค้นหา **Google Drive API** → กด **Enable**
3. เมนู **IAM & Admin → Service Accounts → Create service account**
   - ตั้งชื่อ เช่น `mfu-bot`
   - กด Create → ข้ามขั้น permission ได้เลย → Done
4. คลิกที่ service account ที่เพิ่งสร้าง → แท็บ **Keys → Add key → Create new key → JSON**
   - ไฟล์ JSON จะดาวน์โหลดมา **เก็บให้ดี อย่าอัปขึ้น GitHub**

### ขั้นที่ 2 — แชร์โฟลเดอร์ให้ Service Account

1. เปิดไฟล์ JSON หา `"client_email"` — จะหน้าตาแบบ `mfu-bot@ชื่อโปรเจกต์.iam.gserviceaccount.com`
2. เปิดโฟลเดอร์ Drive ที่เก็บเอกสาร → **แชร์** → วางอีเมลนั้น → สิทธิ์ **ผู้อ่าน (Viewer)** → ส่ง

> **สำคัญ:** แชร์แบบ "ทุกคนที่มีลิงก์" **ไม่พอ** — Drive จะไม่ index ไฟล์ให้ค้นหา
> ต้องแชร์ตรงไปที่อีเมลของ service account เท่านั้น

### ขั้นที่ 3 — ใส่ค่าใน `.env.local`

| ตัวแปร | เอามาจากไหน |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` ในไฟล์ JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` ในไฟล์ JSON — คัดลอกมาทั้งก้อนรวม `-----BEGIN...-----` ใส่ในเครื่องหมายคำพูด บรรทัดเดียว (ตัว `\n` ปล่อยไว้อย่างนั้น) |
| `GOOGLE_DRIVE_FOLDER_ID` | ส่วนท้าย URL ของโฟลเดอร์: `drive.google.com/drive/folders/`**`ตรงนี้`** |

### ขั้นที่ 4 — ตรวจว่าทำงาน

```bash
curl http://localhost:3000/api/status
```

ควรเห็น `"reachable": true` และรายชื่อเอกสารทั้งหมดที่บอทอ่านได้

### ประเภทไฟล์ที่รองรับ

| อ่านได้ ✅ | อ่านไม่ได้ ❌ |
|---|---|
| Google Docs | PDF |
| Google Sheets | รูปภาพ / วิดีโอ |
| Google Slides | ไฟล์ Word/Excel ที่ยังไม่แปลงเป็น Google format |
| `.txt` `.md` `.csv` `.json` | |

ไฟล์ที่อ่านไม่ได้จะขึ้นในช่อง `skipped` ของ `/api/status` — **ไม่มีการเงียบหาย**
ถ้ามี PDF ที่อยากให้บอทรู้ ให้เปิดด้วย Google Docs แล้ว **ไฟล์ → บันทึกเป็น Google เอกสาร**

---

## เชื่อม LINE

### 1. สร้าง LINE Official Account

1. เข้า <https://developers.line.biz/console/> ล็อกอินด้วยบัญชี LINE
2. สร้าง **Provider** (เช่น "Mae Fah Luang University")
3. สร้าง **Messaging API channel** ข้างใน — อันนี้คือตัวบอท

### 2. เก็บค่า 2 ตัว

| ค่า | อยู่ที่ไหน |
|---|---|
| `LINE_CHANNEL_SECRET` | แท็บ **Basic settings** → Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | แท็บ **Messaging API** → Channel access token → **Issue** |

### 3. Deploy ขึ้น Vercel (ฟรี)

LINE ยิง webhook ได้เฉพาะ URL ที่เป็น HTTPS สาธารณะ จึงต้อง deploy ก่อน

```bash
npm i -g vercel
vercel
```

จากนั้นใส่ environment variables ทั้งหมดใน Vercel dashboard
(**Settings → Environment Variables**) แล้ว **Redeploy** หนึ่งครั้ง

### 4. ตั้ง Webhook URL

กลับไปที่แท็บ **Messaging API** ของ LINE channel:

1. **Webhook URL** = `https://ชื่อโปรเจกต์.vercel.app/api/line/webhook`
2. เปิด **Use webhook**
3. กด **Verify** → ต้องขึ้น Success
4. **ปิด** Auto-reply messages และ Greeting messages
   (ไม่งั้นข้อความอัตโนมัติของ LINE จะทับคำตอบบอท)

สแกน QR code เพิ่มบอทเป็นเพื่อน แล้วลองทักดู

### LINE MCP Server คืออะไร ทำไมไม่ได้ใช้

`github.com/line/line-bot-mcp-server` มีเครื่องมือ 12 ตัว **ทั้งหมดเป็นขาส่งออก** —
push, broadcast, rich menu, ดูโปรไฟล์ **ไม่มีตัวไหนรับข้อความเข้า** จึงตอบคำถามผู้สมัครไม่ได้
งานนั้นเป็นของ webhook ข้างบน

ที่มันมีประโยชน์คืองาน admin เช่นให้ AI ช่วย broadcast ประกาศรับสมัคร หรือสร้าง rich menu
โดยไม่ต้องเปิด LINE console เอง

---

## ตรวจสอบระบบ

```bash
curl https://ชื่อโปรเจกต์.vercel.app/api/status
```

บอกได้ทันทีว่า: Gemini key ตั้งหรือยัง, Drive ต่อติดไหม, บอทเห็นเอกสารกี่ไฟล์,
แต่ละไฟล์แก้ล่าสุดเมื่อไหร่, และมีไฟล์ไหนอ่านไม่ได้บ้าง

**อยากให้ดึงข้อมูลใหม่ทันที** (ไม่รอ 5 นาที):

```bash
curl -X POST https://ชื่อโปรเจกต์.vercel.app/api/status
```

---

## ทดสอบว่าบอทตอบถูก

```bash
npm start          # หน้าต่างที่ 1
npm run test:bot   # หน้าต่างที่ 2
```

ยิงคำถามจริง 5 ข้อ แล้วตรวจว่า: ตัวเลขค่าเทอมตรงคู่มือไหม, ถามไทยตอบไทยไหม,
LINE ได้ข้อความล้วนไม่มี markdown ไหม, และคำถามที่ไม่มีในคู่มือมันยอมบอกว่าไม่รู้
หรือมั่วขึ้นมา

**ควรรันทุกครั้งหลังแก้เอกสารใน Drive หรือแก้ `data/knowledge/`**

ผลล่าสุดที่รันจริง: **ผ่าน 26 / ไม่ผ่าน 0**

---

## อัปเดตคู่มือ PDF

เมื่อ มฟล. ออกคู่มือฉบับใหม่:

1. แก้ path ใน `scripts/extract_pdfs.py` (ตัวแปร `SOURCES`)
2. `npm run extract` — เขียนทับ `data/raw/*.json`
3. **ตรวจ `data/knowledge/*.json` ด้วยตาอีกรอบ** — ข้อความดิบสร้างใหม่อัตโนมัติ
   แต่ตารางค่าเทอม/โควตา/กำหนดการถอดมาด้วยคน ต้องมีคนยืนยันว่ายังตรง
   ไม่มีอะไรในระบบจับได้ถ้าตัวเลขค่าเทอมเปลี่ยนเงียบๆ

---

## ปัญหาที่ทราบแล้ว

**`npm run dev` ใช้ไม่ได้บนเครื่องนี้**

Application Control policy ของเครื่องบล็อกไฟล์ `next-swc.win32-x64-msvc.node`
ทำให้ Next ตกไปใช้ WebAssembly compiler ผลคือ:

1. `dev`/`build` ต้องใช้ `--webpack` (ตั้งไว้แล้วใน `package.json`) เพราะ Turbopack รันบน WASM ไม่ได้
2. `npm run dev` คืน HTTP 500 พร้อม error `invalid type: unit value, expected usize`
   **ไม่ใช่บั๊กในโค้ด** — คำสั่งเดียวกันบน production build ทำงานปกติ

ระหว่างนี้ให้ใช้:

```bash
npm run build && npm start
```

ถ้าฝ่าย IT อนุญาตไฟล์ native binary ตัวนั้นได้ ทั้งสองปัญหาหายและ build เร็วขึ้นมาก
บนเครื่องอื่นหรือบน Vercel ไม่มีปัญหานี้

**ข้อจำกัด Gemini free tier — วัดจริงแล้ว**

free tier จำกัด **จำนวนคำขอต่อนาที** (ไม่ใช่ต่อวัน) และชนได้ง่าย — แค่ผู้สมัคร
2-3 คนถามพร้อมกันก็เต็มแล้ว

ระบบจัดการให้ 2 ชั้น:

1. **retry อัตโนมัติ** เมื่อโดน 429 — รอ 2 วินาที แล้ว 5 วินาที ก่อนยอมแพ้
   (ตั้งสั้นๆ เพราะ reply token ของ LINE หมดอายุ ตอบว่าไม่ว่างดีกว่าเงียบหาย)
2. ถ้ายังไม่ผ่าน ผู้ใช้เห็นข้อความสุภาพสองภาษา ไม่ใช่ error ดิบของ Google

```
ขออภัยครับ ตอนนี้มีผู้ใช้งานพร้อมกันจำนวนมาก รบกวนลองถามใหม่อีกครั้งในอีกสักครู่
หากเร่งด่วน ติดต่อได้ที่ interadmission@mfu.ac.th
```

**ถ้าจะใช้งานจริงจัง** ให้เปิด billing ที่ aistudio.google.com — จ่ายตามใช้จริง
คำถามละประมาณ 10,000 tokens ถ้ามี 1,000 คำถาม/เดือน ค่าใช้จ่ายไม่ถึง 50 บาท

---

## โครงสร้างโปรเจกต์

```
app/
  page.tsx                    หน้าเว็บทดสอบ
  api/chat/route.ts           endpoint ของหน้าเว็บ
  api/line/webhook/route.ts   LINE webhook (ตรวจลายเซ็น + ตอบกลับ)
  api/status/route.ts         ตรวจสถานะ + สั่ง sync ใหม่
lib/
  knowledge.ts                ประกอบ system prompt (คู่มือ + Drive)
  gemini.ts                   เรียก Gemini
  drive.ts                    อ่าน Google Drive + cache
  line.ts                     ตรวจลายเซ็น LINE + ส่งข้อความ
data/
  raw/                        ข้อความดิบจาก PDF (สร้างใหม่ด้วย npm run extract)
  knowledge/                  ตารางที่ถอดมาแล้ว (ตรวจด้วยคนหลัง extract ใหม่)
scripts/
  extract_pdfs.py             PDF → JSON
```
