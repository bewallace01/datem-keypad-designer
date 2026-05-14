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

  planimetric_only: {
    label: "Planimetric only — no DTM",
    text:
`Project type: Aerial photogrammetry — planimetric mapping only (no DTM, no surfaces)
Client: <FILL IN client name>
Project name: <FILL IN project name>
Job number: <FILL IN>

Imagery: <FILL IN — e.g. 4" GSD, Vexcel UltraCam, leaf-off spring 2025>
Stereo software: DAT/EM Summit Evolution + DAT/EM Capture for AutoCAD/Civil 3D
Target CAD: <FILL IN — e.g. AutoCAD 2024>
Map scale: <FILL IN — e.g. 1"=50'>
Horizontal accuracy: <FILL IN — e.g. ASPRS Class I, 4" GSD>

Coordinate system: <FILL IN — e.g. NC State Plane FIPS 3200, NAD83(2011), US Survey Feet>
Vertical datum: <FILL IN — e.g. NAVD88, GEOID18>

Deliverables:
- Planimetric features only (structures, transportation, hardscape, hydrography, visible utilities)
- 3D linework with elevations at top of feature, but NO DTM / surface / contours
- <FILL IN any additional deliverables>

NOTE: No DTM compilation on this job. Do NOT include breakline, spot,
mass-point, surface-boundary, or COGO-point layers. Skip Civil 3D feature
lines. The keypad should not waste cells on those tools.

LAYER CODES — STRUCTURES
BLDG           Building outline, closed 3D polyline at roof eave
BLDG_ROOF      Roof footprint detail (if separated from eave)
BLDG_OVHG      Building overhang / canopy
PORCH          Porch / patio / deck
STAIR          Exterior stairs

LAYER CODES — TRANSPORTATION
ROAD_CL        Road centerline, 3D polyline
ROAD_EOP       Edge of pavement, 3D polyline
CURB           Top back of curb, 3D polyline
SIDEWALK       Sidewalk edge, 3D polyline
DRIVE          Driveway, 3D polyline
PARKING        Parking lot edge, 3D polyline
SHOULDER       Pavement shoulder
TRAFFIC_ISL    Traffic island edge
MEDIAN         Roadway median edge
RR             Railroad centerline, 3D polyline
BRIDGE         Bridge deck outline
TRAIL          Trail / unpaved path
STRIPE         Pavement striping (parking, crosswalk, lane lines)

LAYER CODES — HARDSCAPE
WALL           Retaining wall, 3D polyline
FENCE          Fence line, 3D polyline
SIGN           Sign post, point
LIGHT          Light pole, point

LAYER CODES — HYDROGRAPHY
HYDRO_EDGE     Water edge at time of flight, 3D polyline
STREAM_CL      Single-line stream centerline
POND_EDGE      Pond / lake edge, closed 3D polyline
DITCH          Roadside ditch, 3D polyline

LAYER CODES — UTILITIES (visible from air, reference only)
UTIL_POWER     Overhead power line
POLE           Utility pole, point
UTIL_TOWER     Transmission tower
UTIL_LIGHT     Street light, point
MH             Manhole rim, point (visible only)
HYDRANT        Fire hydrant, point

LAYER CODES — VEGETATION
VEG            Vegetation polygon / treeline edge
TREE           Individual tree, point

DRAWING-TOOL PREFERENCES
- All linework collected as 3D polylines
- Buildings collected with PSQR2D for 90° corner squaring
- Curved features collected with AUTOARC3D (DAT/EM Capture)
- All layer-switch buttons must run -LAYER;S;<NAME>;; with the literal {ESC}{ESC}
  prefix so AutoCAD cancels any active command first
- Do NOT include Civil 3D feature line, COGO point, or surface-edit buttons

OPERATOR WORKFLOW (typical pass order)
1. Project setup — open stereo pair, auto-level, set ground Z mode
2. Buildings + hardscape (left-to-right systematic sweep)
3. Roads + driveways + parking
4. Curb / sidewalk / shoulder detail
5. Hydrography
6. Visible utilities + signs / lights
7. Vegetation outlines
8. QC pass — line continuity, layer assignments, closure on buildings

KEYPAD ERGONOMICS
- Most-used controls must be within thumb reach: Driver, RaiseZ, LowerZ,
  ZLock/ZUnlock, AutoLevel, Cancel, EndFeature, UndoLastVertex
- OSNAP toggles (endpoint, intersect, midpoint, nearest, none) on a fixed row
- Prefer one button per layer (no submenus)
- Stereo navigation (NextStereoPair, PreviousStereoPair, ModelExtents,
  Recenter) grouped together
- Pavement layers (CL, EOP, curb, drive, sidewalk) in collection order, left to right
- DTM-related controls (breakline, spot, feature line, COGO point) MUST BE OMITTED
`,
  },

  utility_mapping: {
    label: "Utility mapping from aerial",
    text:
`Project type: Aerial photogrammetry — utility infrastructure mapping
Client: <FILL IN utility client — power co, telecom carrier, water/sewer authority>
Project name: <FILL IN project name>
Job number: <FILL IN>

Imagery: <FILL IN — e.g. 3" GSD nadir + 4-direction obliques, leaf-off>
Stereo software: DAT/EM Summit Evolution + DAT/EM Capture for AutoCAD
Target CAD: <FILL IN — e.g. AutoCAD 2024, or ESRI geodatabase via DXF>
Map scale: <FILL IN — e.g. 1"=40'>
Horizontal accuracy: <FILL IN — e.g. sub-foot, ASPRS Class I>

Coordinate system: <FILL IN — e.g. State Plane, NAD83(2011), US Survey Feet>
Vertical datum: <FILL IN — e.g. NAVD88, GEOID18>

Deliverables:
- Utility infrastructure inventory: linear runs + point equipment
- Equipment block-insertions with attribute tags (pole IDs, MH IDs)
- <FILL IN — e.g. ESRI geodatabase, AutoCAD DWG, KML>

NOTE: Utility-focused job. The keypad should be dominated by utility
layer-switches and equipment block-inserts. Building, road, and DTM
layers are minimal reference linework only. No DTM compilation.

LAYER CODES — POWER (overhead, visible from air)
PWR_OH         Overhead primary distribution line, 3D polyline
PWR_OH_SEC     Secondary distribution line, 3D polyline
PWR_TRANS      Transmission line, 3D polyline
POLE           Utility pole, block-insert at base
POLE_GUY       Guy wire anchor, point
XFMR_POLE      Pole-mount transformer, block-insert
XFMR_PAD       Pad-mount transformer, block-insert
SWITCH_OH      Overhead switch / sectionalizer, block-insert
LIGHT          Street light / yard light, block-insert

LAYER CODES — COMMUNICATION
COMM_OH        Overhead communication line (telco / cable / fiber)
COMM_PED       Comm pedestal / junction box, block-insert
TOWER          Cell tower / monopole, block-insert

LAYER CODES — WATER
WATR_MAIN      Water main centerline (where visible or probed)
HYDRANT        Fire hydrant, block-insert
VALVE_WATR     Water valve box, block-insert
METER_WATR     Water meter, block-insert
WELL           Well head, block-insert

LAYER CODES — SANITARY SEWER
SSWR_MAIN      Sanitary sewer main centerline
MH_SSWR        Sanitary sewer manhole, block-insert
CO_SSWR        Sanitary sewer cleanout, block-insert

LAYER CODES — STORM
STRM_MAIN      Storm sewer main centerline
MH_STRM        Storm sewer manhole, block-insert
INLET          Storm inlet / catch basin, block-insert
HEADWALL       Storm outfall headwall, block-insert

LAYER CODES — GAS
GAS_MAIN       Gas main centerline (typically from field paint)
VALVE_GAS      Gas valve box, block-insert
METER_GAS      Gas meter, block-insert

LAYER CODES — REFERENCE PLANIMETRIC (light usage, for tie-in only)
ROAD_EOP       Edge of pavement
ROAD_CL        Road centerline (corridor reference)
BLDG           Building outline (utility-to-structure tie-in)
ROW            Right-of-way line, 3D polyline
PROPERTY       Property line, 3D polyline

DRAWING-TOOL PREFERENCES
- Linear utilities collected as 3D polylines (one polyline per run, vertex
  on every pole / equipment)
- Point equipment collected as block-inserts using -INSERT;<blockname>;;
  so the operator stops at the insertion-point prompt and picks on-screen
- Where a standard symbol block isn't available, fall back to COGO point
  with description code
- All layer-switch buttons must run -LAYER;S;<NAME>;; with the literal {ESC}{ESC}
  prefix so AutoCAD cancels any active command first
- INSERT snap toggle must be easy to reach — equipment-to-line tie-ins
  rely on it constantly

OPERATOR WORKFLOW (typical pass order)
1. Project setup — open stereo pair, auto-level
2. Point pass — tag every visible pole, transformer, structure
3. Linear pass — string overhead lines pole-to-pole on the correct service layer
4. Surface utilities — hydrants, valves, manholes, inlets
5. Communication equipment + cell towers
6. Reference linework (EOP / ROW / property) only where needed for tie-in
7. QC pass — pole-to-line continuity, equipment count by layer, missed runs

KEYPAD ERGONOMICS
- Equipment-insert buttons (POLE, HYDRANT, VALVE, MH, XFMR, INLET) on a
  high-visibility row, each with a distinct icon
- Linear-utility layer switches grouped by service in pass order:
  power → comm → water → sewer → storm → gas — left to right
- Most-used stereo controls within thumb reach: Driver, RaiseZ, LowerZ,
  ZLock, AutoLevel, Cancel, EndFeature, UndoLastVertex
- OSNAP toggles (endpoint, midpoint, nearest, INSERT, none) on a fixed row
- Building / road / DTM controls can be omitted or pushed to a secondary
  row — they shouldn't displace utility buttons
`,
  },
};

export const DEFAULT_TEMPLATE = "aerial_photogrammetry";
