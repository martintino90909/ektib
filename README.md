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

Four tabs:

- **Learn**: 10 units on a path. Units 1–7 teach the letters grouped by shape, each followed by Egyptian words and a unit review. Unit 8 teaches the hamza and the vowel marks (fatḥa, kasra, ḍamma, sukuun, shadda) with "sound it out" drills. Unit 9 is joined writing: joining letters into words, splitting words into letters, and where words break. Unit 10 is everyday Cairo phrases.
- **Review**: spaced repetition. Every letter and word you learn becomes a card; getting it right pushes it 1, 2, 4, 8… days away, getting it wrong brings it back in 10 minutes. Shows how strong each letter is.
- **Read**: short stories in Egyptian Arabic, like the stories in HelloChinese. Lines appear one at a time; tap any word for its meaning (and add it to your review deck), toggle transliteration and translation, then answer comprehension questions. Each story unlocks once you've learned all its letters.
- **Record**: a native speaker records letters, words and story lines on the iPad. Recordings play in lessons, stories and the word pop-up, and unlock "Which word did you hear?" listening questions.
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
| `GET /api/audio` | Which recordings exist, keyed by a hash of their text |
| `GET /api/audio/:key` | Plays a recording |
| `PUT /api/audio/:key` | Saves a recording (audio body up to 1 MB, `X-Text` header with the Arabic text) |
| `DELETE /api/audio/:key` | Deletes a recording |

Ten wrong passcodes in an hour lock sign-in for the rest of that hour.

## Tests

```
npm test
```
