# REKTD design system

## Overview

REKTD is a trading and jackpot dashboard for wallet holders on Robinhood Chain. The main visual is an oversized tabular countdown on an obsidian surface. Emerald signals the trading action and active clock; crimson marks urgency and the burn share. The page keeps the product state and trading controls ahead of history, claims and rules.

This document describes the implemented source. It is under `docs/` because the assignment's overriding write budget permits only `web/**`, `dist/**` and `docs/**` plus `web/.gitignore`. A repository-root `DESIGN.md` would violate that budget.

## Colors

All semantic tokens are in `web/src/styles.css` (`:root`):

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#07090e` | Page background; dark text on emerald buttons |
| `--surface` | `#0e131f` | Panels, dialogs and header wallet button |
| `--surface-hover` | `#182131` | Hover/pressed control surfaces |
| `--field` | `#080d15` | Form field background |
| `--text` | `#f0f4f8` | Primary content |
| `--muted` | `#9ca9bb` | Supporting copy and metadata |
| `--line` | `#263143` | Structural boundaries |
| `--accent` | `#00ff9d` | Primary fill, active clock and winner marker |
| `--accent-hover` | `#66ffc2` | Primary hover |
| `--danger` | `#ff2e54` | Urgent large clock and burn marker |
| `--error` | `#ff8097` | Readable small error text |
| `--focus` | `#a3fadd` | Keyboard perimeter |

The round surface has a restrained radial tint from `#0f2627` to the panel background. The page has a faint dark tint; body text always stays light. The countdown becomes crimson at 60 seconds or less; its text also identifies the round state, so color is not the only cue. Small error text uses the lighter error token rather than the crimson graphic accent.

This is an intentionally dark-only product. There is no theme switch. Measured contrast and the gradient measurement limitations are recorded in `VALIDATION.md` and its evidence.

## Typography

Two locally bundled variable WOFF2 fonts are used: Manrope for prose/controls and JetBrains Mono for amounts, timers and addresses. The files come from the locked `@fontsource-variable` packages; their OFL licenses ship with the static export. `font-display: swap` and `font-synthesis: none` are explicit. Manrope falls back to system UI/sans-serif, JetBrains Mono to monospace.

| Token | Desktop | At 760px or below | Use |
| --- | --- | --- | --- |
| `--small` | 12px | 12px | Dense supporting metadata |
| `--body` | 14px | 14px | Body copy |
| `--control` | 16px | 16px | Inputs, primary button, subsection headings |
| `--heading` | 24px | 24px | Section headings, amount entry |
| `--value` | 40px | 24px | Main headline and jackpot |
| `--timer` | 88px | 64px | Countdown only |

There are three used weights: 400, 600 and 800. The main headline and wordmark are the heaviest at 800; the large timer remains 600. Headings use 1.25 line height, body 1.6, numeric values 1.3–1.5. Display tracking is mildly negative (`-.035em` headline/jackpot, `-.04em` timer); ordinary text is naturally spaced. All changing amounts and times use tabular numerals. Inputs stay at least 16px on mobile. Important addresses and values wrap or expose their exact value through review/copy/explorer access; no ellipsis CSS clips them.

## Layout

The desktop shell is at most 1320px including 40px side padding. The header shares that alignment. The arena grid uses `minmax(0, 1.4fr)` and `minmax(340px, 1fr)`, with 20px gaps. The trade panel spans both desktop arena rows; the round and leader sit beside it. Statistics and the history/operations sections follow in source order.

Spacing mostly uses 4/8/12/16/20/24/28/32/40/44px. Related fields use 8–12px gaps; panels and sections get larger separation. Grid/flex children have zero minimum widths where long numeric strings could force overflow.

- At **1100px**, shell padding becomes 28px, the network name leaves the header, the leader content wraps, and maintenance panels use two columns.
- At **760px**, the arena becomes one column with 16px shell gutters. The main headline shrinks to 24px and the countdown to 64px. Header navigation is removed while the wallet control stays visible. The round's jackpot becomes a compact row; the full 60/20/20 breakdown follows trading in the leader panel. This preserves the countdown, jackpot, trade input and primary action on the first 390×844 screen.
- On mobile, history rows become two-column entries, maintenance/rules/owner fields stack, and contract addresses wrap. The wallet/review dialog becomes a bottom sheet.
- At **360px**, gutters and a few gaps shrink further; optional small decorative icons are removed. No content uses a fixed text width to force it to fit.

