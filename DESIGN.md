---
name: Sound Annotator
description: A time-anchored music annotation tool for the classroom, built like an audio analysis bench.
colors:
  ink: "#0a0a0c"
  panel: "rgba(255,255,255,0.045)"
  raised: "rgba(255,255,255,0.07)"
  inset: "rgba(0,0,0,0.32)"
  border: "#28282d"
  border-strong: "#44444c"
  text: "#ececf0"
  muted: "#a4a4ae"
  accent: "#ff6a3d"
  meter: "#ffce33"
  note-red: "#ff5252"
  note-orange: "#ff9f2e"
  note-yellow: "#ffd633"
  note-green: "#3ddc74"
  note-teal: "#2dd4bf"
  note-sky: "#5aa8ff"
  note-pink: "#f472b6"
  note-violet: "#a06bff"
typography:
  display:
    fontFamily: "'IBM Plex Sans', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "'IBM Plex Sans', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.2em"
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "6px"
  DEFAULT: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
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
    padding: "0 14px"
    height: "40px"
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

**Creative North Star: "The Listening Station"** — restaged 2026-07-17 under
the **Color-As-Accent doctrine** (*color as accent, never as canvas*), and
re-surfaced 2026-09-05 as **frosted glass**: every workspace column is a
floating pane of translucent, blurred glass over a near-black canvas that
carries a soft bloom of the signal hue (the "Flask look", after flask.do).

Sound Annotator is built like an audio analysis bench, not a web app. The
stage is a deep neutral — near-black in dark, a pale grey in light — with the
panes floating on it, so the eye rests on the recording and the notes, not the
chrome. Everything still reads like instrument output: timecodes and counts
are monospace, the transport is a recessed well with an LED clock, panels are
glass with hairline rings and generous corners. It is dense by intent,
optimized for a teacher who returns to it daily and knows it cold.

Color is treated as data and signal, not decoration — and it is *playful*
where it appears: a juicy selectable signal hue (Tangerine by default), a
sunshine meter, and a full crayon-box note palette. The panes themselves are
neutral glass; the only hue on a surface is the ambient bloom on the canvas
behind them (the light the glass catches), the faint glow beneath the
transport well, and the selected note row's wash. The signal means *now*: the playhead, the active
note, the primary action. The note hues encode *identity* (which note is
which), never mood, and they are always paired with a monospace timecode so
meaning survives a projector or a colorblind viewer.

This system still rejects the generic. Glass is not a card: a pane is a
whole workspace column, never a grid of tiles, and there are at most four on
screen. No indigo "friendly SaaS" accent. No gray-on-gray enterprise clutter
where fourteen controls compete in every corner. And no retro skeuomorphism:
the instrument feel comes from layout, type, and restraint, never from fake
metal or glossy bevels — the blur is the only material effect.

**Key Characteristics:**
- A deep neutral canvas (near-black dark / pale grey light) with an ambient
  bloom of the signal hue; workspace columns float on it as frosted-glass
  panes (`.glass`): translucent fill, 28px backdrop blur, hairline ring, top
  highlight, deep soft shadow, 18px corners, 12px gutters.
- Color only as accent: one signal hue meaning "now", a meter hue, and the
  crayon-box note data. Panes never take a tint; only the canvas glows.
- Monospace tabular numerics for every timecode, count, and micro-label.
- Soft corners (chips 6px · controls 8px · grouped 10px · wells 14px · panes
  18px); timecode and tag chips are pills; Play and the transport steps are
  round.
- Secondary controls hidden at rest, revealed on hover or focus.

## 2. Colors

One untinted neutral stage carrying a single playful signal, with a crayon-box
data palette reserved for note identity. **Color as accent, never as canvas**
(2026-07-17): the neutrals are shared by every palette and never move; only
the accents change.

