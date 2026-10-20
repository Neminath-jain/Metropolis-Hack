# Aegis-Monad Design System (Visual Scaffolding)

Derived from the reference Stitch design system (`Auralis Architecture` / `Visual Scaffolding`), this design specification defines the visual language, typography, component tokens, elevation, and layout patterns for Aegis-Monad.

All components in both the landing page (`/`) and the app (`/app/*`) strictly consume these tokens through Tailwind classes and CSS custom properties.

---

## 1. Core Philosophy: "Visual Scaffolding"

Aegis-Monad is an open delegation primitive and policy engine for AI agents on Monad. The visual style embodies **Engineered Precision** and **Visual Scaffolding**:
- **Clarity over Clutter:** High breathing room between sections (120px–150px) contrasted with dense, high-information operational panels (8px–20px internal padding).
- **Tonal Layering & Structural Containment:** Subtle 1px borders (`#e2e2e2` / `#c4c7c7`) and semi-transparent glassmorphic surfaces (`backdrop-blur-xl`) instead of heavy artificial drop shadows.
- **Dual Surface Modes:**
  - *Light Administrative Canvas:* Soft cool white (`#f9f9f9`) with deep charcoal typography (`#1a1c1c`) for public docs, marketing, and overview panels.
  - *Deep Graphite Technical Zones:* High-contrast dark containers (`#111318` / `#1c1b1b`) for terminal output, raw JSON logs, code quickstarts, and live transaction streams.

---

## 2. Color Palette & Token Mapping

| Token Name | Hex Value | Semantic Role |
| :--- | :--- | :--- |
| `surface` | `#f9f9f9` | Primary page canvas background |
| `surface-dim` | `#dadada` | Inactive borders, dividers, disabled states |
| `surface-bright` | `#ffffff` | Pure white card surfaces, hero containers |
| `surface-container-lowest` | `#ffffff` | Primary elevated cards and modal bodies |
| `surface-container-low` | `#f3f3f3` | Secondary nested panels and table headers |
| `surface-container` | `#eeeeee` | Pill badges, secondary chips, toggle tracks |
| `surface-container-high` | `#e8e8e8` | Hover state on containers, border accents |
| `surface-container-highest` | `#e2e2e2` | Default 1px card and divider borders |
| `surface-dark` | `#111318` | Deep graphite technical/code panels |
| `surface-dark-card` | `#181b22` | Cards inside technical dark panels |
| `on-surface` | `#1a1c1c` | High-contrast body text, primary titles |
| `on-surface-variant` | `#444748` | Secondary explanations, subheaders, captions |
| `outline` | `#747878` | Mid-tone metadata text, inactive icons |
| `outline-variant` | `#c4c7c7` | Standard 1px outline border for inputs & cards |
| `primary` | `#111111` | Primary CTA buttons, authoritative text, active pills |
| `on-primary` | `#ffffff` | Text on primary buttons and dark badges |
| `accent-primary` | `#6366f1` | Indigo/violet technical highlights, verified badges |
| `accent-glow` | `rgba(99, 102, 241, 0.15)` | Subtle ambient focus ring on active inputs |
| `success` | `#059669` | Policy passing, wallet connected, tx confirmed |
| `success-container` | `#ecfdf5` | Background for valid trade / policy active badges |
| `error` | `#ba1a1a` | Security violations, blocked malicious calls, errors |
| `error-container` | `#ffdad6` | Security alert banners, policy violation cards |

---

## 3. Typography Scale (Inter / Geist)

All typography utilizes **Inter** (with system fallback), styled with tight tracking on headings for an architectural, engineered aesthetic:

| Style Name | Size | Weight | Line Height | Letter Spacing | Target Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display-h1` | 72px–84px | 600 (Semibold) | 0.95 | `-0.04em` | Landing page hero headline |
| `h2` | 40px–48px | 600 (Semibold) | 1.1 | `-0.02em` | Section titles, major page headings |
| `h3` | 24px–28px | 600 (Semibold) | 1.2 | `-0.01em` | Card titles, vault metrics, policy steps |
| `body-large` | 17px–18px | 400 (Regular) | 1.6 | `0em` | Hero subheadings, lead paragraphs |
| `body` | 14px–15px | 400 (Regular) | 1.5 | `0em` | Standard body text, descriptions, table cells |
| `label-caps` | 12px | 600 (Semibold) | 1.0 | `+0.05em` | Uppercase category tags, badges, statuses |
| `button` | 14px | 500 (Medium) | 1.0 | `+0.01em` | Primary & secondary action buttons |
| `mono-code` | 13px | 400–500 | 1.5 | `0em` | Code snippets, addresses, transaction hashes |

---

## 4. Spacing Scale & Section Rhythm

- **Maximum Container Width:** `1280px` (centered with `mx-auto px-6`)
- **Vertical Section Padding:** `120px` to `150px` on desktop (`mb-[120px]`–`mb-[150px]`), `64px` on mobile.
- **Grid Layout:** Standard 12-column responsive grid (`gap-6`, 24px gutter).
- **Internal Component Padding:**
  - Cards & Modals: `p-6` to `p-8` (24px–32px).
  - Nested Technical Boxes: `p-4` to `p-5` (16px–20px).
  - Small Indicators & Chips: `px-3 py-1` (12px / 4px).

---

## 5. Border Radii & Nested Box Philosophy

The design system enforces a **Nested Radius** hierarchy:
- **Outer Major Cards:** `rounded-[24px]` (24px)
- **Nested Feature Panels / Demo Boxes:** `rounded-xl` (12px)
- **Interactive Inputs, Form Controls, Inner Chips:** `rounded-lg` (8px)
- **Pill Badges & Primary Action Buttons:** `rounded-full` (9999px)

---

## 6. Elevation, Shadows, and Glassmorphism

- **Border-First Elevation:** Rather than harsh drop shadows, elevation is achieved via a crisp `1px` border (`border border-outline-variant` or `border border-surface-variant`).
- **Glassmorphic Navigation & Panels:**
  - Header Navbar: `bg-surface/80 backdrop-blur-xl border-b border-surface-variant`
  - Floating Panels: `bg-surface-container-lowest/90 backdrop-blur-md`
- **Ambient Occlusion Shadow:**
  - Soft cards: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)`
  - Elevated modal: `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)`

---

## 7. Component Styling Guidelines

### Buttons
- **Primary:** `bg-primary text-on-primary font-button px-6 py-3 rounded-full hover:opacity-90 active:scale-95 transition-all`
- **Secondary / Ghost:** `border border-outline-variant text-on-surface font-button px-6 py-3 rounded-full hover:bg-surface-container active:scale-95 transition-all`
- **Destructive / Revoke:** `bg-error text-on-error font-button px-5 py-2.5 rounded-full hover:opacity-90 active:scale-95 transition-all`

### Cards
- White background (`bg-surface-container-lowest`), 1px border (`border border-outline-variant`), rounded corners (`rounded-[24px]`), optional subtle hover lift (`hover:shadow-sm transition-shadow`).

### Inputs & Selects
- `bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary transition-all`

### Code Panels & Live Decision Stream
- Deep Graphite background (`bg-surface-dark` / `#111318`), light monospaced text (`font-mono text-sm text-gray-200`), rounded 24px with macOS-style 3-dot window buttons (`w-3 h-3 rounded-full bg-outline-variant/30`).
