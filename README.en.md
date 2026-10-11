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

**M1: one person.** On top of the M0 skeleton ported from Pocketverse, lorebooks, multiple worlds and save slots are gone: memory, state and their notes exist exactly once, follow you, and survive swapping the persona. The plugin API has no "save slot" any more, and gained reading conversations by time range, L1 keyword triggers and a `say` line for catch-up.

What works today: on first launch, onboarding lets you pick who moves in (three built-in personas, a one-line description the model turns into one, or a card import), enter a Claude API key, and they speak first: an introduction and three questions (what to call you, when you sleep, what you are busy with), then you are straight in the conversation; they remember things, and when you come back after a while they write up yesterday's diary.

Next steps are in section 7 of the architecture doc: the ledger, schedule and daily review plugins.

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
