# Mesh v9 — Product Requirements Document

> Glossary terms (**Notification**, **Notification Kind**, **Pattern Matcher**, **Pty Tab**, **Session**, **Project**, etc.) are defined in [`/CONTEXT.md`](../CONTEXT.md). v1–v8 architectural decisions are recorded in [`/docs/adr/`](./adr/) and remain in force. **v9 records one new ADR — [ADR-0012](./adr/0012-pattern-matcher-notifications-idle-as-recall-floor.md)** — which reinterprets ADR-0006's "load-bearing trigger" language: the idle detector becomes the *recall floor*, and Pattern Matchers fire first.
>
> v9 cashes in a promise made at v5 ship and pre-staged in v6. CONTEXT.md's **Notification** entry has reserved this since v5: *"future kinds (`approval`, `complete`, etc.) add via pattern matching without schema changes."* v6 staged the seams (open `kind` TEXT column, open `NotificationKind` union, the `IdleDetector.onPtyData` hook). **v9 adds no migration and no new IPC channel** — it fills in detectors behind seams that already exist.

## Goal

**v9 makes notifications say *why* Claude stopped, not just *that* it stopped.** Today every Notification is generic `idle` ("Agent is idle") — including the moments that matter most, when Claude is **blocked on the user's approval**. v5 dogfood confirmed this is the feature's weakest point: a user running several agents saw only "idle" and could not tell an approval prompt from a completed task from a genuine stall.

v9 ships two new **Notification Kinds**, detected by **Pattern Matchers** reading the live Pty Tab's terminal output:

1. **`approval`** — Claude is blocked on a tool-permission prompt and needs the user to answer *right now*. Highest urgency. Surfaced instantly (does not wait for the idle timer) via a **sticky toast** that persists until the user acts.
2. **`complete`** — Claude finished its turn and returned to an empty input prompt. Medium urgency. Auto-dismissing toast.

The existing **`idle`** kind remains the **recall floor**: if no matcher recognizes the screen within the 8-second silence window, `idle` fires as it always has. This guarantees the property ADR-0006 demanded — *a broken matcher can never silently swallow a notification*. Matchers add **speed and precision**; idle guarantees **recall**.

## Problem Statement

As a user running one or more live Pty Tabs, I stepped away from a Project and came back to find Claude had been sitting on an **approval prompt** for ten minutes — but Mesh only ever told me "Agent is idle," the same thing it says when Claude finishes a task or stalls. The notification exists, but it carries no meaning: I can't triage what needs me *now* (unblock an approval) from what's merely done (`complete`) from what just went quiet (`idle`). With multiple agents, the idle-only stream is noise, and the one signal I most need — "Claude is waiting on you" — is indistinguishable from the rest.

## Solution

Mesh reads each live Pty Tab's terminal screen and recognizes two structural states Claude Code renders — a tool-permission prompt and a return-to-empty-input-prompt — and fires a correctly-labelled Notification the moment it sees them. An **approval** notification is instant and its toast is **sticky** (it won't fade while Claude waits on you); a **complete** notification is informational and auto-dismisses. Each kind carries a distinct **shape-first icon** (not color alone) so the bell dropdown and toasts are triageable at a glance, honoring the reduced-color-vision constraint. A global per-kind toast preference lets the user say "toast me for approvals, but stop toasting every completion" without silencing a whole Project. If Claude Code ever changes its interface and a matcher stops recognizing a screen, the notification simply falls back to the generic `idle` kind — degraded precision, never a missed moment.

## User Stories

1. As a user who stepped away, I want an `approval` notification the instant Claude blocks on a permission prompt, so that I can unblock it without waiting out the idle timer.
2. As a user running several agents, I want each Notification to show *which kind* of moment it is, so that I can triage "needs me now" from "just finished" from "went quiet."
3. As a user, I want the `approval` toast to stay on screen until I act, so that I don't miss it because it faded while I glanced away.
4. As a user, I want `complete` and `idle` toasts to auto-dismiss, so that informational notices don't pile up demanding dismissal.
5. As a user with reduced color vision, I want each Notification Kind distinguished by a distinct icon shape (not just hue), so that I can tell them apart regardless of color perception.
6. As a user, I want a `complete` notification when Claude finishes a turn, so that I know a task is done and ready for my review even if I'm in another Project.
7. As a user, I want the generic `idle` notification to still fire when nothing more specific is detected, so that I never lose the guarantee that a quiet agent gets noticed.
8. As a user whose Claude Code just updated its interface, I want notifications to keep working (as `idle`) even if a matcher breaks, so that an interface change can never silently stop my notifications.
9. As a user, I want to turn off `complete` toasts globally while keeping `approval` toasts, so that I'm alerted only for the moments that actually need me.
10. As a user, I want muted-kind notifications to still appear in the bell dropdown and count toward the unread badge, so that I can review what I chose not to be toasted about.
11. As a user, I want the bell dropdown to stay ordered newest-first, so that its ordering stays predictable as new kinds arrive.
12. As a user, I want to jump to the Pty Tab from an `approval` notification, so that I can answer the prompt where it lives.
13. As a user, I want an `approval` toast to clear itself once I've answered the prompt, so that a resolved approval doesn't linger.
14. As a user, I want the notification's Project and Session context shown alongside the kind, so that a generic label like "Approval needed" is still actionable.
15. As a user, I don't want a single silence period to generate both a matcher notification and a duplicate idle notification, so that I get exactly one notification per moment.
16. As a user looking at the Pty Tab when an approval prompt appears, I don't want a notification at all, so that Mesh never alerts me about something already on my screen (foreground suppression, unchanged from v5).
17. As a user, I want notifications to keep their 7-day retention and existing mute/mark-read behavior, so that v9 adds meaning without disrupting the v5 subsystem I already rely on.
18. As a maintainer, I want the matcher logic to be pure and fixture-tested, so that adding or fixing a pattern is a localized, verifiable change rather than a risky one.

