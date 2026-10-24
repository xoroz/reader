# reader — project notes

Private book reader: upload PDF/EPUB/DOCX/TXT/MD, AI-clean the text, read paginated/scroll, TTS, LibGen search, position sync.
Full feature list and deploy walkthrough: `README.md`. Live: https://dev.texngo.it/reader (OTP login).
Repo: github.com/xoroz/reader. Part of the sysmini app family, see `/home/cbot/CLAUDE.md`.

## Run / deploy (sysmini)
- pm2 app `reader`, `next start -p 3017 -H 127.0.0.1`; Apache :81 proxies `/reader` (and `/Reader`) to :3017.
- Build + restart: `npm run build && pm2 restart reader` (build uses `next build --webpack`). Logs: `pm2 logs reader`.
- Config + secrets live in **`ecosystem.config.js`** (gitignored, chmod 600). Template: `ecosystem.config.example.js`. Never print, commit or copy its values.
- DB: local PostgreSQL; migrations are plain SQL in `sql/` (001–004), applied by hand with psql, in order.
- User uploads in `uploads/` (not code; do not wipe).

## Layout
- `src/app/` Next.js App Router pages + `api/`; `src/lib/` helpers (`ai.ts` OpenRouter, `tts.ts`, `extract.ts`, `epub-build.ts`, `libgen.ts`, `db.ts`, `security.ts`, `resume.ts`, `user.ts`); `src/middleware.ts` auth gate.
- Local libs: `node_modules/shared-auth` and `shared-ai` are symlinks to `~/projects/shared-auth` / `~/projects/shared-ai` (`postinstall` recreates them; it also tries `shared-m3`/`shared-amadeus`, which do not exist here, harmless).

## Rules
- Auth = OTP email codes via `shared-auth` (HMAC session cookie, allowed emails list in config, 10-book limit per user).
- AI/TTS go through OpenRouter; keys come from the pm2 env, never hardcode.
- Test locally before restarting pm2; use `playwright-cli` for UI checks.
- Known gaps: no automated tests; TTS and extraction depend on external APIs.
