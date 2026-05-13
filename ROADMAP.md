# Roadmap

Rough notes on what's coming or worth tackling. PRs welcome on any of these.

## Near-term

- **`.dkf` file exporter.** DAT/EM hasn't published the format spec, so this needs to be reverse-engineered from sample files. If you have `.dkf` files we can inspect, please attach to a GitHub issue. If the format is text-based (XML/INI/CSV), this is straightforward. If binary, we'd need a decent sample set.
- **Drag-to-rearrange buttons.** Right-click or drag a configured button to move it to a new cell. Currently you have to clear and re-create.
- **Keyboard shortcut hints in the UI.** `Cmd/Ctrl+Enter` to save, `Esc` to close — surface these.
- **Better mobile/tablet layout.** Grid is usable on tablets but the side panel takes too much room on narrow viewports.

## Medium-term

- **Symbology library import.** Many photogrammetry shops keep their feature codes in CSV or XML lookup tables (DAT/EM's own Symbology Editor uses one). Import a file and auto-populate project context.
- **Macro testing / lint.** Static analysis on the macro field: warn if missing `^C^C`, if a layer name has spaces, if `;;` is missing on `-LAYER;S;NAME;;`, etc.
- **Custom CAD environment profiles.** Today the AI prompts target Civil 3D specifically. Add Map 3D, MicroStation, MicroSurvey CAD as optional profiles with their own command sets.
- **Hosted version.** Eliminates BYOK by proxying API calls through a Lightspace Labs backend. Free tier with reasonable limits.
- **Shared / community keypad layouts.** Browse and import layouts other operators have published for common workflows (FEMA, county planimetric, transmission line, etc.).

## Long-term / aspirational

- **Live Summit integration.** Push button definitions directly into the running DAT/EM Keypad Editor over its IPC/automation interface (if one exists).
- **Smart suggestions during compilation.** Track which buttons get used together and suggest macro combinations.
- **Bundle adjustment / orientation hooks.** Generate buttons for common Summit orientation tasks (relative, absolute, exterior import) given the project's bundle adjustment package (PATB, Albany, Inpho).
- **AI fine-tuning on real macros.** Once enough community-contributed macros exist, fine-tune a small model for offline use without an API key.

## Not planned

- **Replacing the DAT/EM Keypad Editor.** This tool generates configuration. Actually loading buttons onto the physical keypad still happens through DAT/EM's software.
- **Generic CAD macro generation outside surveying/photogrammetry.** Stay focused on the niche.
- **Cloud sync of projects.** Local-first by design. Use the JSON export for moving between machines.

## Contributing

Issues and PRs welcome. Most useful contributions:

1. **Sample `.dkf` files** to enable a real exporter (can be from any project — we just need format samples).
2. **AI prompt improvements** — if generation produces wrong syntax for a particular case, file an issue with the description and the wrong output. The fix usually lives in `js/prompts.js`.
3. **Civil 3D / Map 3D / Microstation command coverage** — additional commands to teach the AI about.
4. **Translations** of the UI.
5. **Real-world layout templates** for common photogrammetry workflows.