The export was inspected at 320, 390, 760 and 1440 CSS pixels, including long balances and full addresses. These are viewport tests, not physical-device or browser-native zoom certification.

## Elevation & depth

Panels use tonal separation and one structural border, without drop shadows. The round's tinted field gives it focus without a decorative background image. The amount input uses a baseline within the trade panel, avoiding a second card surface. The native modal occupies the browser's top layer; its dark backdrop has an 8px blur. There are no sticky panels covering content.

## Shapes

`--radius` is 16px for panels. The history panel uses 12px; ordinary buttons/inputs use 8px, wallet rows 10px and dialogs 20px. Mobile dialogs keep rounded upper corners and meet the bottom safe area. Icon coins and leader markers are circular. Rounded tracks clip only decorative progress, never text.

## Components

| Component / source | Reuse and states |
| --- | --- |
| `Icon`, `Status` in `web/src/components.tsx` | One outline icon set, `currentColor`, decorative ARIA-hidden SVG; status always includes text |
| `ActionButton`, `TxFeedback` in the same file | Primary/secondary action styling; distinct per-action simulation/wallet/pending/success/error state, receipt explorer link and confirmation retry |
| `WalletControl`, `Modal` in `web/src/Wallet.tsx` | EIP-6963 wallet rows, phone links, wrong-chain control; native dialog, explicit Tab loop, Escape/backdrop/close button, focus return |
| `AddressView` in the same file | Checksummed display, exact clipboard value, explorer link; full and compact variants, inline copy feedback |
| `Trade` in `web/src/Trade.tsx` | Buy/sell pressed-button group, labeled amount/slippage inputs, presets, quote status, approval progression, frozen review; disabled until prerequisites pass |
| Arena in `web/src/App.tsx` | Timer, progress, jackpot split, leader and statistics; unavailable data never becomes a fabricated zero |
| `History` in `web/src/History.tsx` | Bounded on-chain event pages with loading/empty/error/retry and explicit scanned range |
| `Operations` in `web/src/Operations.tsx` | Permissionless settlement/claim/recovery and owner-only forms; descriptions identify actual ETH recipients |

Controls have visible hover, press, focus and disabled treatments. Touch rows in the wallet sheet are at least 48px; primary actions are 48px. Compact presets remain 36px with gaps and icon buttons have explicit accessible names. Buttons remain disabled for unavailable contract prerequisites. Ordinary field errors sit beside the controls; transaction feedback persists. The quote status has a polite live region. The countdown is a timer, not a once-per-second live announcement.

Transitions are limited to color/background/border, with the progress width animated for 300ms. Spinner rotation and press scaling exist only under `prefers-reduced-motion: no-preference`; reduced motion also removes smooth scrolling. Forced-colors uses system `CanvasText`, `Highlight` and `HighlightText`.

## Do's and don'ts

- Start a new surface with `.shell`, `.section-head` and the existing panel or list patterns. Put the task control before explanatory sections.
- Use the existing type tokens and three weights. Reserve large mono type for data, not long prose.
- Keep one filled primary action for the current task; other operations use secondary controls.
- Use the error token for small error text. Pair status colors with words or icons.
- Show loading/unavailable/stale honestly. Never fill an empty chain state with demo activity, fake prices or simulated balances.
- Keep exact values available and wrap long strings. Do not hide overflow to mask a layout defect.
- Reuse the runtime manifest and transaction runner when adding a contract control; do not put a new address or ABI map inside a component.
- Preserve the 390px first-screen arrangement. A new explanation belongs next to its control or in disclosure, not above the arena.

For another page, keep the header/wallet control, wrap its content in `.shell`, introduce one main heading and primary task, then reuse the existing panel/field/status components. Verify narrow layouts and the relevant transaction state before extending this document.
