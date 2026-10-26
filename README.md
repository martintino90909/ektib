# Ektib · اكتب

A Duolingo-style app for learning to read and write Egyptian Arabic on an iPad with an Apple Pencil: trace letters, write them from memory, read real Egyptian words and phrases.

It runs as a Cloudflare Worker. The app is one page in `public/`, the API is in `src/`, and progress lives in one Durable Object behind a passcode, so it syncs between devices.

## Setup on Cloudflare (once)

1. In Cloudflare, go to **Workers & Pages** → **Create** → **Import a repository** and pick `ektib`. Keep the defaults (deploy command `npx wrangler deploy`).
2. Open the Worker → **Settings** → **Variables and Secrets** → **Add**. Type **Secret**, name `PASSCODE`, value: a passcode only you know. Save and redeploy.
3. Open `https://ektib.<your-subdomain>.workers.dev`, enter the passcode, done.

Every push to `main` redeploys automatically. Changing `PASSCODE` signs every device out.

Without a passcode set, the app still works but keeps progress on the device only.

## On your iPad

Open the site in Safari, tap **Share** → **Add to Home Screen**. It opens full screen as "Ektib".

Once the app sees your Apple Pencil, it ignores finger and palm touches on the writing slate.

## What's in it

- 8 units: letters grouped by shape, then Egyptian words, then a unit review. The last unit is everyday Cairo phrases.
- Egyptian pronunciation throughout: ج is a hard g, ق is a glottal stop, and each letter shows its Franco-Arabic spelling (3, 7, 5, 2).
- Exercise types: trace, write from memory, letter → sound, sound → letter, letter shapes (start/middle/end), read a word, pick the word for a meaning, match pairs.
- Handwriting checks look at dots (count and position) and overall shape. They can't reliably tell look-alike letters apart, so after each check the correct letter shows behind your writing, and "I wrote it right, count it" overrides a wrong mark.

## API

All routes except `/api/session` and `/api/login` need the session cookie.

| Route | What it does |
|---|---|
| `GET /api/session` | Whether a passcode is set and whether you're signed in |
| `POST /api/login` `{passcode}` | Signs this device in for a year |
| `POST /api/logout` | Signs this device out |
| `GET /api/progress` | Your saved progress |
| `PUT /api/progress` | Saves progress; refused with 409 (and the newer copy) if another device saved something newer |

Ten wrong passcodes in an hour lock sign-in for the rest of that hour.

## Tests

```
npm test
```
