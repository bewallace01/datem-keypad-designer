# Claude Project Brief: DAT/EM Keypad Designer

> Drop this file into a Claude Project as knowledge so future conversations have full context. It also doubles as a developer onboarding doc.

## What this project is

An AI-assisted keypad button designer for **DAT/EM Summit Evolution** + **AutoCAD Civil 3D**, built for the **aerial photogrammetry stereo compilation** workflow. End users describe what each button should do in plain English, and the app generates correctly-formatted DAT/EM Keypad Editor macros. Operators can configure per-project layouts, paste their feature code library once as project context, and generate complete keypad layouts with one click.

## Who it's for

Aerial photogrammetry compilers / mapping technicians who use DAT/EM Summit Evolution with Civil 3D for stereo compilation. They digitize planimetric features (buildings, roads, utilities) and topographic features (breaklines, spot elevations) from stereo aerial imagery. They need keypad layouts that vary per project (different feature codes per client/job).

## What problem it solves

DAT/EM Keypad Editor button macros use AutoCAD command-line syntax with several non-obvious rules (`^C^C` cancel prefix, `_` for language-independent commands, `-` to suppress dialogs, `'` for transparent commands, `;` as Enter). Mistakes are silent until the button fails mid-session. Most operators don't write these from memory — they copy from a reference doc or from another operator's setup. This tool lets them describe buttons in English and get correct syntax.

## Architecture

Plain HTML + vanilla JS (ES modules) + CSS. No framework, no build step, no node_modules. Designed to be hackable.

```
datem-keypad-designer/
├── index.html           # Main app shell
├── landing.html         # Marketing/intro page
├── css/
│   └── app.css          # All app styles
├── js/
│   ├── main.js          # Entry point, wires modules together, exposes window-level handlers
│   ├── state.js         # Project + button data structures, default seed, COLORS palette
│   ├── storage.js       # Storage adapter (localStorage <-> window.storage), API key handling
│   ├── ui.js            # Render functions for keypad, legend, status, project select; toast; modal helpers
│   ├── editor.js        # Side-panel button editor (open/save/clear, AI single-button generate)
│   ├── ai.js            # Anthropic API calls (single + bulk), works in artifact and BYOK modes
│   ├── prompts.js       # AI system prompts (most fork-friendly file)
│   └── export.js        # Text/JSON export, JSON import, file download
└── docs/
    ├── DAT_EM_REFERENCE.md
    └── CLAUDE_PROJECT_BRIEF.md  # this file
```

## Data model

A single state blob persisted to storage:

```js
{
  currentId: "p_abc123",
  projects: {
    "p_abc123": {
      id: "p_abc123",
      name: "Project name",
      rows: 6,                  // grid rows
      cols: 8,                  // grid cols
      context: "...",           // free-text feature code library / conventions
      buttons: {
        "0,0": {                // key is "row,col"
          label: "Driver",
          color: "summit",      // category id from COLORS
          commands: "Driver",   // raw macro text
          notes: "..."          // free-text note
        }
      }
    }
  }
}
```

Categories (`color` field): `summit`, `cad`, `capture`, `osnap`, `layer`, `mixed`, `neutral`. Color hex codes in `state.js` `COLORS` array.

## Storage modes

`storage.js` detects which environment it's in:

- **Artifact mode** (Claude.ai artifacts): uses `window.storage.{get,set}`. Auth to api.anthropic.com is handled by the runtime — no API key needed.
- **Standalone mode** (any HTTP server): uses `localStorage`. AI features require user-provided Anthropic API key (BYOK), stored in localStorage, sent only to api.anthropic.com with `anthropic-dangerous-direct-browser-access: true` header.

The same code runs in both. `isArtifactMode` is exported from `storage.js`.

## AI generation

Two prompts in `js/prompts.js`:

1. **`SINGLE_BUTTON_PROMPT`** — given a description and optional project context, return one button as JSON `{label, color, commands, notes}`.
2. **`BULK_AUTOFILL_PROMPT`** — given grid size and project context, return an array of buttons positioned across the grid as JSON `{buttons: [{row, col, label, color, commands, notes}, ...]}`.

Both prompts encode domain knowledge of Summit Evolution keywords, DAT/EM Capture CallCommands, AutoCAD/Civil 3D command-line syntax, and stereo compilation workflow rules. Modifying these prompts is the most direct way to tune output behavior.

The AI is instructed to:
- Always start CAD macros with `^C^C` to cancel any running command.
- Use `_` prefix for language-independent command names.
- Use `-` prefix to suppress dialogs (critical during stereo digitizing).
- Use `'` prefix for transparent commands.
- Use Civil 3D feature lines for breaklines (so they can become surface breaklines), 3D polylines for general planimetric.
- Use exact layer names from project context, not generic placeholders.

## DAT/EM specifics

- **Keypad Editor** is the DAT/EM utility for configuring physical or on-screen keypad button macros. Stored in `.dkf` files (proprietary, not publicly documented — no exporter for now).
- **Capture for AutoCAD** is the DAT/EM bridge between Summit and AutoCAD/Civil 3D. It exposes `CallCmd <name>` style commands.
- **Summit Evolution keywords** are case-sensitive identifiers that drive Summit itself (cursor controls, navigation, image operations) — distinct from AutoCAD keyins.

## Feature ideas / roadmap

See [ROADMAP.md](../ROADMAP.md). Highlights:

- `.dkf` exporter (needs format reverse-engineering from sample files)
- Drag-to-rearrange buttons within the grid
- Symbology library import (CSV / XML feature code lookup tables)
- Custom CAD environment support beyond Civil 3D (Map 3D, Microstation/MicroSurvey)
- Hosted version with shared backend (eliminates BYOK)
- Embedded reference: example macros for common surveying/photogrammetry workflows beyond aerial

## How a future Claude conversation should approach this

When iterating on this project:

1. **Read `js/prompts.js` first** before changing AI behavior. That file is the primary lever.
2. **Keep the artifact/standalone parity working** — any new feature should work in both, with `storage.js` abstracting differences.
3. **Don't break the storage schema** without a migration path. The state shape above is what's persisted.
4. **No build step** is a deliberate constraint for hackability. Don't introduce one without good reason.
5. **Domain accuracy matters** — when in doubt about DAT/EM or Civil 3D specifics, search official docs (datem.com, autodesk.com support pages) rather than guessing.

## Maintainer

Built by [Lightspace Labs](https://lightspacelabs.com). Initial author works in aerial photogrammetry / GIS and built this out of frustration setting up project keypads.
