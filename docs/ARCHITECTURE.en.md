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
      lock/              PIN lock state machine + WebCrypto sealing of the API key
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
      speech/            voice: the browser's own SpeechRecognition and speechSynthesis, no third-party TTS
      api/               $kernel/api: the only module plugins may import
    plugins/
      chat/              Messages (kernel-level, cannot be disabled); the composer's mic (recognised text fills the box, never auto-sends) and a read-aloud button on their messages, both hidden when the browser lacks the API
      characters/        Them: persona, profile, memories, card import, first-run onboarding; the persona editor picks the read-aloud voice and rate, stored in the card's voice field
      diary/             Diary: their own take on the day (sample plugin)
      ledger/            Ledger: record, look up, last week's spending
      habits/            Habits: things to keep up, check-ins, streaks
      schedule/          Schedule: events, to-dos, reminders, lunar calendar and holidays
      dates/             Dates: birthdays, anniversaries, countdowns
      weather/           Weather: what it is like where you are today
      review/            Review: good morning + yesterday's recap, weekly summary
      moments/           Moments: a line or two about your last few days, heart it or answer it in chat
      telegram/          Telegram push (off by default): while the page is open, reminders and what he says on your return go to your phone
      settings/          API, appearance, plugin toggles, lock screen, logs, full-database export / import, multi-device sync
    main.ts              boot: kernel → register plugins → mount shell
