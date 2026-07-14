/**
 * js/catalog.js
 * Contains: CATALOG_ITEMS (108), GROUPS (37), ROOM_TEMPLATES (7), SECTIONS (7),
 *           SERIAL_ITEM_IDS, REQUIRED_GROUP_KEYS, CRITICAL_GROUP_KEYS,
 *           quantity chip presets, helpers, and dev-only __coverageReport().
 *
 * Vanilla ESM. Named exports only. No DOM, no IndexedDB, no localStorage.
 * Source: official Pricing List.csv. sum-1 (Test Name) excluded — final count: 108 items.
 */

// ---------------------------------------------------------------------------
// CATALOG_ITEMS
// CSV columns: id, name, cost, unit  (RFC-4180 quoting; "" → " inside quotes)
// defaultCost = cost (number, decimals preserved exactly)
// name/unit = exact CSV strings after unescaping doubled quotes
// ---------------------------------------------------------------------------

/** @type {Array<{id:string,name:string,unit:string,defaultCost:number}>} */
export const CATALOG_ITEMS = [
  // Interior General — ig-01..28
  { id: "ig-01", name: "Refinish Hardwood Floor",                                              unit: "sqft",                  defaultCost: 2.35  },
  { id: "ig-02", name: 'New Hardwoods 1.5"',                                                  unit: "sqft",                  defaultCost: 10    },
  { id: "ig-03", name: 'New Hardwoods 2"',                                                    unit: "sqft",                  defaultCost: 4.75  },
  { id: "ig-04", name: "Hardwood Splicing",                                                   unit: "sqft",                  defaultCost: 8.4   },
  { id: "ig-05", name: "Vinyl Plank",                                                         unit: "sqft",                  defaultCost: 2.5   },
  { id: "ig-06", name: "Carpet",                                                              unit: "sqft",                  defaultCost: 1.9   },
  { id: "ig-07", name: "Interior Paint — 2 Tone",                                             unit: "sqft",                  defaultCost: 2.95  },
  { id: "ig-08", name: "Drywall Repair",                                                      unit: "1,000 sqft",            defaultCost: 900   },
  { id: "ig-09", name: "Wallpaper Removal",                                                   unit: "room",                  defaultCost: 250   },
  { id: "ig-10", name: "Interior Door — Hollow Slab",                                        unit: "ea.",                   defaultCost: 125   },
  { id: "ig-11", name: "Interior Door Hardware (Knob + Hinges + Labor)",                     unit: "ea.",                   defaultCost: 25    },
  { id: "ig-12", name: "Bifold Door with Framing",                                           unit: "ea.",                   defaultCost: 400   },
  { id: "ig-13", name: "Interior Door — Pre-hung",                                           unit: "ea.",                   defaultCost: 200   },
  { id: "ig-14", name: "Front Entry Door",                                                   unit: "ea.",                   defaultCost: 475   },
  { id: "ig-15", name: "Front Entry Door Hardware",                                          unit: "ea.",                   defaultCost: 80    },
  { id: "ig-16", name: "Exterior Door Hardware",                                             unit: "handle",                defaultCost: 75    },
  { id: "ig-17", name: "Exterior Insulated Side Door (Installed)",                           unit: "ea.",                   defaultCost: 500   },
  { id: "ig-18", name: "Sliding Glass Door",                                                 unit: "ea.",                   defaultCost: 1025  },
  { id: "ig-19", name: "Trim Out (Casing, Crown, Baseboard)",                               unit: "LF",                    defaultCost: 3.75  },
  { id: "ig-20", name: "MISC / Punch List",                                                  unit: "flat",                  defaultCost: 2650  },
  { id: "ig-21", name: "Finish Out Labor",                                                   unit: "flat",                  defaultCost: 1350  },
  { id: "ig-22", name: "Light Fixtures",                                                     unit: "100 sqft",              defaultCost: 70    },
  { id: "ig-23", name: "Bedbug Spray / Heat Treat",                                         unit: "ea.",                   defaultCost: 475   },
  { id: "ig-24", name: "Termite Treatment",                                                  unit: "ea.",                   defaultCost: 650   },
  { id: "ig-25", name: "Demo",                                                               unit: "variable",              defaultCost: 1375  },
  { id: "ig-26", name: "Haul Off",                                                           unit: "load",                  defaultCost: 725   },
  { id: "ig-27", name: "Final Cleaning",                                                     unit: "flat",                  defaultCost: 325   },
  { id: "ig-28", name: "Staging",                                                            unit: "sqft",                  defaultCost: 0.9   },

  // Kitchen — kt-01..17
  { id: "kt-01", name: "Hinges and Pulls",                                                   unit: "kitchen",               defaultCost: 275   },
  { id: "kt-02", name: "Cabinets Uppers",                                                   unit: "LF",                    defaultCost: 125   },
  { id: "kt-03", name: "Cabinets Lowers",                                                   unit: "LF",                    defaultCost: 150   },
  { id: "kt-04", name: "Cabinet Door Faces Only",                                           unit: "door",                  defaultCost: 80    },
  { id: "kt-05", name: "Cabinets (Labor & Paint)",                                          unit: "kitchen",               defaultCost: 1100  },
  { id: "kt-06", name: 'Granite + 4" Splash Guard',                                        unit: "LF",                    defaultCost: 40    },
  { id: "kt-07", name: "Backsplash",                                                        unit: "house",                 defaultCost: 725   },
  { id: "kt-08", name: "Misc Woodwork",                                                     unit: "variable",              defaultCost: 500   },
  { id: "kt-09", name: "Tile — Large Areas",                                                unit: "sqft",                  defaultCost: 6.45  },
  { id: "kt-10", name: "Tile — Small Areas",                                               unit: "sqft",                  defaultCost: 10    },
  { id: "kt-11", name: "Undermount Kitchen Sink",                                           unit: "ea.",                   defaultCost: 325   },
  { id: "kt-12", name: "Microwave / Hood",                                                  unit: "ea.",                   defaultCost: 500   },
  { id: "kt-13", name: "Range",                                                             unit: "ea.",                   defaultCost: 725   },
  { id: "kt-14", name: "Wall Oven",                                                         unit: "ea.",                   defaultCost: 1075  },
  { id: "kt-15", name: "Cooktop",                                                           unit: "ea.",                   defaultCost: 550   },
  { id: "kt-16", name: "Dishwasher",                                                        unit: "ea.",                   defaultCost: 575   },
  { id: "kt-17", name: "Fridge",                                                            unit: "ea.",                   defaultCost: 1175  },

  // Bathroom — ba-01..16
  { id: "ba-01", name: "Granite ($/LF)",                                                    unit: "LF",                    defaultCost: 35    },
  { id: "ba-02", name: "New Bottom Vanity",                                                 unit: "LF",                    defaultCost: 125   },
  { id: "ba-03", name: 'Home Depot Vanity w/ Sink (18")',                                  unit: "ea.",                   defaultCost: 225   },
  { id: "ba-04", name: "Toilet",                                                            unit: "ea.",                   defaultCost: 150   },
  { id: "ba-05", name: "Tile — Large Areas",                                               unit: "sqft",                  defaultCost: 5.8   },
  { id: "ba-06", name: "Tile — Small Areas",                                               unit: "sqft",                  defaultCost: 10    },
  { id: "ba-07", name: "Reglaze Tub or Chemical Clean",                                   unit: "ea.",                   defaultCost: 350   },
  { id: "ba-08", name: "Reglaze Tub + Surround",                                          unit: "ea.",                   defaultCost: 750   },
  { id: "ba-09", name: "Reglaze Shower",                                                   unit: "ea.",                   defaultCost: 1325  },
  { id: "ba-10", name: "Tiled Shower Tear Out + Tile Install",                            unit: "ea.",                   defaultCost: 3100  },
  { id: "ba-11", name: "Tub Tile Surround Tear Out + Tile Install (incl. tub)",           unit: "ea.",                   defaultCost: 2250  },
  { id: "ba-12", name: "Shower Plastic Insert Tear Out + New Insert",                     unit: "ea.",                   defaultCost: 825   },
  { id: "ba-13", name: "Tub Tear Out + New Insert & Tub",                                 unit: "ea.",                   defaultCost: 1575  },
  { id: "ba-14", name: "Undermount Sink",                                                  unit: "ea.",                   defaultCost: 150   },
  { id: "ba-15", name: "Mirror",                                                           unit: "ea.",                   defaultCost: 200   },
  { id: "ba-16", name: "HVL (needed if no window)",                                       unit: "ea.",                   defaultCost: 275   },

  // Systems (All Systems) — as-01..24
  { id: "as-01", name: "Furnace",                                                          unit: "ea.",                   defaultCost: 3350  },
  { id: "as-02", name: "Condensing Unit",                                                  unit: "ea.",                   defaultCost: 3300  },
  { id: "as-03", name: "Package Unit",                                                     unit: "ea.",                   defaultCost: 4700  },
  { id: "as-04", name: "A-Coil (if no condensing unit)",                                  unit: "ea.",                   defaultCost: 1625  },
  { id: "as-05", name: "Ducting (if NO HVAC)",                                            unit: "ea.",                   defaultCost: 3200  },
  { id: "as-06", name: "Duct Cleaning — Floor Vents",                                    unit: "ea.",                   defaultCost: 550   },
  { id: "as-07", name: "Window Unit Replacement 220",                                     unit: "ea.",                   defaultCost: 575   },
  { id: "as-08", name: "Hot Water Heater w/ Expansion Tank",                              unit: "ea.",                   defaultCost: 1425  },
  { id: "as-09", name: "Hot Water Heater Expansion Tank Only",                            unit: "ea.",                   defaultCost: 200   },
  { id: "as-10", name: "Switches / Outlets",                                              unit: "house",                 defaultCost: 1400  },
  { id: "as-11", name: "Standard Electrical",                                             unit: "house",                 defaultCost: 1650  },
  { id: "as-12", name: "Subfloor",                                                        unit: "sqft",                  defaultCost: 8.2   },
  { id: "as-13", name: "Framing",                                                         unit: "variable",              defaultCost: 950   },
  { id: "as-14", name: "Structural (Pier)",                                               unit: "pier",                  defaultCost: 375   },
  { id: "as-15", name: "Structural Foam Injection",                                       unit: "sqft of affected area", defaultCost: 5.85  },
  { id: "as-16", name: "Roof",                                                            unit: "225 sqft L&M",          defaultCost: 1100  },
  { id: "as-17", name: "Plumbing",                                                        unit: "variable",              defaultCost: 1000  },
  { id: "as-18", name: "Electrical Panel Swap to 200A",                                   unit: "ea.",                   defaultCost: 2350  },
  { id: "as-19", name: "Full Electrical Rewire (to Studs)",                               unit: "sqft",                  defaultCost: 5.65  },
  { id: "as-20", name: "Full Electrical Rewire (leaving Drywall)",                        unit: "sqft",                  defaultCost: 9.15  },
  { id: "as-21", name: "Wall Insulation (to Studs)",                                      unit: "sqft",                  defaultCost: 1.2   },
  { id: "as-22", name: "Attic Insulation",                                                unit: "1,600 sqft house",      defaultCost: 1225  },
  { id: "as-23", name: "New Drywall to Studs (L&M)",                                      unit: "sqft",                  defaultCost: 5.2   },
  { id: "as-24", name: "Aluminum Wiring",                                                 unit: "variable",              defaultCost: 2450  },

  // Exterior — ex-01..23
  { id: "ex-01", name: "Fence Repair — Chain Link / Wood Gate",                           unit: "variable",              defaultCost: 225   },
  { id: "ex-02", name: "Fence Repair — Chain Link",                                       unit: "LF",                    defaultCost: 275   },
  { id: "ex-03", name: "Fence Repair — Privacy 6ft",                                      unit: "LF",                    defaultCost: 30    },
  { id: "ex-04", name: "Landscaping",                                                     unit: "variable",              defaultCost: 450   },
  { id: "ex-05", name: "Vinyl Siding (10'x10')",                                          unit: "square",                defaultCost: 300   },
  { id: "ex-06", name: "Tuck Pointing",                                                   unit: "variable",              defaultCost: 225   },
  { id: "ex-07", name: "Exterior Paint",                                                  unit: "sqft",                  defaultCost: 2.6   },
  { id: "ex-08", name: "Exterior Wood Repair",                                            unit: "variable",              defaultCost: 525   },
  { id: "ex-09", name: "Siding Repair (10'x10')",                                         unit: "section",               defaultCost: 975   },
  { id: "ex-10", name: "Tree Trimming",                                                   unit: "variable",              defaultCost: 450   },
  { id: "ex-11", name: "Tree Removal (w/o stump)",                                        unit: "tree",                  defaultCost: 1450  },
  { id: "ex-12", name: "Stump Grinding",                                                  unit: "stump",                 defaultCost: 250   },
  { id: "ex-13", name: "Aluminum Window Paint (Int/Ext)",                                 unit: "house",                 defaultCost: 700   },
  { id: "ex-14", name: "Windows (3x5 sash)",                                              unit: "ea.",                   defaultCost: 425   },
  { id: "ex-15", name: "Window Repair — Non-Insulated (6x6+)",                            unit: "sf",                    defaultCost: 35    },
  { id: "ex-16", name: "Window Repair — Insulated (6x6+)",                                unit: "sf",                    defaultCost: 40    },
  { id: "ex-17", name: "Aluminum Framed Window Pane",                                     unit: "pane",                  defaultCost: 100   },
  { id: "ex-18", name: "Guttering",                                                       unit: "LF",                    defaultCost: 4.15  },
  { id: "ex-19", name: "Concrete w/ Demo",                                                unit: "sqft",                  defaultCost: 200   },
  { id: "ex-20", name: "Mowing (summer, every 2 weeks)",                                  unit: "mowing",                defaultCost: 45    },
  { id: "ex-21", name: "Garage Door — 1 Car",                                            unit: "ea.",                   defaultCost: 975   },
  { id: "ex-22", name: "Garage Door — 2 Car (Installed)",                                unit: "ea.",                   defaultCost: 1225  },
  { id: "ex-23", name: "Garage Conversion",                                               unit: "ea.",                   defaultCost: 8850  },
];

