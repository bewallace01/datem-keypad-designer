# Keypad Designer for DAT/EM Summit Evolution

An AI-assisted button designer for **aerial photogrammetry stereo compilation** in DAT/EM Summit Evolution + AutoCAD Civil 3D. Configure your DAT/EM Keypad layout in plain English instead of memorizing macro syntax.

> Describe what you want a button to do — *"start a 3D polyline on layer ROAD_EOP with endpoint snap on"* — and it generates the proper command string for the DAT/EM Keypad Editor.

![screenshot placeholder](docs/screenshot.png)

## Why this exists

Configuring the DAT/EM Keypad means writing macro strings like:

```
-LAYER{RET}SET{RET}ROAD_EOP{RET}{RET}_3DPOLY
```

Every token matters. `{RET}` is the literal Enter keystroke that DAT/EM injects into AutoCAD. The leading `_` makes commands language-independent. The `-` suppresses dialog boxes (critical during digitizing — a popped dialog interrupts the active drawing command). Two `{RET}` in a row close the LAYER command.

If you live in this syntax all day, fine. If you're a compiler trying to set up a new project keypad, it's a pain. This tool generates correct macros from plain English, organizes buttons by category, and exports a clean reference doc.

## Features

- **CAD-template import.** Drop a `.dxf`, `.dwg`, or `.dwt` and the layer table + block library are parsed in-browser (DWG/DWT via a vendored WASM build of LibreDWG). Entity-aware pre-select picks only layers that actually have geometry collected. Blocks with INSERT history auto-pair to their dominant layer, so one button does the full layer-switch + symbol insert.
- **Lossless `.dkf` round-trip.** Real DAT/EM Keypad Editor file format, byte-compatible. Multi-cell buttons, section headers, stacked labels, BMP icon references, and colors all preserved through import → export → re-import.
- **AI-generated commands.** Plain-English descriptions become correctly-formatted DAT/EM macros, with knowledge of Summit keywords, AutoCAD/Civil 3D keyins, Capture CallCmds (PSQR2D, AUTOARC3D, etc.), and stereo compilation workflow.
- **AI auto-fill from project context.** Paste your feature code library; one click generates a complete keypad layout using your exact layer names.
- **Custom button icons.** Upload, draw (24×24 pixel editor), or AI-generate icon BMPs. Export as a ZIP bundle (`.dkf` + `bitmaps/`) ready to drop into `C:\DAT-EM\Bitmaps\`.
- **AI layer report.** Generate a CSV documenting every mapped layer with a one-sentence description per layer.
- **Bulk grid operations.** Cmd/Ctrl-click to multi-select, then recolor, find/replace text across macros, or delete.
- **Drag to rearrange.** Direct manipulation of the grid; multi-cell spans move as a unit.
- **Undo / redo.** Cmd/Ctrl-Z covers every mutation: bulk ops, drag, AI generation, DXF import, grid resize.
- **Templates.** Mark any project as a ★ template; new projects can clone from any existing one.
- **Macro lint.** Warns on legacy AutoCAD CUI syntax (`^C^C`, `;`), bare `LAYER` instead of `-LAYER`, missing trailing `{RET}{RET}` on `-LAYER`, non-transparent `-osnap`, case-wrong Summit keywords, and unloaded Capture commands.
- **10-color palette + workflow categories.** Roads, utilities, DTM, summit, layer, etc. — colors match real DAT/EM keypads.
- **Local-first.** All data stored in browser `localStorage`. No accounts. AI features (BYOK) call `api.anthropic.com` directly from your browser.

## Quick start

### Use it online
**Live**: https://datem-keypad-designer.pages.dev/ (Cloudflare Pages, free, no signup)

### Run locally
This is a static site with ES modules, so it needs a tiny HTTP server (file:// won't work with modules).

```bash
git clone https://github.com/bewallace01/datem-keypad-designer.git
cd datem-keypad-designer

