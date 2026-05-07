# DESIGN.md — GenForge

Visual and interaction design language for the tool. Pairs with `genlayer-ic-tool-spec.md` (functional spec).

## Inspiration & direction

Reference: a dark builder-style UI (HR Manage / Awe Studio) with a deep near-black canvas, three vertical zones (icon rail / contextual panel / inspector), violet as the single committed accent, and a rounded-card aesthetic that telegraphs "tool, not website."

What we take from it:

- **Three-zone layout** — icon rail, contextual panel, inspector. The center workspace dominates, but flanking panels are always present.
- **Card-on-canvas density** — UI elements sit *inside* the dark canvas as raised, rounded, slightly-lighter cards rather than flush against the bezel.
- **A single hero accent** — violet does all the persuasion work. Buttons, active states, focus rings, syntax highlights. Nothing else competes.
- **Generous corner radius** — 10–14px on cards, 8px on inputs, full-pill on the primary CTA.
- **Soft elevation** — no harsh shadows; cards lift through subtle background lightening, not drop shadows.

What we deliberately move *away from* the reference:

- The reference uses a generic geometric sans (Inter-ish). We don't. Typography is where this tool earns visual identity.
- The reference is decorative. Our tool is utilitarian — a code-editing surface. So we keep the chrome quiet and let the code be the loud thing.
- No pastel-gradient backdrop behind the app frame. The app fills the viewport.

## Aesthetic verdict

**Quiet workshop.** Dark canvas, restrained chrome, expressive code. The user is here to fix or generate code; the UI's job is to disappear except where it needs to communicate state. When it does communicate, it does so in violet.

---

## Color system

CSS variables, defined once on `:root` and used everywhere. No hex literals scattered through components.

```css
:root {
  /* Canvas */
  --bg-canvas: #0B0B10;          /* app background, near-black with cool cast */
  --bg-panel: #14141C;            /* side panels, modals */
  --bg-card: #1A1A24;             /* cards inside panels, input fields */
  --bg-card-hover: #20202C;       /* card hover */
  --bg-elevated: #24242F;         /* tooltips, dropdowns, the topmost layer */

  /* Borders & dividers */
  --border-subtle: #22222C;       /* card-to-panel separation */
  --border-default: #2C2C38;      /* input borders */
  --border-strong: #3A3A48;       /* hover/focus borders */

  /* Text */
  --text-primary: #ECECF1;        /* body, headings */
  --text-secondary: #9A9AA8;      /* labels, helper text */
  --text-tertiary: #5E5E6E;       /* placeholders, disabled */
  --text-on-accent: #FFFFFF;      /* text on violet buttons */

  /* Accent — single committed color */
  --accent: #7C5CFF;              /* primary violet */
  --accent-hover: #8E72FF;
  --accent-pressed: #6A4BE8;
  --accent-glow: rgba(124, 92, 255, 0.18);  /* focus rings, soft halos */
  --accent-bg-subtle: rgba(124, 92, 255, 0.08);  /* selected row tint */

  /* Semantic — used only for status, never for decoration */
  --ok: #4ADE80;
  --warn: #FBBF24;
  --error: #F87171;
  --info: var(--accent);

  /* Code editor token colors (Monaco theme) */
  --code-keyword: #C792EA;        /* def, class, return */
  --code-string: #C3E88D;
  --code-number: #F78C6C;
  --code-comment: #6E6E80;
  --code-decorator: #82AAFF;      /* @gl.public.write etc — calls out the GenLayer surface */
  --code-self: #FFCB6B;
  --code-default: var(--text-primary);
}
```

**Accent rule:** violet is for *one thing per surface*. Primary CTA, or active tab, or focus state — never two simultaneously. If the user has clicked a button and triggered a loading state, the focus ring on the next input should fade out so the loading button keeps the spotlight.

**Semantic colors are for status only.** A green check means "lint passed." Green is never used to make a button feel friendlier.

---

## Typography

Three families, hand-picked. The display family is the identity move.