// ---------------------------------------------------------------------------
// REQUIRED_GROUP_KEYS (19)
// ---------------------------------------------------------------------------
/** @type {string[]} */
export const REQUIRED_GROUP_KEYS = [
  "ig:flooring",
  "ig:paint",
  "ig:doors",
  "ig:pest",
  "kt:cabinets",
  "kt:counters",
  "kt:appliances",
  "ba:vanity",
  "ba:tub",
  "ba:tile",
  "as:hvac",
  "as:electrical",
  "as:structural",
  "as:insulation",
  "ex:fence",
  "ex:siding",
  "ex:windows",
  "ex:garage",
  "ex:trees",
];

const _requiredSet = new Set(REQUIRED_GROUP_KEYS);

// ---------------------------------------------------------------------------
// CRITICAL_GROUP_KEYS (9)
// ---------------------------------------------------------------------------
/** @type {Set<string>} */
export const CRITICAL_GROUP_KEYS = new Set([
  "kt:appliances",
  "ba:tub",
  "as:hvac",
  "as:electrical",
  "as:structural",
  "as:waterheater",
  "as:roof",
  "as:plumbing",
  "ex:windows",
]);

// ---------------------------------------------------------------------------
// SERIAL_ITEM_IDS
// HVAC (as-01..07) + Water Heater (as-08..09) + Kitchen Appliances (kt-11..17)
// ---------------------------------------------------------------------------
/** @type {Set<string>} */
export const SERIAL_ITEM_IDS = new Set([
  "as-01","as-02","as-03","as-04","as-05","as-06","as-07",
  "as-08","as-09",
  "kt-11","kt-12","kt-13","kt-14","kt-15","kt-16","kt-17",
]);