## Implementation Decisions

Decisions below are the nine locked in the 2026-07-24 planning grill (recorded in `memory/v9-planned.md`) plus the module decomposition confirmed with the developer. Governing ADR: **ADR-0012**.

**Scope boundary — subtypes only.** v9 is notification subtypes exclusively. The `--timeline-*` CSS tokens reserved in v6 belong to a *separate, deferred* feature (a live tool-activity timeline: thinking/grep/read/edit/done) and are **not** v9's color source and **not** in v9 scope. `question` (Claude asking a free-text clarifying question) is deferred-but-reserved: it has no reliable structural anchor (pure natural-language heuristic → false-positive risk), and the open `kind` column means it can land later as a code-only change.

**Trigger — matchers fire first, idle is the recall floor.** A Pattern Matcher creates the Notification immediately with the correct kind the moment it recognizes a settled screen. The idle timer is not a gate: if no matcher fires within the 8-second silence window, `idle` fires as before. The two are **deduped per idle period** via the existing `alreadyFired` flag on the per-Pty entry — whichever trips first wins; the other disarms. A new period (activity resumes, then goes quiet again) can fire a fresh notification (e.g. `approval` answered → Claude works → `complete`).

**Parse substrate — a debounced, ANSI-stripped screen snapshot.** Matchers never see the raw `pty.onData` chunk stream (a full-screen Ink TUI that repaints continuously). A **`ScreenModel`** deep module wraps a headless terminal buffer (`@xterm/headless`, the sibling of the `@xterm/xterm` the renderer already depends on), one instance per live Pty Tab. It exposes `write(bytes)` and `snapshot()` (settled, decoded screen text). Matchers run against the *settled* frame — debounced ~150–300ms after the last chunk — which doubles as natural dedup against repaint storms.

**Matchers — pure functions, structural anchors.** A **`matchers`** deep module exposes `(screenText) => NotificationKind | null` functions with zero I/O and zero state: `matchApproval`, `matchComplete`, and a `classify()` resolver applying precedence **`approval` > `complete`** (they are naturally mutually exclusive on a settled frame; precedence is defensive). Anchors are **structural, not prose**: `approval` matches the numbered-option-menu scaffold (the `❯` selector + the `1. Yes` / `No, and tell Claude what to do differently` skeleton); `complete` matches empty-input-prompt-present + spinner-absent + no in-flight tool line. Structure survives Claude Code copy changes; specific wording would not.

**Detector coordination — `IdleDetector` extended, remains the single owner of dedup.** `IdleDetector` is modified to receive PTY **bytes** (today `onPtyData` receives only the `ptyId`; the `index.ts` `onData` callback will thread the `data` payload through), feed the per-Pty `ScreenModel`, run the debounced `classify()`, and on a match fire immediately with that kind while setting `alreadyFired`. It keeps the 8-second idle timer as the floor. `DEFAULT_IDLE_LABEL` is extended with generic labels for the new kinds. All timing/dedup stays injectable (clock/scheduler/emitter/uuid), as in v5.

**Labels — generic per kind.** `label_text` is generic: `"Approval needed"`, `"Task complete"`, `"Agent is idle"`. No content extraction in v9 (the row already shows Project/Session context, which makes a generic label actionable). The column takes any string, so richer extracted labels are a zero-schema-cost future refinement.

**Presentation — shape-first, urgency-behavioral.** `NotificationToast` and `NotificationsBell` gain a kind→icon map (distinct lucide glyphs verified not to collide with existing app icons) with a secondary color token per kind (new `--notif-*` tokens or reused `--mesh-*` accents — **not** `--timeline-*`). Toast behavior differentiates by urgency: **`approval` = sticky** (no auto-dismiss timer; clears when the PTY resumes output, i.e. the user answered, via the existing auto-mark-read path); **`complete`/`idle` = auto-dismiss** on the existing timer. Bell ordering is **unchanged (pure recency)** — urgency is carried by the glyph and the sticky toast, not by reordering the log.