### Primary
- **Signal Tangerine** (#ff6a3d dark / #e04e1a light): The only voice color.
  Marks the present moment and the primary action: the playhead, the active
  ("now playing") note, the Play button, the active track's spine, the LED
  readout glow. Used sparingly by design. The signal *hue* is user-selectable
  (see "Themes & Palettes" below): Tangerine is the default of four palettes
  (Tangerine / Bubblegum / Limeade / Crayon). Everything said about the signal
  holds for whichever hue is active.

### Secondary
- **Meter** (Tangerine palette: sunshine #ffce33 dark / #b98600 light):
  Reserved for the output level meter, reading like an instrument's
  signal-present indicator. Each palette brings its own meter hue as the one
  supporting act; never used as a general accent.

### Tertiary (Note Data Palette)
Reserved exclusively for distinguishing notes. Never used as UI accents.
Full crayon-box saturation — on the neutral stage, the note data carries the
playfulness:
- **Red** (#ff5252), **Orange** (#ff9f2e), **Yellow** (#ffd633),
  **Green** (#3ddc74), **Teal** (#2dd4bf), **Sky** (#5aa8ff),
  **Pink** (#f472b6), **Violet** (#a06bff). Each is assigned
  deterministically from the note id (`src/lib/noteColors.ts`); the same hues
  serve the tag and element palettes.

### Neutral (shared by every palette)
Dark — near-black canvas, glass on top. The surfaces are *washes* (white or
black at low alpha) rather than opaque greys, so every pane stays translucent
wherever it sits:
- **Ink** (#0a0a0c): The canvas, with the `--ambient` bloom painted over it
  (`body::before`).
- **Panel** (white 4.5%): A pane of glass (`.glass` adds the blur, ring,
  highlight and shadow). Also the fill of any `bg-panel` surface.
- **Raised** (white 7%): Lifted strips and hover states; title bars use a
  3% wash so they read as a frosted band, not a slab.
- **Inset** (black 32%): Recessed wells: the transport, LED readouts, the
  level meter, text inputs, the video frame's surround.
- **Pop** (#1a1a1e at 78%): The denser glass a floating menu or modal needs
  to stay legible over live content (`.glass-pop`).
- **Border** (#28282d) / **Border Strong** (#44444c): Hairline dividers and
  hover/active edges; the pane ring itself is white 8% (`--glass-ring`).
- **Text** (#ececf0). **Muted** (#a4a4ae): labels, secondary text, inactive.

### Named Rules
**The Accent-Not-Canvas Rule (glass edition).** Panes are neutral glass in
both modes. Color arrives only as the signal, the meter, the note data, the
faint signal wash on the selected row (`--row-sel`), and — the one addition
the glass restyle made — the ambient bloom *behind* the panes and the glow
beneath the transport well (`--ambient`, `.well-glow`, both read the signal
hue so they follow the palette). If a pane's own fill is carrying a hue,
it's wrong.

**The Signal-Is-Now Rule.** The active palette's signal color means the
present moment or the primary action, nothing else. It is forbidden as a
decorative fill. If more than roughly 10% of a screen is the signal color,
something non-temporal has stolen it.

**The Color-Is-Data Rule.** Hue only ever encodes identity (which note), never
emotion or hierarchy. Any color-coded element must also carry a text label
(timecode), so it reads correctly on a dim projector and for colorblind users.

### Themes & Palettes (Dark / Light × Tangerine / Bubblegum / Limeade / Crayon)

The theme has **two axes** off one set of CSS variables: the **mode** (dark,
default, described above; or light) and the **signal palette** (which hue plays
the "now" role). Both are picked from the header theme dropdown; `System`
follows the OS for the mode. The axes are `data-theme` and `data-palette` on
`<html>` (a boot script in `index.html` paints both before first render, so
there's no flash); tokens live in `src/index.css`, the runtime in
`src/lib/theme.ts`. Because the neutral canvas is shared, palette blocks
redefine only the accent family — `--accent` / `--accent-ink` / `--on-accent`,
the meter, the `--row-sel` wash, and (where the signal would collide with
delete affordances) danger. Bevels, LED glow, and motion inherit from the mode
blocks (the glow auto-follows the palette because it reads
`var(--accent-ink)`).

The four palettes (signal fill, dark / light):

- **Tangerine** (default) — `#ff6a3d` / `#e04e1a`, sunshine meter. One juicy
  orange does all the talking.
- **Bubblegum** — `#ff4fd1` / `#d61fae`, aqua meter (`#2ee6c8` / `#0d9488`).
  The hottest voice; still reads like a record light. **Danger shifts to plain
  red** (`#ff5c5c` dark / `#b91c1c` light) in this palette only, so delete
  affordances never read as the pink signal.
- **Limeade** — lime `#c0f03c` on dark, deepened to emerald `#16a34a` in light
  so text and fills stay AA on white; violet meter (`#b497ff` / `#7c58e8`) as
  the wink.
- **Crayon** — cobalt `#4f8bff` / `#335df0`, green meter (`#3ddc74` /
  `#1e9e4e`). The chrome stays quietest here and the note data carries the
  playfulness. Crayon light is the one place `--on-accent` (text on the signal
  fill: Play, sign-in, copy) diverges from `--on-bright` (text on data-hue
  chips, always dark): the cobalt fill carries white text.

The note **data palette** (red/orange/yellow/green/teal/sky/pink/violet) is
palette-independent: hue-as-identity must stay stable when the signal hue
changes. (Known softness: an orange note spine sits near the Tangerine signal,
pink notes near Bubblegum, green near Limeade, sky near Crayon — the playing
state never relies on hue alone, the dot + row wash + chip carry it.)

Light is **white glass on a pale canvas** — the page is `#e9eaee` with the
same ambient bloom, and the panes are white at 62% with the blur, so they
read as frosted rather than flat white. Light surface ramp (all palettes; see
`src/index.css`): **ink** `#e9eaee` · **panel** white 62% · **note** white
55% · **raised** black 4% · **inset** black 5% · **pop** white 86% ·
**border** `#d0d0d6` · **border-strong** `#9c9ca6` · **text** `#1d1d21` ·
**muted** `#62626b`. The masthead is bare canvas in both modes.

Three light-specific rules, all WCAG-AA verified:

- **The White-Sheet Rule** (supersedes the White-Page and Dark-Masthead rules,
  2026-07-17). The whole light theme is one clean white sheet — including the
  global header, which previously kept dark chrome (the retired `.chrome-dark`
  zone). Nothing is tinted; the selected/active note row alone takes
  `--row-sel`, a 7–8% wash of the signal over white. (History: the tinted-
  chrome "Daylit Station" and its dark masthead were replaced when the user
  chose color-as-accent-only — see the palette-mockups artifact.)
- **The Two-Signal Rule.** The signal stays singular, but splits by job in
  every palette: `--accent` is the signal for **fills and graphics** (Play,
  spines, dots, progress; e.g. `#e04e1a` in tangerine light), and
  `--accent-ink` is the contrast-safe variant for **text, the LED readout,
  links, and the focus ring** (e.g. `#a63a10` in tangerine light). They are
  **identical in dark**; the split only exists where a fill-strength signal
  would fail AA as text on white. Every light accent fill is also tuned so its
  `--on-accent` text (the Play button) clears 4.5:1 while the fill itself
  holds ≥3:1 on white.
- **The Hue-As-Data-Holds Rule.** The note/tag/element hues stay raw as
  **fills** in both themes; used as **text or a 1px border** on the white page
  they are mixed toward ink for AA (`src/lib/noteColors.ts` → `hueText`). The
  LED glow is dropped in light (a glow is a dark-screen affordance).

## 3. Typography

**Display / Body Font:** IBM Plex Sans (with system-ui, 'Segoe UI', Roboto fallbacks)
**Label / Mono Font:** IBM Plex Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas fallbacks)

**Character:** The interface speaks in two voices. A quiet humanist-technical
sans (IBM Plex Sans) carries all prose (notes, titles, helper text); its
matching mono (IBM Plex Mono) carries every number and every micro-label, the
way a piece of gear silkscreens its panel. The contrast between the two is the
type system; there is no third face.

### Hierarchy
- **Display** (700, 1.125rem, 1.2): The editable track title in the sub-bar. The
  largest prose on screen; this is a tool, so nothing shouts.
- **Body** (400, 0.8125rem, 1.6): Note content in the TipTap editor and general
  UI copy. Cap reading measure around 65–75ch inside a note.
- **Label** (600, 0.625rem/10px, +0.2em, UPPERCASE): Panel title bars, source
  badges, "live" indicators, the ⤓-set control. Monospace, always uppercase.
- **Mono Readout** (500, 1rem, +0.08em, tabular): The LED transport/header clock
  and every timecode tag. Signal-colored, with a soft glow on the primary clock
  in dark.

### Named Rules
**The Monospace-Numerics Rule.** Every timecode, duration, and count is monospace
and tabular-figure. Numbers must never reflow or jitter as they tick. Prose is
never monospace; numerics are never proportional.

**The No-Shouting Rule.** This is product UI: display type stays ≤1.25rem. There
is no hero type. Hierarchy comes from weight, case, and the mono/sans split, not
from size.

## 4. Elevation

Two layers, and only two. The **canvas** (ink + ambient bloom) is the
ground; the **panes** float on it, and everything else lives *inside* a pane
where depth is again tonal: a raised strip is a lighter wash, a well is a
darker one, a hairline separates. The pane is the only thing that casts a
shadow (`--glass-shadow`, deep and soft, plus a 1px top highlight
`--glass-hi`); menus and modals reuse it via `.glass-pop`. Inside a pane the
old rules hold: 1px bevels on a handful of *controls* (inset on recessed
screens, raised on Play), and the transport well throws a faint signal glow
downward (`.well-glow`) — the lit console under the recorder.

### Shadow Vocabulary
Both bevels are **theme-tuned tokens** (`--bevel-inset` / `--bevel-raised`):
heavy on dark, whisper-soft on light so a black inset shadow never dirties a pale
surface. Values below are the dark theme.
- **Inset bevel** (`box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.6)`): Recessed
  screens only: LED readouts, the meter well, text inputs, the editor canvas.
- **Raised bevel** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), inset 0 -2px 3px rgb(0 0 0 / 0.32)`):
  The primary Play button only. A hint of a physical key, not a gel button.

### Named Rules
**The One-Float Rule.** Only a pane (or a popover/modal) floats. Inside a
pane, reach for the wash ramp or a hairline to separate two surfaces; never
nest a shadowed card inside a pane. A screen has at most four panes.

**The Bevel-Restraint Rule.** Bevels are 1px lighting hints on interactive
controls only. Textures, gradients on surfaces, gloss, and faux-material finishes
are forbidden. The moment a bevel looks like brushed metal, it has failed.

## 5. Components

### Buttons
- **Shape:** Soft (8px radius; chips 6px, segmented/grouped containers
  10px). Pills are reserved for *data chips* (timecode, tag, Q, section, bar)
  and the transport's Play + step buttons; every other button keeps a corner.
- **Primary (Play):** Solid signal fill (`--accent`), `--on-accent` text, the
  raised bevel, padding 6px 12px. Brightens slightly on hover. The one filled
  button in the transport.
- **Transport (±5s):** Ghost. Transparent fill, 1px Border, Muted text,
  monospace. Hover lifts text to Text and border to Border Strong.
- **Capture (Note @):** Signal outline. Translucent signal fill
  (`--accent` at 0.1), 1px signal border at 70%, signal uppercase mono label.
  Fill deepens to 0.2 on hover. Signals the primary creative action without a
  second solid-signal element competing with Play.

### Inputs / Fields
- **Style:** Inset. Inset (#0f0f12 dark / #e8e8ec light) fill, 1px Border, Text
  color, 6px radius.
- **Focus:** Border shifts to the signal. No glow ring, no box-shadow halo.
- **Placeholder:** Muted; never lighter (keep ≥4.5:1).

### Title Bars
- Filled panel headers (40px tall): Raised fill, 1px bottom Border, Muted
  uppercase mono label (+0.25em), optional right-aligned mono stat. Every panel
  (Tracks, Viewer, Annotations) wears one. This is the load-bearing "instrument
  panel" device of the whole UI.

### Readouts (LED) & Level Meter
- **LED readout:** Inset well, signal-colored monospace with a soft
  text-shadow glow in dark (`--led-glow`, reads `var(--accent-ink)`), tabular
  figures. The transport and header clock.
- **Level meter:** 16 thin segments in an inset well; the palette's meter hue
  low, signal mid, red (`--peak`) peak. Animates while playing, dim at rest.

### Note Rows (Signature Component)
The note list is a flush cue list inside the notes pane, not a stack of
cards. Each note is a full-width row separated by hairline dividers, with a
full-height colored spine (3px) on the left edge encoding its identity. The
header line carries a colored monospace timecode *pill* (click to seek); a
ranged note shows `start–end` plus its length; tag chips are pills on a 14%
tint of their hue with no outline. The active note takes a 7% white wash in
dark (`--row-sel` in light) and shows a signal "playing" dot. Secondary
controls (Set start / Set end / Clear end, delete, and the formatting toolbar)
are hidden at rest and revealed on hover or focus, keeping the resting state
quiet.

### Navigation (Library) — "Station Cards"
The signed-in landing view. Still flat Panel tiles (hairline border, softly
squared corners — no soft cards), grouped into folders with Drive semantics (folder
cards at the root, drill in to see a folder's tracks), but the surface warmed
for a wider audience (2026-06-08) without leaving the system:

- **Cover-led tiles.** Every track leads with its cover in an inset "viewer
  screen" well (hairline below): the YouTube thumbnail, or — for audio files,
  sourceless tracks, and dead thumbs — a deterministic waveform mark generated
  from the track id in the id's note hue (`hueText`-mixed in light).
- **The cue line.** Under each cover, a slim strip draws every note as a tick
  at its real position in the track, in the note's own colour (positions
  normalise against the last note; hues `hueText`-mixed in light). Colour
  stays data — the line is the track's annotation fingerprint at a glance.
- **Hue-coded folder cards** (id-derived hue icon, track + note tallies) plus
  a dashed New-folder card; a time-of-day greeting and a prominent inset
  search well sit above. Inside a folder the greeting yields to the Library
  crumb (also the unfile drop target).
- Meta lines stay monospace Label style; a glyph (▶ / ♪) still marks the
  source; per-tile controls (move to folder, delete) stay hidden at rest and
  revealed on hover/focus. The signal appears only on the primary New-track
  action, the Shared chip, and the drag-and-drop drop highlight. The wordmark
  and a Home button return here from the editor.

### Landing (Signed-Out) — "The Input Jack"
The front door, and the only page in the system whose job is to explain the
tool rather than operate it (`src/components/LandingPage.tsx`). A signed-out
visitor is a student holding a link or a teacher sizing the app up, so the page
leads with the one input that starts the work and follows it with the published
gallery as the proof. Sign-in is a ghost button in the masthead; a deep link
that needs an account (`?track=`, `?admin=`) skips this page for Clerk's card.

- **The panel is the hero, not the type.** The YouTube paste field is staged as
  a real Title Bar panel — silkscreen `NEW TRACK` label, right-aligned LED
  readout (`Awaiting link` → `Ready` → `Starting`, danger on a bad link), inset
  input, one solid-signal key. It is the largest object on the page.
- **One row, no standfirst.** The panel body is a single control group: link
  field, workspace menu, key. Nothing explains it in advance — no paragraph
  under the headline, no caption under the menu, no warning under the panel.
  The page is short enough to be read in one glance, which is the point.
- **One door, not two.** There is no blank start beside the paste field; a
  second call to action on a page whose whole argument is "paste a link" only
  competes with it. That makes guests YouTube-only, which App enforces by
  withholding `onAudioUrl` from their `SourcePicker` (see CLAUDE.md).
- **The workspace menu.** Immediately left of the key sits a dropdown in the
  signed-in New-track menu's exact shape — trigger with a chevron, rows of icon
  + name + one line of what it is: *Song sections* (the default) or *Listening
  notes*. What each workspace does arrives inside the menu, at the moment
  someone is choosing between them, rather than sitting on the page being read
  past. The key names the job it will start ("Start mapping" / "Start
  annotating"); trigger and key are both fixed-width from `sm` up, so switching
  workspace doesn't twitch the field beside them.
- **Live confirmation, not a form.** A parsed link resolves the video's real
  title (public oEmbed) and shows it beside the thumbnail in the library tile's
  own cover well. The same title becomes the new track's title.
- **The one No-Shouting exception.** Landing display type runs to
  `clamp(1.75rem, 5.5vw, 2.75rem)`, above §3's in-app 1.25rem ceiling. It
  applies here and nowhere else; the rule still governs all app chrome.
- Hero, gallery, and footer share one 1180px container and one left edge — the
  page reads as a single column, not two stacked pages. The gallery section
  stays on Ink so its Panel tiles keep their tonal step.
- Guest tracks this browser holds keys to appear as a quiet chip row under the
  hero ("On this device"), each carrying the workspace glyph its track opens
  into. A guest key exists only in its URL, so this is the local record that
  keeps a second visit from stranding the first track. The "keep your private
  link" warning is **not** on this page — GuestLinkBar states it across the top
  of the editor, where the work that could be lost actually exists.

### The Signal Dot Is The Way Home
The accent dot is the app's identity mark and it sits at the left of every
masthead — the landing page, the sign-in card, the share viewer, the public
gallery, the admin console and the editor. Everywhere but the editor it is one
component (`src/components/HomeDot.tsx`) wrapping a link to `homeHref()`
(`src/lib/nav.ts`: the pathname with no query, so a sub-path deployment lands
on its own root). The dot lifts 10% on hover from the group, so a wordmark
beside it inside the same link answers too.

The editor keeps its own: with a track open the dot means *back to this
track's folder*, which is a different journey. A guest's dot there leaves the
app for the landing page — a full navigation, since the in-app home is the
library and a guest has none. It was inert before there was a signed-out home
to send them to.

## 6. Do's and Don'ts

### Do:
- **Do** float the workspace columns as `.glass` panes and build every depth
  *inside* a pane from the wash ramp (panel → raised / inset) and hairline
  dividers. Soft corners (6–18px).
- **Do** keep numerics monospace and tabular: timecodes, counts, durations.
- **Do** keep the panes neutral glass and reserve the signal for "now", the
  primary action, and the ambient bloom; keep it under ~10% of any screen.
- **Do** pair every color-coded note with its timecode label, so identity never
  depends on hue alone (projector + colorblind safe).
- **Do** hide secondary controls until hover/focus; let the resting UI stay calm.

### Don't:
- **Don't** ship the **generic AI / shadcn dashboard** look: a grid of small
  shadowed cards, indigo accent, evenly padded "friendly SaaS" whitespace. This
  is the primary anti-reference. Glass panes are columns, not cards.
- **Don't** drift into **heavy enterprise SaaS clutter**: gray-on-gray toolbars,
  competing controls, data-grid busyness. Density is welcome; clutter is not.
- **Don't** use **retro skeuomorphism**: fake wood or metal textures, glossy
  bevels, brushed-aluminum. Bevels stay 1px and only on controls.
- **Don't** let color carry meaning alone, and **don't** add a second face to the
  type system. Two voices (sans + mono) only.
- **Don't** introduce a second solid-signal control next to Play, tint a
  pane's own fill with the signal (beyond `--row-sel`), or nest a shadowed
  card inside a pane. If it looks like a tile in a dashboard, it's wrong.