// ---------------------------------------------------------------------------
// GROUPS (37 group objects)
// Helper: build a group entry
// ---------------------------------------------------------------------------
/**
 * @param {string}   key
 * @param {string}   label
 * @param {string}   section
 * @param {string[]} itemIds
 * @param {boolean|'conditional'} critical
 * @param {string[]|null}        conditionalItemIds
 */
function _g(key, label, section, itemIds, critical = false, conditionalItemIds = null) {
  return {
    key,
    label,
    section,
    required: _requiredSet.has(key),
    critical,
    conditionalItemIds,
    itemIds,
  };
}

/** @type {Record<string,{key:string,label:string,section:string,required:boolean,critical:boolean|'conditional',conditionalItemIds:string[]|null,itemIds:string[]}>} */
export const GROUPS = {
  // Interior (section: interior)
  "ig:flooring": _g("ig:flooring", "Flooring",          "interior", ["ig-01","ig-02","ig-03","ig-04","ig-05","ig-06"]),
  "ig:paint":    _g("ig:paint",    "Paint & Wall Repair","interior", ["ig-07","ig-08","ig-09"]),
  "ig:doors":    _g("ig:doors",    "Doors",              "interior", ["ig-10","ig-11","ig-12","ig-13","ig-14","ig-15","ig-16","ig-17","ig-18"]),
  "ig:pest":     _g("ig:pest",     "Pest Control",       "interior", ["ig-23","ig-24"]),
  "ig:trim":     _g("ig:trim",     "Trim & Finish",      "interior", ["ig-19","ig-20","ig-21","ig-22"]),
  "ig:demo":     _g("ig:demo",     "Demo & Site Prep",   "interior", ["ig-25","ig-26","ig-27","ig-28"]),

  // Kitchen (section: kitchen)
  "kt:cabinets":  _g("kt:cabinets",  "Cabinets",           "kitchen", ["kt-01","kt-02","kt-03","kt-04","kt-05"]),
  "kt:counters":  _g("kt:counters",  "Countertops & Tile", "kitchen", ["kt-06","kt-07","kt-08","kt-09","kt-10"]),
  "kt:appliances":_g("kt:appliances","Appliances",          "kitchen", ["kt-11","kt-12","kt-13","kt-14","kt-15","kt-16","kt-17"], true),

  // Bathroom (section: bathrooms, multi)
  "ba:vanity":   _g("ba:vanity", "Vanity & Countertop", "bathrooms", ["ba-01","ba-02","ba-03","ba-14"]),
  "ba:tub":      _g("ba:tub",    "Tub & Shower",        "bathrooms", ["ba-07","ba-08","ba-09","ba-10","ba-11","ba-12","ba-13"],
                    "conditional", ["ba-10","ba-11","ba-12","ba-13"]),
  "ba:tile":     _g("ba:tile",   "Tile",                "bathrooms", ["ba-05","ba-06"]),
  "ba:fixtures": _g("ba:fixtures","Fixtures & Ventilation","bathrooms",["ba-04","ba-15","ba-16"]),

  // Systems (section: systems)
  "as:hvac":       _g("as:hvac",       "HVAC",                "systems", ["as-01","as-02","as-03","as-04","as-05","as-06","as-07"], true),
  "as:electrical": _g("as:electrical", "Electrical",          "systems", ["as-10","as-11","as-18","as-19","as-20","as-24"], true),
  "as:structural": _g("as:structural", "Structural",          "systems", ["as-12","as-13","as-14","as-15"], true),
  "as:insulation": _g("as:insulation", "Insulation & Drywall","systems", ["as-21","as-22","as-23"]),
  "as:waterheater":_g("as:waterheater","Water Heater",         "systems", ["as-08","as-09"], true),
  "as:roof":       _g("as:roof",       "Roof",                "systems", ["as-16"], true),
  "as:plumbing":   _g("as:plumbing",   "Plumbing",            "systems", ["as-17"], true),

  // Exterior (section: exterior)
  "ex:fence":       _g("ex:fence",       "Fence",                   "exterior", ["ex-01","ex-02","ex-03"]),
  "ex:siding":      _g("ex:siding",      "Siding",                  "exterior", ["ex-05","ex-09"]),
  "ex:windows":     _g("ex:windows",     "Windows",                 "exterior", ["ex-13","ex-14","ex-15","ex-16","ex-17"], true),
  "ex:garage":      _g("ex:garage",      "Garage",                  "exterior", ["ex-21","ex-22","ex-23"]),
  "ex:trees":       _g("ex:trees",       "Trees",                   "exterior", ["ex-10","ex-11","ex-12"]),
  "ex:paintmasonry":_g("ex:paintmasonry","Exterior Paint & Masonry", "exterior", ["ex-06","ex-07","ex-08"]),
  "ex:gutters":     _g("ex:gutters",     "Gutters & Drainage",       "exterior", ["ex-18"]),
  "ex:concrete":    _g("ex:concrete",    "Concrete & Walkways",      "exterior", ["ex-19"]),
  "ex:landscaping": _g("ex:landscaping", "Landscaping & Lawn",       "exterior", ["ex-04","ex-20"]),

  // Bedroom template groups (section: bedrooms, multi — reuse interior item ids)
  "bed:flooring": _g("bed:flooring", "Flooring",          "bedrooms", ["ig-01","ig-02","ig-03","ig-04","ig-05","ig-06"]),
  "bed:paint":    _g("bed:paint",    "Paint & Wall Repair","bedrooms", ["ig-07","ig-08","ig-09"]),
  "bed:doors":    _g("bed:doors",    "Doors",              "bedrooms", ["ig-10","ig-11","ig-13","ig-14","ig-15","ig-16","ig-17","ig-18"]),
  "bed:closet":   _g("bed:closet",   "Closet",             "bedrooms", ["ig-12","ig-19"]),

  // Living template groups (section: living, multi — reuse interior item ids)
  "liv:flooring": _g("liv:flooring", "Flooring",          "living", ["ig-01","ig-02","ig-03","ig-04","ig-05","ig-06"]),
  "liv:paint":    _g("liv:paint",    "Paint & Wall Repair","living", ["ig-07","ig-08","ig-09"]),
  "liv:doors":    _g("liv:doors",    "Doors",              "living", ["ig-10","ig-11","ig-12","ig-13","ig-14","ig-15","ig-16","ig-17","ig-18"]),
  "liv:lighting": _g("liv:lighting", "Lighting",           "living", ["ig-22"]),
};