**Per-kind mute — global toggles only.** A single global set of three per-kind toast preferences (default all-on, preserving v5 behavior). Toast emission gates as `global-unmuted AND project-unmuted AND kind-enabled`. There is **no per-Project × per-kind matrix**. The load-bearing ADR-0006 invariant is untouched: **mute gates the toast, never the storage** — muted-kind notifications still persist to SQLite, appear in the bell dropdown, and count toward the unread badge. Preferences are stored via the generic setting IPC (the same surface v8's plan-fee used); the existing `notifications:mute-changed` channel is reused.

**No schema change.** `kind` stays plain TEXT; `NotificationKind` stays an open union; `KNOWN_NOTIFICATION_KINDS` grows to `['idle', 'approval', 'complete']`. The renderer still renders an unknown kind as `idle`. Foreground suppression, auto-mark-read, and 7-day retention are unchanged from ADR-0006.

## Testing Decisions

**What makes a good test here:** exercise external behavior through a module's public interface, not its internals. The two modules carrying all the brittleness — `ScreenModel` (M1) and `matchers` (M2) — are deliberately pure/injectable precisely so they can be tested by feeding recorded input and asserting output, with no Electron and no live PTY.

**Module under test (developer-scoped): `matchers` (M2).** The matcher functions are tested by **replaying recorded byte-stream fixtures** — real `pty.onData` output captured from a live `claude --resume` session — through the screen snapshot and asserting the resulting `NotificationKind`. Fixtures cover: (1) a tool-approval prompt → `approval`; (2) a turn completion → `complete`; and negative cases that must yield `null`/`idle` — (3) mid-tool output containing a `?`, (4) spinner-animation frames, (5) printed code/output that looks prompt-ish. Because matchers are pure `(screenText) => kind`, each new pattern is one more fixture + one more assertion — this is the concrete answer to ADR-0006's "the testing matrix grows" concern.

**Fixture hygiene.** Fixtures go stale when Claude Code changes its interface. A documented "re-record fixtures when Claude Code updates" note lives in the test directory. No automation — the architecture self-heals to `idle`, so stale fixtures degrade precision gracefully rather than breaking notifications.

**Regression guard (no new tests, must stay green): `IdleDetector` (M3).** The existing v5 idle-detector unit tests (injectable clock/scheduler) must remain green after M3 is extended. New M3 behavior (matcher-fires-first, idle-floor-fallback, dedup-per-period) is exercised end-to-end through the M2 fixtures and the existing suite rather than a new dedicated M3 test file.

**Prior art:** the existing `src/main/notifications/idle-detector` unit tests (v5, injected clock/emitter/uuid) are the model for pure main-process testing; the v6 RTL + `window.api` mock harness (Slice 45) is available should renderer toast-behavior tests be added later.

**Out of test scope for v9 (per developer):** `ScreenModel` (M1) standalone tests, new `IdleDetector` (M3) tests, and renderer (M5) toast-behavior tests. M1 is covered transitively via the M2 fixtures; M3 by its existing suite; M5 is lower-risk presentation.

## Out of Scope

- **`question` kind** — reserved, not detected in v9 (no reliable structural anchor). Lands later as a code-only change if an anchor emerges.
- **Tool-activity timeline** (thinking/grep/read/edit/done, the `--timeline-*` tokens) — a separate, larger feature deferred to v10+. Shares only the PTY-parsing seam.
- **Extracted/specific labels** (e.g. "Approve Bash: `rm …`?") — generic labels only in v9; enrichable later at zero schema cost.
- **Per-Project × per-kind mute matrix** — global per-kind toggles only.
- **Urgency-weighted bell ordering** — pure recency retained.
- **System-level (OS) notifications** — out of scope per ADR-0006; v9 stays in-window.
- **Content extraction / parsing beyond kind detection** — v9 detects the *kind*, not the *content*.

## Further Notes

- **CONTEXT.md** gained three terms this cycle: **Notification Kind**, **Pattern Matcher**, and a rewritten **Notification** entry. **ADR-0012** records the fire-first / idle-as-floor decision.
- **Slicing (tracer-bullet, parse-spine-first).** Published under parent issue #62; slice issues #63–#67:
  - *Slice 63* (#63) — `ScreenModel` (M1) + `matchers` (M2) + fixtures/replay harness (M7): the pure parse spine, fixture-tested. No UI; detection can log to prove it fires.
  - *Slice 64* (#64) — wire M2 into `IdleDetector` (M3): thread PTY bytes through `onData`, fire-first + dedup + idle floor, extend `DEFAULT_IDLE_LABEL`. `approval`/`complete` now fire end-to-end and render via existing `label_text`.
  - *Slice 65* (#65) — presentation (M5): kind→icon map, `--notif-*` tokens, sticky `approval` toast vs auto-dismiss. (Depends on #64 only; parallel with #66.)
  - *Slice 66* (#66) — per-kind toast mute (M4 + M6): global toggles + gate + Settings UI. (Depends on #64 only; parallel with #65.)
  - *Slice 67* (#67, HITL) — PRD-v9 + ADR-0012 close-out + v0.9.0 release ceremonials + packaged-build install. (Planning artifacts — this PRD, ADR-0012, CONTEXT terms — are committed at planning time in `0e83251`, so the closing slice does not re-commit them, mirroring Slice 57/61.)
- **Reduced-color-vision constraint** (`memory/user-reduced-color-vision.md`) governs all presentation work: shape/position first, color as redundant reinforcement.
