---
name: Sound Annotator
description: A time-anchored music annotation tool for the classroom, built like an audio analysis bench.
colors:
  ink: "#1a1813"
  panel: "#211f18"
  raised: "#2a271f"
  inset: "#131210"
  border: "#38342b"
  border-strong: "#4d473a"
  text: "#e9e4d8"
  muted: "#968d7c"
  accent: "#f5a623"
  meter: "#9ccb63"
  note-teal: "#3bb6a6"
  note-violet: "#a07bf0"
  note-rose: "#ef6f8b"
  note-sky: "#5aa8e6"
  note-orange: "#ef8b4b"
typography:
  display:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.2em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "1px"
  DEFAULT: "2px"
  lg: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-play:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 12px"
    typography: "{typography.body}"
  button-transport:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 8px"
    typography: "{typography.mono}"
  button-capture:
    textColor: "{colors.accent}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 10px"
    typography: "{typography.label}"
  title-bar:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.DEFAULT}"
    padding: "8px 12px"
    typography: "{typography.body}"
  readout-led:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.accent}"
    rounded: "{rounded.DEFAULT}"
    padding: "4px 8px"
    typography: "{typography.mono}"
---

# Design System: Sound Annotator

## 1. Overview

**Creative North Star: "The Listening Station"**

Sound Annotator is built like an audio analysis bench, not a web app. The
surface is warm-dark and quiet so the eye rests on the recording and the notes,
not the chrome. Everything reads like instrument output: timecodes and counts
are monospace, the transport carries an LED clock and a level meter, panels are
flush metal with hard edges. It is dense by intent, optimized for a teacher who
returns to it daily and knows it cold.

Color is treated as data, not decoration. There is exactly one signal color,
amber, and it means *now*: the playhead, the active note, the primary action.
The notes borrow a small set of saturated hues, but those hues encode
*identity* (which note is which), never mood, and they are always paired with a
monospace timecode so meaning survives a projector or a colorblind viewer.

This system explicitly rejects the generic. No rounded cards floating on soft
drop shadows. No indigo "friendly SaaS" accent. No gray-on-gray enterprise
clutter where fourteen controls compete in every corner. And no retro
skeuomorphism: the instrument feel comes from layout, type, and restraint, never
from fake metal or glossy bevels.

**Key Characteristics:**
- Warm-dark, four-step tonal surface ramp; depth from tone, not shadow.
- One amber signal color meaning "now"; everything else is neutral or data-hue.
- Monospace tabular numerics for every timecode, count, and micro-label.
- Squared corners (≤2px), flush panels, hairline dividers; zero card-gaps.
- Secondary controls hidden at rest, revealed on hover or focus.

## 2. Colors

A warm near-black neutral ramp carrying a single amber signal, with a small data
palette reserved for note identity.