// ---------------------------------------------------------------------------
// ROOM_TEMPLATES (7)
// ---------------------------------------------------------------------------
/** @type {Record<string,{roomType:string,section:string,label:string,multi:boolean,prefix:string,removable:boolean,groupKeys:string[]}>} */
export const ROOM_TEMPLATES = {
  "interior-general": {
    roomType:  "interior-general",
    section:   "interior",
    label:     "Interior",
    multi:     false,
    prefix:    "interior",
    removable: false,
    groupKeys: ["ig:flooring","ig:paint","ig:doors","ig:pest","ig:trim","ig:demo"],
  },
  "kitchen": {
    roomType:  "kitchen",
    section:   "kitchen",
    label:     "Kitchen",
    multi:     false,
    prefix:    "kitchen",
    removable: false,
    groupKeys: ["kt:cabinets","kt:counters","kt:appliances"],
  },
  "systems": {
    roomType:  "systems",
    section:   "systems",
    label:     "Systems",
    multi:     false,
    prefix:    "systems",
    removable: false,
    groupKeys: ["as:hvac","as:electrical","as:structural","as:insulation","as:waterheater","as:roof","as:plumbing"],
  },
  "exterior": {
    roomType:  "exterior",
    section:   "exterior",
    label:     "Exterior",
    multi:     false,
    prefix:    "exterior",
    removable: false,
    groupKeys: ["ex:fence","ex:siding","ex:windows","ex:garage","ex:trees","ex:paintmasonry","ex:gutters","ex:concrete","ex:landscaping"],
  },
  "bathroom": {
    roomType:  "bathroom",
    section:   "bathrooms",
    label:     "Bathroom",
    multi:     true,
    prefix:    "bath",
    removable: true,
    groupKeys: ["ba:vanity","ba:tub","ba:tile","ba:fixtures"],
  },
  "bedroom": {
    roomType:  "bedroom",
    section:   "bedrooms",
    label:     "Bedroom",
    multi:     true,
    prefix:    "bed",
    removable: true,
    groupKeys: ["bed:flooring","bed:paint","bed:doors","bed:closet"],
  },
  "living": {
    roomType:  "living",
    section:   "living",
    label:     "Living",
    multi:     true,
    prefix:    "living",
    removable: true,
    groupKeys: ["liv:flooring","liv:paint","liv:doors","liv:lighting"],
  },
};

