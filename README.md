# Reader

Private reading app. Upload a book (PDF / EPUB / DOCX / TXT / MD), get AI-cleaned text, read it in a beautifully typeset paginated or scroll view, with high-quality TTS narration powered by OpenAI voice models via OpenRouter.

## Features

- **Paginated or scroll reading** with full typography controls (serif/sans fonts, size, line-height, column width, margins, theme, justify, hyphens) — per-user, synced across devices.
- **AI extraction** (PDF text-layer, EPUB, DOCX, TXT/MD) via `pdf-parse`, `epub2`, `mammoth`. Text cleanup via OpenRouter → `anthropic/claude-haiku-4.5`:
  - Restores dropped apostrophes/contractions (`didn t` → `didn't`)
  - Drops publisher front-matter, copyright pages, ISBN blocks, printing history
  - Keeps only: title, TOC, prologue/foreword/preface, main body
- **Covers**: first PDF page via `pdftoppm`; EPUB cover extracted from OPF manifest.
- **High-quality TTS** via OpenRouter → `openai/gpt-audio-mini` (8 voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `coral`, `sage`). Audio cached per-chapter-per-voice in Postgres.
  - Starts reading from the paragraph currently visible on screen.
  - Smooth paragraph-level highlighting with a per-paragraph progress underline.
  - Auto-advances through chapters.
- **PWA**: installable, offline-capable (cached app shell + book pages).
- **LibGen search + download** (uses `libgen.vg` / `.la` / `.gl` / `.bz` mirrors, defaults to EPUB).
- **Reading position sync** (paragraph-anchored, survives font/size changes; syncs across laptop & mobile for the same signed-in email).
- **10-book limit per user** with delete from the library.

## Stack

- Next.js 15 (App Router, TypeScript), Tailwind v4
- Postgres 15+
- PM2 process manager
- Caddy reverse proxy (OTP gating via `shared-auth` HMAC session cookie)
- OpenRouter (Anthropic + OpenAI audio)
- `poppler-utils` (PDF cover rendering)

## Deploy — sysmini (Ubuntu, no Caddy, Apache + pm2)

This documents the actual production setup on the sysmini server.

### Prerequisites

- Node 22+, PostgreSQL 18+, PM2, `poppler-utils`
- `~/projects/shared-auth/` — custom shared-auth module (see below)
- `~/projects/shared-ai/` — custom shared-ai module (see below)

### 1) PostgreSQL

```bash
PGPASSWORD='<postgres-superuser-pass>' psql -U postgres -h 127.0.0.1 \
  -c "CREATE ROLE reader LOGIN PASSWORD '<pg-pass>';"
PGPASSWORD='<postgres-superuser-pass>' psql -U postgres -h 127.0.0.1 \
  -c "CREATE DATABASE reader OWNER reader;"

PGPASSWORD='<pg-pass>' psql -U reader -h 127.0.0.1 -d reader -f sql/001_init.sql
PGPASSWORD='<pg-pass>' psql -U reader -h 127.0.0.1 -d reader -f sql/002_opds.sql
PGPASSWORD='<pg-pass>' psql -U reader -h 127.0.0.1 -d reader -f sql/003_columns.sql
PGPASSWORD='<pg-pass>' psql -U reader -h 127.0.0.1 -d reader -f sql/003_libgen_md5.sql
```

### 2) shared-auth module

The original `shared-auth` package expects JMAP for email. This setup uses SMTP (OVH)
and lives at `~/projects/shared-auth/` instead of `/opt/apps/shared-auth/`.

Files: `index.js`, `edge.js`, `email.js`, `package.json`
- `index.js`: `getConfig`, `loginPageHTML`, `generateOTP`, `verifyOTP`, `sendOTPEmail`, `checkRateLimit`, `createSession`
- `edge.js`: `verifySessionEdge` (Edge-runtime Web Crypto, no Node.js imports)
- `email.js`: `sendEmailWithAttachment` via nodemailer

```bash
mkdir -p ~/projects/shared-auth
cd ~/projects/shared-auth
npm install  # installs nodemailer
```

Env vars consumed (falls back SMTP_* if OTP_SMTP_* not set):
- `OTP_SESSION_SECRET` — 32-byte base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
- `OTP_SESSION_HOURS` — session lifetime (168 = 7 days)
- `OTP_ALLOWED_EMAILS` — comma-separated allow-list
- `OTP_FROM_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`

### 3) shared-ai module

```bash
mkdir -p ~/projects/shared-ai
# write index.js with chatCompletion() that calls OpenRouter
```

`chatCompletion({apiKey, model, messages, temperature, maxTokens, responseFormat, appName, referer})` → `{content: string}`

### 4) App install

```bash
cp -r ~/repos/reader ~/projects/reader
mkdir -p ~/projects/reader/uploads
cd ~/projects/reader
cp ecosystem.config.example.js ecosystem.config.js
# Fill in all values (see ecosystem.config.js comments)

npm install

# Fix the shared-* symlinks (postinstall points to /opt/apps which doesn't exist)
rm ~/projects/reader/node_modules/shared-auth
ln -sfn ~/projects/shared-auth ~/projects/reader/node_modules/shared-auth
rm ~/projects/reader/node_modules/shared-ai
ln -sfn ~/projects/shared-ai ~/projects/reader/node_modules/shared-ai

npm run build
pm2 start ecosystem.config.js
pm2 save
```

### 5) Apache proxy (adds to `/etc/apache2/sites-enabled/001-cbot.conf`)

```apache
<Location /Reader>
    Require all granted
</Location>

ProxyPass /Reader        http://127.0.0.1:3017/Reader
ProxyPassReverse /Reader http://127.0.0.1:3017/Reader
```

Then: `sudo systemctl restart apache2`

> Note: On sysmini, external traffic (`dev.texngo.it`) hits Apache port 80 (`000-default.conf`).
> The proxy rules above belong in whichever Apache VHost handles your public hostname.

### Caddy snippet (alternative, original design)

```caddyfile
@reader path_regexp ^(?i)/Reader(/.*)?$
handle @reader {
  reverse_proxy 127.0.0.1:3017 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto "https"
  }
}
```

## Routes

| Path | Purpose |
|---|---|
| `/` | Library grid (covers + progress) |
| `/upload` | File upload + extraction progress |
| `/search` | LibGen search + one-click import |
| `/book/[id]` | Reader with typography prefs + TTS |
| `/api/auth/[action]` | OTP email auth (login / verify / send-code / logout) |
| `/api/upload` | Multipart upload → extract pipeline |
| `/api/books/[id]` | Book status + delete |
| `/api/books/[id]/cover` | JPEG/PNG cover |
| `/api/progress` | Save reading position (paragraph-anchored) |
| `/api/prefs` | User typography + TTS voice preferences |
| `/api/tts/[bookId]/[chapterIdx]` | Streaming WAV synthesis (with cache + start-from-paragraph mode) |
| `/api/libgen/search` | LibGen search proxy |
| `/api/libgen/download` | Fetch + extract a LibGen book |

## Schema

See `sql/001_init.sql`.

## License

MIT
