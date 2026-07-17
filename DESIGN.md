---
name: ระบบบันทึกการผลิต (Production Logging System)
description: Shop-floor production logging — start and checkout work orders, track defects, stone changes, and tuning rounds
colors:
  graphite-night: "#16181d"
  graphite-surface: "#1d1f24"
  graphite-surface-2: "#272a30"
  hairline: "#3a3e46"
  hairline-strong: "#4a4e57"
  ink: "#f2f3f5"
  ink-muted: "#a9adb6"
  ink-faint: "#80848d"
  shift-blue: "#2f6fc4"
  shift-blue-text: "#7fb0e8"
  amber-warning-bg: "#3a3322"
  amber-warning-border: "#6b5a2e"
  amber-warning-text: "#f0c674"
  alert-rose-bg: "#3d2626"
  alert-rose-text: "#e89a9a"
  confirm-green-bg: "#243a2e"
  confirm-green-text: "#7fd1a0"
  on-accent: "#ffffff"
  amber-warning-hint: "#c9a85a"
typography:
  title:
    fontFamily: "var(--font-geist-sans), Arial, Helvetica, sans-serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "var(--font-geist-sans), Arial, Helvetica, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "var(--font-geist-sans), Arial, Helvetica, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  sm: "8px"
  md: "12px"
  lg: "14px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "14px"
components:
  button-primary:
    backgroundColor: "{colors.shift-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "56px"
  button-primary-disabled:
    backgroundColor: "{colors.graphite-surface-2}"
    textColor: "{colors.ink-faint}"
    rounded: "{rounded.md}"
    height: "56px"
  input:
    backgroundColor: "{colors.graphite-night}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "48px"
  input-readonly:
    backgroundColor: "{colors.graphite-surface-2}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    height: "48px"
  card:
    backgroundColor: "{colors.graphite-surface}"
    rounded: "{rounded.lg}"
    padding: "14px"
---

# Design System: The Shift Log

## 1. Overview

**Creative North Star: "The Shift Log"**

This is a logbook, not a storefront. Every screen exists to get one shift's production data recorded correctly, fast, on a shared device that's been tapped with dirty hands since 6am. Nothing here is decorative — the graphite surfaces, the hairline borders, the three-tier status system all exist to answer one question at a glance: did this save, and is anything wrong. The system rejects the two easy failure modes for a tool like this: looking like an abandoned spreadsheet with form fields bolted on, and looking like a consumer app performing friendliness it doesn't need. It is quiet by default and only raises its voice — amber, then rose — when something genuinely needs a second look.

Density is generous, not tight: full-width 48–56px touch targets, one clear field per row on narrow layouts, because the cost of a mistap on the floor is a wrong production number, not a mild annoyance.

**Key Characteristics:**
- Near-black graphite base with two tonal surface steps, never a pure black or pure white
- Single accent hue (Shift Blue) reserved for primary actions and active/selected state
- Three explicit status tiers — confirm, warning, alert — used consistently everywhere something needs to read as ok, borderline, or wrong
- Flat throughout: no shadows, no gradients, no glassmorphism; depth comes from tone-stepping and 0.5px hairlines only
- One typeface, one weight scale, no display-size heroics

## 2. Colors

A near-black graphite base carries almost the entire surface; color is spent only on the accent and the three status tiers, never decoratively.

