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
      context/           context assembly: L0/L1/L2, memfs, search, tools
      memory/            memory consolidation (Haiku)
      catchup/           catch-up: one model call per tier
      scheduler/         foreground timers + resume trigger
      data/              repo (writes) and view (read-only view for plugins)
      importers/         character card PNG/JSON (lorebook / preset / stChat pending removal)
      theme/             theme tokens
      nav/               navigation and browser history
      ui/                base UI kit
      api/               $kernel/api: the only module plugins may import
    plugins/
      chat/              Messages (kernel-level, cannot be disabled)
      characters/        Them: persona, profile, memories, card import
      diary/             Diary: the daily review they write for you (sample plugin)
      settings/          API, appearance, plugin toggles, logs
    main.ts              boot: kernel → register plugins → mount shell
```

Rule: `plugins/*` may only import `$kernel/api`, never kernel internals or other plugins. Cross-plugin communication goes through the event bus or `services`.

## 5. Core data model

In M0 the kernel data model is identical to Pocketverse (see `src/kernel/storage/db.ts`): `characters`, `campaigns`, `conversations`, `messages`, `memories`, `memfs`, `kv`, `usage`, `logs`, plus the not-yet-removed `worlds`, `lore`, `overlays`.

Target model (after M1):

```ts
// Them: the single resident character. Swapping the card changes personality, not the memory below
interface Character { id; name; avatar?; core; full; voice? }

// You: user profile, always in L0
interface UserProfile { facts: string[]; preferences: string[] }

// Memory belongs to the user, not to a save slot. characterId only records whose point of view wrote it
interface EpisodicMemory { id; when; text; importance: 1|2|3; sourceMessageIds; createdAt }

// Current state: their mood, your relationship, the last 20 facts; goes into L0
interface State { mood: string; relation: string; facts: string[] }
```

Pocketverse's `Campaign` collapses into an implicit singleton: "your world, and this one run of them". The UI never shows a "save slot".

### 5.1 Three-tier memory

Same as Pocketverse, with a different source of canon:

- **L0 resident**: global rules, user profile, their `core`, current state, recent key events (importance 3), the stable part of each plugin's `promptContributors`. Goes into `system`, cached.
- **L1 triggered**: scan the last few messages for keywords matching plugin-registered triggers (ledger: "spent" pulls in this week's spending; schedule: "tomorrow" pulls in tomorrow's plan). Goes into the last user message.
- **L2 on demand**: the model calls tools: `memory_search`, `memory_recent`, memfs, and plugin tools (`ledger_query`, `schedule_list`).

Write-back: `state_update` and memory tool calls persist immediately; every N turns or on app switch, Haiku consolidates into episodic memories and state changes.

## 6. Kernel modules

Shell, Registry, Bus, Storage, LLM gateway, Context assembler, Theme, Scheduler and Catchup are designed exactly as in Pocketverse and are not repeated here; see section 5 of Pocketverse's `docs/ARCHITECTURE.md`. Roomie's differences:

### 6.1 Catch-up means they were waiting for you

In Pocketverse catch-up is "a few story days passed, post a moment, write a diary". In Roomie it is the core of the product:

- Check once immediately on resume; while in the foreground, check hourly.
- Tiers unchanged: `h6` (≥ 6h), `d1` (≥ 24h), `days` (≥ 2 days), `attach` (rides on the next chat reply).
- Plugins register `catchup: [{ id, tier, collect(ctx) }]`; the kernel merges everything into **one** model call. Expected v1 items:
  - Diary (`d1`): yesterday's review.
  - Schedule (`attach`): what is on today, mentioned in passing.
  - Ledger (`days`, Mondays): last week's spending summary.
- Their opening line is assembled by the kernel: good morning / long time no see, plus each section's result. Budget: at most one round per resume.

### 6.2 Capability packs are plugins

A "specialty" is a plugin, not a character. A pack typically contributes:

| Contribution | Ledger plugin example |
|---|---|
| `app` | The ledger screen |
| `tools` | `ledger_add`, `ledger_query`: they can record or look up for you |
| `promptContributors.volatile` | A one-line summary of this week's spending |
| `composerActions` | "Log an expense" in the "+" panel: user-initiated, produces an `OutgoingMessage` with a card |
| `outputHandlers` | Expense card |
| `catchup` | Weekly summary on Mondays |
| `profileSections` | "Spent this month" on their profile page |
| `storage` | The `p_ledger_entries` table |

`ctx.addCard`, `share` and `services` are all reused. Plugins never listen to `app.resumed` and call the model themselves.

### 6.3 Push

Background timers are throttled (Chrome: once per minute for background tabs, intensive throttling after 5 minutes), and a backgrounded mobile page may be discarded at any time. Therefore:

- Foreground, page open: `scheduler` checks catch-up hourly. Already there.
- Page closed: no guarantee. Periodic Background Sync is Chrome/Android only; optional enhancement.
- To actually reach you: a Telegram bot plugin (the Bot API is plain HTTPS, callable from the browser, no server needed). Email via Gmail API with browser OAuth. WhatsApp is out of scope.

## 7. Milestones

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 Move in** ✅ | Port the skeleton from Pocketverse: keep the whole kernel, keep only Messages / Them / Diary / Settings; delete lorebooks, styles, story plugins; rename | `npm run lint` and `npm run build` pass; can import a card, set a key, chat, get yesterday's diary written |
| M1 One person | Memory follows the user: drop `worlds` / `lore` / `overlays` tables and related kernel code, collapse `Campaign` into a singleton, remove "world / save slot" from the UI; first-run onboarding (they introduce themselves, ask a few questions); user profile in L0 | Swap the card and they still remember you; no "world" anywhere in settings |
| M2 Three packs | Ledger, reminders, daily review plugins; catch-up becomes "good morning + yesterday's recap" on open | Toggling plugins changes the home screen; come back after a day and get a greeting and review; ask "what did I spend yesterday" and get an answer |
| M3 Out of the browser | Telegram bot push plugin; full export / import; PIN-encrypted key | Close the page and still get their message on Telegram |

## 8. Copy

- Chinese UI refers to the character as 他 throughout.
- Never say "user", "assistant" or "AI" in the UI; they are they, you are you.
