# DAT/EM Command Reference

Quick reference for the macro syntax this tool generates. Useful when you want to verify or hand-edit a button's commands.

## Macro syntax rules (AutoCAD command line)

| Prefix | Meaning | Example |
|--------|---------|---------|
| `^C^C` | Cancel any running command | `^C^C_PLINE` |
| `_` | Language-independent command name | `_LINE`, `_ZOOM` |
| `-` | Suppress dialog popup | `-LAYER` (vs. `LAYER` which opens dialog) |
| `'` | Transparent command (runs without ending current command) | `'_-osnap;end` |
| `;` | Equivalent to pressing Enter | `_LAYER;S;BLDG;;` (Set, name, Enter, Enter) |

**Why dialogs matter during stereo digitizing:** if a dialog pops up, it interrupts the active drawing command and breaks your collection rhythm. Use `-` prefix wherever possible.

## Command types

The DAT/EM Keypad Editor accepts three kinds of commands per button. They can be mixed in a single macro.

### 1. AutoCAD / Civil 3D command-line keyins

Anything you can type at the AutoCAD command line. The most common type.

**Drawing tools:**
| Command | What it does |
|---------|--------------|
| `^C^C_LINE` | Start a 2D line |
| `^C^C_PLINE` | Start a 2D polyline |
| `^C^C_3DPOLY` | Start a 3D polyline (preferred for ground-following features) |
| `^C^C_CIRCLE` | Start a circle |
| `^C^C_ARC` | Start an arc |

**Civil 3D commands (for photogrammetry):**
| Command | What it does |
|---------|--------------|
| `^C^C_AECCDRAWFEATURELINES` | Draw Civil 3D feature lines (use for breaklines) |
| `^C^C_AECCCREATEPTMANUAL` | Create COGO point manually (good for spot elevations) |
| `^C^C_AECCCREATESURFACE` | Create a TIN surface |
| `^C^C_AECCADDFEATURELINEPI` | Add a PI to existing feature line |
| `^C^C_AECCEDITFEATURELINEELEV` | Edit feature line elevations |
| `^C^C_AECCADDSURFBREAKLINES` | Add objects as breaklines to a surface |
| `^C^C_AECCQUICKPROFILE` | Quick profile through a polyline |

**Layer setting (most-used compilation pattern):**
```
^C^C-LAYER;S;LAYER_NAME;;
```
Breakdown: cancel any running command, open `-LAYER` (dialog suppressed), `S` = Set current, `LAYER_NAME` = the layer to make current, `;;` = exit the LAYER command.

**OSNAP toggling (transparent so it won't interrupt drawing):**
```
'_-osnap;end       — endpoint
'_-osnap;int       — intersection
'_-osnap;mid       — midpoint
'_-osnap;cen       — center
'_-osnap;nea       — nearest
'_-osnap;none      — clear all OSNAP
'_-osnap;end,int   — multiple at once
```

### 2. Summit Evolution keywords

Drive Summit itself, not AutoCAD. Case-sensitive. No prefix.

| Keyword | What it does |
|---------|--------------|
| `Driver` | Accept point / digitize at current cursor position |
| `RaiseZ` / `LowerZ` | Move stereo cursor up / down in elevation |
| `ZoomIn` / `ZoomOut` | Image zoom |
| `ZLock` / `ZUnlock` | Lock / unlock cursor at current Z (for roof outlines, water surfaces) |
| `AutoLevel` | Auto-level cursor on ground |
| `StereoToggle` | Toggle stereo on/off |
| `NextStereoPair` / `PreviousStereoPair` | Navigate between models in project |
| `ModelExtents` | Zoom to extents of current model |
| `Recenter` | Recenter cursor in view |
| `Cursor3D` | 3D cursor mode |

For the complete current list, see DAT/EM's published "Summit Keywords for the DAT/EM Keypad" PDF on the [DAT/EM downloads page](https://www.datem.com/downloads-2/).

### 3. Capture CallCommands

DAT/EM Capture for AutoCAD actions. Format: `CallCmd CommandName`.

| Command | What it does |
|---------|--------------|
| `CallCmd EndFeature` | End the current feature being collected |
| `CallCmd StartFeature` | Start a new feature |
| `CallCmd UndoLastVertex` | Back up one vertex on active feature |
| `CallCmd SmartCode` | Smart code prompt |
| `CallCmd NextSymbol` / `CallCmd PreviousSymbol` | Navigate symbology |

For the complete current list, see DAT/EM's published "Lists of Keywords and CallCommands" PDF on the downloads page.

## Multi-step macros

Chain multiple commands by placing each on its own line. The Keypad Editor sends them sequentially.

**Example: switch layer and start a feature line in one button**
```
^C^C-LAYER;S;BREAKLINE;;
_AECCDRAWFEATURELINES
```

**Example: place a spot elevation as COGO point**
```
^C^C-LAYER;S;SPOT_ELEV;;
_AECCCREATEPTMANUAL
```

**Example: cancel + zoom in (mixing CAD and Summit keyword)**
```
^C^C
ZoomIn
```

## Common mistakes

- **Forgetting `^C^C`** — the new command starts mid-way through the previous one and confuses AutoCAD.
- **Using `LAYER` instead of `-LAYER`** — the dialog pops, breaking your digitizing flow.
- **Forgetting the trailing `;;` on `-LAYER;S;NAME;;`** — the LAYER command stays open, eating your next inputs.
- **Mixing case on Summit keywords** — `driver` won't work, only `Driver`.
- **Putting `'` on commands that aren't supported as transparent** — silently fails.

## Useful DAT/EM resources

- [DAT/EM Downloads page](https://www.datem.com/downloads-2/) — Summit Keywords PDF, CallCommands PDF, current Snapping Guide
- [Snapping Guide for Capture for AutoCAD](https://www.datem.com/wp-content/uploads/2021/01/SnappingGuideForDATEMCaptureForAutoCAD.pdf) — official guide for OSNAP setup with the keypad
- [Configurations page](https://www.datem.com/configurations/) — current hardware and software compatibility