### Primary
- **Shift Blue** (#2f6fc4): The one interactive accent — primary buttons, active toggle state, selected picks. Paired with **Shift Blue Text** (#7fb0e8) for links/labels on dark surfaces where the solid fill would be too heavy, and **On Accent** (#ffffff) for text/icons sitting directly on a solid Shift Blue (or other solid-fill) surface.

### Secondary — Status tiers
- **Confirm Green** (#7fd1a0 text / #243a2e bg): Successful save, healthy downtime, QC pass.
- **Amber Warning** (#f0c674 text / #3a3322 bg / #6b5a2e border): Something needs a second look but isn't wrong — downtime over 2 hours, a value worth double-checking. Reserved for genuine anomalies, never decorative. **Amber Warning Hint** (#c9a85a) is its dimmed sibling for secondary/supporting text inside the same warning box — same relationship Ink Muted has to Ink.
- **Alert Rose** (#e89a9a text / #3d2626 bg): A hard error or a value that can't be submitted — defects exceeding output, a required field left blank, QC fail.

### Neutral
- **Graphite Night** (#16181d): App background, and the recessed fill for editable input fields (fields sit a step *below* their card, not above it).
- **Graphite Surface** (#1d1f24): Card / section background — the primary content plane.
- **Graphite Surface 2** (#272a30): One step up from Graphite Surface — read-only fields, the "off" state of a toggle button, secondary chrome (the H01–H15 index tag).
- **Ink** (#f2f3f5): Primary text and active labels.
- **Ink Muted** (#a9adb6): Secondary text, read-only field values, field labels.
- **Ink Faint** (#80848d): Tertiary text, disabled state, placeholder-weight content.
- **Hairline** (#3a3e46) / **Hairline Strong** (#4a4e57): The only border weight in the system — cards and status boxes use Hairline, inputs and buttons use Hairline Strong. Never bolder than 0.5px.

### Named Rules
**The One Accent Rule.** Shift Blue is the only color that means "act on this." It never appears as decoration — only on the primary button, the active toggle, and the current selection.

**The Earned Amber Rule.** Amber Warning appears only for a real anomaly the operator should double-check (downtime > 2 hours, a mismatch). It is never used as a generic "heads up" or an empty-state color. If amber shows up somewhere without an anomaly behind it, that's a bug in the design, not a style choice.

## 3. Typography

**Display Font:** none — this system has no hero/marketing scale.
**Body Font:** Geist Sans (self-hosted via `next/font`), falling back to Arial/Helvetica.
**Label/Mono Font:** none distinct; labels use the body family at a smaller size and Ink Muted color.

**Character:** A single neutral geometric sans at one weight axis (400/500). The typeface should be invisible — legible at arm's length in a bright shop, never a personality statement.

### Hierarchy
- **Title** (500, 19px, 1.3 line-height): Screen and section headers ("เลือกงานที่จะปิด", "ข้อมูลทั่วไป").
- **Body** (400, 15–16px, 1.4 line-height): Field values, list content, buttons.
- **Label** (400, 12px, 1.3 line-height): Field labels above inputs, in Ink Muted. Required fields use full Ink instead of Ink Muted — weight of color, not an asterisk-only signal, marks "required."

### Named Rules
**The One Face Rule.** Geist Sans, everywhere, no exceptions. (The current `checkout` screen overrides to `'Segoe UI', Tahoma, sans-serif` — that's a defect to fix during the Tailwind migration, not a second typeface to keep.)

## 4. Elevation

Flat throughout — there is no `box-shadow` anywhere in the current system, and none should be added. Depth is conveyed entirely by tone-stepping (Graphite Night → Graphite Surface → Graphite Surface 2) and by the 0.5px hairline border. A card never "floats" over the background; it simply sits one tone lighter.

### Named Rules
**The Hairline Rule.** Every border in the system is 0.5px. Never thicker, never a colored accent stripe. If a boundary needs more emphasis than a hairline gives it, that's a background-tone problem, not a border-weight problem.

## 5. Components

Solid and deliberate: every control commits fully to its state (on/off, valid/invalid, saved/pending) with an unambiguous color and size change — nothing fades in halfway or hovers between states.

### Buttons
- **Shape:** 12px radius (`{rounded.md}`), full-width by default.
- **Primary:** Shift Blue fill, white text, 56px height (64px for the single most important action on a screen, e.g. final submit).
- **Toggle / Choice (e.g. machine picker, QC pass/fail):** Graphite Surface 2 fill with a Hairline Strong border when unselected; swaps fully to a solid fill (Shift Blue for neutral choices, Confirm Green / Alert Rose for QC pass/fail) plus matching border when active. The swap is binary — no partial/hover-only tinting.
- **Disabled:** Graphite Surface 2 fill, Ink Faint text — same shape, clearly inert.
- **Stepper (+/−, defect quantity):** Square 48px buttons flanking a center input, sharing one hairline-bordered group with squared-off inner corners.

### Cards / Containers
- **Corner Style:** 14px radius (`{rounded.lg}`).
- **Background:** Graphite Surface.
- **Shadow Strategy:** none — see Elevation.
- **Border:** 0.5px Hairline.
- **Internal Padding:** 14px, sections stacked with 14px gaps.

### Inputs / Fields
- **Style:** Graphite Night fill (recessed relative to its card), 0.5px Hairline Strong border, 8px radius, 48px height, 16px text (large enough to avoid mobile Safari auto-zoom).
- **Read-only:** Graphite Surface 2 fill, Ink Muted text, same border and radius — legible as "filled but locked" without looking disabled.
- **Focus:** native outline suppressed; rely on the field's position and label, not a focus glow (no focus-ring token exists yet — a gap to fill before shipping keyboard/assistive-tech support more broadly).
- **Error:** border shifts to Alert Rose; paired with an Alert Rose status box below the field group explaining what to fix, not just that it's wrong.

### Status Box (signature component)
The recurring `confirm / warn / alert` banner used for downtime readouts, save confirmations, and validation messages. Full-width, 11–13px padding, 8px radius, centered text, background + text pulled from the matching status tier (never just an icon or a border — the entire box is tinted, so it reads at a glance even peripherally).

## 6. Do's and Don'ts

### Do:
- **Do** reserve Shift Blue strictly for primary actions and current selection (The One Accent Rule).
- **Do** use the three-tier confirm/warn/alert system for every status message across the whole app, including `start` and `dashboard` once they're migrated onto this palette.
- **Do** keep every tappable control at ≥48px height — this is used on shared shop devices, often with imprecise or gloved taps.
- **Do** carry Geist Sans everywhere; retire the Segoe UI override in `checkout`.
- **Do** make read-only fields visually distinct (Graphite Surface 2) rather than identical to editable ones — an operator should never wonder if a field is locked.

### Don't:
- **Don't** let this read as a digitized paper form or a spreadsheet with a UI bolted on — PRODUCT.md's explicit anti-reference. Every screen should feel like considered software, not a Google Forms clone.
- **Don't** add `box-shadow`, glassmorphism, or gradients anywhere — the system is flat by design (see Elevation).
- **Don't** use a colored `border-left`/`border-right` stripe as a decorative accent on cards or list items; use a full hairline border or a tinted background instead.
- **Don't** spend Amber Warning on anything that isn't a genuine anomaly the operator needs to double-check.
- **Don't** introduce a second typeface, a second border weight, or a shadow "just for this one component" — extend the existing token set instead.