```css
--font-display: 'Instrument Serif', 'Times New Roman', serif;
  /* Used for the app wordmark, empty-state hero text, and section H1s.
     A serif in a dev tool is unexpected — that's the point. */

--font-ui: 'Geist', 'Inter', system-ui, sans-serif;
  /* Body, labels, buttons, panel headers. Geist is geometric but
     warmer than Inter; less obviously "AI dashboard." */

--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  /* Code editor, inline code, file paths, keyboard shortcuts.
     Ligatures ON. */
```

Scale (rem-based, 16px root):

| Token | Size | Line | Use |
|---|---|---|---|
| `--text-xs` | 0.75 | 1.2 | Captions, key shortcuts |
| `--text-sm` | 0.8125 | 1.4 | Labels, panel headers, secondary |
| `--text-base` | 0.875 | 1.5 | Body, button text |
| `--text-md` | 1 | 1.5 | Editor text |
| `--text-lg` | 1.125 | 1.4 | Tab labels, modal titles |
| `--text-xl` | 1.5 | 1.3 | Page titles |
| `--text-display` | 2.25 | 1.1 | Empty state hero (Instrument Serif, italic) |

**Weight discipline:**
- Geist: 400 (body), 500 (labels & buttons), 600 (panel headers). No 700.
- Instrument Serif: 400 only, often italicized.
- JetBrains Mono: 400 in editor, 500 for inline code in prose.

**Letter-spacing:**
- All-caps labels (e.g. "WHAT WENT WRONG"): `tracking: 0.08em`, weight 500, color `--text-secondary`. This pattern signals "panel section" without needing a divider.
- Body and code: default tracking.
- Display serif: `tracking: -0.01em` to tighten optical balance.

---

## Spatial system

8-point grid. Compose in multiples of 8; allow 4 only for tight icon-text gaps.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;
```

**Card padding default:** `--space-5` (24px) on all sides. Inputs inside cards get `--space-3` vertical, `--space-4` horizontal.

**Panel padding:** `--space-5` outer, `--space-4` between stacked cards.

**Editor padding:** Monaco's own — don't fight it. Just give the editor container a `--space-4` margin from the panel edges.

---

## Elevation & borders

No real shadows. Elevation is communicated by background lightness alone — each layer is one step lighter than the one beneath it (`canvas → panel → card → elevated`).

Borders are 1px hairlines at low opacity, used for *separation* not *containment*:

```css
border: 1px solid var(--border-subtle);
```

**Focus ring (the one place we go bright):**

```css
outline: none;
box-shadow:
  0 0 0 2px var(--bg-canvas),       /* knock-out gap */
  0 0 0 4px var(--accent),
  0 0 0 8px var(--accent-glow);
```

This double-ring with a glow halo is the tool's signature interaction detail. Use it on every focusable element. Be consistent.

**Corner radii:**

```css
--radius-sm: 6px;       /* badges, tag chips */
--radius-md: 10px;      /* inputs, buttons, small cards */
--radius-lg: 14px;      /* panels, large cards, modals */
--radius-pill: 999px;   /* primary CTA only */
```

The pill-shape primary CTA is a deliberate echo of the reference's "Publish" button — it gives the user one obvious destination per screen.

---

## Layout

Three vertical zones, viewport-filling, no outer margin.

```
┌──────┬─────────────────────────┬───────────────────────┐
│      │                         │                       │
│ icon │   contextual panel      │    inspector / output │
│ rail │   (input side)          │    (result side)      │
│      │                         │                       │
│ 56px │   480px (resizable)     │    flex: 1            │
│      │                         │                       │
└──────┴─────────────────────────┴───────────────────────┘
```

Wait — for our tool, the layout is actually **rail + workspace**, not three columns. The workspace itself splits into input/output. Let me redraw:

```
┌──────┬───────────────────────────┬───────────────────────┐
│ rail │   INPUT SIDE              │   OUTPUT SIDE         │
│      │                           │                       │
│ 56px │   • code editor           │   • fixed code        │
│      │   • error context box     │   • diff toggle       │
│      │   • Fix / Generate CTA    │   • explanation       │
│      │                           │                       │
│      │   ~50% width              │   ~50% width          │
└──────┴───────────────────────────┴───────────────────────┘
       ↑ resizable splitter
