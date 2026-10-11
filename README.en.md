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

**M2: capability packs.** After M1 removed lorebooks, worlds and save slots, this round moves someone in and gives them things to do:

- **Onboarding**: pick who moves in (three built-in personas, a one-line description the model turns into one, or a card import), enter a Claude API key, and they speak first: an introduction and three questions (what to call you, when you sleep, what you are busy with), then you are straight in the conversation.
- **Six packs**: ledger (say "lunch 32" in chat and it is recorded), habits (things to keep up, check-ins, streaks), schedule ("meeting tomorrow at 3" gets recorded and reminded), dates (birthdays and countdowns, lunar too), weather (what it is like where you are, with a word when it turns cold or rainy) and review (come back after a day and they say good morning and talk about yesterday; a weekly summary on Sunday night). All plugins, all switchable in settings.
- **Catch-up on open**: how long you were away decides what they say, and every plugin's line is merged into one message from them.
- **Backup**: export the whole database as one JSON from settings and import it on a new phone.
- **Voice**: a mic in the composer, read-aloud on their messages, voice picked in the persona; browser built-ins only, no third-party TTS.

Next steps are in section 7 of the architecture doc: Telegram push and a PIN-encrypted key.

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
