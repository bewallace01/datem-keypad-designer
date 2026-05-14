// js/context-templates.js
// Pre-written project-context starting points. Pasted into the Project
// Context modal's textarea so the AI keypad generator sees a structured
// description (project type, layer codes, drawing-tool preferences,
// workflow phases) instead of generic placeholders. Operators are
// expected to edit the <FILL IN ...> tags and any layer codes that
// don't match their firm's convention before saving.

export const CONTEXT_TEMPLATES = {
  aerial_photogrammetry: {
    label: "Aerial photogrammetry (stereo compilation)",
    text:
`Project type: Aerial photogrammetry — stereo compilation in DAT/EM Summit Evolution
Client: <FILL IN client name>
Project name: <FILL IN project name>
Job number: <FILL IN>

Imagery: <FILL IN — e.g. 6" GSD, Vexcel UltraCam, leaf-off spring 2025>
Stereo software: DAT/EM Summit Evolution + DAT/EM Capture for AutoCAD/Civil 3D
Target CAD: <FILL IN — e.g. Civil 3D 2024>
Map scale: <FILL IN — e.g. 1"=100'>
Contour interval: <FILL IN — e.g. 2 ft>
Horizontal accuracy: <FILL IN — e.g. ASPRS Class I, 6" GSD>
Vertical accuracy: <FILL IN — e.g. RMSEz 0.3 ft @ 95% confidence>

Coordinate system: <FILL IN — e.g. NC State Plane FIPS 3200, NAD83(2011), US Survey Feet>
Vertical datum: <FILL IN — e.g. NAVD88, GEOID18>

Deliverables:
- Planimetric features (buildings, roads, utilities, hydrography)
- DTM breaklines + spot elevations
- Contours (derived from DTM)
- <FILL IN any additional deliverables>

LAYER CODES — PLANIMETRIC
BLDG           Building outline, closed 3D polyline at roof eave
BLDG_ROOF      Roof footprint (if separated from eave)
ROAD_CL        Road centerline, 3D polyline
ROAD_EOP       Edge of pavement, 3D polyline
CURB           Top back of curb, 3D polyline
SIDEWALK       Sidewalk edge, 3D polyline
DRIVE          Driveway, 3D polyline
PARKING        Parking lot edge, 3D polyline
SHOULDER       Pavement shoulder
TRAFFIC_ISL    Traffic island
FENCE          Fence line, 3D polyline
WALL           Retaining wall, 3D polyline
RR             Railroad centerline, 3D polyline
BRIDGE         Bridge deck outline
TRAIL          Trail / unpaved path

LAYER CODES — HYDROGRAPHY
HYDRO_EDGE     Water edge at time of flight, 3D polyline
STREAM_CL     Single-line stream centerline
POND_EDGE      Pond / lake edge, closed 3D polyline
DITCH          Roadside ditch, 3D polyline

LAYER CODES — UTILITIES (visible from air)
UTIL_POWER     Overhead power line
POLE           Utility pole, point
UTIL_TOWER     Transmission tower
UTIL_LIGHT     Light pole / street light, point

LAYER CODES — DTM
BREAKLINE      Topographic breakline, Civil 3D feature line
SPOT           Spot elevation, Civil 3D COGO point
RIDGE          Ridge breakline
DRAIN          Drainage breakline / flowline
SURF_BOUNDARY  Surface boundary / project limit, closed polyline
OBSCURE        Obscured area boundary (canopy, building shadow)
WATER_FILL     Water body to cookie-cut from DTM
MASS_POINT     DTM mass point, COGO point

LAYER CODES — VEGETATION
VEG            Vegetation polygon / treeline edge
TREE           Individual tree, point

DRAWING-TOOL PREFERENCES
- All planimetric linework collected as 3D polylines
- DTM breaklines collected as Civil 3D feature lines (_AECCDRAWFEATURELINES)
- Spot elevations + mass points placed as Civil 3D COGO points (_AECCCREATEPTMANUAL)
- Buildings collected with PSQR2D for 90° corner squaring
- Curved features collected with AUTOARC3D (DAT/EM Capture)
- All layer-switch buttons must run -LAYER;S;<NAME>;; with the literal {ESC}{ESC}
  prefix so AutoCAD cancels any active command first

OPERATOR WORKFLOW (typical pass order)
1. Project setup — open stereo pair, auto-level, set ground Z mode
2. Planimetric compilation — buildings, roads, then utilities
3. Hydrography
4. DTM compilation — breaklines (ridge, drain), spots, mass points
5. Vegetation and obscure-area polygons
6. QC pass — line continuity, layer assignments, surface checks

KEYPAD ERGONOMICS
- Most-used controls must be within thumb reach: Driver, RaiseZ, LowerZ,
  ZLock/ZUnlock, AutoLevel, Cancel, EndFeature, UndoLastVertex
- OSNAP toggles (endpoint, intersect, midpoint, nearest, none) on a fixed row
- Prefer one button per layer (no submenus)
- Stereo navigation (NextStereoPair, PreviousStereoPair, ModelExtents,
  Recenter) grouped together
- Pavement layers (CL, EOP, curb, drive, sidewalk) in collection order, left to right
- DTM layers grouped together so the operator doesn't toggle modes mid-pass
`,
  },
};

export const DEFAULT_TEMPLATE = "aerial_photogrammetry";