```

**Top bar** — 56px tall, spans the full width above the rail+workspace. Contains: app wordmark left (in Instrument Serif italic — *GenForge*, with the F slightly enlarged as a flourish), tab switcher center (Debug / Generate), settings gear right.

**Rail** — 56px wide, full height. Icon-only buttons with tooltips on hover. Active item gets a violet vertical bar on its left edge (3px wide, full button height).

**Splitter between input and output** — 4px wide, transparent until hover, then `--border-strong`. Drag to resize.

**Empty state on the output side** — full-height centered block with the display serif:
> *waiting for code*
> Paste a contract on the left and hit Fix.

This is the one place the serif gets to be theatrical.

---

## Components

### Buttons

**Primary** — pill, violet, used once per screen for the main action (Fix / Generate / Save Key).

```
height: 40px;
padding: 0 var(--space-5);
background: var(--accent);
color: var(--text-on-accent);
border-radius: var(--radius-pill);
font: 500 var(--text-base) var(--font-ui);
transition: background 120ms ease;
```

Hover → `--accent-hover`. Pressed → `--accent-pressed`. Loading → keep violet, replace label with a spinning JetBrains Mono `·` cycling through `· · · · · ·` (six positions, 80ms each).

**Secondary** — rectangular, `--radius-md`, `--bg-card` background, `--border-default` border. Used for Copy, Download, Cancel.

**Ghost** — no background, no border, only text in `--text-secondary`. Hover lifts the text to `--text-primary`. Used for "Clear", "Reset", and rail tooltips.

### Inputs

```
height: 40px;
padding: 0 var(--space-4);
background: var(--bg-card);
border: 1px solid var(--border-default);
border-radius: var(--radius-md);
color: var(--text-primary);
font: 400 var(--text-base) var(--font-ui);
```

Hover border → `--border-strong`. Focus → focus-ring treatment (above). Placeholder → `--text-tertiary`.

Textareas (the "what went wrong" field) use the same styling but `min-height: 96px` and `resize: vertical`.

### Tabs

The Debug/Generate switcher in the top bar:

```
[ Debug ]  [ Generate ]
```

Each tab is text-only, `--space-3` vertical padding, `--space-5` horizontal. Active tab gets:
- Color shifts from `--text-secondary` to `--text-primary`
- A 2px violet underline that animates in from 0% to 100% width over 180ms

No background change. Subtle is the brief.

### Cards

Group related content inside panels. `--bg-card`, `--radius-lg`, `--space-5` padding. No border by default; add `--border-subtle` only if a card is interactive (e.g. a settings row that's clickable).

### Settings modal

Centered, max-width 520px, `--bg-panel` background, `--radius-lg`, `--space-6` padding. Backdrop is `rgba(0, 0, 0, 0.6)` with a 4px blur. Provider selector at top is a segmented control (three pills inside a `--bg-card` container; active pill = violet).

---

## Code editor (Monaco)

This is where the user spends most of their attention, so it gets explicit treatment.

- **Theme:** custom dark theme using the `--code-*` tokens above. Register it as `genfix-dark` and apply on Monaco init.
- **Font:** JetBrains Mono, 14px, line-height 1.6, ligatures on.
- **Line numbers:** `--text-tertiary`, no border between gutter and code.
- **Active line highlight:** `--bg-card-hover`, no border.
- **Selection:** `--accent-glow`.
- **Scrollbar:** thin (8px), `--border-default` thumb, transparent track.
- **Minimap:** off by default. Real estate matters more than orientation in a small editor.

Decorators (`@gl.public.write`, `@allow_storage`) get `--code-decorator` — calling visual attention to the GenLayer-specific surface is on-brand for the tool.

---

## Diff view (Debug output)

When the user toggles "Show diff" in the output panel:

- Side-by-side, not inline.
- Removed lines: subtle red tint `rgba(248, 113, 113, 0.08)` background, no border.
- Added lines: subtle green tint `rgba(74, 222, 128, 0.08)` background.
- Modified intra-line diffs use a stronger version of the same tints (0.18 opacity).
- A pill toggle above the diff lets the user flip between "Diff" and "Full" view. The pill matches the segmented-control style used in Settings.

---

## Motion

Sparingly. Three rules:

1. **State changes get 120–180ms ease-out.** Buttons, hover, tab switches, panel resize.
2. **Async actions get a single dedicated animation.** When the LLM is thinking, the Fix button spinner is the *only* moving thing on the screen. Don't also pulse the editor border, animate the explanation panel fade-in, etc. One signal.
3. **Page-load reveal is one staggered cascade.** When the app first mounts: rail fades in (0ms), top bar slides down 8px (60ms), workspace fades in (120ms). Total under 300ms. After that, no more "intro" animations on navigation.

No bouncy easing. No springs. `cubic-bezier(0.16, 1, 0.3, 1)` for the rare moments something needs personality (the focus ring appearing, the empty-state serif typing in on first load).

---

## Iconography

Use [Lucide](https://lucide.dev) icons throughout — single library, consistent stroke. 16px in dense UI (rail tooltips, button leading icons), 20px in panels, 24px only in empty states. Stroke width 1.5 always. Color inherits from text.

Specific icons:
- Debug tab → `wrench`
- Generate tab → `sparkles`
- Settings → `settings-2`
- Copy → `copy`
- Download → `download`
- Diff toggle → `git-compare`
- Provider switcher: Anthropic → `bot`, OpenAI → `circle`, Gemini → `gem` *(sigh — the literal choice. Replace with custom 12-faceted SVG if we have time.)*

---

## Empty states

Three to design:

1. **No code in editor (Debug, on load).** Editor shows ghost placeholder text in `--text-tertiary` mono: `# Paste your contract here…`
2. **No description (Generate, on load).** Textarea placeholder: `Describe what your contract should do.`
3. **Output panel before first run.** The Instrument Serif moment described in Layout. Italic, `--text-secondary`, centered. Below it, a subtle keyboard hint: `⌘ + Enter to run`.