// ---------------------------------------------------------------------------
// SECTIONS (nav order)
// ---------------------------------------------------------------------------
/** @type {Array<{id:string,label:string,roomType:string,multi:boolean}>} */
export const SECTIONS = [
  { id: "interior",  label: "Interior",  roomType: "interior-general", multi: false },
  { id: "kitchen",   label: "Kitchen",   roomType: "kitchen",          multi: false },
  { id: "bathrooms", label: "Bathrooms", roomType: "bathroom",         multi: true  },
  { id: "systems",   label: "Systems",   roomType: "systems",          multi: false },
  { id: "exterior",  label: "Exterior",  roomType: "exterior",         multi: false },
  { id: "bedrooms",  label: "Bedrooms",  roomType: "bedroom",          multi: true  },
  { id: "living",    label: "Living",    roomType: "living",           multi: true  },
];

// ---------------------------------------------------------------------------
// Internal lookup map (built once at module load)
// ---------------------------------------------------------------------------
const _itemById = new Map(CATALOG_ITEMS.map(item => [item.id, item]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a catalog item by id, optionally including custom items from a project.
 * Returns undefined if not found — never throws.
 *
 * @param {string} itemId
 * @param {{customItems?: Array<{id:string}>}|undefined} [project]
 * @returns {{id:string,name:string,unit:string,defaultCost:number}|undefined}
 */
export function getItem(itemId, project) {
  // Check catalog first
  const catalogItem = _itemById.get(itemId);
  if (catalogItem) return catalogItem;

  // Check project's custom items if provided
  if (project && Array.isArray(project.customItems)) {
    return project.customItems.find(ci => ci.id === itemId);
  }

  return undefined;
}

/**
 * Get the ordered array of group objects for a given room instance.
 *
 * @param {string} instanceId  (unused for routing — roomType drives template lookup)
 * @param {string} roomType
 * @returns {Array<{key:string,label:string,section:string,required:boolean,critical:boolean|'conditional',conditionalItemIds:string[]|null,itemIds:string[]}>}
 */
export function getGroupsForInstance(instanceId, roomType) {
  const template = ROOM_TEMPLATES[roomType];
  if (!template) return [];
  return template.groupKeys.map(gk => GROUPS[gk]).filter(Boolean);
}

/**
 * Get ordered items for a group, appending custom items, filtering deleted ids.
 *
 * @param {string} groupKey
 * @param {{customItems?: Array<{id:string,groupKey:string}>, deletedItemIds?: string[]}|undefined} [project]
 * @returns {Array<{id:string,name:string,unit:string,defaultCost:number}>}
 */
export function getItemsForGroup(groupKey, project) {
  const group = GROUPS[groupKey];
  if (!group) return [];

  const deletedSet = (project && Array.isArray(project.deletedItemIds))
    ? new Set(project.deletedItemIds)
    : new Set();

  // Start with catalog items for this group, filtering deleted
  const items = group.itemIds
    .filter(id => !deletedSet.has(id))
    .map(id => _itemById.get(id))
    .filter(Boolean);

  // Append any project custom items that belong to this group, filtering deleted
  if (project && Array.isArray(project.customItems)) {
    for (const ci of project.customItems) {
      if (ci.groupKey === groupKey && !deletedSet.has(ci.id)) {
        items.push(ci);
      }
    }
  }

  return items;
}

/**
 * Return quantity chip preset values for a given unit string.
 *   sqft, sf           → [100, 250, 500]
 *   LF                 → [10, 25, 50]
 *   ea., handle, door, pier, tree, stump, pane → [1, 2, 3]
 *   everything else    → [1]
 *
 * @param {string} unit
 * @returns {number[]}
 */
export function quantityChips(unit) {
  if (unit === "sqft" || unit === "sf") return [100, 250, 500];
  if (unit === "LF") return [10, 25, 50];
  if (["ea.","handle","door","pier","tree","stump","pane"].includes(unit)) return [1, 2, 3];
  return [1];
}

// ---------------------------------------------------------------------------
// Dev-only coverage report (NOT a test file; no test runner; pure data check)
// ---------------------------------------------------------------------------

/**
 * Returns a coverage report object proving catalog correctness at runtime.
 * itemCount                  — should be 108
 * requiredGroupsPresent      — all 19 REQUIRED_GROUP_KEYS exist with required:true
 * missingRequired            — any that don't
 * allItemsReachable          — every catalog item id appears in at least one group
 *                              across singleton+bathroom templates
 * orphans                    — item ids not reachable
 * intraInstanceCollisions    — per roomType: any itemId in >1 group of that template
 *
 * @returns {{
 *   itemCount: number,
 *   requiredGroupsPresent: boolean,
 *   missingRequired: string[],
 *   allItemsReachable: boolean,
 *   orphans: string[],
 *   intraInstanceCollisions: Array<{roomType:string, itemId:string, groups:string[]}>
 * }}
 */
export function __coverageReport() {
  const itemCount = CATALOG_ITEMS.length;

  // 1. Required groups check
  const missingRequired = REQUIRED_GROUP_KEYS.filter(
    gk => !(GROUPS[gk] && GROUPS[gk].required === true)
  );
  const requiredGroupsPresent = missingRequired.length === 0;

  // 2. Reachability across singleton + bathroom templates
  //    (interior-general, kitchen, systems, exterior, bathroom)
  const singletonAndBathTemplates = [
    "interior-general","kitchen","systems","exterior","bathroom"
  ];
  const reachableIds = new Set();
  for (const rt of singletonAndBathTemplates) {
    const tpl = ROOM_TEMPLATES[rt];
    if (!tpl) continue;
    for (const gk of tpl.groupKeys) {
      const grp = GROUPS[gk];
      if (!grp) continue;
      for (const id of grp.itemIds) reachableIds.add(id);
    }
  }
  const orphans = CATALOG_ITEMS
    .map(item => item.id)
    .filter(id => !reachableIds.has(id));
  const allItemsReachable = orphans.length === 0;

  // 3. Intra-instance collision check (per roomType template)
  const intraInstanceCollisions = [];
  for (const [rt, tpl] of Object.entries(ROOM_TEMPLATES)) {
    const seen = new Map(); // itemId -> [groupKeys]
    for (const gk of tpl.groupKeys) {
      const grp = GROUPS[gk];
      if (!grp) continue;
      for (const id of grp.itemIds) {
        if (!seen.has(id)) seen.set(id, []);
        seen.get(id).push(gk);
      }
    }
    for (const [itemId, groups] of seen.entries()) {
      if (groups.length > 1) {
        intraInstanceCollisions.push({ roomType: rt, itemId, groups });
      }
    }
  }

  return {
    itemCount,
    requiredGroupsPresent,
    missingRequired,
    allItemsReachable,
    orphans,
    intraInstanceCollisions,
  };
}
