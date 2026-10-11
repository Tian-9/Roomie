# Roomie

Someone who lives in your pocket. A pure front-end PWA: a character with personality and long-term memory who also happens to track your spending, remind you of things, and help you reflect on your day.

[中文](README.md) · Design baseline: [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md)

## What it is

Roomie is the real-world fork of [Pocketverse](https://github.com/Tian-9/pocketverse). Pocketverse is a "little phone" running in the browser, inhabited by role-play characters. Roomie takes the same shell, plugin system and three-tier memory and points them at everyday life:

- **A person, not an assistant.** They have a personality, moods, and remember what you told them. Getting things done is a side effect; the relationship is the point.
- **Abilities are plugins, not people.** Budgeting, scheduling and daily reviews are capability packs installed on the same character. Install the finance plugin and they start reading your ledger; install the kitchen plugin and they suggest dinner from what is in your fridge. There is only ever one personality and one memory.
- **Pure front end, bring your own key.** Static hosting, data in your browser, model key stored locally, no server.
- **Catch-up on open.** Browsers cannot push in the background, so they "pick up the phone" when you open the app: say good morning, write up yesterday.

## Status

**M3: out of the browser.** Once they could chat, remember and remind, this round locks the door, hooks up your phone and links several devices:

- **Onboarding**: pick who moves in (three built-in personas, a one-line description the model turns into one, or a card import), enter a Claude API key, and they speak first: an introduction and three questions (what to call you, when you sleep, what you are busy with), then you are straight in the conversation.
- **Seven packs**: ledger (say "lunch 32" in chat and it is recorded), habits (things to keep up, check-ins, streaks), schedule ("meeting tomorrow at 3" gets recorded and reminded; can subscribe to Google Calendar), dates (birthdays and countdowns, lunar too), weather (what it is like where you are, with a word when it turns cold or rainy), review (come back after a day and they say good morning and talk about yesterday; a weekly summary on Sunday night) and moments (a line or two about your last few days; heart it or answer it in chat). All plugins, all switchable in settings.
- **Catch-up on open**: how long you were away decides what they say, every plugin's line is merged into one message from them, and good morning is said once.
- **Lock screen and key encryption**: set a 4–6 digit PIN, required on open and after coming back from the background; the API key, the Bot token and the sync password are sealed with it, so neither the browser database nor a backup file holds them in plaintext.
- **Telegram push** (off by default): while the page is open, reminders and what they say on your return are also sent to Telegram on your phone; you create your own bot.
- **Backup and multi-device sync**: export the whole database as one JSON from settings and import it on a new phone, or point several devices at your own WebDAV and they merge row by row, keeping a conflict copy when both sides changed the same row.
- **Voice**: a mic in the composer, read-aloud on their messages, voice picked in the persona; browser built-ins only, no third-party TTS.

What comes next is M4 in section 7 of the architecture doc.

## Getting started

**Try this first**

1. Open the page, pick who moves in (or describe them in one line and let the model write the persona), enter your key, answer their three questions.
2. Chat a little and drop in "lunch was 32", "meeting tomorrow at 3pm", "mum's birthday is Oct 14": the ledger, schedule and dates apps on the home screen should now have them.
3. Close the page and open it the next morning: they say good morning, talk about yesterday, and a new post shows up in Moments. Too impatient? Move the phone's clock a day ahead.
4. Settings → Plugins: switch off what you do not want; the icons disappear.

**What you set up yourself**

- **Claude API key**: get one at [console.anthropic.com](https://console.anthropic.com/) and enter it under Settings → API (or in step two of onboarding). It stays in this device's browser; usage is pay-as-you-go and the settings page shows this month's spend.
- **GitHub Pages** (needed to use it as an app on your phone): after forking or pushing to your own repository, open the repository's Settings → Pages and set Source to **GitHub Actions**; every push to `main` then deploys, and "Add to Home Screen" in the phone browser installs it. Without that setting the deploy workflow fails with a 404.
- **Telegram bot** (optional): message [@BotFather](https://t.me/BotFather) with `/newbot` to get a token; enable Telegram under Settings → Plugins, open the Telegram app on the home screen, paste the token, send your bot any message, then tap "Find me". This page is the sender: nothing is sent while it is closed (leave a tab open on a computer), and replies typed in Telegram never reach them.
- **WebDAV** (optional, for sync): you need a WebDAV server that allows cross-origin requests. Your own Nextcloud (with an app such as WebAppPassword that opens CORS, or a reverse proxy adding `Access-Control-Allow-Origin` and friends), `rclone serve webdav` and `dufs` all work; Nutstore (坚果云) does not allow CORS and cannot be reached from a web page. The server must allow `PUT / MKCOL / PROPFIND`, accept the `Authorization / If-Match / Depth` headers and expose `ETag`. Enter it under Settings → Sync and press "Test" before saving.
- **Google Calendar** (optional): on a computer open Google Calendar → gear → Settings → pick the calendar on the left → scroll to "Integrate calendar" → copy the "Secret address in iCal format", and paste it under the globe icon at the top right of Schedule ("Subscribe calendars"). Read-only, one-way: what you add in Google lands in Schedule, what they write down never goes back to Google; there is no backend, so it is fetched once when you open Roomie (not again within a few hours), and changes in Google show up on the next open. Google's address sends no CORS headers, so a direct fetch from the browser is usually blocked. Two ways out: export from Google Calendar settings → Import & export and import the .ics file (importing the same calendar again updates it), or host your own relay, e.g. a free Cloudflare Worker, and put its address under "Self-hosted relay" (`{url}` is replaced with the encoded calendar address). Don't use a public proxy, that hands your whole calendar to a stranger. Worker code:

  ```js
  export default {
    async fetch(req) {
      const url = new URL(req.url).searchParams.get('url') ?? '';
      if (!url.startsWith('https://calendar.google.com/')) return new Response('nope', { status: 400 });
      const r = await fetch(url, { cf: { cacheTtl: 0 } });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' } });
    },
  };
  ```

  Once deployed, enter `https://your.workers.dev/?url={url}`. For extra safety hard-code the address in the Worker and add a query parameter only you know as a passphrase.
- **Lock screen** (recommended): Settings → Lock screen. The PIN is stored nowhere; if you forget it, the only way out is clearing the key and entering it again, everything else is kept.

## Development

```bash
npm install
npm run dev      # local preview; desktop browsers show a phone frame
npm run lint     # type check + unit tests
npm run build    # output in dist/
```

Pushing to `main` deploys to GitHub Pages (set Settings → Pages → Source to GitHub Actions once).

## Conventions

See [CLAUDE.md](CLAUDE.md) (Chinese). Design changes go into [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) first.