---

## Accessibility

- Color-blind safe: never rely on color alone. Diff view has +/- gutter marks. Status indicators have icons.
- All interactive elements reachable by Tab; visible focus ring (defined above) on every one.
- Motion-reduce respected: `@media (prefers-reduced-motion)` strips all easing transitions to instant.
- Minimum text contrast 4.5:1 against its background. `--text-secondary` (#9A9AA8) on `--bg-panel` (#14141C) = 7.4:1. Safe.
- Modal traps focus, returns to trigger on close.

---

## What this design is NOT

To stay honest about the reference:

- **Not a website.** No marketing-page tropes (hero gradients, feature card grids, social proof rows). This is a tool.
- **Not a dashboard.** No charts, no metrics tiles, no donut graphs. The output is code and prose.
- **Not playful.** No emoji in chrome (emoji can appear in user-supplied LLM output, but never in our UI labels). No tilted cards. No mascot.
- **Not heavy.** If anything ever feels noisy, the answer is to remove, not to organize.

---

## Open design questions

- ~~**Wordmark.**~~ ✅ Resolved: *GenForge* set in Instrument Serif italic, with the **F** slightly oversized — a small typographic flourish that hints at the "forge" without being literal about it. No icon mark needed; the wordmark *is* the logo.
- **Light mode.** Punted for v1. The whole system above assumes dark. If light mode becomes a requirement, we re-derive the palette rather than auto-inverting.
- **Mobile.** Tool is desktop-first. Below 1024px we should probably show a "best on a wider screen" notice rather than try to squeeze the three-zone layout into one column.
- **Favicon.** A single italic *F* in violet on dark, matching the wordmark treatment. Cheap to make, instantly identifiable in a tab strip.