### Primary
- **Signal Amber** (#f5a623): The only voice color. Marks the present moment and
  the primary action: the playhead, the active ("now playing") note, the Play button,
  the active track's spine, the LED readout glow. Used sparingly by design.
  The signal *hue* is user-selectable (see "Themes & Palettes" below): Amber is
  the default of four palettes (Amber / Cyan / Vermilion / Violet). Everything
  said about amber holds for whichever signal hue is active.

### Secondary
- **Meter Green** (#9ccb63): Reserved for the output level meter, reading like an
  instrument's signal-present indicator. Not used as a general accent.

### Tertiary (Note Data Palette)
Reserved exclusively for distinguishing notes. Never used as UI accents.
- **Note Teal** (#3bb6a6), **Note Violet** (#a07bf0), **Note Rose** (#ef6f8b),
  **Note Sky** (#5aa8e6), **Note Orange** (#ef8b4b). Amber and green can also
  appear in the rotation. Each is assigned deterministically from the note id.

### Neutral
- **Ink** (#1a1813): App background, the deepest surface.
- **Panel** (#211f18): Standard panel fill (sidebar, transport strip).
- **Raised** (#2a271f): Lifted controls and panel title bars.
- **Inset** (#131210): Recessed "screens": LED readouts, the level meter well,
  text inputs, the waveform/editor canvas.
- **Border** (#38342b) / **Border Strong** (#4d473a): Hairline dividers and
  hover/active edges. Borders carry structure here, not shadows.
- **Text** (#e9e4d8): Primary reading text. **Muted** (#968d7c): labels,
  secondary text, inactive items.

### Named Rules
**The Signal-Is-Now Rule** (née Amber-Is-Now). The active palette's signal color
means the present moment or the primary action, nothing else. It is forbidden as
a decorative fill. If more than roughly 10% of a screen is the signal color,
something non-temporal has stolen it.

**The Color-Is-Data Rule.** Hue only ever encodes identity (which note), never
emotion or hierarchy. Any color-coded element must also carry a text label
(timecode), so it reads correctly on a dim projector and for colorblind users.

### Themes & Palettes (Dark / Light × Amber / Cyan / Vermilion / Violet / Mono)

The theme has **two axes** off one set of CSS variables: the **mode** (dark,
default, described above; or light) and the **signal palette** (which hue plays
the "now" role, plus a matching neutral tint). Both are picked from the header
theme dropdown; `System` follows the OS for the mode. The axes are `data-theme`
and `data-palette` on `<html>` (a boot script in `index.html` paints both before
first render, so there's no flash); tokens live in `src/index.css`, the runtime
in `src/lib/theme.ts`. Palette blocks only redefine what differs — bevels, LED
glow, meter, and motion inherit from the mode blocks (the glow auto-follows the
palette because it reads `var(--accent-ink)`).

The four palettes (signal fill, dark / light):

- **Amber** (default) — `#f5a623` / `#cc7a0a` on warm-dark studio neutrals;
  light chrome is de-yellowed stone.
- **Cyan** "Scope" — `#35e0d8` / `#139087` on cool graphite; phosphor-trace feel.
- **Vermilion** "Tally" — `#ff5640` / `#df5127` on neutral studio gray;
  broadcast REC-light feel. **Danger shifts to pink** (`#f472b6` dark /
  `#be185d` light) in this palette only, so delete affordances never read as
  the signal red.
- **Violet** "Lab" — `#b497ff` / `#9366ed` on neutral-cool gray; synth-hardware
  feel.
- **Mono** "Print" — `#f0f0f0` / `#2b2b2b` on pure grayscale chrome; the signal
  is achromatic (bright white on dark, near-black on light). Color survives
  only as data (note hues) and alarms (danger, the meter's red peak); the meter
  bars go gray. Mono is the one palette where `--on-accent` (text on the signal
  fill: Play, sign-in, copy, the toggle knob) diverges from `--on-bright` (text
  on data-hue chips, always dark): the near-black light accent carries white
  text.

The note **data palette** (teal/violet/rose/sky/orange) is palette-independent:
hue-as-identity must stay stable when the signal hue changes. (Known softness:
in the Cyan palette a teal note spine sits near the signal hue, and likewise
violet notes in the Violet palette — the playing state never relies on hue
alone, the dot + row tint + chip carry it.)

Light is **"The Daylit Station": a white score on the instrument bench** —
the page and canvas are literal white, framed by chrome tinted toward the
active palette.

Light surface ramp (amber palette shown; the other palettes keep the same
structure with their own neutral tint — see `src/index.css`) — the ramp
**inverts** vs dark: the white page is the lightest surface and depth shades
*down* from it (on paper, controls and wells shade rather than lift, which
keeps raised states visible against white), with deliberately dark hairlines so
edges draw crisply:
**ink / note** `#ffffff` · **panel** `#f5f5f2` · **raised** `#f0efeb` ·
**inset** `#e5e3dc` · **border** `#b8b4a6` · **border-strong** `#84806f` ·
**text** `#2a2620` · **muted** `#5f5646`.

Three light-specific rules, all WCAG-AA verified:

- **The White-Page Rule.** The notes list/editor and the canvas are **literal
  white** in light (`--note` = ink = `#ffffff`); the chrome framing them carries
  the active palette's tint. Tint lives in the chrome, wells, borders, and the
  signal color — never the page. The active/selected row uses `--row-sel`
  (equals `raised` in dark): a neutral stone in Amber light (the playing dot +
  chip carry the signal, not a cream field — the user rejected the yellow
  field), a pale signal-tinted wash in the other palettes. (History: white was
  tried first and read clinical against the then-all-warm flat ramp; a warm
  page held for a while, but once the hairlines were darkened to carry the
  structure, white won — 2026-06-07.)
- **The Two-Signal Rule** (née Two-Amber). The signal stays singular, but splits
  by job in every palette: `--accent` is the signal for **fills and graphics**
  (Play, spines, dots, progress; e.g. `#cc7a0a` in amber light), and
  `--accent-ink` is the contrast-safe variant for **text, the LED readout,
  links, and the focus ring** (e.g. `#874e05` in amber light). They are
  **identical in dark**; the split only exists where a fill-strength signal
  would fail AA as text on a pale surface. Every light accent fill is also tuned
  so the dark `--on-bright` text on it (timecode chips, the Play button) clears
  4.5:1 while the fill itself holds ≥3:1 on white and panel.
- **The Hue-As-Data-Holds Rule.** The note/tag/element hues stay raw as **fills**
  in both themes; used as **text or a 1px border** on the white page they are
  mixed toward ink for AA (`src/lib/noteColors.ts` → `hueText`). The LED glow is
  dropped in light (a glow is a dark-screen affordance).

## 3. Typography

**Display / Body Font:** system-ui (with 'Segoe UI', Roboto, sans-serif)
**Label / Mono Font:** ui-monospace (with SFMono-Regular, Menlo, Consolas)

**Character:** The interface speaks in two voices. A quiet system humanist sans
carries all prose (notes, titles, helper text); a monospace carries every number
and every micro-label, the way a piece of gear silkscreens its panel. The
contrast between the two is the type system; there is no third face.

### Hierarchy
- **Display** (700, 1.125rem, 1.2): The editable track title in the sub-bar. The
  largest prose on screen; this is a tool, so nothing shouts.
- **Body** (400, 0.8125rem, 1.6): Note content in the TipTap editor and general
  UI copy. Cap reading measure around 65–75ch inside a note.
- **Label** (600, 0.625rem/10px, +0.2em, UPPERCASE): Panel title bars, source
  badges, "live" indicators, the ⤓-set control. Monospace, always uppercase.
- **Mono Readout** (500, 1rem, +0.08em, tabular): The LED transport/header clock
  and every timecode tag. Amber, with a soft glow on the primary clock.

### Named Rules
**The Monospace-Numerics Rule.** Every timecode, duration, and count is monospace
and tabular-figure. Numbers must never reflow or jitter as they tick. Prose is
never monospace; numerics are never proportional.

**The No-Shouting Rule.** This is product UI: display type stays ≤1.25rem. There
is no hero type. Hierarchy comes from weight, case, and the mono/sans split, not
from size.

## 4. Elevation

Flat by doctrine. Depth is built from the four-step tonal ramp
(ink → panel → raised → inset), not from drop shadows. A panel is "above" the
background because it is lighter, and a readout is "below" the panel because it is
darker. The only shadows in the system are 1px bevels used to make a handful of
*controls* feel physical: an inset shadow on recessed screens (LED readout, meter
well, inputs) and a subtle raised highlight on the primary Play button.

### Shadow Vocabulary
Both bevels are **theme-tuned tokens** (`--bevel-inset` / `--bevel-raised`):
heavy on dark, whisper-soft on light so a black inset shadow never dirties a pale
surface. Values below are the dark theme.
- **Inset bevel** (`box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.6)`): Recessed
  screens only: LED readouts, the meter well, text inputs, the editor canvas.
- **Raised bevel** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), inset 0 -2px 3px rgb(0 0 0 / 0.32)`):
  The primary Play button only. A hint of a physical key, not a gel button.

### Named Rules
**The Tonal-Depth Rule.** Reach for the surface ramp before any shadow. If two
surfaces need separating, change their tone or draw a hairline; do not float one
on a shadow.

**The Bevel-Restraint Rule.** Bevels are 1px lighting hints on interactive
controls only. Textures, gradients on surfaces, gloss, and faux-material finishes
are forbidden. The moment a bevel looks like brushed metal, it has failed.

## 5. Components

### Buttons
- **Shape:** Squared (2px radius). No pills, no fully-rounded buttons.
- **Primary (Play):** Solid Signal Amber (#f5a623) fill, Ink (#1a1813) text, the
  raised bevel, padding 6px 12px. Brightens slightly on hover. The one filled
  button in the transport.
- **Transport (±5s):** Ghost. Transparent fill, 1px Border, Muted text,
  monospace. Hover lifts text to Text and border to Border Strong.
- **Capture (Note @):** Amber outline. Translucent amber fill
  (rgba(245,166,35,0.1)), 1px amber border at 70%, amber uppercase mono label.
  Fill deepens to 0.2 on hover. Signals the primary creative action without a
  second solid-amber element competing with Play.

### Inputs / Fields
- **Style:** Inset. Inset (#131210) fill, 1px Border, Text color, 2px radius.
- **Focus:** Border shifts to Signal Amber. No glow ring, no box-shadow halo.
- **Placeholder:** Muted (#968d7c); never lighter (keep ≥4.5:1).

### Title Bars
- Filled panel headers: Raised (#2a271f) fill, 1px bottom Border, Muted
  uppercase mono label (+0.25em), optional right-aligned mono stat. Every panel
  (Tracks, Viewer, Annotations) wears one. This is the load-bearing "instrument
  panel" device of the whole UI.

### Readouts (LED) & Level Meter
- **LED readout:** Inset well, amber monospace with a soft text-shadow glow
  (`0 0 8px rgb(245 166 35 / 0.5)`), tabular figures. The transport and header
  clock.
- **Level meter:** 16 thin segments in an inset well; green (#9ccb63) low,
  amber mid, red (#ef6f6f) peak. Animates while playing, sits dim at rest.

### Note Rows (Signature Component)
The note list is a flush cue list, not a stack of cards. Each note is a
full-width row separated by hairline dividers, with a full-height colored spine
(3px) on the left edge encoding its identity. The header line carries a colored
monospace timecode tag (click to seek); a ranged note shows `start–end` plus its
length. The active note tints Raised and shows an amber "playing" dot. Secondary
controls (Set start / Set end / Clear end, delete, and the formatting toolbar)
are hidden at rest and revealed on hover or focus, keeping the resting state
quiet.

### Navigation (Library)
The signed-in landing view: every track is a flat Panel tile (hairline border,
squared corners — no soft cards), grouped into folders with Drive semantics
(folder tiles at the root, drill in to see a folder's tracks). A monospace
glyph (▶ / ♪) marks the source type; meta lines (note count, updated-ago) are
monospace Label style. Per-tile controls (move to folder, delete) are hidden at
rest and revealed on hover/focus. Amber appears only on the primary New-track
action, the Shared chip, and the drag-and-drop drop highlight. The wordmark and
a Home button return here from the editor.

## 6. Do's and Don'ts

### Do:
- **Do** build depth from the tonal ramp (ink → panel → raised → inset) and
  hairline (#38342b) dividers. Flush panels, squared corners (≤2px).
- **Do** keep numerics monospace and tabular: timecodes, counts, durations.
- **Do** reserve Signal Amber (#f5a623) for "now" and the primary action; keep it
  under ~10% of any screen.
- **Do** pair every color-coded note with its timecode label, so identity never
  depends on hue alone (projector + colorblind safe).
- **Do** hide secondary controls until hover/focus; let the resting UI stay calm.

### Don't:
- **Don't** ship the **generic AI / shadcn dashboard** look: rounded cards, soft
  drop shadows, indigo accent, evenly padded "friendly SaaS" whitespace. This is
  the primary anti-reference.
- **Don't** drift into **heavy enterprise SaaS clutter**: gray-on-gray toolbars,
  competing controls, data-grid busyness. Density is welcome; clutter is not.
- **Don't** use **retro skeuomorphism**: fake wood or metal textures, glossy
  bevels, brushed-aluminum. Bevels stay 1px and only on controls.
- **Don't** let color carry meaning alone, and **don't** add a second face to the
  type system. Two voices (sans + mono) only.
- **Don't** introduce a second solid-amber control next to Play, or round a
  corner past 2px. If it looks like a card with a shadow, it's wrong.