```

Rule: `plugins/*` may only import `$kernel/api`, never kernel internals or other plugins. Cross-plugin communication goes through the event bus or `services`.

## 5. Core data model

Kernel tables (from M1 on, see `src/kernel/storage/db.ts`): `home`, `characters`, `conversations`, `messages`, `memories`, `notes`, `kv`, `usage`, `logs`. Pocketverse's `worlds`, `lore`, `overlays` and `campaigns` are gone; opening an old database drops those tables, and `memfs` became `notes` because its primary key changed (Dexie cannot change a primary key in place).

Backup: Settings → Data → Export all packs every table in `db.tables` except `logs` / `usage` (plugin tables included) into one JSON file (`src/plugins/settings/backup.ts`), Blobs as base64, with the header `{ app: 'roomie', kernel, schema, exportedAt }`. Import shows a preview, then replaces the whole database (clear and write in one transaction, rolled back on failure); only backups with the same kernel version are accepted, and tables belonging to plugins that are not installed are skipped. Multi-device sync (6.6) is built on this format.

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
- Their opening line is assembled by the kernel: each section's schema may carry an optional `say` field (the one line they want to say after handling it); the kernel joins the greeting (`h6` none, `d1` "早", `days` "好久不见") with every section's `say` into **one** message from them, written into the direct conversation, and emits `notify`. If nobody has anything to say, nothing is posted. A section marked `greets: true` carries its own greeting in `say` (the review says good morning or "back?" depending on the hour); when it actually speaks, the kernel skips the tier greeting, and its `say` goes first whatever the plugin order. The system prompt tells the model the sections are joined into one message: only the section asked to greet greets, a fact that appears in several sections is said once, and the "leave `say` empty when replying" rule does not apply during catch-up. Budget: at most one round per resume.

### 6.2 Capability packs are plugins

A "specialty" is a plugin, not a character. A pack typically contributes:

| Contribution | Ledger plugin (`src/plugins/ledger`, implemented) |
|---|---|
| `app` | The ledger screen: month total with a category bar, entries grouped by day, swipe to delete, CSV export |
| `tools` | `ledger_add`, `ledger_query`, `ledger_delete`: they can record, look up or remove an entry for you. Amounts are integer cents, dates are `YYYY-MM-DD`; the model turns natural language into numbers, the plugin only validates |
| `promptContributors.volatile` | A one-line summary of this week's spending, with `triggers` such as "花了 / 买了 / 多少钱" so it is only injected when money comes up |
| `composerActions` | "Log an expense" in the "+" panel: user-initiated, produces an `OutgoingMessage` with an expense card |
| `outputHandlers` | The `bill` card (a snapshot in `attrs` keeps it readable after the entry is deleted) |
| `catchup` | `days` tier: back on Mon–Wed with last week's entries and nothing said yet this week, they mention last week's spending (`say`); skipped while the review plugin's weekly summary is on, since that covers spending |
| `profileSections` | "Spent this month" on their profile page |
| `services` | `ledger`: `monthTotal()`, `range(from, to)`, for the review plugin to pull yesterday's spending |
| `storage` | The `p_ledger_entries` table (`id, date, category`) |

`ctx.addCard`, `share` and `services` are all reused. Plugins never listen to `app.resumed` and call the model themselves.

Capability packs so far (each plugin adds its own line when it lands):

- `habits` habit tracking: tables `habits` / `checks`; tools `habit_add`, `habit_check`, `habit_status`; a `check` card; one `volatile` line of streaks (triggers: 打卡, 坚持, 习惯…); an `attach`-tier catch-up that asks after 8 pm about habits not yet checked today; a "习惯" profile section; service `habits` (`summary()` / `status()`).
- `review` (`src/plugins/review`, implemented): `p_review_reviews` table (`id, date, kind, createdAt`, `kind` daily / weekly); tool `review_read`; catch-up `d1` tier "good morning + yesterday's recap" (`greets`: says good morning inside the configured morning hours, otherwise "back?"; covers the whole absence, up to 7 days) and `attach` tier weekly summary (Sunday after 18:00 or Monday, once a week, can be switched off); material comes from the `ledger` / `habits` / `schedule` / `lunar` services, and anything not installed is simply not mentioned; the review app lists each entry by day with that day's material (message count, spending, done / missed items); nothing injected into the per-turn prompt; service `review` (`weeklyEnabled()`, which the ledger checks before mentioning last week's spending on its own).
- `schedule` (agenda and reminders, `src/plugins/schedule`, implemented): `p_schedule_items` table; tools `schedule_add` / `schedule_list` / `schedule_done` / `schedule_remove`; the `event` card; "Add an event" in the "+" panel; a `volatile` block with today / tomorrow / the next public holiday (triggers: tomorrow, o'clock, remind…); catch-up `attach` tier "what's left today" (mentioned once a day) and `h6` tier "what you missed while away"; next item on the profile page; a foreground timer polling due reminders every 30 s (kernel `notify` plus browser `Notification`, no background push promised); services `schedule` (today / range / upcoming) and `lunar` (lunar calendar and the Chinese public-holiday table: 2026 per the State Council notice, 2027 estimated).
  - Calendar subscriptions (`src/plugins/schedule/feeds.ts` + `ics.ts`, implemented): Google Calendar's "secret address in iCal format" or an exported .ics file, read-only, one-way (calendar → agenda). No backend: on open and on return to the foreground, once the minimum interval has passed (3 h by default, 1 h to a day in settings, plus "refresh now"), one fetch runs in the background and lands in `p_schedule_items` (`source: 'calendar'`, with `feedId` / `feedKey` / `allDay` / `endTime` / `place`); the rest of the time it reads local data; nothing is fetched offline. The address is as good as a password, so it lives in `ctx.secrets` (`feed.<id>`; a fetch waits for unlock while the lock screen is on); the feed list, interval, relay address and the occurrences you removed by hand live in `settings.feeds`. The parser is hand-written (no library): line unfolding, TZID converted to local time via Intl, all-day events, RRULE daily / weekly (BYDAY) / monthly (BYMONTHDAY, nth weekday) / yearly with COUNT / UNTIL / INTERVAL, EXDATE, RECURRENCE-ID overrides and cancelled instances; only 3 days back to 60 days ahead are expanded. Sync is idempotent: single events are keyed by UID, recurring instances by UID + original start; existing rows are updated (the reminder is re-armed only when the time changed, done state is kept), new ones added, ones gone from the calendar deleted, and writes for one feed are queued so a background fetch and a manual refresh can't insert two copies; an occurrence you delete in the agenda goes into `hidden` and is not re-added. Imported events are not todos: once their day has passed they don't show under "overdue" and `today()` doesn't treat them as undone; reminders and catch-up (today's plans, missed plans) work as for hand-written items. Google's address sends no CORS headers, so a direct browser fetch is usually blocked: the settings page explains the two ways out, importing a file or filling in a self-hosted relay (`{url}` placeholder; README has a Cloudflare Worker example), never a public proxy.
- `dates` (anniversaries and countdowns, `src/plugins/dates`, implemented): `p_dates_dates` table (`id, month, day`; fields title / month / day / year? / lunar / kind); tools `date_add` / `date_list` / `date_remove`, where kind is a birthday or anniversary (yearly; with a year it computes the age or the nth anniversary) or a countdown (a single day); the `date` card; one `volatile` line of dates within seven days (nothing injected otherwise) plus a `stable` sentence on when to record one; an `attach`-tier catch-up that mentions a date falling today or tomorrow (once per occurrence); the nearest date on the profile page; lunar dates resolved through `ctx.service('lunar')` from the schedule plugin, solar only when schedule is off; service `dates` (`upcoming(days)` / `summary()`).
- `weather` (weather, `src/plugins/weather`, implemented): Open-Meteo forecast + air quality + city search, no key; location from geolocation (reverse-geocoded) or a hand-picked city, place and forecast cached in `settings`, fetched at most once an hour; `volatile` one line ("Your side: Beijing 12°C light rain, today 8~15°C, air good") with no triggers (every turn, omitted when no place is set or the fetch fails); catch-up `attach` tier mentions the weather between 5 and 11 am only when something changed noticeably (≥ 5°C warmer / colder than yesterday, rain or snow, strong wind, bad air, extreme heat / cold), once a day; one screen: current + 24 hours + 7 days + sunrise / sunset; network failures fall back silently to the cache and never touch chat; service `weather` (`line()`, structured `today()` with `notes`, `place()`) for the review / morning plugin to pull today's weather.
- `moments` (his feed, `src/plugins/moments`, implemented): Pocketverse's Moments reskinned. He does not post his own storyline; he posts what he noticed about your last few days, one or two sentences. `p_moments_posts` table (`id, characterId, date, createdAt`, fields text / source catch-up · chat · manual / liked / material as one line per item); catch-up `d1` tier "post one" (bundled into the same call as the review, no `say`; the result lands in the feed with a `notify`; looks back as many days as the absence, up to 3; at most one a day); material shares the review's sources: `ctx.data.messages()` plus the `ledger` / `habits` / `schedule` / `lunar` / `weather` services, nothing mentioned for plugins not installed; tool `moments_post` (he posts on his own when the chat turns up something worth keeping); `volatile` lists the last three posts and whether you hearted them, triggered by "动态 / 那条 / 你发的 …" so it is injected only when mentioned; the feed lists posts by time, each can be hearted or answered with "回他一句", which jumps into his conversation with the post quoted in the draft so the talk continues there (the kernel gained `ctx.data.conversationWith(characterId)` and a `draft` param on the conversation screen); no separate comment thread; profile section "动态" shows the latest post; service `moments` (`latest()`).
- `telegram` (Telegram push, `src/plugins/telegram`, implemented, off by default): the Bot API is plain HTTPS, so the browser calls `api.telegram.org` directly, no server; the Bot Token lives in `ctx.secrets` (sealed by the PIN together with the API key once the lock screen is on), chat id and switches in `settings`; one settings screen: the limitation spelled out, Token (checked with `getMe`), "Find me" (`getUpdates`, picks your private chat and fills the chat id), a test message, two switches, the last send result; `onEvent.notify` batches notification-bar items (schedule reminders etc.) for 2.5 s into one message, `onEvent['catchup.done']` forwards the whole message he just composed and drops the notices collected during the catch-up run (the phone gets exactly one message); tool `telegram_send` ("send it to my Telegram"), with a one-line system note only once configured; the send queue is sequential, splits above 4096 chars and waits once on 429 `retry_after`. The honest limitation is on the settings screen: this page is the sender, nothing is sent while it is closed, and replies typed in Telegram never reach him.

### 6.3 Push

Background timers are throttled (Chrome: once per minute for background tabs, intensive throttling after 5 minutes), and a backgrounded mobile page may be discarded at any time. Therefore:

- Foreground, page open: `scheduler` checks catch-up hourly. Already there.
- Page closed: no guarantee. Periodic Background Sync is Chrome/Android only; optional enhancement.
- To actually reach you: the `telegram` plugin (see 6.2) sends reminders and what he says on your return through the Bot API to your phone; it still needs this page open (leave a tab open on the desktop). Email via Gmail API with browser OAuth. WhatsApp is out of scope.

### 6.4 First-run onboarding

The first thing a fresh install does is not import a card; it is meeting someone. When the `characters` plugin's `setup` finds no card at all, it pushes the `onboarding` screen. Three steps:

1. **Who they are**: pick one of three built-in personas (`src/plugins/characters/presets/`: the gentle roommate, the teasing best friend, the quiet bookworm, each with a ~300-character core); or write one line ("I want someone who…") and a cheap model generates name, core and sample dialogue as JSON; "More" keeps the PNG / JSON card import, which goes through the existing inspection page.
2. **API key**: the gateway's own setting; the key stays in this device's browser. With a built-in persona you can skip it and fill it in before chatting; generation from a description needs it first.
3. **They speak first**: in their own voice, generate a one-line introduction and three questions (what to call you, when you usually sleep, what you are busy with lately); without a key, or if generation fails, fixed fallback copy is used. The first answer goes through `cleanName` into `kernel.userName`, the other two are joined into `kernel.userProfile`; the whole exchange is written verbatim into the direct conversation (`meta.onboarding`), and the last answer is handed to the chat engine so they reply to it, which is why their first real message already uses your name.

Onboarding ends inside the conversation. The empty states (Messages, Them) can re-enter it by hand.

### 6.5 Lock screen and key encryption

The goal: when the phone is lent out or the browser is poked through, neither the conversation nor the key is lying in the open. Honestly, this guards against casual snooping, not a determined person with the device.

- **PIN**: 4–6 digits, Settings → Security → Lock screen & key encryption. The PIN itself is never stored; after unlocking, memory holds only the non-extractable AES key derived by PBKDF2, and locking drops it.
- **Key encryption** (`src/kernel/lock/crypto.ts`): PBKDF2-SHA256 (600k iterations, `iter` stored in the record so it can change later) with a random 16-byte salt → AES-256-GCM with a random 12-byte nonce. The ciphertext lives in kv `kernel.lock` (`LockRecord`: `pinLength`, `idleMinutes`, `sealed`, `hasKey`). While the lock is on, `apiKey` in kv `kernel.llm` is always the empty string: `Gateway.save` hands the key to the attached `vault` (the `KeyVault` interface: `persist` / `ready` / `sealed`) to encrypt and store separately. A wrong PIN is a failed GCM tag; there is no separate verifier.
- **When it locks**: at startup whenever `kernel.lock` exists; on return from background (`visibilitychange`) after more than `idleMinutes` minutes (0 = immediately, -1 = only on open). The lock screen is `shell/LockScreen.svelte`, layered above every screen and the pre-send preview (z 90), and not part of the navigation stack.
- **Model calls while locked**: `llm.configured` is true while locked with a sealed key, so catch-up and memory consolidation do not mistake it for "no key" and bail; `Gateway.chat` / `ping` `await vault.ready()` first and only send after unlock.
- **Forgot the PIN**: the only way out is "clear the key and re-enter it" (offered on both the lock screen and the settings page): delete `kernel.lock`, write an empty `kernel.llm.apiKey`, turn the lock off; everything else stays (the other secrets sealed with the PIN are lost too and must be re-entered).
- **Rate limiting**: five wrong attempts → 30-second cooldown, in memory only, reset by a refresh. Do not describe it as brute-force protection.
- **Plugin secrets** (`ctx.secrets.get / set / locked`): Bot tokens, sync passwords and the like are kept the same way as the key. With the lock off they are plaintext in kv `secret.plugin.<id>.<key>`; the moment the lock is turned on they are all sealed into `LockRecord.secrets` (one `Sealed` per secret, same key and salt as the API key, fresh nonce each) and the kv plaintext is deleted; turning the lock off writes them back to kv; changing the PIN re-seals them; forgetting the PIN clears them along with the key. While locked, `get` waits for the unlock like model calls do; plugins that send on a timer check `locked` first to decide whether to wait.
- **Backups**: the full export still exports `kv`, so with the lock on a backup carries the key as ciphertext (`kernel.lock`) and an empty `kernel.llm.apiKey`; importing on another device, the same PIN unlocks it. With the lock off the backup still holds the plaintext key, and the Data page's copy says which case applies. Conversations in a backup are always plaintext.

### 6.6 Multi-device sync

There is no Roomie server. You enter your own WebDAV (Nextcloud, rclone serve webdav, dufs…), and each device merges with the one file kept there. Code lives in `src/plugins/settings/`: `webdav.ts` (a just-enough client), `merge.ts` (the merge, pure functions), `sync.svelte.ts` (the controller) and `Sync.svelte` (Settings → Data → Sync).

- **Unit of sync**: the full-backup JSON from `backup.ts`. The server holds a single `<folder>/roomie.json` plus a `conflicts/` directory. `logs` / `usage` are never synced; in kv, `kernel.lastSeen` and every key ending in `.cache` (the weather forecast cache, for example) are per-device caches that stay out of the file and untouched by the merge. A plugin that wants a cache that must not sync just ends the key with `.cache`.
- **Three-way merge, per table and primary key**: the device remembers what things looked like after the last sync (the base). Per row: identical on both sides → keep it; changed on one side only (deletion counts) → take that side; changed on both → a conflict, won by the larger numeric `updatedAt` when the row has one, otherwise by last write time (the device's last database write vs. the remote file's `exportedAt`); deleted on one side and edited on the other → the edit wins. Conflicts in `home` and `kv` are resolved quietly (logged, no conflict copy): `lastActiveAt`, `catchupAt` and the plugins' "said it today" flags are written by every device and are not your content. The first sync has no base, and the only collisions then are singletons and settings (`home`, kv): the server copy wins, so a newly joined device adopts it. Tables of plugins not installed here pass through untouched; tables the other side lacks keep the local rows — nobody deletes a table on someone else's behalf. Writing back touches only the rows that differ, so a conversation in progress is unaffected; when `kernel.*` settings come in, the page reloads (they are read into memory at boot).
- **Concurrency**: PUT carries `If-Match: <last ETag>` (`If-None-Match: *` the first time); if another device wrote first the server answers 412 and the whole pass runs again, now merging their write too, up to three times. An unchanged ETag means no download.
- **Conflict copies**: when there are conflicts, the losing side's full pre-merge snapshot is uploaded to `conflicts/<time>-<device>-local|remote.json` before the real file is touched. The settings page lists them, previews one, restores it wholesale (the next sync pushes it) or deletes it. They are complete backups, so "Import from backup" also accepts them.
- **When it syncs**: on open, on return from background after more than a minute, fifteen seconds after a local write (`Dexie.on('storagemutated')`, ignoring the merge's own writes), and on tap. Auto-sync can be turned off. Offline is skipped.
- **Where things live**: server URL, account, folder and the auto toggle in kv `kernel.sync`, which syncs with the data; the password is a plugin secret as in 6.5 (`secret.plugin.settings.webdav`, sealed by the PIN when the lock is on; `lock.hasSecret` answers whether one is stored even while locked); base, ETag and device name sit in a separate per-device IndexedDB database `roomie-sync` that export / import never touches.
- **The lock travels with the sync**: `kernel.lock` is a kv row, so once one device turns the lock on, every other device is locked after its next sync and reopen; the same PIN opens it and the sealed key / token / password come along. The trap in the other direction: a new device with no lock enters the sync password first (plaintext `secret.*`), then its first sync pulls another device's lock. Two safeguards: a file pushed with `kernel.lock` in it never carries plaintext `secret.*` rows (`stripLooseSecrets`; the local rows stay for now), and on unlock the kernel seals any plaintext `secret.*` still in kv into the lock (an entry already in the lock wins) and deletes the plaintext (`lock.adoptLoose`).
- **Honest limits**: browsers talking straight to WebDAV are bound by CORS: the server must send `Access-Control-Allow-Origin`, allow PUT / MKCOL / PROPFIND and the `Authorization` / `If-Match` / `Depth` headers, and expose `ETag`. Self-hosted servers can be configured (Nextcloud with WebAppPassword or similar, or a reverse proxy adding headers); Jianguoyun does not allow CORS, so it does not work from a web page. With the lock off the password is plaintext in kv `secret.*` (like the API key) and travels to the server with kv; with the lock on both are ciphertext. The backup file itself is not encrypted. GitHub Gist is left as a possible second backend (swap `WebDav` for a class with the same stat / get / put shape); not built in this version.

## 7. Milestones

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 Move in** ✅ | Port the skeleton from Pocketverse: keep the whole kernel, keep only Messages / Them / Diary / Settings; delete lorebooks, styles, story plugins; rename | `npm run lint` and `npm run build` pass; can import a card, set a key, chat, get yesterday's diary written |
| **M1 One person** ✅ | Memory follows the user: drop the `worlds` / `lore` / `overlays` / `campaigns` tables, related kernel code and the lorebook / preset / stChat importers; collapse `Campaign` into the `home` singleton; remove "world / save slot / story time" from the UI; drop `campaignId` from the plugin API, add `ctx.data.messages()`, `triggers` and catch-up `say` | Swap the persona and they still remember you; an old database upgrades on open; no "world" or "save slot" anywhere in settings or the profile |
| **M2 Capability packs** ✅ | First-run onboarding (they introduce themselves, ask a few questions, answers go into the user profile); ledger, habits, schedule, dates, weather and review plugins; catch-up becomes "good morning + yesterday's recap" on open; full export / import | Wipe the database, finish onboarding and chat; toggling plugins changes the home screen; come back after a day and get a greeting and review; ask "what did I spend yesterday" and get an answer |
| **M3 Out of the browser** ✅ | Lock screen PIN + key encryption (plugin secrets sealed with it); moments plugin; Telegram push plugin; multi-device sync on your own WebDAV (row-level three-way merge, conflict copies) | With the lock on, neither the database nor a backup holds a plaintext key / token / password, and the same PIN unlocks on another device; review, moments and Telegram each do their part inside one catch-up run and the phone gets exactly one message; two devices chat separately and match after a sync |
| M4 Polish | Gist as a second sync backend; catch-up thresholds as settings; Periodic Background Sync as an optional enhancement; more packs (kitchen, reading) | As needed |

## 8. Copy

- Chinese UI refers to the character as 他 throughout.
- Never say "user", "assistant" or "AI" in the UI; they are they, you are you.
