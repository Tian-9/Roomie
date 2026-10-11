# Roomie Architecture

> Someone who lives in your pocket. The shell is a virtual phone, there is exactly one personality and one memory, and abilities grow as plugins. This document is the design baseline; code follows it, and design changes land here first. 中文：[ARCHITECTURE.md](ARCHITECTURE.md).

## 0. In one sentence

**Microkernel + plugins + three-tier memory, serving one person.** The kernel owns the phone shell, storage, model gateway, context assembly, catch-up and the plugin registry. Chat, diary, ledger, schedule are all plugins. The kernel does not know what a "ledger" is, nor who "they" are; it only knows character cards and memories.

## 1. Relationship to Pocketverse

Roomie forks from [Pocketverse](https://github.com/Tian-9/pocketverse). Pocketverse is built for multiverse role-play: many worlds, many character cards, one save slot per playthrough, memory attached to the save slot. Roomie has exactly one world (your real life), so:

| | Pocketverse | Roomie |
|---|---|---|
| Worlds | Many, each with a lorebook canon | One, no lorebook; the "canon" is your own data |
| Characters | Many cards, each with its own playthroughs | One resident character; you can swap the card, memory does not follow the card |
| Save slots | One card, many slots, memory isolated per slot | One memory, attached to the user |
| Plugins | Moments, red packets, forum, shop (story features) | Ledger, schedule, review (life features) |
| Catch-up | A few days passed in the story | They waited a few days for you in real life |

Reused as is: Shell, Storage, LLM gateway, Context assembler, Catchup, Scheduler, Theme, UI kit, Registry, Bus, character-card import. Removed: lorebooks (lore), style presets (style), overlays, and all story plugins.

## 2. Goals and non-goals

Goals:

- Pure front-end PWA, static hosting (GitHub Pages), add to home screen and go, no server.
- Bring your own API key; the browser talks to Claude directly. Gemini / OpenAI-compatible as secondary adapters.
- One character with a personality: the card defines who they are, three-tier memory lets them remember you.
- Every visible feature is a plugin; capability packs can be toggled and the home screen follows.
- Relationship first, chores second: v1 only does low-risk abilities (record, remind, recall), nothing with external side effects (sending email, editing calendars).
- One visual language: plugins compose the kernel UI kit, nothing else.

Non-goals (not now, door left open):

- Background execution, lock-screen push. Browsers cannot; "catch-up on open" replaces it, and a Telegram bot plugin comes later.
- Multi-device sync. Local first; sync becomes a plugin later.
- Third-party plugin sandbox. v1 ships built-in plugins only.
- Vector search. Keywords plus model-driven lookup are enough.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite | Fast, zero config, PWA plugin available |
| Language | TypeScript, strict | Let the compiler catch mistakes |
| UI | Svelte 5 | Closest to plain HTML, smallest output, fast cold start on phones |
| Styling | Tailwind + CSS variables | Variables are the root of theming |
| Storage | Dexie (IndexedDB) | Versioned migrations; plugins declare their own tables |
| Search | MiniSearch | A few KB of in-memory BM25 for memory keyword search |
| Model | `@anthropic-ai/sdk` (browser mode) first | Caching, tool loop, memory tool all used |
| PWA | vite-plugin-pwa | Manifest + service worker for offline caching only |

## 4. Repository layout

```
roomie/
  docs/                  design docs (this file, zh + en)
  src/
    kernel/              the kernel; plugins cannot bypass it
      shell/             lock screen, home grid, dock, notification banner
      registry/          plugin registry, contribution points, services
      bus/               event bus
      storage/           Dexie instance, schema, plugin table namespace, live queries
      llm/               model gateway: Claude adapter, streaming, caching, usage
      chat/              chat engine: tool loop, tag parsing
      context/           context assembly: L0/L1/L2, notes (memfs), search, tools
      memory/            memory consolidation (Haiku)
      catchup/           catch-up: one model call per tier
      scheduler/         foreground timers + resume trigger
      data/              repo (writes) and view (read-only view for plugins)
      importers/         character card PNG/JSON and pre-import scan
      theme/             theme tokens
      nav/               navigation and browser history
      ui/                base UI kit
      api/               $kernel/api: the only module plugins may import
    plugins/
      chat/              Messages (kernel-level, cannot be disabled)
      characters/        Them: persona, profile, memories, card import, first-run onboarding
      diary/             Diary: the daily review they write for you (sample plugin)
      settings/          API, appearance, plugin toggles, logs, full-database export / import
    main.ts              boot: kernel → register plugins → mount shell
```

Rule: `plugins/*` may only import `$kernel/api`, never kernel internals or other plugins. Cross-plugin communication goes through the event bus or `services`.

## 5. Core data model

Kernel tables (from M1 on, see `src/kernel/storage/db.ts`): `home`, `characters`, `conversations`, `messages`, `memories`, `notes`, `kv`, `usage`, `logs`. Pocketverse's `worlds`, `lore`, `overlays` and `campaigns` are gone; opening an old database drops those tables, and `memfs` became `notes` because its primary key changed (Dexie cannot change a primary key in place).

Backup: Settings → Data → Export all packs every table in `db.tables` except `logs` / `usage` (plugin tables included) into one JSON file (`src/plugins/settings/backup.ts`), Blobs as base64, with the header `{ app: 'roomie', kernel, schema, exportedAt }`. Import shows a preview, then replaces the whole database (clear and write in one transaction, rolled back on failure); only backups with the same kernel version are accepted, and tables belonging to plugins that are not installed are skipped. Multi-device sync will be built on this format.

```ts
// Them: the persona card. There can be several (swap the persona), but nothing below follows the card
interface Character { id; name; avatar?; core; full; firstMessage?; useFirstMessage?; voice? }

// Your world and this one run of them: exactly one row, id fixed to 'home'. Pocketverse's Campaign collapses into this
interface Home { id: 'home'; state: State; lastActiveAt: number; catchupAt?: number }

// Current state: their mood, your relationship, the last 20 facts; goes into L0
interface State { mood: string; relation: string; facts: string[] }

// Memory belongs to you, not to a card. characterId only records whose point of view wrote it
interface EpisodicMemory { id; characterId?; when; text; importance: 1|2|3; sourceMessageIds; createdAt }

// Their notebook /memories (backend of the Claude memory tool), one tree for the whole database
interface MemFile { path; content; updatedAt }

// One direct conversation per card; consolidation progress lives on the conversation
interface Conversation { id; kind; participantIds; pluginId; consolidatedUpTo?; consolidateFailedAt? }
```

Your name and profile live in kv (`kernel.userName`, `kernel.userProfile`) and are always in L0. "The resident one" is a kv pointer (`kernel.currentCharacter`): whoever you last messaged; catch-up only runs for them. The UI never shows a "save slot" or a "world".

Plugins see `ctx.data`: `currentCharacter()`, `character(id)`, `characters()`, `state()`, `memories(opts)`, `messages({ from, to, limit })`, `userProfile()`, all read-only snapshots.

### 5.1 Three-tier memory

Same as Pocketverse, with a different source of canon:

- **L0 resident**: global rules, user profile, their `core`, current state, recent key events (importance 3), the stable part of each plugin's `promptContributors`. Goes into `system`, cached.
- **L1 triggered**: scan the last few messages for keywords matching plugin-registered triggers (ledger: "spent" pulls in this week's spending; schedule: "tomorrow" pulls in tomorrow's plan). Goes into the last user message. Registered as `promptContributors[].triggers: string[]`: with triggers, `volatile` is only called on a hit; without, it is called every turn.
- **L2 on demand**: the model calls tools: `memory_search`, `memory_recent`, memfs, and plugin tools (`ledger_query`, `schedule_list`).

Write-back: `state_update` and memory tool calls persist immediately; every N turns or on app switch, Haiku consolidates into episodic memories and state changes.

## 6. Kernel modules

Shell, Registry, Bus, Storage, LLM gateway, Context assembler, Theme, Scheduler and Catchup are designed exactly as in Pocketverse and are not repeated here; see section 5 of Pocketverse's `docs/ARCHITECTURE.md`. Roomie's differences:

### 6.1 Catch-up means they were waiting for you

In Pocketverse catch-up is "a few story days passed, post a moment, write a diary". In Roomie it is the core of the product:

- Check once immediately on resume; while in the foreground, check hourly.
- Tiers unchanged: `h6` (≥ 6h), `d1` (≥ 24h), `days` (≥ 2 days), `attach` (rides on the next chat reply).
- Plugins register `catchup: [{ id, tier, collect(ctx) }]`; the kernel merges everything into **one** model call. Expected v1 items:
  - Review (`d1`): good morning + yesterday's recap; (`attach`, Sunday evening / Monday) the weekly summary. Diary (`h6`) writes their own diary separately.
  - Schedule (`attach`): what is on today, mentioned in passing; (`h6`) items that came due while you were away, asked about once.
  - Ledger (`days`, Mondays): last week's spending summary.
- Their opening line is assembled by the kernel: each section's schema may carry an optional `say` field (the one line they want to say after handling it); the kernel joins the greeting (`h6` none, `d1` "早", `days` "好久不见") with every section's `say` into **one** message from them, written into the direct conversation, and emits `notify`. If nobody has anything to say, nothing is posted. A section marked `greets: true` carries its own greeting in `say` (the review says good morning or "back?" depending on the hour); when it actually speaks, the kernel skips the tier greeting. Budget: at most one round per resume.

### 6.2 Capability packs are plugins

A "specialty" is a plugin, not a character. A pack typically contributes:

| Contribution | Ledger plugin (`src/plugins/ledger`, implemented) |
|---|---|
| `app` | The ledger screen: month total with a category bar, entries grouped by day, swipe to delete, CSV export |
| `tools` | `ledger_add`, `ledger_query`, `ledger_delete`: they can record, look up or remove an entry for you. Amounts are integer cents, dates are `YYYY-MM-DD`; the model turns natural language into numbers, the plugin only validates |
| `promptContributors.volatile` | A one-line summary of this week's spending, with `triggers` such as "花了 / 买了 / 多少钱" so it is only injected when money comes up |
| `composerActions` | "Log an expense" in the "+" panel: user-initiated, produces an `OutgoingMessage` with an expense card |
| `outputHandlers` | The `bill` card (a snapshot in `attrs` keeps it readable after the entry is deleted) |
| `catchup` | `days` tier: back on Mon–Wed with last week's entries and nothing said yet this week, they mention last week's spending (`say`) |
| `profileSections` | "Spent this month" on their profile page |
| `services` | `ledger`: `monthTotal()`, `range(from, to)`, for the review plugin to pull yesterday's spending |
| `storage` | The `p_ledger_entries` table (`id, date, category`) |

`ctx.addCard`, `share` and `services` are all reused. Plugins never listen to `app.resumed` and call the model themselves.

Capability packs so far (each plugin adds its own line when it lands):

- `habits` habit tracking: tables `habits` / `checks`; tools `habit_add`, `habit_check`, `habit_status`; a `check` card; one `volatile` line of streaks (triggers: 打卡, 坚持, 习惯…); an `attach`-tier catch-up that asks after 8 pm about habits not yet checked today; a "习惯" profile section; service `habits` (`summary()` / `status()`).
- `review` (`src/plugins/review`, implemented): `p_review_reviews` table (`id, date, kind, createdAt`, `kind` daily / weekly); tool `review_read`; catch-up `d1` tier "good morning + yesterday's recap" (`greets`: says good morning inside the configured morning hours, otherwise "back?"; covers the whole absence, up to 7 days) and `attach` tier weekly summary (Sunday after 18:00 or Monday, once a week, can be switched off); material comes from the `ledger` / `habits` / `schedule` / `lunar` services, and anything not installed is simply not mentioned; the review app lists each entry by day with that day's material (message count, spending, done / missed items); nothing injected into the per-turn prompt.
- `schedule` (agenda and reminders, `src/plugins/schedule`, implemented): `p_schedule_items` table; tools `schedule_add` / `schedule_list` / `schedule_done` / `schedule_remove`; the `event` card; "Add an event" in the "+" panel; a `volatile` block with today / tomorrow / the next public holiday (triggers: tomorrow, o'clock, remind…); catch-up `attach` tier "what's left today" (mentioned once a day) and `h6` tier "what you missed while away"; next item on the profile page; a foreground timer polling due reminders every 30 s (kernel `notify` plus browser `Notification`, no background push promised); services `schedule` (today / range / upcoming) and `lunar` (lunar calendar and the Chinese public-holiday table: 2026 per the State Council notice, 2027 estimated).
- `dates` (anniversaries and countdowns, `src/plugins/dates`, implemented): `p_dates_dates` table (`id, month, day`; fields title / month / day / year? / lunar / kind); tools `date_add` / `date_list` / `date_remove`, where kind is a birthday or anniversary (yearly; with a year it computes the age or the nth anniversary) or a countdown (a single day); the `date` card; one `volatile` line of dates within seven days (nothing injected otherwise) plus a `stable` sentence on when to record one; an `attach`-tier catch-up that mentions a date falling today or tomorrow (once per occurrence); the nearest date on the profile page; lunar dates resolved through `ctx.service('lunar')` from the schedule plugin, solar only when schedule is off; service `dates` (`upcoming(days)` / `summary()`).
- `weather` (weather, `src/plugins/weather`, implemented): Open-Meteo forecast + air quality + city search, no key; location from geolocation (reverse-geocoded) or a hand-picked city, place and forecast cached in `settings`, fetched at most once an hour; `volatile` one line ("Your side: Beijing 12°C light rain, today 8~15°C, air good") with no triggers (every turn, omitted when no place is set or the fetch fails); catch-up `attach` tier mentions the weather between 5 and 11 am only when something changed noticeably (≥ 5°C warmer / colder than yesterday, rain or snow, strong wind, bad air, extreme heat / cold), once a day; one screen: current + 24 hours + 7 days + sunrise / sunset; network failures fall back silently to the cache and never touch chat; service `weather` (`line()`, structured `today()` with `notes`, `place()`) for the review / morning plugin to pull today's weather.

### 6.3 Push

Background timers are throttled (Chrome: once per minute for background tabs, intensive throttling after 5 minutes), and a backgrounded mobile page may be discarded at any time. Therefore:

- Foreground, page open: `scheduler` checks catch-up hourly. Already there.
- Page closed: no guarantee. Periodic Background Sync is Chrome/Android only; optional enhancement.
- To actually reach you: a Telegram bot plugin (the Bot API is plain HTTPS, callable from the browser, no server needed). Email via Gmail API with browser OAuth. WhatsApp is out of scope.

### 6.4 First-run onboarding

The first thing a fresh install does is not import a card; it is meeting someone. When the `characters` plugin's `setup` finds no card at all, it pushes the `onboarding` screen. Three steps:

1. **Who they are**: pick one of three built-in personas (`src/plugins/characters/presets/`: the gentle roommate, the teasing best friend, the quiet bookworm, each with a ~300-character core); or write one line ("I want someone who…") and a cheap model generates name, core and sample dialogue as JSON; "More" keeps the PNG / JSON card import, which goes through the existing inspection page.
2. **API key**: the gateway's own setting; the key stays in this device's browser. With a built-in persona you can skip it and fill it in before chatting; generation from a description needs it first.
3. **They speak first**: in their own voice, generate a one-line introduction and three questions (what to call you, when you usually sleep, what you are busy with lately); without a key, or if generation fails, fixed fallback copy is used. The first answer goes through `cleanName` into `kernel.userName`, the other two are joined into `kernel.userProfile`; the whole exchange is written verbatim into the direct conversation (`meta.onboarding`), and the last answer is handed to the chat engine so they reply to it, which is why their first real message already uses your name.

Onboarding ends inside the conversation. The empty states (Messages, Them) can re-enter it by hand.

## 7. Milestones

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 Move in** ✅ | Port the skeleton from Pocketverse: keep the whole kernel, keep only Messages / Them / Diary / Settings; delete lorebooks, styles, story plugins; rename | `npm run lint` and `npm run build` pass; can import a card, set a key, chat, get yesterday's diary written |
| **M1 One person** ✅ | Memory follows the user: drop the `worlds` / `lore` / `overlays` / `campaigns` tables, related kernel code and the lorebook / preset / stChat importers; collapse `Campaign` into the `home` singleton; remove "world / save slot / story time" from the UI; drop `campaignId` from the plugin API, add `ctx.data.messages()`, `triggers` and catch-up `say` | Swap the persona and they still remember you; an old database upgrades on open; no "world" or "save slot" anywhere in settings or the profile |
| M2 Three packs | First-run onboarding (they introduce themselves, ask a few questions, answers go into the user profile); ledger, reminders, daily review plugins; catch-up becomes "good morning + yesterday's recap" on open | Wipe the database, finish onboarding and chat; toggling plugins changes the home screen; come back after a day and get a greeting and review; ask "what did I spend yesterday" and get an answer |
| M3 Out of the browser | Telegram bot push plugin; full export / import; PIN-encrypted key | Close the page and still get their message on Telegram |

## 8. Copy

- Chinese UI refers to the character as 他 throughout.
- Never say "user", "assistant" or "AI" in the UI; they are they, you are you.