# any of these work:
npx serve .
# or:
python3 -m http.server 8000
# or:
php -S localhost:8000
```

Open http://localhost:8000

### AI generation setup
The AI features need an Anthropic API key. On first use of "Generate from description" or "Auto-fill", you'll be prompted to paste one.

- Get a key: https://console.anthropic.com
- The key is stored only in your browser's `localStorage` and sent only to `api.anthropic.com`. It never touches a third-party server.
- You can clear it any time from Settings.

If you'd rather not deal with keys, manual button editing works without AI.

## Workflow

1. **Set up project context.** Click **📋 Context** in the toolbar. Paste your feature code library (e.g., `BLDG - building outlines`, `ROAD_EOP - edge of pavement, 3D polyline`, etc.). Save.
2. **Auto-fill the layout.** Click **✨ Auto-fill**. It generates a complete starter keypad using your codes. Choose "fill empty buttons only" or "replace everything".
3. **Refine individual buttons.** Click any button to open the editor. Use AI generation for new buttons, or edit the macro directly. Pick a category color so related buttons cluster visually.
4. **Export.** Click **Export** → **Reference text**. Open the resulting doc on a second monitor next to the actual DAT/EM Keypad Editor and replicate the buttons. Or save as JSON for backup.

## Project structure

```
datem-keypad-designer/
├── index.html           # Main app
├── landing.html         # Marketing/intro page
├── css/
│   └── app.css
├── js/
│   ├── main.js          # Entry point
│   ├── state.js         # Project + button state
│   ├── storage.js       # localStorage / window.storage adapter
│   ├── ui.js            # Render functions
│   ├── editor.js        # Side-panel button editor
│   ├── ai.js            # AI generation (single + bulk)
│   ├── prompts.js       # System prompts for the AI
│   └── export.js        # Import / export
├── docs/
│   ├── DAT_EM_REFERENCE.md
│   └── CLAUDE_PROJECT_BRIEF.md
├── ROADMAP.md
├── LICENSE
└── README.md
```

## Tech

Plain HTML, vanilla JS (ES modules), CSS variables. No framework, no build step, no node_modules. Designed to be hackable — clone and read the source. Every macro string the AI emits is in `js/prompts.js`, which is the most useful file to fork and adapt for your own conventions.

## Compatibility notes

- Designed against DAT/EM Summit Evolution 7.x / 8.x and AutoCAD Civil 3D 2018-2025. Older versions may need command syntax tweaks.
- DWG / DWT reading is via the vendored WASM build of LibreDWG (`vendor/libredwg/`, ~14 MB lazy-loaded). Tested against DWG 2018 (AC1032). Older formats work; very recent (2026+) formats may not.
- Generated `.dkf` files are byte-compatible with DAT/EM Keypad Editor v7+. The exporter has been verified against a real production sample.
- DGN (MicroStation) is **not** supported in-browser. Convert to DXF in MicroStation first.

## Contributing

Issues and PRs welcome. Useful contributions:
- Tweaks to the AI system prompts in `js/prompts.js` for better generation
- Additional Civil 3D / Map 3D / Microstation command coverage
- Better drawing-tool inference rules in `js/dxf-import.js` (`drawingToolForLayer`)
- Direct DGN parsing (currently requires manual DXF export step)
- Translations of the UI

## License

This project (everything outside `vendor/`) is **MIT** — see [LICENSE](LICENSE).

`vendor/libredwg/` contains [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) — a WebAssembly port of [LibreDWG](https://www.gnu.org/software/libredwg/) — vendored under its own **GPL-3.0** license. Its `package.json` is included alongside the binary. If you're redistributing, you must comply with both licenses.

## Credits

Built by [Lightspace Labs](https://lightspacelabs.com). Created out of frustration setting up DAT/EM keypads for stereo compilation.

DAT/EM, Summit Evolution, and Capture are trademarks of DAT/EM Systems International. AutoCAD and Civil 3D are trademarks of Autodesk. This project is not affiliated with or endorsed by either company.
