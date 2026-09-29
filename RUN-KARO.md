# કેવી રીતે ચલાવવું / How to run

બે રીત છે. પહેલી રીત માં કંઈ install કરવાની જરૂર નથી.

---

## Option A — આખી app (Admin + Student), 30 સેકન્ડ માં ચાલુ

જરૂરી: ફક્ત **Node.js** (https://nodejs.org — LTS). Database ની જરૂર નથી, `npm install` ની પણ નહીં.

VS Code માં આ folder ખોલો → Terminal (`Ctrl + ~`) → લખો:

```bash
cd app
node server.mjs
```

Browser માં ખોલો: **http://localhost:4000**

### Login details — તમે જે રાખવા માંગો તે રાખી શકો

`app/.env` file ખોલો અને આ values બદલો:

```env
ADMIN_USERNAME=examadmin
ADMIN_PASSWORD=Exam@2026
ADMIN_NAME=Exam Administrator

STUDENT_USERNAME=student01
STUDENT_PASSWORD=Student@2026
STUDENT_NAME=Demo Student

SHOW_DEMO_HINT=true
SYNC_LOGIN_CONFIG=false
```

**Password/username source code અથવા login page માં hard-coded નથી.** `.env` બદલ્યા પછી server restart કરો.
જો જૂના demo account ને નવા credentials સાથે force-sync કરવો હોય તો `SYNC_LOGIN_CONFIG=true` કરો, એક વખત server restart કરો, પછી ફરી `false` કરી શકો.

Login page નીચે sample usernames બતાવી શકાય છે; passwords security માટે ત્યાં બતાવવામાં આવતા નથી.

### Admin શું કરી શકે

- **Subjects** — Physics, Chemistry, Biology… જેટલા જોઈએ એટલા ઉમેરો
- **Questions** — પોતાના question, options, સાચો જવાબ, marks, negative marks, explanation.
  ચાર type: single correct, multiple correct (partial marking સાથે), numerical, true/false
- **Exams** — questions select કરો, duration (minutes) નક્કી કરો, અને
  *shuffle question order* + *shuffle option order* ચાલુ કરો → દરેક student ને paper નો order અલગ મળશે
- **Students** — દરેક student ની અલગ username + password બનાવો, password reset કરો, block કરો
- **Live monitor** — exam ચાલુ હોય ત્યારે કોણ કયા question પર છે, કેટલા answer કર્યા,
  કેટલો time બાકી છે, અત્યાર સુધી કેટલા marks — બધું 5 સેકન્ડે refresh થાય છે.
  કોઈ પણ student ની details ખોલી ને question-wise જવાબ પણ જોઈ શકો

### Student શું જુએ

Login → એને assign થયેલા exams → exam screen (question palette, timer, mark for review,
clear response, submit confirmation) → submit પછી score + subject-wise breakdown + solutions.

### જાણવા જેવું

- બધો data `app/data.json` માં save થાય છે. Server બંધ કરો તો પણ રહે છે.
  બધું ભૂંસીને ફરી શરૂ કરવું હોય તો એ file delete કરી દો.
  **⚠ Folder ને ફરી extract ના કરવું** — એ કરવાથી આ file (તમારો બધો data) ડિલીટ થઈ જાય છે.
- Timer server પર ચાલે છે. Student page refresh કરે તો answers અને બાકી time એવા ને એવા જ રહે છે,
  અને time વધતો નથી. Time પૂરો થાય એટલે automatic submit.
- દરેક student નો question order અને option order એના attempt માં save થઈ જાય છે,
  એટલે refresh કર્યા પછી પણ એનો order બદલાતો નથી — પણ બીજા student નો order અલગ જ રહે છે.
- `demo/` folder માં નાનું fixed-paper version છે (`node demo/server.mjs`) — ખાલી exam engine
  બતાવવા માટે. મુખ્ય app `app/` છે.

### Tab-switch protection (anti-cheating)

Exam ચાલુ હોય ત્યારે student બીજા tab પર જાય, browser minimize કરે, કે બીજી app ખોલે તો એ
record થાય છે:
- પહેલી વાર → warning popup (પાછા આવે ત્યારે)
- Exam બનાવતી વખતે "Tab-switch warnings allowed" field માં number સેટ કરો (default 1 = એક warning
  પછી બીજી વાર કરે તો automatic submit). 0 રાખો તો પહેલી જ વાર submit થઈ જાય.
- Automatic submit થયા પછી student ફરીથી એ exam આપી ના શકે (એક જ attempt allowed હોય એટલે).
- Admin ના **Live monitor** માં "Tab switches" column માં દેખાશે, અને "Details" ખોલો તો ક્યારે
  ક્યારે switch કર્યું એ time પણ દેખાશે.

### AI થી questions બનાવવા (syllabus/notes પેસ્ટ કરીને)

Questions tab માં નીચે **"Generate from syllabus or notes (AI)"** panel છે:
1. Anthropic નું API key જોઈએ — https://console.anthropic.com પર જઈને account બનાવો,
   billing setup કરો (થોડા પૈસા credit તરીકે નાખવા પડે — questions generate કરવાનો cost બહુ ઓછો
   છે, પણ free નથી), અને key copy કરો
2. પેનલ માં key paste કરી **Save key** કરો (key તમારા `data.json` માં local રહે છે, ક્યાંય share નથી થતી)
3. Subject પસંદ કરો, syllabus/notes નો text paste કરો, કેટલા questions જોઈએ (max 20), difficulty,
   ne question types પસંદ કરો
4. **Generate questions** — Claude questions બનાવી ને preview આપશે
5. Check કરી ને **Add all to question bank**

---

## Option B — Production backend (Postgres + Prisma)

આ `src/` વાળું version છે — real database, JWT auth, migrations. College submission /
deployment માટે આ વાપરવાનું. ચલાવવા માટે:

જરૂરી: Node.js + PostgreSQL. Postgres ના હોય તો Docker Desktop થી સહેલું પડશે.

### 1. Database ચાલુ કરો

Docker હોય તો, project folder માં:

```bash
docker compose up -d
```

Docker ના હોય તો PostgreSQL install કરો (https://www.postgresql.org/download/windows/),
`exam_portal` નામનું database બનાવો, અને નીચે `.env` માં password બદલો.

### 2. Environment file

```bash
copy .env.example .env      # Windows CMD
cp .env.example .env        # Git Bash / Mac / Linux
```

`.env` ખોલીને બે secrets બદલો (કંઈ પણ લાંબી random string ચાલશે):

```
JWT_ACCESS_SECRET=koi_pan_lambi_random_string_1234567890
JWT_REFRESH_SECRET=biji_lambi_random_string_0987654321
```

### 3. Install + migrate + seed + run

```bash
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev
```

Check કરો: http://localhost:4000/api/v1/health → `{"success":true,...}` આવવું જોઈએ.

### 4. Login કરી ને test કરો

Seed થયેલા accounts:

| Role | Email | Password |
|---|---|---|
| Admin | admin@examportal.test | Admin@12345 |
| Student | aarav@example.test | Student@123 |

Browser માં ખાલી URL ખોલશો તો JSON જ દેખાશે — **એ API છે, website નથી.**
Test કરવા માટે VS Code નું **Thunder Client** કે **REST Client** extension વાપરો, અથવા:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login -H "content-type: application/json" -d "{\"email\":\"aarav@example.test\",\"password\":\"Student@123\"}"
```

જે `accessToken` મળે એ પછીની requests માં header તરીકે મોકલો:
`Authorization: Bearer <accessToken>`

---

## સામાન્ય errors

| Error | કારણ + ઉપાય |
|---|---|
| `'node' is not recognized` | Node.js install નથી, અથવા install પછી CMD restart નથી કર્યો |
| `EADDRINUSE :4000` | port already વપરાયેલો છે — બીજું terminal બંધ કરો કે `set PORT=5000` |
| `Can't reach database server` | Postgres ચાલુ નથી, કે `.env` માં `DATABASE_URL` ખોટું છે |
| `Environment variable not found: DATABASE_URL` | `.env` file બનાવી નથી (step 2) |
| `Invalid environment configuration` | JWT secrets 16 characters થી નાના છે |
| `prisma: command not found` | પહેલાં `npm install` ચલાવો, પછી `npx prisma ...` |

---

## આગળ શું બાકી છે

- Admin API (exam CRUD, question bank, bulk import, results publish, analytics)
- Next.js frontend — demo વાળી exam screen નું full version + dashboards
- Payment gateway (Razorpay) — schema તૈયાર છે, ફક્ત adapter લખવાનો બાકી

## Coding + Proctoring setup

1. Install Docker Desktop.
2. Start Docker Desktop.
3. Start the portal with `npm run app`.
4. Open `http://localhost:4000`.
5. Login as admin and open **Coding** to create a coding problem and test cases.
6. Add the coding question to an exam from **Exams**.
7. Login as a student. Before starting the exam, allow camera and microphone permissions.
8. The exam requests fullscreen and records tab/fullscreen/camera/microphone and clipboard/context-menu violations.
9. For a production deployment, use HTTPS and configure a proper reverse proxy and persistent database.

> Browser proctoring is a detection/logging mechanism, not a guarantee that cheating is impossible. Institutions should define consent, retention and review policies for monitoring data.

## New: Branding & Exam Page Layout

Admin login → **Branding** tab.

You can set:
- Logo upload (PNG/JPG/WebP/SVG) or logo URL
- Header text shown on every question
- Footer text shown on every question
- Watermark text
- Question page width: 900px / 1100px / 1300px / 100%
- Question layout: Card / Full width
- Show/hide logo, header and footer

Click **Save branding & layout**. Students will see the saved branding on every question page.
