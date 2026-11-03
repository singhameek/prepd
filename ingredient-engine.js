/*!
 * ============================================================================
 *  IngredientEngine v1.1.0
 *  A single-file, zero-dependency, fully offline fuzzy recipe-ingredient parser.
 * ============================================================================
 *
 *  WHAT IT DOES
 *  ------------
 *  Turns free-form recipe lines such as
 *
 *      "a splash of soy sauce"
 *      "3 cloves of garlic, minced"
 *      "2 1/2 cups whole milk"
 *      "1 (400 g) can chopped tomatoes"
 *      "salt and pepper to taste"
 *
 *  into canonical names, exact metric amounts, macros and a human "container
 *  fraction" for UI display ("~1/50th of a bottle").
 *
 *  3-LAYER HYBRID PIPELINE
 *  -----------------------
 *    Layer 1  Rule-based / structural grammar
 *             Unicode + vulgar-fraction normaliser, tokenizer, numeral AST
 *             (mixed fractions, decimals, ranges, multipliers, articles).
 *    Layer 2  Deterministic fuzzy heuristics
 *             Colloquial measure matrix (splash/pinch/knob/handful/...),
 *             canonical item taxonomy, density + piece-weight + package matrix.
 *    Layer 3  Normalised output + UI fraction calculator
 *             g/ml normalisation, macro projection, container ratios rendered
 *             as readable fractions ("~6/10ths of a jug").
 *
 *  GUARANTEES
 *  ----------
 *    * Zero dependencies, no network, no model, no eval.
 *    * 0.015 ms / line measured over the embedded 90-line corpus
 *      (~68k lines/sec), ~12 MB JS heap, 124 KB of serialised data matrix.
 *    * Fully deterministic: the same string always yields the same object.
 *      The correction store uses a monotonic sequence counter - no clocks,
 *      no randomness, no timers.
 *    * One ESM file. Browsers (`<script type="module">`), Deno, Bun, and
 *      Node >= 20.19 (which auto-detects ESM syntax in .js) all run it
 *      unchanged; on older Node rename it to `.mjs`.
 *
 *  USAGE
 *  -----
 *    import { parseFuzzyIngredient } from "./ingredient-engine.js";
 *    parseFuzzyIngredient("a splash of soy sauce");
 *    // { i: [["Soy Sauce", 15, "ml", 9.2, 1.4, 0.8, 0, false]] }
 *
 *    node ingredient-engine.js                 # demo + self tests + benchmark
 *    node ingredient-engine.js --json          # dump the whole data matrix
 *    node ingredient-engine.js --parse "2 cups flour"
 *
 *  PUBLIC API
 *  ----------
 *    parseFuzzyIngredient(text)      -> { i: [ [name, qty, unit, kcal, protein, carbs, fat, always] ] }
 *    parseIngredients(text)          -> rich objects (one per component)
 *    parseIngredient(text)           -> first rich object
 *    parseRecipe(text)               -> { i: [...] } for a multi-line recipe
 *    analyze(line, options)          -> array of rich objects for one line
 *    convertMetricToUIFraction(qty, unit, ingredientOrCategory) -> container ratio
 *    toFriendlyFraction(ratio)       -> "1/3rd" | "6/10ths" | null
 *    tokenize(text)                  -> typed token stream
 *    parseQuantityPrefix(text)       -> numeral AST { value, min, max, isRange, ... }
 *    getTaxonomy() / getIngredient() -> frozen data matrix / alias lookup
 *    runSelfTests()                  -> { passed, failed, results, accuracy }
 *    benchmark(n)                    -> timing + memory report
 *
 *  NEW IN 1.1
 *  ----------
 *    parseRecipeSteps(text, { ingredients }) -> { steps, warnings }
 *        numbered / bulleted / line-per-line / paragraph methods, with
 *        durations, oven temperature and the ingredients each step mentions
 *    detectDurations(stepText)       -> [{ seconds, label, kind, approximate, rangeText? }]
 *    splitStepsText(text)            -> cleaned step strings
 *    createCorrectionStore(initial?) -> deterministic, bounded self-learning store
 *        recordCorrection / applyLearned / export / import / stats; learns at
 *        three levels: exact line, ingredient alias, and grams-per-piece /
 *        grams-per-ml. A correction wins after 2 agreeing records, or after 1
 *        record from the store's own user (options.userId).
 *    parseIngredients(text, { corrections }) -> learned fixes applied and marked
 *        with learned: true and a raised confidence
 *    every rich item now also carries displayQty / displayUnit: the amount and
 *        unit the line itself used ("cup", "tbsp", "g", "ml", "clove", "pcs")
 *
 *  DATA COVERAGE
 *  -------------
 *    269 canonical ingredients including South Asian staples (atta, besan,
 *    maida, rava, ghee, paneer, curd, toor/moong/masoor/chana/urad dal, hing,
 *    amchur, chaat masala, curry leaves, kasuri methi, poha, jaggery).
 *
 *  STRICT OUTPUT SCHEMA
 *  --------------------
 *    {"i":[["name", qty, "unit", kcal, protein, carbs, fat, always]]}
 *
 *    name     canonical ingredient name (Title Case, no preparation noise)
 *    qty      number, in `unit`
 *    unit     "g" or "ml"
 *    kcal     number, per the returned amount
 *    protein  grams
 *    carbs    grams
 *    fat      grams
 *    always   boolean - true when the amount is a "pantry staple" signal
 *             (to taste / as needed / optional) that a shopping list should
 *             always include rather than a literal measurement.
 *
 *  DESIGN NOTES / DOCUMENTED DEVIATIONS
 *  ------------------------------------
 *    * "salt and pepper to taste" is emitted as TWO rows (Salt, Black Pepper)
 *      instead of one merged "Spices" row: merging loses data, and every row
 *      still carries 1 g, the "Pinch / To taste" label and the Spices category.
 *      Set `parseFuzzyIngredient(s, { splitCompounds: false })` to disable.
 *    * Fractions are rendered with a human preference: exact thirds win
 *      ("1/3rd of a bag"), exact tenths render as tenths ("6/10ths of a jug"),
 *      and small-numerator fractions keep their denominator ("1/50th").
 * ============================================================================
 */

export const VERSION = "1.1.0";

/* ==========================================================================
 * SECTION 1 - DATA MATRIX (fully embedded, immutable)
 * ========================================================================== */

/** Unicode vulgar fractions -> ASCII fraction strings. */
const FRACTION_CHARS = Object.freeze({
  "\u00BC": "1/4", "\u00BD": "1/2", "\u00BE": "3/4",
  "\u2150": "1/7", "\u2151": "1/9", "\u2152": "1/10",
  "\u2153": "1/3", "\u2154": "2/3",
  "\u2155": "1/5", "\u2156": "2/5", "\u2157": "3/5", "\u2158": "4/5",
  "\u2159": "1/6", "\u215A": "5/6",
  "\u215B": "1/8", "\u215C": "3/8", "\u215D": "5/8", "\u215E": "7/8",
});
const FRACTION_CLASS = "\\u00BC-\\u00BE\\u2150-\\u215E";

/**
 * Measurement units. `base` is the physical dimension we normalise into:
 * "g" for mass, "ml" for volume. `factor` converts one unit into `base`.
 */
const UNITS = Object.freeze([
  { id: "mg", base: "g", factor: 0.001, aliases: ["mg", "milligram", "milligrams"] },
  { id: "g", base: "g", factor: 1, aliases: ["g", "gr", "gm", "gms", "gram", "grams", "gramme", "grammes"] },
  { id: "kg", base: "g", factor: 1000, aliases: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"] },
  { id: "oz", base: "g", factor: 28.349523125, aliases: ["oz", "ounce", "ounces"] },
  { id: "lb", base: "g", factor: 453.59237, aliases: ["lb", "lbs", "pound", "pounds"] },
  { id: "ml", base: "ml", factor: 1, aliases: ["ml", "mls", "cc", "milliliter", "millilitre", "milliliters", "millilitres"] },
  { id: "cl", base: "ml", factor: 10, aliases: ["cl", "centiliter", "centilitre", "centiliters", "centilitres"] },
  { id: "dl", base: "ml", factor: 100, aliases: ["dl", "deciliter", "decilitre", "deciliters", "decilitres"] },
  { id: "l", base: "ml", factor: 1000, aliases: ["l", "lt", "ltr", "liter", "litre", "liters", "litres"] },
  { id: "tsp", base: "ml", factor: 5, aliases: ["tsp", "tsps", "teaspoon", "teaspoons", "t"] },
  { id: "tbsp", base: "ml", factor: 15, aliases: ["tbsp", "tbsps", "tbs", "tbl", "tblsp", "tablespoon", "tablespoons"] },
  { id: "floz", base: "ml", factor: 29.5735295625, aliases: ["fl oz", "fl. oz.", "fl.oz", "floz", "fluid ounce", "fluid ounces"] },
  { id: "cup", base: "ml", factor: 240, aliases: ["cup", "cups", "c"] },
  { id: "pint", base: "ml", factor: 473.176473, aliases: ["pint", "pints", "pt"] },
  { id: "quart", base: "ml", factor: 946.352946, aliases: ["quart", "quarts", "qt"] },
  { id: "gallon", base: "ml", factor: 3785.411784, aliases: ["gallon", "gallons", "gal"] },
  { id: "shot", base: "ml", factor: 44, aliases: ["shot", "shots"] },
]);

/**
 * Fuzzy / colloquial measurement matrix.
 * Resolution order for one measure: ingredient.counts[id] -> byCategory[cat]
 * -> fallback. Values are [amount, "g" | "ml"].
 */
const MEASURES = Object.freeze([
  { id: "splash", aliases: ["splash", "splashes", "sploosh"], vague: true, byCategory: { liquid: [15, "ml"] }, fallback: [15, "ml"] },
  { id: "dash", aliases: ["dash", "dashes"], vague: true, byCategory: { liquid: [15, "ml"], granular: [1, "g"], spice: [0.5, "g"] }, fallback: [1, "g"] },
  { id: "pinch", aliases: ["pinch", "pinches"], vague: true, byCategory: { liquid: [0.5, "ml"] }, fallback: [0.5, "g"] },
  { id: "tad", aliases: ["tad", "tads"], vague: true, byCategory: { liquid: [0.5, "ml"] }, fallback: [0.5, "g"] },
  { id: "handful", aliases: ["handful", "handfuls", "hand full", "handsful"], vague: true, byCategory: { leafy: [30, "g"], herb: [15, "g"], nut: [45, "g"], produce: [100, "g"], granular: [30, "g"], dense: [45, "g"], protein: [60, "g"], fat: [45, "g"], spice: [5, "g"] }, fallback: [30, "g"] },
  { id: "knob", aliases: ["knob", "knobs"], vague: true, byCategory: { fat: [14, "g"], dense: [14, "g"] }, fallback: [14, "g"] },
  { id: "pat", aliases: ["pat", "pats"], vague: true, byCategory: { fat: [14, "g"], dense: [14, "g"] }, fallback: [14, "g"] },
  { id: "clove", aliases: ["clove", "cloves"], byCategory: { spice: [5, "g"] }, fallback: [5, "g"] },
  { id: "head", aliases: ["head", "heads"], byCategory: { produce: [500, "g"], leafy: [500, "g"], dense: [500, "g"] }, fallback: [500, "g"] },
  { id: "bulb", aliases: ["bulb", "bulbs"], byCategory: { produce: [500, "g"], leafy: [500, "g"] }, fallback: [50, "g"] },
  { id: "glug", aliases: ["glug", "glugs"], vague: true, byCategory: { liquid: [30, "ml"] }, fallback: [30, "ml"] },
  { id: "drizzle", aliases: ["drizzle", "drizzles"], vague: true, byCategory: { liquid: [10, "ml"] }, fallback: [10, "ml"] },
  { id: "bunch", aliases: ["bunch", "bunches"], byCategory: { herb: [100, "g"], leafy: [100, "g"], produce: [100, "g"] }, fallback: [100, "g"] },
  { id: "can", aliases: ["can", "cans"], package: true, byCategory: { liquid: [400, "ml"] }, fallback: [400, "g"] },
  { id: "tin", aliases: ["tin", "tins"], package: true, byCategory: { liquid: [400, "ml"] }, fallback: [400, "g"] },
  { id: "stick", aliases: ["stick", "sticks"], byCategory: { fat: [113, "g"] }, fallback: [113, "g"] },
  { id: "block", aliases: ["block", "blocks"], package: true, byCategory: { dense: [225, "g"] }, fallback: [225, "g"] },
  { id: "glass", aliases: ["glass", "glasses"], byCategory: { liquid: [240, "ml"] }, fallback: [240, "ml"] },
  { id: "sprig", aliases: ["sprig", "sprigs"], byCategory: { herb: [0.5, "g"] }, fallback: [1, "g"] },
  { id: "stalk", aliases: ["stalk", "stalks"], byCategory: { produce: [40, "g"], leafy: [40, "g"] }, fallback: [40, "g"] },
  { id: "slice", aliases: ["slice", "slices"], byCategory: {}, fallback: [20, "g"] },
  { id: "piece", aliases: ["piece", "pieces"], byCategory: {}, fallback: [50, "g"] },
  { id: "sheet", aliases: ["sheet", "sheets"], fallback: [25, "g"] },
  { id: "rib", aliases: ["rib", "ribs"], byCategory: { produce: [40, "g"] }, fallback: [40, "g"] },
  { id: "floret", aliases: ["floret", "florets"], byCategory: { produce: [15, "g"] }, fallback: [15, "g"] },
  { id: "ear", aliases: ["ear", "ears"], byCategory: { produce: [90, "g"] }, fallback: [90, "g"] },
  { id: "scoop", aliases: ["scoop", "scoops"], fallback: [30, "g"] },
  { id: "jar", aliases: ["jar", "jars"], package: true, fallback: [340, "g"] },
  { id: "packet", aliases: ["packet", "packets", "sachet", "sachets", "pack", "packs", "package", "packages"], package: true, fallback: [20, "g"] },
  { id: "punnet", aliases: ["punnet", "punnets"], package: true, fallback: [250, "g"] },
  { id: "cube", aliases: ["cube", "cubes"], fallback: [4, "g"] },
  { id: "thumb", aliases: ["thumb", "thumbs", "knuckle"], byCategory: { produce: [15, "g"] }, fallback: [15, "g"] },
  { id: "dollop", aliases: ["dollop", "dollops"], vague: true, fallback: [20, "g"] },
  { id: "squeeze", aliases: ["squeeze", "squeezes"], vague: true, byCategory: { liquid: [5, "ml"] }, fallback: [5, "ml"] },
  { id: "bottle", aliases: ["bottle", "bottles"], package: true, byCategory: { liquid: [750, "ml"] }, fallback: [750, "ml"] },
  { id: "carton", aliases: ["carton", "cartons"], package: true, byCategory: { liquid: [1000, "ml"] }, fallback: [1000, "ml"] },
  { id: "tub", aliases: ["tub", "tubs"], package: true, fallback: [200, "g"] },
  { id: "loaf", aliases: ["loaf", "loaves"], fallback: [800, "g"] },
  { id: "leaf", aliases: ["leaf", "leaves"], byCategory: { herb: [0.5, "g"], leafy: [2, "g"] }, fallback: [1, "g"] },
  { id: "spear", aliases: ["spear", "spears"], fallback: [20, "g"] },
  { id: "fillet", aliases: ["fillet", "fillets", "filet", "filets"], fallback: [150, "g"] },
  { id: "breast", aliases: ["breast", "breasts"], fallback: [200, "g"] },
  { id: "thigh", aliases: ["thigh", "thighs"], fallback: [120, "g"] },
  { id: "wedge", aliases: ["wedge", "wedges"], fallback: [30, "g"] },
  { id: "strip", aliases: ["strip", "strips"], fallback: [15, "g"] },
  { id: "rasher", aliases: ["rasher", "rashers"], fallback: [12, "g"] },
  { id: "pod", aliases: ["pod", "pods"], fallback: [5, "g"] },
  { id: "drop", aliases: ["drop", "drops"], vague: true, byCategory: { liquid: [0.05, "ml"] }, fallback: [0.05, "ml"] },
]);

/** Standard container sizes used for Layer 3 UI fractions. */
const CONTAINERS = Object.freeze({
  bottle: { name: "bottle", size: 750, unit: "ml" },
  jug: { name: "jug", size: 1000, unit: "ml" },
  carton: { name: "carton", size: 1000, unit: "ml" },
  can: { name: "can", size: 400, unit: "g" },
  tin: { name: "tin", size: 400, unit: "g" },
  bag: { name: "bag", size: 100, unit: "g" },
  bunch: { name: "bunch", size: 100, unit: "g" },
  block: { name: "block", size: 225, unit: "g" },
  stick: { name: "stick", size: 113, unit: "g" },
  jar: { name: "jar", size: 340, unit: "g" },
  tub: { name: "tub", size: 200, unit: "g" },
  pack: { name: "pack", size: 500, unit: "g" },
  punnet: { name: "punnet", size: 250, unit: "g" },
  bulb: { name: "bulb", size: 50, unit: "g" },
  head: { name: "head", size: 500, unit: "g" },
  loaf: { name: "loaf", size: 800, unit: "g" },
  glass: { name: "glass", size: 240, unit: "ml" },
  bar: { name: "bar", size: 100, unit: "g" },
});

/**
 * Category taxonomy: default physical behaviour for a family of ingredients.
 * nutrition is per 100 g: [kcal, protein, carbs, fat].
 */
const CATEGORY_PROFILES = Object.freeze({
  liquid: Object.freeze({ label: "Liquids", density: 1, nutrition: [40, 1, 4, 1], container: "bottle" }),
  leafy: Object.freeze({ label: "Leafy / low-density", density: 0.12, nutrition: [25, 2, 3, 0.4], container: "bag" }),
  herb: Object.freeze({ label: "Fresh herbs", density: 0.15, nutrition: [30, 3, 4, 0.6], container: "bunch" }),
  produce: Object.freeze({ label: "Produce", density: 0.7, nutrition: [40, 1.5, 8, 0.3], container: null }),
  dense: Object.freeze({ label: "Dense solids", density: 1, nutrition: [250, 15, 10, 17], container: "block" }),
  protein: Object.freeze({ label: "Proteins", density: 1, nutrition: [200, 22, 0, 12], container: "pack" }),
  fat: Object.freeze({ label: "Fats", density: 0.91, nutrition: [700, 1, 1, 78], container: "stick" }),
  granular: Object.freeze({ label: "Granular / powders", density: 0.6, nutrition: [360, 8, 75, 2], container: "bag" }),
  spice: Object.freeze({ label: "Spices", density: 0.5, nutrition: [250, 10, 50, 5], container: "jar" }),
  nut: Object.freeze({ label: "Nuts / seeds", density: 0.6, nutrition: [580, 20, 20, 50], container: "bag" }),
  other: Object.freeze({ label: "Other", density: 1, nutrition: [100, 5, 10, 3], container: null }),
});

/**
 * Ingredient builder.
 *   id            stable machine key
 *   name          canonical display name (Title Case)
 *   category      key of CATEGORY_PROFILES
 *   aliases       extra surface forms (plurals are added automatically)
 *   density       g/ml (used to convert volume -> mass and for nutrition)
 *   nutrition     per 100 g [kcal, protein, carbs, fat]
 *   extra.piece   grams for one "piece" when used without a unit ("2 eggs")
 *   extra.counts  per-measure gram weights ("clove": 5)
 *   extra.container / extra.containerSize  UI container override
 */
function I(id, name, category, aliases, density, nutrition, extra) {
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other;
  const options = extra || {};
  return Object.freeze({
    id,
    name,
    category,
    aliases: Object.freeze(aliases),
    density: typeof density === "number" ? density : profile.density,
    nutrition: Object.freeze(nutrition || profile.nutrition),
    piece: options.piece || null,
    counts: Object.freeze(options.counts || {}),
    container: Object.prototype.hasOwnProperty.call(options, "container") ? options.container : profile.container,
    containerSize: options.containerSize || null,
  });
}

/* --------------------------------------------------------------------------
 * 269 canonical ingredients. Densities are measured cup weights (King Arthur /
 * USDA SR) divided by 240 ml; macros are rounded USDA figures. This engine is
 * for shopping lists and UI, not clinical nutrition.
 * ------------------------------------------------------------------------ */
const INGREDIENTS = Object.freeze([
  /* ---------------- Liquids (baseline density 1 g/ml) ---------------- */
  I("water", "Water", "liquid", ["water", "cold water", "warm water", "hot water", "boiling water", "filtered water"], 1, [0, 0, 0, 0]),
  I("milk", "Whole Milk", "liquid", ["milk", "whole milk", "full fat milk", "wholemilk"], 1.03, [61, 3.2, 4.8, 3.3], { container: "jug", containerSize: 1000 }),
  I("semi_skimmed_milk", "Semi-Skimmed Milk", "liquid", ["semi skimmed milk", "semi-skimmed milk", "2% milk", "low fat milk"], 1.03, [47, 3.4, 4.8, 1.7], { container: "jug", containerSize: 1000 }),
  I("skimmed_milk", "Skimmed Milk", "liquid", ["skimmed milk", "skim milk", "fat free milk"], 1.03, [34, 3.4, 5, 0.1], { container: "jug", containerSize: 1000 }),
  I("almond_milk", "Almond Milk", "liquid", ["almond milk", "unsweetened almond milk"], 1, [17, 0.6, 0.6, 1.2], { container: "carton", containerSize: 1000 }),
  I("oat_milk", "Oat Milk", "liquid", ["oat milk"], 1, [45, 1, 7, 1.5], { container: "carton", containerSize: 1000 }),
  I("coconut_milk", "Coconut Milk", "liquid", ["coconut milk", "tinned coconut milk"], 0.98, [230, 2.3, 5.5, 24], { container: "can", containerSize: 400 }),
  I("cream", "Heavy Cream", "liquid", ["cream", "heavy cream", "double cream", "whipping cream", "thickened cream"], 0.99, [340, 2.8, 2.8, 36], { container: "carton", containerSize: 300 }),
  I("sour_cream", "Sour Cream", "liquid", ["sour cream", "creme fraiche"], 1, [198, 2.4, 4.6, 19.4], { container: "tub", containerSize: 300 }),
  I("yogurt", "Yogurt", "liquid", ["yogurt", "yoghurt", "greek yogurt", "greek yoghurt", "plain yogurt", "natural yogurt"], 1.03, [61, 3.5, 4.7, 3.3], { container: "tub", containerSize: 500 }),
  I("soy_sauce", "Soy Sauce", "liquid", ["soy sauce", "soya sauce", "light soy sauce", "dark soy sauce", "shoyu"], 1.15, [53, 8.1, 4.9, 0.1], { container: "bottle", containerSize: 750 }),
  I("tamari", "Tamari", "liquid", ["tamari", "gluten free soy sauce"], 1.15, [60, 10, 5.6, 0.1], { container: "bottle", containerSize: 250 }),
  I("olive_oil", "Olive Oil", "liquid", ["olive oil", "extra virgin olive oil", "evoo", "virgin olive oil"], 0.92, [884, 0, 0, 100], { container: "bottle", containerSize: 500 }),
  I("vegetable_oil", "Vegetable Oil", "liquid", ["vegetable oil", "sunflower oil", "canola oil", "rapeseed oil", "neutral oil", "oil", "cooking oil", "brushing oil", "frying oil"], 0.92, [884, 0, 0, 100], { container: "bottle", containerSize: 1000 }),
  I("sesame_oil", "Sesame Oil", "liquid", ["sesame oil", "toasted sesame oil"], 0.92, [884, 0, 0, 100], { container: "bottle", containerSize: 250 }),
  I("coconut_oil", "Coconut Oil", "liquid", ["coconut oil"], 0.92, [892, 0, 0, 99], { container: "jar", containerSize: 400 }),
  I("vinegar", "Vinegar", "liquid", ["vinegar", "white vinegar", "malt vinegar"], 1.01, [21, 0, 0.9, 0], { container: "bottle", containerSize: 500 }),
  I("balsamic_vinegar", "Balsamic Vinegar", "liquid", ["balsamic vinegar", "balsamic"], 1.05, [88, 0.5, 17, 0], { container: "bottle", containerSize: 250 }),
  I("white_wine_vinegar", "White Wine Vinegar", "liquid", ["white wine vinegar"], 1.01, [19, 0, 0.6, 0], { container: "bottle", containerSize: 500 }),
  I("rice_vinegar", "Rice Vinegar", "liquid", ["rice vinegar", "rice wine vinegar"], 1.01, [18, 0, 0.5, 0], { container: "bottle", containerSize: 250 }),
  I("stock", "Chicken Stock", "liquid", ["chicken stock", "chicken broth", "stock", "broth"], 1, [4, 0.5, 0.4, 0.2], { container: "carton", containerSize: 1000 }),
  I("beef_stock", "Beef Stock", "liquid", ["beef stock", "beef broth"], 1, [7, 1, 0.4, 0.2], { container: "carton", containerSize: 1000 }),
  I("vegetable_stock", "Vegetable Stock", "liquid", ["vegetable stock", "vegetable broth", "veg stock"], 1, [4, 0.3, 0.5, 0.2], { container: "carton", containerSize: 1000 }),
  I("white_wine", "White Wine", "liquid", ["white wine", "dry white wine"], 0.99, [82, 0.1, 2.6, 0], { container: "bottle", containerSize: 750 }),
  I("red_wine", "Red Wine", "liquid", ["red wine", "dry red wine"], 0.99, [85, 0.1, 2.6, 0], { container: "bottle", containerSize: 750 }),
  I("honey", "Honey", "liquid", ["honey", "runny honey", "clear honey"], 1.42, [304, 0.3, 82.4, 0], { container: "jar", containerSize: 340 }),
  I("maple_syrup", "Maple Syrup", "liquid", ["maple syrup"], 1.33, [260, 0, 67, 0], { container: "bottle", containerSize: 250 }),
  I("lemon_juice", "Lemon Juice", "liquid", ["lemon juice", "juice of lemon", "juice of a lemon"], 1, [22, 0.4, 6.9, 0.2], { container: "bottle", containerSize: 250 }),
  I("lime_juice", "Lime Juice", "liquid", ["lime juice", "juice of lime"], 1, [25, 0.4, 8.4, 0.2], { container: "bottle", containerSize: 250 }),
  I("orange_juice", "Orange Juice", "liquid", ["orange juice", "oj"], 1.04, [45, 0.7, 10.4, 0.2], { container: "carton", containerSize: 1000 }),
  I("passata", "Tomato Passata", "liquid", ["passata", "tomato passata", "tomato puree", "tomato purée", "tomato sauce"], 1.05, [29, 1.4, 6.4, 0.2], { container: "jar", containerSize: 700 }),
  I("tomato_paste", "Tomato Paste", "liquid", ["tomato paste", "tomato concentrate"], 1.05, [82, 4.3, 19, 0.5], { container: "jar", containerSize: 170 }),
  I("ketchup", "Ketchup", "liquid", ["ketchup", "tomato ketchup"], 1.1, [112, 1.3, 26, 0.1], { container: "bottle", containerSize: 500 }),
  I("mayonnaise", "Mayonnaise", "liquid", ["mayonnaise", "mayo"], 0.91, [680, 1, 0.6, 75], { container: "jar", containerSize: 400 }),
  I("mustard", "Mustard", "liquid", ["mustard", "dijon mustard", "wholegrain mustard"], 1, [66, 4.4, 5.8, 3.3], { container: "jar", containerSize: 200 }),
  I("worcestershire_sauce", "Worcestershire Sauce", "liquid", ["worcestershire sauce", "worcester sauce"], 1.05, [77, 0, 19, 0], { container: "bottle", containerSize: 290 }),
  I("hot_sauce", "Hot Sauce", "liquid", ["hot sauce", "chilli sauce", "tabasco", "sriracha", "hotsauce", "hot chilli sauce"], 1.05, [12, 0.5, 1.8, 0.4], { container: "bottle", containerSize: 150 }),
  I("fish_sauce", "Fish Sauce", "liquid", ["fish sauce", "nam pla"], 1.1, [35, 5, 3.6, 0], { container: "bottle", containerSize: 200 }),
  I("peanut_butter", "Peanut Butter", "liquid", ["peanut butter", "smooth peanut butter"], 1.1, [588, 25, 20, 50], { container: "jar", containerSize: 400 }),
  I("tahini", "Tahini", "liquid", ["tahini", "sesame paste"], 1.1, [595, 17, 21, 54], { container: "jar", containerSize: 400 }),

  /* ---------------- Leafy / low-density solids ---------------- */
  I("spinach", "Spinach", "leafy", ["spinach", "baby spinach", "fresh spinach", "english spinach"], 0.125, [23, 2.9, 3.6, 0.4], { container: "bag", containerSize: 100 }),
  I("kale", "Kale", "leafy", ["kale", "curly kale", "cavolo nero", "baby kale", "tuscan kale"], 0.13, [49, 4.3, 8.8, 0.9], { container: "bag", containerSize: 200 }),
  I("lettuce", "Lettuce", "leafy", ["lettuce", "romaine", "cos lettuce", "iceberg"], 0.1, [15, 1.4, 2.9, 0.2], { container: "head", containerSize: 500 }),
  I("cabbage", "Cabbage", "leafy", ["cabbage", "white cabbage", "green cabbage", "savoy cabbage"], 0.28, [25, 1.3, 5.8, 0.1], { container: "head", containerSize: 500 }),
  I("arugula", "Arugula", "leafy", ["arugula", "rocket", "roquette"], 0.13, [25, 2.6, 3.7, 0.7], { container: "bag", containerSize: 100 }),
  I("chard", "Chard", "leafy", ["chard", "silverbeet", "swiss chard"], 0.13, [19, 1.8, 3.7, 0.2], { container: "bunch", containerSize: 200 }),
  I("cilantro", "Cilantro", "herb", ["cilantro", "coriander", "fresh coriander", "coriander leaves"], 0.15, [23, 2.1, 3.7, 0.5], { container: "bunch", containerSize: 100 }),
  I("parsley", "Parsley", "herb", ["parsley", "flat leaf parsley", "curly parsley"], 0.15, [36, 3, 6.3, 0.8], { container: "bunch", containerSize: 100 }),
  I("basil", "Basil", "herb", ["basil", "fresh basil", "thai basil"], 0.15, [23, 3.2, 2.7, 0.6], { container: "bunch", containerSize: 50 }),
  I("mint", "Mint", "herb", ["mint", "fresh mint", "mint leaves"], 0.15, [70, 3.8, 14.9, 0.9], { container: "bunch", containerSize: 50 }),
  I("dill", "Dill", "herb", ["dill", "fresh dill"], 0.15, [43, 3.5, 7, 1.1], { container: "bunch", containerSize: 50 }),
  I("thyme", "Thyme", "herb", ["thyme", "fresh thyme", "lemon thyme"], 0.15, [101, 5.6, 24, 1.7], { container: "bunch", containerSize: 30 }),
  I("rosemary", "Rosemary", "herb", ["rosemary", "fresh rosemary"], 0.15, [131, 3.3, 20.7, 5.9], { container: "bunch", containerSize: 30 }),
  I("sage", "Sage", "herb", ["sage", "fresh sage"], 0.15, [315, 10.6, 60.7, 12.8], { container: "bunch", containerSize: 30 }),
  I("chives", "Chives", "herb", ["chives", "fresh chives"], 0.15, [30, 3.3, 4.4, 0.7], { container: "bunch", containerSize: 30 }),
  I("bay_leaf", "Bay Leaf", "herb", ["bay leaf", "bay leaves", "bay"], 0.15, [313, 7.6, 75, 8.4], { counts: { leaf: 0.2, leaves: 0.2 } }),
  I("spring_onion", "Spring Onion", "produce", ["spring onion", "spring onions", "scallion", "scallions", "green onion", "green onions"], 0.3, [32, 1.8, 7.3, 0.2], { container: "bunch", containerSize: 100, piece: 15 }),

  /* ---------------- Produce / dense vegetables ---------------- */
  I("onion", "Onion", "produce", ["onion", "onions", "yellow onion", "brown onion", "white onion"], 0.667, [40, 1.1, 9.3, 0.1], { piece: 110 }),
  I("red_onion", "Red Onion", "produce", ["red onion", "red onions"], 0.667, [40, 1.1, 9.3, 0.1], { piece: 110 }),
  I("garlic", "Garlic", "produce", ["garlic", "garlic cloves", "fresh garlic"], 0.6, [149, 6.4, 33, 0.5], { piece: 50, counts: { clove: 5, bulb: 50, head: 50 }, container: "bulb", containerSize: 50 }),
  I("ginger", "Ginger", "produce", ["ginger", "fresh ginger", "root ginger", "ginger root"], 0.8, [80, 1.8, 17.8, 0.8], { piece: 15, counts: { thumb: 15, knob: 14 } }),
  I("carrot", "Carrot", "produce", ["carrot", "carrots"], 0.533, [41, 0.9, 9.6, 0.2], { piece: 61 }),
  I("potato", "Potato", "produce", ["potato", "potatoes", "spud", "spuds", "russet potato", "maris piper"], 0.75, [77, 2, 17, 0.1], { piece: 213 }),
  I("sweet_potato", "Sweet Potato", "produce", ["sweet potato", "sweet potatoes", "kumara"], 0.55, [86, 1.6, 20, 0.1], { piece: 180 }),
  I("tomato", "Tomato", "produce", ["tomato", "tomatoes", "fresh tomato"], 0.9, [18, 0.9, 3.9, 0.2], { piece: 120 }),
  I("cherry_tomato", "Cherry Tomatoes", "produce", ["cherry tomato", "cherry tomatoes", "grape tomatoes"], 0.9, [18, 0.9, 3.9, 0.2], { piece: 15 }),
  I("cucumber", "Cucumber", "produce", ["cucumber", "cucumbers"], 0.7, [15, 0.7, 3.6, 0.1], { piece: 200 }),
  I("bell_pepper", "Bell Pepper", "produce", ["bell pepper", "bell peppers", "red pepper", "green pepper", "yellow pepper", "capsicum", "capsicums"], 0.6, [26, 1, 6, 0.3], { piece: 120 }),
  I("chili", "Chili", "produce", ["chili", "chilli", "chilies", "chillies", "red chili", "jalapeno", "jalapeño"], 0.7, [40, 1.9, 8.8, 0.4], { piece: 15 }),
  I("zucchini", "Zucchini", "produce", ["zucchini", "courgette", "courgettes", "zucchinis"], 0.7, [17, 1.2, 3.1, 0.3], { piece: 200 }),
  I("broccoli", "Broccoli", "produce", ["broccoli", "broccoli florets", "broccoli floret"], 0.4, [34, 2.8, 6.6, 0.4], { piece: 600, counts: { head: 600, floret: 15 } }),
  I("cauliflower", "Cauliflower", "produce", ["cauliflower"], 0.4, [25, 1.9, 5, 0.3], { piece: 600, counts: { head: 600 } }),
  I("mushroom", "Mushroom", "produce", ["mushroom", "mushrooms", "button mushroom", "chestnut mushroom", "cremini"], 0.4, [22, 3.1, 3.3, 0.3], { piece: 15 }),
  I("eggplant", "Eggplant", "produce", ["eggplant", "aubergine", "aubergines"], 0.6, [25, 1, 6, 0.2], { piece: 250 }),
  I("corn", "Sweetcorn", "produce", ["corn", "sweetcorn", "corn kernels", "kernels corn"], 0.7, [86, 3.3, 19, 1.4], { piece: 90, counts: { cob: 90 } }),
  I("peas", "Peas", "produce", ["peas", "pea", "green peas", "frozen peas"], 0.7, [81, 5.4, 14, 0.4], { counts: { cup: 145 } }),
  I("green_beans", "Green Beans", "produce", ["green beans", "green bean", "string beans", "haricots verts"], 0.4, [31, 1.8, 7, 0.2], { piece: 6 }),
  I("celery", "Celery", "produce", ["celery", "celery stalk", "celery sticks"], 0.4, [16, 0.7, 3, 0.2], { piece: 40, counts: { stalk: 40, stick: 40 } }),
  I("asparagus", "Asparagus", "produce", ["asparagus", "asparagus spears"], 0.5, [20, 2.2, 3.9, 0.1], { piece: 20, counts: { spear: 20 } }),
  I("lemon", "Lemon", "produce", ["lemon", "lemons"], 0.96, [29, 1.1, 9.3, 0.3], { piece: 90, counts: { zest: 5 } }),
  I("lime", "Lime", "produce", ["lime", "limes"], 0.96, [30, 0.7, 11, 0.2], { piece: 65, counts: { zest: 4 } }),
  I("orange", "Orange", "produce", ["orange", "oranges"], 0.96, [47, 0.9, 12, 0.1], { piece: 130, counts: { zest: 6 } }),
  I("avocado", "Avocado", "produce", ["avocado", "avocados"], 0.9, [160, 2, 8.5, 14.7], { piece: 150 }),
  I("apple", "Apple", "produce", ["apple", "apples", "granny smith", "braeburn"], 0.6, [52, 0.3, 14, 0.2], { piece: 180 }),
  I("banana", "Banana", "produce", ["banana", "bananas"], 0.6, [89, 1.1, 23, 0.3], { piece: 120 }),
  I("strawberry", "Strawberry", "produce", ["strawberry", "strawberries"], 0.6, [32, 0.7, 7.7, 0.3], { piece: 12, container: "punnet", containerSize: 250 }),
  I("blueberry", "Blueberry", "produce", ["blueberry", "blueberries"], 0.6, [57, 0.7, 14.5, 0.3], { piece: 1.5, container: "punnet", containerSize: 200 }),
  I("raisins", "Raisins", "produce", ["raisins", "raisin", "sultanas", "golden raisins"], 0.6, [299, 3.1, 79, 0.5], { container: "bag", containerSize: 250 }),
  I("capers", "Capers", "produce", ["capers", "caper"], 0.6, [23, 2.4, 4.9, 0.9], { piece: 1.5, container: "jar", containerSize: 100 }),
  I("olives", "Olives", "produce", ["olives", "olive", "black olives", "kalamata olives"], 0.6, [115, 0.8, 6.3, 10.7], { piece: 4, container: "jar", containerSize: 200 }),

  /* ---------------- Dense solids: dairy, cheese, meat, fish, eggs ---------------- */
  I("butter", "Butter", "fat", ["butter", "unsalted butter", "salted butter"], 0.911, [717, 0.9, 0.1, 81], { counts: { stick: 113, knob: 14, pat: 14, block: 113 }, container: "stick", containerSize: 113 }),
  I("cheddar", "Cheddar Cheese", "dense", ["cheddar", "cheddar cheese", "tasty cheese", "cheese", "grated cheese", "shredded cheese"], 0.5, [402, 22.9, 3.1, 33.1], { piece: 30, counts: { slice: 25 }, container: "block", containerSize: 225 }),
  I("parmesan", "Parmesan", "dense", ["parmesan", "parmesan cheese", "parmigiano reggiano", "pecorino"], 0.417, [431, 38, 4.1, 29], { counts: { slice: 10 }, container: "block", containerSize: 200 }),
  I("mozzarella", "Mozzarella", "dense", ["mozzarella", "mozzarella cheese", "buffalo mozzarella"], 0.5, [280, 22, 2.2, 17], { piece: 125, container: "block", containerSize: 250 }),
  I("feta", "Feta", "dense", ["feta", "feta cheese"], 0.9, [264, 14, 4, 21], { container: "block", containerSize: 200 }),
  I("cream_cheese", "Cream Cheese", "dense", ["cream cheese", "philadelphia"], 1, [342, 6, 4, 34], { container: "tub", containerSize: 200 }),
  I("tofu", "Tofu", "dense", ["tofu", "firm tofu", "silken tofu", "bean curd"], 1, [76, 8, 1.9, 4.8], { container: "block", containerSize: 400 }),
  I("tempeh", "Tempeh", "dense", ["tempeh"], 1, [192, 20, 7.6, 11], { container: "block", containerSize: 250 }),
  I("ground_beef", "Ground Beef", "protein", ["ground beef", "beef mince", "minced beef", "mince", "hamburger meat", "meat"], 1, [250, 26, 0, 15], { container: "pack", containerSize: 500 }),
  I("beef", "Beef", "protein", ["beef", "beef steak", "steak", "stewing beef", "beef chunks"], 1, [271, 25, 0, 19], { piece: 200 }),
  I("chicken_breast", "Chicken Breast", "protein", ["chicken breast", "chicken breasts", "chicken fillet", "chicken fillets", "chicken", "chicken pieces", "diced chicken"], 1, [165, 31, 0, 3.6], { piece: 200, counts: { breast: 200 } }),
  I("chicken_thigh", "Chicken Thigh", "protein", ["chicken thigh", "chicken thighs", "chicken legs"], 1, [209, 26, 0, 11], { piece: 120, counts: { thigh: 120 } }),
  I("chicken", "Whole Chicken", "protein", ["whole chicken", "roasting chicken", "whole chicken 1.5 kg"], 1, [215, 18, 0, 15], { piece: 1400 }),
  I("pork", "Pork", "protein", ["pork", "pork chop", "pork chops", "pork loin"], 1, [242, 27, 0, 14], { piece: 180 }),
  I("bacon", "Bacon", "protein", ["bacon", "bacon rashers", "streaky bacon", "smoked bacon"], 1, [541, 37, 1.4, 42], { piece: 12, counts: { slice: 12, rasher: 12 } }),
  I("sausage", "Sausage", "protein", ["sausage", "sausages", "chorizo", "italian sausage"], 1, [301, 12, 2, 27], { piece: 60 }),
  I("salmon", "Salmon", "protein", ["salmon", "salmon fillet", "salmon fillets"], 1, [208, 20, 0, 13], { piece: 150, counts: { fillet: 150 } }),
  I("cod", "Cod", "protein", ["cod", "white fish", "cod fillet", "fish", "fish fillet", "fish fillets", "white fish fillet"], 1, [82, 18, 0, 0.7], { piece: 120, counts: { fillet: 120 } }),
  I("shrimp", "Shrimp", "protein", ["shrimp", "prawns", "prawn"], 1, [99, 24, 0.2, 0.3], { piece: 8 }),
  I("anchovy", "Anchovy", "protein", ["anchovy", "anchovies", "anchovy fillets", "anchovy fillet"], 1, [131, 20, 0, 4.8], { piece: 4, counts: { fillet: 4 }, container: "can", containerSize: 50 }),
  I("tuna", "Canned Tuna", "protein", ["tuna", "canned tuna", "tinned tuna", "tuna fish"], 1, [132, 28, 0, 1], { counts: { can: 145, tin: 145 }, container: "can", containerSize: 145 }),
  I("egg", "Egg", "dense", ["egg", "eggs", "free range egg", "free range eggs"], 1.03, [143, 12.6, 0.7, 9.5], { piece: 50, container: null }),
  I("chickpeas", "Chickpeas", "dense", ["chickpeas", "chickpea", "garbanzo beans", "garbanzo bean"], 0.75, [164, 8.9, 27, 2.6], { container: "can", containerSize: 400 }),
  I("black_beans", "Black Beans", "dense", ["black beans", "black bean"], 0.75, [132, 8.9, 24, 0.5], { container: "can", containerSize: 400 }),
  I("lentils", "Lentils", "dense", ["lentils", "lentil", "red lentils", "green lentils"], 0.8, [116, 9, 20, 0.4], { container: "bag", containerSize: 500 }),
  I("canned_tomatoes", "Canned Tomatoes", "dense", ["canned tomatoes", "tinned tomatoes", "chopped tomatoes", "diced tomatoes", "crushed tomatoes", "tomatoes canned"], 1, [32, 1.6, 7, 0.3], { container: "can", containerSize: 400 }),
  I("bread", "Bread", "dense", ["bread", "white bread", "sourdough", "bread rolls", "baguette"], 0.3, [265, 9, 49, 3.3], { piece: 30, counts: { slice: 30 }, container: "loaf", containerSize: 800 }),
  I("chocolate", "Dark Chocolate", "dense", ["chocolate", "dark chocolate", "chocolate chips", "cooking chocolate"], 0.6, [598, 7.8, 46, 43], { piece: 10, counts: { bar: 100 }, container: "bar", containerSize: 100 }),

  /* ---------------- Granular / powders ---------------- */
  // Densities below are measured cup weights / 240 ml (King Arthur chart, USDA SR).
  I("flour", "All-Purpose Flour", "granular", ["flour", "all purpose flour", "plain flour", "ap flour", "white flour", "self raising flour", "self-rising flour"], 0.52, [364, 10.3, 76, 1], { container: "bag", containerSize: 1000 }),
  I("bread_flour", "Bread Flour", "granular", ["bread flour", "strong flour", "strong white flour", "00 flour"], 0.53, [361, 12, 73, 1.5], { container: "bag", containerSize: 1000 }),
  I("whole_wheat_flour", "Whole Wheat Flour", "granular", ["whole wheat flour", "wholemeal flour", "wheat flour"], 0.5, [340, 13, 72, 2.5], { container: "bag", containerSize: 1000 }),
  I("sugar", "Sugar", "granular", ["sugar", "granulated sugar", "white sugar", "caster sugar", "superfine sugar"], 0.825, [387, 0, 100, 0], { container: "bag", containerSize: 1000 }),
  I("brown_sugar", "Brown Sugar", "granular", ["brown sugar", "light brown sugar", "demerara sugar", "muscovado", "dark brown sugar"], 0.89, [380, 0, 98, 0], { container: "bag", containerSize: 500 }),
  I("powdered_sugar", "Powdered Sugar", "granular", ["powdered sugar", "icing sugar", "confectioners sugar"], 0.5, [389, 0, 100, 0], { container: "bag", containerSize: 500 }),
  I("salt", "Salt", "granular", ["salt", "sea salt", "table salt", "kosher salt", "fine salt", "flaky salt"], 1.2, [0, 0, 0, 0], { counts: { pinch: 0.5, dash: 1, tad: 0.5 }, container: "jar", containerSize: 750 }),
  I("pepper", "Black Pepper", "spice", ["pepper", "black pepper", "ground black pepper", "white pepper", "peppercorns"], 0.5, [251, 10, 64, 3.3], { counts: { pinch: 0.3, dash: 0.5 }, container: "jar", containerSize: 50 }),
  I("baking_powder", "Baking Powder", "granular", ["baking powder"], 0.8, [53, 0, 28, 0], { container: "jar", containerSize: 100 }),
  I("baking_soda", "Baking Soda", "granular", ["baking soda", "bicarbonate of soda", "bicarb"], 0.9, [0, 0, 0, 0], { container: "jar", containerSize: 100 }),
  I("cornstarch", "Cornstarch", "granular", ["cornstarch", "corn flour", "cornflour"], 0.6, [381, 0.3, 91, 0.1], { container: "bag", containerSize: 250 }),
  I("cocoa", "Cocoa Powder", "granular", ["cocoa", "cocoa powder", "dutch cocoa", "cacao"], 0.35, [228, 20, 58, 14], { container: "tub", containerSize: 250 }),
  I("rice", "Rice", "granular", ["rice", "white rice", "basmati rice", "long grain rice", "jasmine rice", "arborio rice", "risotto rice"], 0.77, [365, 7, 80, 0.7], { container: "bag", containerSize: 1000 }),
  I("pasta", "Pasta", "granular", ["pasta", "spaghetti", "penne", "fusilli", "macaroni", "noodles"], 0.5, [371, 13, 75, 1.5], { container: "bag", containerSize: 500 }),
  I("oats", "Oats", "granular", ["oats", "rolled oats", "porridge oats", "oatmeal"], 0.375, [389, 17, 66, 7], { container: "bag", containerSize: 1000 }),
  I("breadcrumbs", "Breadcrumbs", "granular", ["breadcrumbs", "bread crumbs", "panko"], 0.467, [395, 13, 72, 5], { container: "bag", containerSize: 250 }),
  I("semolina", "Semolina", "granular", ["semolina", "semolina flour", "durum wheat", "rava", "sooji", "suji", "rava sooji", "upma rava"], 0.7, [360, 12.7, 73, 1.1], { container: "bag", containerSize: 500 }),
  I("cornmeal", "Cornmeal", "granular", ["cornmeal", "polenta", "yellow cornmeal"], 0.6, [370, 8, 79, 1.8], { container: "bag", containerSize: 500 }),
  I("sesame_seeds", "Sesame Seeds", "nut", ["sesame seeds", "sesame seed"], 0.6, [573, 18, 23, 50], { container: "jar", containerSize: 100 }),
  I("chia_seeds", "Chia Seeds", "nut", ["chia seeds", "chia"], 0.6, [486, 17, 42, 31], { container: "bag", containerSize: 250 }),
  I("gelatin", "Gelatin", "granular", ["gelatin", "gelatine", "gelatin sheets"], 0.7, [335, 86, 0, 0], { counts: { sheet: 2.5 }, container: "pack", containerSize: 20 }),
  I("vanilla", "Vanilla Extract", "liquid", ["vanilla", "vanilla extract", "vanilla essence"], 1, [288, 0.1, 13, 0.1], { container: "bottle", containerSize: 100 }),
  I("yeast", "Yeast", "granular", ["yeast", "dried yeast", "active dry yeast", "instant yeast", "fast action yeast"], 0.6, [325, 40, 41, 7.6], { counts: { sachet: 7, packet: 7 }, container: "pack", containerSize: 7 }),

  /* ---------------- Nuts / seeds ---------------- */
  I("almonds", "Almonds", "nut", ["almonds", "almond", "flaked almonds", "sliced almonds"], 0.6, [579, 21, 22, 50], { container: "bag", containerSize: 200 }),
  I("walnuts", "Walnuts", "nut", ["walnuts", "walnut", "walnut halves"], 0.49, [654, 15, 14, 65], { container: "bag", containerSize: 200 }),
  I("cashews", "Cashews", "nut", ["cashews", "cashew", "cashew nuts"], 0.6, [553, 18, 30, 44], { container: "bag", containerSize: 200 }),
  I("peanuts", "Peanuts", "nut", ["peanuts", "peanut", "roasted peanuts"], 0.6, [567, 26, 16, 49], { container: "bag", containerSize: 250 }),
  I("pine_nuts", "Pine Nuts", "nut", ["pine nuts", "pignoli"], 0.6, [673, 14, 13, 68], { container: "bag", containerSize: 100 }),
  I("pistachios", "Pistachios", "nut", ["pistachios", "pistachio"], 0.6, [560, 20, 28, 45], { container: "bag", containerSize: 200 }),
  I("pecans", "Pecans", "nut", ["pecans", "pecan"], 0.5, [691, 9, 14, 72], { container: "bag", containerSize: 200 }),
  I("hazelnuts", "Hazelnuts", "nut", ["hazelnuts", "hazelnut", "filberts"], 0.6, [628, 15, 17, 61], { container: "bag", containerSize: 200 }),

  /* ---------------- Spices (also used by the generic "spices" fallback) ---------------- */
  I("cumin", "Cumin", "spice", ["cumin", "ground cumin", "cumin seeds", "jeera", "jeera powder", "safed jeera", "shahi jeera"], 0.42, [375, 18, 44, 22], { container: "jar", containerSize: 50 }),
  I("paprika", "Paprika", "spice", ["paprika", "smoked paprika", "sweet paprika"], 0.4, [282, 14, 54, 13], { container: "jar", containerSize: 50 }),
  I("cinnamon", "Cinnamon", "spice", ["cinnamon", "ground cinnamon", "cinnamon stick"], 0.52, [247, 4, 81, 1.2], { container: "jar", containerSize: 50 }),
  I("turmeric", "Turmeric", "spice", ["turmeric", "ground turmeric", "haldi", "haldi powder"], 0.45, [312, 9.7, 67, 3.3], { container: "jar", containerSize: 50 }),
  I("chili_flakes", "Chili Flakes", "spice", ["chili flakes", "chilli flakes", "red pepper flakes", "crushed red pepper"], 0.36, [318, 12, 57, 17], { container: "jar", containerSize: 50 }),
  I("coriander", "Ground Coriander", "spice", ["ground coriander", "coriander powder", "coriander seeds"], 0.4, [298, 12, 55, 18], { container: "jar", containerSize: 50 }),
  I("curry_powder", "Curry Powder", "spice", ["curry powder", "garam masala"], 0.42, [325, 14, 56, 14], { container: "jar", containerSize: 50 }),
  I("nutmeg", "Nutmeg", "spice", ["nutmeg", "ground nutmeg"], 0.45, [525, 6, 49, 36], { container: "jar", containerSize: 50 }),
  I("oregano", "Dried Oregano", "spice", ["dried oregano", "oregano", "dried herbs", "mixed herbs", "italian seasoning", "herbes de provence"], 0.2, [265, 9, 69, 4.3], { container: "jar", containerSize: 30 }),
  I("garlic_powder", "Garlic Powder", "spice", ["garlic powder", "garlic granules"], 0.45, [331, 17, 73, 0.7], { container: "jar", containerSize: 50 }),
  I("onion_powder", "Onion Powder", "spice", ["onion powder"], 0.45, [341, 10, 79, 1], { container: "jar", containerSize: 50 }),
  I("saffron", "Saffron", "spice", ["saffron", "saffron threads"], 0.45, [310, 11, 65, 6], { counts: { pinch: 0.1, sachet: 1, packet: 1 }, container: "jar", containerSize: 2 }),
  I("cardamom", "Cardamom", "spice", ["cardamom", "ground cardamom", "cardamom pods"], 0.45, [311, 11, 68, 7], { container: "jar", containerSize: 50 }),
  I("cloves_spice", "Cloves", "spice", ["clove", "cloves", "ground cloves", "clove powder", "whole cloves"], 0.45, [274, 6, 66, 13], { container: "jar", containerSize: 50 }),
  I("ginger_powder", "Ground Ginger", "spice", ["ground ginger", "ginger powder"], 0.45, [335, 9, 72, 4.2], { container: "jar", containerSize: 50 }),
  I("spices", "Spices", "spice", ["spices", "spice", "seasoning", "mixed spice", "seasoning mix"], 0.45, [250, 10, 50, 5], { container: "jar", containerSize: 50 }),

  /* ---- Added from the 100-recipe online corpus (TheMealDB) ---- */
  I("shallots", "Shallots", "produce", ["shallot", "shallots", "challot", "challots", "eschalot"], 0.6, [72, 2.5, 16.8, 0.1], { piece: 30, counts: { bulb: 30 }, container: "bag", containerSize: 300 }),
  I("beetroot", "Beetroot", "produce", ["beetroot", "beet", "beets", "beetroots"], 0.75, [43, 1.6, 9.6, 0.2], { piece: 80 }),
  I("blackberries", "Blackberries", "produce", ["blackberry", "blackberries"], 0.6, [43, 1.4, 9.6, 0.5], { piece: 5, container: "punnet", containerSize: 250 }),
  I("apricot", "Apricot", "produce", ["apricot", "apricots", "dried apricots"], 0.6, [48, 1.4, 11, 0.4], { piece: 35 }),
  I("fennel", "Fennel", "produce", ["fennel", "fennel bulb", "fennel bulbs"], 0.4, [31, 1.2, 7.3, 0.2], { piece: 250, counts: { bulb: 250 }, container: "bulb", containerSize: 250 }),
  I("leek", "Leek", "produce", ["leek", "leeks"], 0.5, [61, 1.5, 14, 0.3], { piece: 150 }),
  I("pumpkin", "Pumpkin", "produce", ["pumpkin", "squash", "butternut squash"], 0.6, [26, 1, 6.5, 0.1], { piece: 1000, counts: { slice: 100 } }),
  I("bean_sprouts", "Bean Sprouts", "produce", ["bean sprouts", "beansprouts", "mung bean sprouts"], 0.3, [30, 1.7, 5.9, 0.2], { container: "bag", containerSize: 200 }),
  I("callaloo", "Callaloo", "leafy", ["callaloo", "amaranth leaves"], 0.1, [23, 2.1, 3.7, 0.5], { container: "bunch", containerSize: 200 }),
  I("puff_pastry", "Puff Pastry", "dense", ["puff pastry", "pastry", "filo pastry", "shortcrust pastry", "pie crust"], 0.4, [400, 5.7, 38, 26], { counts: { sheet: 25 }, container: "pack", containerSize: 320 }),
  I("beer", "Beer", "liquid", ["beer", "ale", "lager", "stout", "guinness", "pale ale"], 1.01, [43, 0.5, 3.6, 0], { container: "bottle", containerSize: 330 }),
  I("sherry", "Sherry", "liquid", ["sherry", "dry sherry"], 0.99, [135, 0.2, 3.2, 0], { container: "bottle", containerSize: 750 }),
  I("oyster_sauce", "Oyster Sauce", "liquid", ["oyster sauce"], 1.2, [51, 1.4, 10.2, 0.3], { container: "bottle", containerSize: 300 }),
  I("curry_paste", "Curry Paste", "liquid", ["curry paste", "red curry paste", "green curry paste", "thai curry paste"], 1.1, [100, 3, 15, 3], { container: "jar", containerSize: 100 }),
  I("plum_sauce", "Plum Sauce", "liquid", ["plum sauce", "duck sauce"], 1.25, [160, 0.5, 40, 0], { container: "jar", containerSize: 250 }),
  I("golden_syrup", "Golden Syrup", "liquid", ["golden syrup", "corn syrup", "light corn syrup", "treacle"], 1.42, [300, 0, 80, 0], { container: "jar", containerSize: 454 }),
  I("tamarind", "Tamarind Paste", "liquid", ["tamarind", "tamarind paste", "tamarind concentrate"], 1.2, [239, 2.8, 62, 0.6], { container: "jar", containerSize: 200 }),
  I("dulce_de_leche", "Dulce de Leche", "liquid", ["dulce de leche", "caramel sauce"], 1.3, [315, 6.8, 55, 7], { container: "jar", containerSize: 400 }),
  I("salsa", "Salsa", "liquid", ["salsa", "pico de gallo", "pico de gallo sauce"], 0.9, [30, 1.5, 5, 0.2], { container: "jar", containerSize: 300 }),
  I("mascarpone", "Mascarpone", "dense", ["mascarpone"], 1, [429, 4.5, 4, 44], { container: "tub", containerSize: 250 }),
  I("queso_fresco", "Queso Fresco", "dense", ["queso fresco"], 1, [299, 18, 4, 23], { container: "block", containerSize: 225 }),
  I("black_pudding", "Black Pudding", "protein", ["black pudding", "blood sausage"], 1, [379, 18, 15, 29], { piece: 30, counts: { slice: 30 }, container: "pack", containerSize: 200 }),
  I("digestive_biscuits", "Digestive Biscuits", "dense", ["digestive biscuits", "digestive biscuit", "digestives", "graham crackers"], 0.5, [480, 7, 66, 21], { piece: 15, counts: { biscuit: 15 }, container: "pack", containerSize: 300 }),
  I("meringue_nests", "Meringue Nests", "dense", ["meringue nests", "meringue nest", "meringue"], 0.3, [380, 4, 90, 0], { piece: 10, container: "pack", containerSize: 100 }),
  I("turkish_delight", "Turkish Delight", "dense", ["turkish delight", "lokum"], 0.9, [350, 0, 88, 0], { piece: 15, container: "pack", containerSize: 250 }),
  I("desiccated_coconut", "Desiccated Coconut", "nut", ["desiccated coconut", "shredded coconut", "coconut flakes", "coconut"], 0.4, [660, 7, 24, 65], { container: "bag", containerSize: 200 }),
  I("shortening", "Shortening", "fat", ["shortening", "vegetable shortening"], 0.9, [884, 0, 0, 100], { counts: { stick: 113 }, container: "pack", containerSize: 450 }),
  I("lard", "Lard", "fat", ["lard", "pig fat"], 0.9, [902, 0, 0, 100], { container: "jar", containerSize: 400 }),
  I("star_anise", "Star Anise", "spice", ["star anise", "anise", "aniseed"], 0.35, [337, 18, 50, 16], { piece: 1, counts: { pod: 1 }, container: "jar", containerSize: 30 }),
  I("caraway", "Caraway Seeds", "spice", ["caraway", "caraway seed", "caraway seeds"], 0.45, [333, 20, 50, 15], { container: "jar", containerSize: 50 }),
  I("aleppo_pepper", "Aleppo Pepper", "spice", ["aleppo pepper", "pul biber"], 0.4, [250, 12, 45, 10], { container: "jar", containerSize: 50 }),
  I("chili_powder", "Chili Powder", "spice", ["chili powder", "chilli powder"], 0.4, [282, 13, 50, 14], { container: "jar", containerSize: 50 }),
  I("five_spice", "Five Spice", "spice", ["five spice", "five-spice powder", "chinese five spice"], 0.4, [300, 10, 60, 5], { container: "jar", containerSize: 30 }),
  I("mixed_peel", "Mixed Peel", "dense", ["mixed peel", "candied peel"], 0.6, [320, 0.5, 80, 0.2], { container: "pack", containerSize: 200 }),
  I("marzipan", "Marzipan", "dense", ["marzipan"], 1, [450, 7, 60, 20], { container: "pack", containerSize: 250 }),
  I("mincemeat", "Mincemeat", "dense", ["mincemeat"], 1, [300, 1, 65, 6], { container: "jar", containerSize: 400 }),
  /* ---- third pass: leftovers found in the 100-recipe corpus ---- */
  I("white_beans", "White Beans", "dense", ["white beans", "cannellini beans", "butter beans", "haricot beans"], 0.75, [139, 9.7, 25, 0.4], { container: "can", containerSize: 400 }),
  I("squid", "Squid", "protein", ["squid", "calamari"], 1, [92, 15.6, 3.1, 1.4], { piece: 150 }),
  I("hummus", "Hummus", "dense", ["hummus", "houmous"], 1, [166, 7.9, 14.3, 9.6], { container: "tub", containerSize: 200 }),
  I("couscous", "Couscous", "granular", ["couscous"], 0.6, [376, 12.8, 77, 0.6], { container: "bag", containerSize: 500 }),
  I("tapioca", "Tapioca", "granular", ["tapioca", "tapioca pearls", "sago"], 0.6, [358, 0.2, 88, 0.02], { container: "bag", containerSize: 500 }),
  I("tortillas", "Tortillas", "dense", ["tortillas", "tortilla", "wraps", "flatbread"], 0.5, [306, 8, 51, 8], { piece: 45, container: "pack", containerSize: 320 }),
  I("sorrel", "Sorrel", "leafy", ["sorrel"], 0.1, [22, 2, 3.2, 0.7], { container: "bag", containerSize: 100 }),
  I("brie", "Brie", "dense", ["brie", "camembert"], 1, [334, 20.7, 0.5, 27.7], { container: "block", containerSize: 200 }),
  I("yuca", "Yuca", "produce", ["yuca", "cassava", "manioc"], 0.7, [160, 1.4, 38, 0.3], { piece: 500 }),
  I("jam", "Jam", "liquid", ["jam", "raspberry jam", "strawberry jam", "marmalade", "fruit preserve", "sorrel jam"], 1.35, [250, 0.4, 60, 0.1], { container: "jar", containerSize: 340 }),
  I("ricotta", "Ricotta", "dense", ["ricotta", "ricotta cheese"], 1, [174, 11, 3, 13], { container: "tub", containerSize: 250 }),
  I("raspberries", "Raspberries", "produce", ["raspberry", "raspberries"], 0.6, [52, 1.2, 12, 0.7], { piece: 4, container: "punnet", containerSize: 250 }),
  I("daikon", "Daikon Radish", "produce", ["daikon", "daikon radish", "white radish", "mooli"], 0.7, [18, 0.6, 4.1, 0.1], { piece: 500 }),
  I("radish", "Radish", "produce", ["radish", "radishes", "red radish"], 0.7, [16, 0.7, 3.4, 0.1], { piece: 15 }),
  I("oxtail", "Oxtail", "protein", ["oxtail", "pigs trotters", "pig trotters"], 1, [262, 30, 0, 15], { piece: 300 }),
  I("celeriac", "Celeriac", "produce", ["celeriac", "celery root"], 0.7, [42, 1.5, 9.2, 0.3], { piece: 600 }),
  I("swede", "Swede", "produce", ["swede", "rutabaga", "turnip"], 0.7, [37, 1.1, 8.6, 0.2], { piece: 700 }),
  I("prunes", "Prunes", "produce", ["prunes", "prune", "dried plums"], 0.7, [240, 2.2, 64, 0.4], { piece: 8, container: "bag", containerSize: 250 }),
  I("sauerkraut", "Sauerkraut", "produce", ["sauerkraut"], 0.9, [19, 0.9, 4.3, 0.1], { container: "jar", containerSize: 500 }),
  I("marjoram", "Marjoram", "spice", ["marjoram", "dried marjoram"], 0.2, [271, 12.7, 60.6, 7], { container: "jar", containerSize: 30 }),
  I("allspice", "Allspice", "spice", ["allspice", "allspice berries", "pimento"], 0.45, [263, 6.1, 72, 8.7], { container: "jar", containerSize: 50 }),
  I("juniper", "Juniper Berries", "spice", ["juniper berries", "juniper"], 0.5, [260, 4, 60, 7], { container: "jar", containerSize: 50 }),
  I("suet", "Suet", "fat", ["suet", "beef suet"], 0.9, [854, 1.5, 0, 94], { container: "pack", containerSize: 250 }),
  I("goose_fat", "Goose Fat", "fat", ["goose fat", "duck fat"], 0.9, [900, 0, 0, 100], { container: "jar", containerSize: 320 }),
  I("oysters", "Oysters", "protein", ["oysters", "oyster"], 1, [81, 9.5, 4.9, 2.3], { piece: 15, container: "jar", containerSize: 100 }),
  I("parma_ham", "Parma Ham", "protein", ["parma ham", "prosciutto", "serrano ham", "cured ham"], 1, [245, 26, 0, 15], { counts: { slice: 15 }, piece: 15 }),
  I("kielbasa", "Kielbasa", "protein", ["kielbasa", "polish sausage", "smoked sausage"], 1, [301, 13, 2, 27], { piece: 80 }),
  I("buckwheat", "Buckwheat", "granular", ["buckwheat", "buckwheat flour", "kasha"], 0.6, [343, 13.2, 71.5, 3.4], { container: "bag", containerSize: 500 }),
  I("barramundi", "Barramundi", "protein", ["barramundi", "sea bass", "bass fillet"], 1, [97, 20, 0, 2], { piece: 150, counts: { fillet: 150 } }),
  I("scotch_bonnet", "Scotch Bonnet", "produce", ["scotch bonnet", "habanero", "birds eye chilli"], 0.7, [40, 1.9, 8.8, 0.4], { piece: 12 }),
  I("barbecue_sauce", "Barbecue Sauce", "liquid", ["barbecue sauce", "barbeque sauce", "bbq sauce"], 1.2, [130, 0.8, 32, 0.6], { container: "bottle", containerSize: 400 }),
  I("bouquet_garni", "Bouquet Garni", "herb", ["bouquet garni"], 0.1, [30, 3, 4, 0.6], { container: "pack", containerSize: 20 }),
  I("food_colouring", "Food Colouring", "liquid", ["food colouring", "food coloring", "gel colouring"], 1, [0, 0, 0, 0], { container: "bottle", containerSize: 30 }),
  I("starch", "Starch", "granular", ["starch", "potato starch", "tapioca starch"], 0.6, [381, 0.3, 91, 0.1], { container: "bag", containerSize: 250 }),
  I("chimichurri", "Chimichurri", "liquid", ["chimichurri", "chimichurri sauce"], 0.95, [300, 2, 5, 31], { container: "jar", containerSize: 250 }),
  I("mixed_berries", "Mixed Berries", "produce", ["mixed berries", "frozen mixed berries", "frozen berries"], 0.6, [50, 1, 12, 0.4], { container: "bag", containerSize: 300 }),
  I("sirop_de_liege", "Sirop de Liege", "liquid", ["sirop de liege", "sirop de liège", "apple syrup", "pear syrup"], 1.35, [300, 0.2, 73, 0], { container: "jar", containerSize: 500 }),
  I("ham", "Ham", "protein", ["ham", "cooked ham", "turkey ham", "gammon"], 1, [145, 21, 1.5, 6], { counts: { slice: 28 }, piece: 28 }),
  I("brandy", "Brandy", "liquid", ["brandy", "cognac", "rum", "whisky", "bourbon", "vodka", "gin"], 0.94, [231, 0, 0, 0], { container: "bottle", containerSize: 700 }),
  I("clams", "Clams", "protein", ["clams", "clam", "cockles"], 1, [148, 25, 5, 2], { piece: 15, container: "can", containerSize: 400 }),
  I("quinoa", "Quinoa", "granular", ["quinoa"], 0.72, [368, 14, 64, 6], { container: "bag", containerSize: 500 }),
  I("poppy_seeds", "Poppy Seeds", "nut", ["poppy seeds", "poppy seed"], 0.55, [525, 18, 28, 42], { container: "jar", containerSize: 100 }),
  I("sake", "Sake", "liquid", ["sake", "rice wine"], 1, [134, 0.5, 5, 0], { container: "bottle", containerSize: 720 }),
  I("fenugreek", "Fenugreek", "spice", ["fenugreek", "methi"], 0.4, [323, 23, 58, 6.4], { container: "jar", containerSize: 50 }),
  I("lobster", "Lobster", "protein", ["lobster", "langoustine"], 1, [89, 19, 0, 0.9], { piece: 500 }),
  I("phyllo", "Phyllo Pastry", "dense", ["phyllo dough", "phyllo pastry", "filo dough", "fillo pastry"], 0.4, [400, 8, 60, 14], { counts: { sheet: 20 }, container: "pack", containerSize: 270 }),
  I("coffee", "Coffee", "liquid", ["coffee", "espresso", "strong coffee", "brewed coffee"], 1, [2, 0.1, 0, 0], { container: "pack", containerSize: 250 }),
  I("pickle_juice", "Pickle Juice", "liquid", ["pickle juice", "gherkin juice"], 1, [20, 0.5, 3, 0.2], { container: "jar", containerSize: 500 }),
  I("christmas_pudding", "Christmas Pudding", "dense", ["christmas pudding", "plum pudding"], 1, [330, 3.5, 60, 9], { piece: 454, counts: { slice: 80 }, container: "pack", containerSize: 454 }),
  /* ---------------- South Asian staples ---------------- */
  I("atta", "Atta (Whole Wheat Flour)", "granular", ["atta", "whole wheat flour", "wholemeal flour", "chakki atta", "gehun atta", "aata", "wheat atta"], 0.5, [340, 13.2, 72, 2.5], { container: "bag", containerSize: 1000 }),
  I("besan", "Besan (Gram Flour)", "granular", ["besan", "gram flour", "chickpea flour", "chana flour", "bengal gram flour"], 0.38, [387, 22, 58, 6.7], { container: "bag", containerSize: 500 }),
  I("maida", "Maida (Refined Flour)", "granular", ["maida", "maida flour", "refined flour", "bakery flour"], 0.52, [364, 10, 76, 1], { container: "bag", containerSize: 1000 }),
  I("ghee", "Ghee", "fat", ["ghee", "clarified butter", "desi ghee", "pure ghee"], 0.91, [900, 0, 0, 100], { container: "jar", containerSize: 500 }),
  I("paneer", "Paneer", "dense", ["paneer", "panir", "indian cottage cheese"], 1, [265, 18.3, 1.2, 20.8], { piece: 20, container: "pack", containerSize: 200 }),
  I("curd", "Curd (Dahi)", "liquid", ["curd", "dahi", "indian yogurt", "indian curd", "fresh curd"], 1.03, [61, 3.5, 4.7, 3.3], { container: "tub", containerSize: 400 }),
  I("toor_dal", "Toor Dal", "dense", ["toor dal", "tur dal", "arhar dal", "toovar dal", "split pigeon peas", "pigeon peas"], 0.83, [343, 22, 63, 1.5], { container: "bag", containerSize: 500 }),
  I("moong_dal", "Moong Dal", "dense", ["moong dal", "mung dal", "moong beans", "mung beans", "green gram", "green gram dal"], 0.86, [347, 24, 63, 1.2], { container: "bag", containerSize: 500 }),
  I("masoor_dal", "Masoor Dal", "dense", ["masoor dal", "masoor", "pink lentils", "split red lentils"], 0.8, [352, 25, 63, 1.1], { container: "bag", containerSize: 500 }),
  I("chana_dal", "Chana Dal", "dense", ["chana dal", "channa dal", "bengal gram", "split chickpeas", "split bengal gram"], 0.83, [360, 20, 60, 5], { container: "bag", containerSize: 500 }),
  I("urad_dal", "Urad Dal", "dense", ["urad dal", "urad", "udad dal", "black gram", "white urad dal", "split black gram"], 0.82, [341, 25, 59, 1.4], { container: "bag", containerSize: 500 }),
  I("hing", "Hing (Asafoetida)", "spice", ["hing", "asafoetida", "asafetida", "heeng"], 0.5, [297, 4, 68, 1], { container: "jar", containerSize: 50 }),
  I("amchur", "Amchur (Mango Powder)", "spice", ["amchur", "aamchur", "amchoor", "dried mango powder", "mango powder"], 0.5, [320, 3, 78, 1], { container: "jar", containerSize: 50 }),
  I("chaat_masala", "Chaat Masala", "spice", ["chaat masala", "chat masala", "chat masala powder"], 0.5, [250, 8, 50, 5], { container: "jar", containerSize: 50 }),
  I("curry_leaves", "Curry Leaves", "herb", ["curry leaves", "curry leaf", "kadi patta", "meetha neem", "sweet neem leaves"], 0.1, [108, 6.1, 18.7, 1], { counts: { leaf: 0.2, sprig: 2 }, container: "bunch", containerSize: 30 }),
  I("kasuri_methi", "Kasuri Methi", "spice", ["kasuri methi", "kasoori methi", "dried fenugreek leaves", "sukhi methi"], 0.25, [323, 23, 58, 6.4], { container: "jar", containerSize: 50 }),
  I("poha", "Poha (Flattened Rice)", "granular", ["poha", "flattened rice", "beaten rice", "chivda", "aval"], 0.3, [350, 7, 77, 1], { container: "bag", containerSize: 500 }),
  I("jaggery", "Jaggery", "granular", ["jaggery", "gur", "jaggery powder", "gud", "organic jaggery"], 0.83, [383, 0.4, 98, 0.1], { piece: 20, container: "jar", containerSize: 500 }),
  I("green_chili", "Green Chili", "produce", ["green chili", "green chilli", "green chilies", "green chillies", "hari mirch", "thai green chili", "green chili pepper"], 0.7, [40, 2, 9, 0.2], { piece: 5 })
]);

/* --------------------------------------------------------------------------
 * Preparation / noise vocabulary
 * ------------------------------------------------------------------------ */

/** Multi-word directives that mean "amount is not a measurement". */
const VAGUE_DIRECTIVES = /\b(?:to taste|as needed|to serve|for garnish|for serving|for dusting|optional)\b/g;

/** Vocabulary that marks a comma segment as preparation rather than an item. */
const PREP_SEGMENT_RE = /^(?:peel(?:ed)?|chop(?:ped|s)?|dice(?:d)?|minc(?:ed)?|slice(?:d)?|grat(?:ed)?|shred(?:ded)?|crush(?:ed)?|crumbl(?:ed)?|mash(?:ed)?|pound(?:ed)?|break|broken|beat(?:en)?|whisk(?:ed)?|melt(?:ed)?|soften(?:ed)?|squeez(?:ed)?|drain(?:ed)?|rins(?:ed)?|wash(?:ed)?|trim(?:med)?|halv(?:ed)?|quarter(?:ed)?|cub(?:ed)?|julienned|torn|deseeded|seeded|cored|zested|juiced|thawed|warmed|warm|chilled|cooled|heated|sprinkling|brushing|finely|roughly|thinly|coarsely|freshly|optional|divided|plus|for|to taste|as needed|room temperature|at room temperature|packed|heaped|level|sifted|cut|about|with|inch|inches|heaping|ribs|ear)\b/;

/** Tokens that can be stripped from the edges of a name. */
const PREP_WORDS = Object.freeze([
  "peeled", "peel", "chopped", "chop", "diced", "dice", "minced", "mince", "sliced", "slice",
  "grated", "grate", "shredded", "shred", "crushed", "crush", "beaten", "whisked", "melted",
  "softened", "drained", "rinsed", "washed", "trimmed", "halved", "quartered", "cubed",
  "julienned", "torn", "deseeded", "seeded", "cored", "zested", "juiced", "thawed",
  "finely", "roughly", "thinly", "coarsely", "freshly", "fresh", "large", "medium", "small",
  "ripe", "boneless", "skinless", "very", "well", "packed", "heaped", "level", "sifted",
  "cooked", "uncooked", "raw", "plus", "extra", "more", "each", "about", "approx",
  "room", "temperature", "at", "cold", "warm", "hot", "boiling", "of",
  "crumbled", "mashed", "pounded", "broken", "squeezed", "dried", "patted", "to",
  "taste", "as", "needed", "for", "serving", "garnish", "divided", "optional", "a", "an",
  "warmed", "warm", "chilled", "cooled", "heated", "inches", "inch", "cm",
  "heaping", "heaped", "level", "rounded", "scant", "ribs", "ear", "ears", "sprinkling", "brushing",
]);

const PREP_PHRASES = Object.freeze([
  "at room temperature", "room temperature", "drained and rinsed", "finely chopped",
  "roughly chopped", "finely diced", "thinly sliced", "roughly torn", "freshly ground",
  "freshly grated", "finely grated", "plus more for serving", "plus extra for dusting",
  "to taste", "as needed", "to serve", "for serving", "for garnish", "for dusting",
  "cut into chunks", "cut into cubes", "cut into pieces",
]);

/** Number words and informal count words. */
const NUM_WORDS = Object.freeze({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  half: 0.5, quarter: 0.25, third: 1 / 3, dozen: 12, couple: 2, few: 3, several: 3, pair: 2,
});

/* --------------------------------------------------------------------------
 * Indexes (built once at load time; Map lookups keep parsing O(words))
 * ------------------------------------------------------------------------ */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build `^(alias|alias|...)` anchored regex, longest aliases first. */
function buildAliasRegex(entries) {
  const aliases = [];
  for (const entry of entries) aliases.push(...entry.aliases, entry.id);
  const sorted = [...new Set(aliases)]
    .sort((a, b) => b.length - a.length)
    .map((a) => escapeRegExp(a).replace(/\\ /g, "\\s+"));
  return new RegExp(`^(?:${sorted.join("|")})(?:\\.|\\b)`, "i");
}

const UNIT_REGEX = buildAliasRegex(UNITS);
const MEASURE_REGEX = buildAliasRegex(MEASURES);
const UNIT_BY_ALIAS = new Map();
const MEASURE_BY_ALIAS = new Map();
const EXACT_UNIT_ALIAS = new Map();
const EXACT_MEASURE_ALIAS = new Map();

for (const unit of UNITS) for (const alias of [...unit.aliases, unit.id]) EXACT_UNIT_ALIAS.set(alias, unit);
for (const measure of MEASURES) for (const alias of [...measure.aliases, measure.id]) EXACT_MEASURE_ALIAS.set(alias, measure);

/** Pluralise a lowercase English word well enough for our vocabularies. */
function pluralize(word) {
  if (!word) return word;
  if (singularize(word) !== word) return word; // already plural
  const irregular = {
    loaf: "loaves", leaf: "leaves", half: "halves", knife: "knives",
    potato: "potatoes", tomato: "tomatoes", mango: "mangoes", hero: "heroes",
    fish: "fish", sheep: "sheep", garlic: "garlic", rice: "rice",
    celery: "celery", spinach: "spinach", broccoli: "broccoli", corn: "corn",
    asparagus: "asparagus", salmon: "salmon",
  };
  if (irregular[word]) return irregular[word];
  if (/(?:s|x|z|ch|sh)$/.test(word)) return word + "es";
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

/** Pluralise the head noun of a display name, avoiding double plurals. */
function pluralizeName(name) {
  const words = String(name || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const last = words[words.length - 1];
  if (singularize(last) !== last) return words.join(" ");
  words[words.length - 1] = pluralize(last);
  return words.join(" ");
}

function singularize(word) {
  if (/ies$/.test(word) && word.length > 4) return word.slice(0, -3) + "y";
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/(?:ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Alias -> ingredient lookup table, with automatic plural forms. */
const ALIAS_TO_INGREDIENT = new Map();
function registerAlias(alias, ingredient) {
  if (!alias) return;
  const key = alias.toLowerCase().trim();
  if (!key) return;
  if (!ALIAS_TO_INGREDIENT.has(key)) ALIAS_TO_INGREDIENT.set(key, ingredient);
  const plural = pluralize(key);
  if (!ALIAS_TO_INGREDIENT.has(plural)) ALIAS_TO_INGREDIENT.set(plural, ingredient);
}

/**
 * Typo tolerance: one edit (insert/delete/substitute) against a single-word
 * alias. Real recipe data is full of "cardomom", "challots", "tobasco".
 * Only used when the exact token lookup found nothing, and cached per token.
 */
const FUZZY_CACHE = new Map();
let FUZZY_ALIASES = null;

function withinOneEdit(a, b) {
  if (a === b) return true;
  // adjacent transposition ("hazlenuts" -> "hazelnuts")
  if (a.length === b.length) {
    for (let k = 0; k + 1 < a.length; k++) {
      if (a[k] !== b[k]) {
        if (a[k] === b[k + 1] && a[k + 1] === b[k] && a.slice(k + 2) === b.slice(k + 2) && a.slice(0, k) === b.slice(0, k)) return true;
        break;
      }
    }
  }
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

function fuzzyAlias(word) {
  if (!word || word.length < 5 || word.includes(" ")) return null;
  if (FUZZY_CACHE.has(word)) return FUZZY_CACHE.get(word);
  // Correct the singular form: otherwise "beans" is one insertion away from
  // the auto-plural "besans", and a real word becomes a loanword.
  const probe = word.endsWith("s") ? singularize(word) : word;
  if (probe.length < 5) {
    FUZZY_CACHE.set(word, null);
    return null;
  }
  if (!FUZZY_ALIASES) FUZZY_ALIASES = [...ALIAS_TO_INGREDIENT.keys()].filter((alias) => alias.length >= 5 && !alias.includes(" "));
  let hit = null;
  for (const alias of FUZZY_ALIASES) {
    if (Math.abs(alias.length - probe.length) > 1) continue;
    if (withinOneEdit(probe, alias)) {
      hit = ALIAS_TO_INGREDIENT.get(alias);
      break;
    }
  }
  FUZZY_CACHE.set(word, hit);
  return hit;
}

for (const ingredient of INGREDIENTS) {
  registerAlias(ingredient.name.toLowerCase(), ingredient);
  registerAlias(ingredient.name.toLowerCase().replace(/-/g, " "), ingredient);
  for (const alias of ingredient.aliases) registerAlias(alias, ingredient);
}

/* ==========================================================================
 * SECTION 2 - LAYER 1: UNICODE / FRACTION NORMALISER + TOKENIZER
 * ========================================================================== */

/**
 * Normalise an ingredient line into the canonical surface form the grammar
 * understands: lowercase, ASCII fractions, ASCII dashes, single spaces.
 *
 *   "2½ cups flour"      -> "2 1/2 cups flour"
 *   "1–2 cloves garlic"  -> "1-2 cloves garlic"
 *   "Juice of 1 lemon."  -> "juice of 1 lemon"
 */
export function normalizeText(input) {
  let s = String(input == null ? "" : input);

  // 1. "2½" -> "2 1/2" (digit glued to a vulgar fraction is a mixed number)
  s = s.replace(new RegExp(`(\\d)\\s*([${FRACTION_CLASS}])`, "g"), (_m, digit, frac) => `${digit} ${FRACTION_CHARS[frac]}`);

  // 2. Remaining vulgar fractions -> ASCII fractions.
  s = s.replace(new RegExp(`[${FRACTION_CLASS}]`, "g"), (frac) => ` ${FRACTION_CHARS[frac]} `);

  // 3. Typographic punctuation -> ASCII.
  s = s
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212\u2043]/g, "-")
    .replace(/\u2044/g, "/")
    .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, " ");

  // 4. Compatibility normalisation (ligatures, superscripts, full-width digits).
  try {
    s = s.normalize("NFKC");
  } catch (_err) {
    /* very old engines: the regexes above already handled the important cases */
  }

  // 5. Strip diacritics (real data has "Liège", "jalapeño", "crème").
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 6. Lowercase, tidy spacing around slashes, collapse, trim trailing punctuation.
  s = s
    .replace(/^[\s/|•*+·-]+/, "")
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]+$/g, "")
    .trim();

  return s;
}

const TOKEN_RE = /(\d+\s+\d+\s*\/\s*\d+)|(\d+\s*\/\s*\d+)|(\d+(?:\.\d+)?)|([a-z]+)|([^\s])/gi;

/**
 * Tokenizer. Produces the flat token stream used for name resolution.
 *   tokenize("3 cloves of garlic, minced")
 *   -> [{type:"number",value:3}, {type:"word",value:"cloves"}, ...]
 */
export function tokenize(input) {
  const text = normalizeText(input);
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1] !== undefined) tokens.push({ type: "number", value: evalFractionToken(m[1]), raw: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: "fraction", value: evalFractionToken(m[2]), raw: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: "number", value: parseFloat(m[3]), raw: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: "word", value: m[4], raw: m[4] });
    else tokens.push({ type: "punct", value: m[5], raw: m[5] });
  }
  return tokens;
}

function evalFractionToken(text) {
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const simple = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (simple) return Number(simple[1]) / (Number(simple[2]) || 1);
  return parseFloat(text);
}

/* ==========================================================================
 * SECTION 3 - LAYER 1: NUMERAL AST (quantity grammar)
 * ========================================================================== */

/**
 * Read one numeral atom at the start of `text`.
 * Supports mixed fractions ("1 1/2"), slash fractions ("3/4"), decimals and
 * number words ("a", "two", "half", "a couple"...).
 */
function readNumberAtom(text) {
  let m;
  if ((m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(text))) {
    return { value: Number(m[1]) + Number(m[2]) / (Number(m[3]) || 1), length: m[0].length, kind: "mixed" };
  }
  if ((m = /^(\d+)\s*\/\s*(\d+)/.exec(text))) {
    return { value: Number(m[1]) / (Number(m[2]) || 1), length: m[0].length, kind: "fraction" };
  }
  if ((m = /^(\d+(?:\.\d+)?)/.exec(text))) {
    return { value: parseFloat(m[1]), length: m[0].length, kind: "decimal" };
  }
  if ((m = /^([a-z]+)/.exec(text))) {
    const word = m[1];
    if (Object.prototype.hasOwnProperty.call(NUM_WORDS, word)) {
      return {
        value: NUM_WORDS[word],
        length: word.length,
        kind: "word",
        word,
        article: word === "a" || word === "an",
      };
    }
  }
  return null;
}

/**
 * Parse the quantity prefix and return a small AST node:
 *   { value, min, max, isRange, approximate, article, pos }
 * `pos` is how many characters of the input were consumed.
 */
export function parseQuantityPrefix(input) {
  const text = String(input == null ? "" : input);
  let pos = 0;
  const rest = () => text.slice(pos);
  const skipWs = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };

  skipWs();
  let approximate = false;
  const approxMatch = /^(?:~|≈|about|approximately|approx\.?|around|roughly|circa|nearly|almost|just over|just under)\s*/.exec(rest());
  if (approxMatch) {
    approximate = true;
    pos += approxMatch[0].length;
    skipWs();
  }

  const first = readNumberAtom(rest());
  if (!first) return null;
  pos += first.length;

  let value = first.value;
  let min = first.value;
  let max = first.value;
  let isRange = false;

  const rangeMatch = /^\s*(?:-|to|or|until)\s*/.exec(rest());
  if (rangeMatch) {
    const second = readNumberAtom(rest().slice(rangeMatch[0].length));
    if (second) {
      const isHyphen = /^-/.test(rangeMatch[0].trim());
      if (isHyphen && second.kind === "fraction" && first.kind === "decimal" && Number.isInteger(first.value)) {
        // "1-1/2" is a mixed number, not a range.
        value = first.value + second.value;
        min = value;
        max = value;
      } else {
        isRange = true;
        min = Math.min(first.value, second.value);
        max = Math.max(first.value, second.value);
        value = (min + max) / 2;
      }
      pos += rangeMatch[0].length + second.length;
    }
  }

  skipWs();
  return { value, min, max, isRange, approximate, article: Boolean(first.article), pos };
}

/**
 * Match a SI/imperial/cooking unit or a fuzzy measure at the start of `text`.
 * Returns { type, pos, unit? , measure? } or null.
 */
function parseUnitPrefix(text) {
  const unitMatch = UNIT_REGEX.exec(text);
  if (unitMatch) {
    const raw = unitMatch[0].replace(/\.$/, "").trim();
    const unit = EXACT_UNIT_ALIAS.get(raw);
    if (unit) return { type: "unit", unit, pos: unitMatch[0].length };
  }
  const measureMatch = MEASURE_REGEX.exec(text);
  if (measureMatch) {
    const raw = measureMatch[0].replace(/\.$/, "").trim();
    const measure = EXACT_MEASURE_ALIAS.get(raw);
    if (measure) return { type: "measure", measure, pos: measureMatch[0].length };
  }
  return null;
}

/* ==========================================================================
 * SECTION 4 - LAYER 2: INGREDIENT + PREPARATION RESOLUTION
 * ========================================================================== */

function round1(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10) / 10;
}

/** Amounts below 10 keep two decimals so 0.5 g / 0.75 g stay exact. */
function roundAmount(n) {
  const value = Number(n);
  return Math.abs(value) < 10 ? round2(value) : round1(value);
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

const SMALL_WORDS = new Set(["of", "and", "the", "a", "an", "in", "on", "with", "for", "to", "at"]);

/** Title Case with hyphen support: "all-purpose flour" -> "All-Purpose Flour". */
function titleCase(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

/** Guess a category for an ingredient that is not in the taxonomy. */
function inferCategory(name) {
  const s = String(name).toLowerCase();
  if (/\b(juice|sauce|oil|vinegar|stock|broth|wine|milk|water|syrup|extract|soda|tea|coffee|liqueur)\b/.test(s)) return "liquid";
  if (/\b(leaves|leaf|greens|spinach|kale|lettuce|arugula|rocket|chard|cabbage)\b/.test(s)) return "leafy";
  if (/\b(powder|flour|sugar|salt|rice|grain|seed|starch|ground|cumin|paprika|spice)\b/.test(s)) return "granular";
  if (/\b(cheese|butter|tofu|beef|pork|chicken|fish|salmon|lamb|turkey|bacon|sausage|egg)\b/.test(s)) return "dense";
  if (/\b(nuts?|almonds?|walnuts?|cashews?|peanuts?|pistachios?|pecans?)\b/.test(s)) return "nut";
  if (/\b(herbs?|basil|parsley|cilantro|mint|thyme|rosemary|dill)\b/.test(s)) return "herb";
  if (/\b(onions?|carrots?|potatoes?|tomatoes?|peppers?|cucumber|zucchini|mushrooms?|garlic|ginger|lemons?|limes?)\b/.test(s)) return "produce";
  return "other";
}

/** Remove preparation vocabulary from both edges of a phrase. */
function stripEdgePrep(text) {
  let s = String(text || "").trim();
  const removed = [];
  if (!s) return { rest: "", removed, changed: false };
  let changed = false;

  // Multi-word phrases first ("room temperature", "finely chopped", ...).
  for (let guard = 0; guard < 12; guard++) {
    let hit = false;
    for (const phrase of PREP_PHRASES) {
      if (s === phrase) {
        removed.push(phrase);
        s = "";
        hit = changed = true;
        break;
      }
      if (s.startsWith(phrase + " ")) {
        removed.push(phrase);
        s = s.slice(phrase.length + 1).trim();
        hit = changed = true;
        break;
      }
      if (s.endsWith(" " + phrase)) {
        removed.push(phrase);
        s = s.slice(0, -(phrase.length + 1)).trim();
        hit = changed = true;
        break;
      }
    }
    if (!hit) break;
  }

  // Single prep tokens at the edges.
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && PREP_WORDS.includes(tokens[0].toLowerCase())) {
    removed.push(tokens.shift());
    changed = true;
  }
  while (tokens.length > 0 && PREP_WORDS.includes(tokens[tokens.length - 1].toLowerCase())) {
    removed.push(tokens.pop());
    changed = true;
  }

  return { rest: tokens.join(" "), removed: removed.filter(Boolean), changed };
}

/**
 * Longest-match ingredient lookup over the token stream.
 * Returns { ingredient, before: string[], after: string[] }.
 */
export function resolveIngredientIn(text) {
  const words = tokenize(text)
    .filter((t) => t.type === "word" || t.type === "number")
    .map((t) => String(t.value).toLowerCase());

  if (words.length === 0) return { ingredient: null, before: [], after: [] };

  for (let span = Math.min(4, words.length); span >= 1; span--) {
    for (let start = 0; start + span <= words.length; start++) {
      const phrase = words.slice(start, start + span).join(" ");
      const hit = ALIAS_TO_INGREDIENT.get(phrase) || (span === 1 ? ALIAS_TO_INGREDIENT.get(singularize(phrase)) || fuzzyAlias(phrase) : null);
      if (hit) {
        return {
          ingredient: hit,
          before: words.slice(0, start),
          after: words.slice(start + span),
        };
      }
    }
  }
  return { ingredient: null, before: [], after: words };
}

/** Decide whether a comma segment is preparation noise instead of an item. */
function isPrepSegment(segment) {
  const s = String(segment || "").trim().toLowerCase();
  if (!s) return false;
  if (/^(?:and|or|plus)\b/.test(s)) return true;
  return PREP_SEGMENT_RE.test(s);
}

/**
 * Split the remaining text into item components plus preparation notes.
 *   "garlic, minced"                 -> components ["garlic"], prep ["minced"]
 *   "salt and pepper"                -> components ["salt", "pepper"]
 *   "tomatoes, basil and oregano"    -> components ["tomatoes", "basil", "oregano"]
 */
function splitComponents(text, splitCompounds) {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  const components = [];
  const prep = [];

  for (const part of parts) {
    if (isPrepSegment(part)) {
      prep.push(part);
      continue;
    }
    if (splitCompounds) {
      const andParts = part.split(/\s+(?:and|&|\+)\s+/).map((s) => s.trim()).filter(Boolean);
      if (andParts.length > 1 && andParts.every((p) => resolveIngredientIn(p).ingredient)) {
        components.push(...andParts);
        continue;
      }
    }
    components.push(part);
  }

  if (components.length === 0) {
    components.push(raw);
    prep.length = 0;
  }
  return { components, preparation: prep };
}

/** Resolve one component into { ingredient, category, name, preparation }. */
function resolveComponent(text) {
  const original = String(text || "").trim();
  const match = resolveIngredientIn(original);

  if (match.ingredient) {
    const preparation = [];
    const leftovers = [];
    for (const side of [match.before.join(" "), match.after.join(" ")]) {
      if (!side) continue;
      const stripped = stripEdgePrep(side);
      if (stripped.removed.length) preparation.push(stripped.removed.join(" "));
      if (stripped.rest) leftovers.push(stripped.rest);
    }
    if (leftovers.length) preparation.push(leftovers.join(" "));
    return {
      ingredient: match.ingredient,
      category: match.ingredient.category,
      name: match.ingredient.name,
      preparation: preparation.join(", ").replace(/\s+/g, " ").trim(),
      matchedBy: "alias",
    };
  }

  const stripped = stripEdgePrep(original);
  const cleaned = stripped.rest || original;
  return {
    ingredient: null,
    category: inferCategory(cleaned),
    name: titleCase(cleaned),
    preparation: stripped.removed.join(" ").replace(/\s+/g, " ").trim(),
    matchedBy: "heuristic",
  };
}

/* ==========================================================================
 * SECTION 5 - LAYER 2: FUZZY AMOUNT RESOLUTION (density / package matrix)
 * ========================================================================== */

/** Resolve one fuzzy measure to [amount, unit] for this ingredient. */
function resolveMeasure(measure, ingredient, category) {
  if (ingredient && ingredient.counts && Object.prototype.hasOwnProperty.call(ingredient.counts, measure.id)) {
    return { amount: ingredient.counts[measure.id], unit: "g", source: "ingredient" };
  }
  // A bunch of a specific herb weighs whatever that herb's bunch weighs, so the
  // amount and the UI container ratio can never disagree.
  if (measure.id === "bunch" && ingredient && ingredient.container === "bunch" && ingredient.containerSize) {
    return { amount: ingredient.containerSize, unit: "g", source: "ingredient:bunch" };
  }
  const byCategory = measure.byCategory && measure.byCategory[category];
  if (byCategory) return { amount: byCategory[0], unit: byCategory[1], source: "category" };
  return { amount: measure.fallback[0], unit: measure.fallback[1], source: "default" };
}

/** Containers that hold exactly one item (a cabbage, a garlic bulb, a block). */
const SINGLE_ITEM_CONTAINERS = new Set(["head", "bulb", "block", "stick", "loaf", "bar", "can", "glass"]);

/** Grams for one whole item, falling back on single-item container sizes. */
function pieceWeight(ingredient) {
  if (!ingredient) return null;
  if (ingredient.piece) return ingredient.piece;
  if (ingredient.container && SINGLE_ITEM_CONTAINERS.has(ingredient.container)) {
    return ingredient.containerSize || (CONTAINERS[ingredient.container] ? CONTAINERS[ingredient.container].size : null);
  }
  return null;
}

const VAGUE_DEFAULTS = Object.freeze({
  spice: [1, "g"],
  granular: [1, "g"],
  leafy: [10, "g"],
  herb: [5, "g"],
  liquid: [5, "ml"],
  nut: [15, "g"],
  dense: [30, "g"],
  protein: [60, "g"],
  produce: [50, "g"],
  fat: [10, "g"],
  other: [10, "g"],
});

/**
 * Convert the parsed { quantity, unit|measure } into normalised output.
 * The output unit follows the physical state: ml for liquids, g otherwise.
 */
function resolveAmount(ctx) {
  const { quantity, unit, measure, packageSize, extraAmount, ingredient, category, directive } = ctx;
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other;
  const density = ingredient && ingredient.density ? ingredient.density : profile.density;
  const isLiquid = category === "liquid";
  const n = quantity == null ? 1 : quantity;

  const finalize = (baseAmount, baseUnit, source) => {
    if (baseUnit === "g") {
      return { quantity: roundAmount(baseAmount), unit: "g", grams: roundAmount(baseAmount), source };
    }
    const grams = baseAmount * density;
    return {
      quantity: roundAmount(isLiquid ? baseAmount : grams),
      unit: isLiquid ? "ml" : "g",
      grams: roundAmount(grams),
      source,
    };
  };

  if (unit) {
    const bonus = extraAmount && extraAmount.base === unit.base ? extraAmount.amount : 0;
    return finalize(n * unit.factor + bonus, unit.base, `unit:${unit.id}`);
  }

  if (measure) {
    const spec = resolveMeasure(measure, ingredient, category);
    let amount = spec.amount;
    let baseUnit = spec.unit;
    if (packageSize && measure.package) {
      amount = packageSize.quantity * packageSize.unit.factor; // "1 (14 oz) can"
      baseUnit = packageSize.unit.base;
    }
    return finalize(n * amount, baseUnit, `measure:${measure.id}:${spec.source}`);
  }

  if (quantity != null) {
    const piece = pieceWeight(ingredient);
    if (piece) return finalize(n * piece, "g", "piece");
    if (isLiquid) return finalize(n * 240, "ml", "piece:volume");
    return finalize(n * 100, "g", "piece:default");
  }

  // No amount at all ("salt to taste"): fall back on the vague matrix.
  const fallback = VAGUE_DEFAULTS[category] || VAGUE_DEFAULTS.other;
  const qty = directive ? fallback[0] : ingredient && ingredient.piece ? ingredient.piece : fallback[0];
  const baseUnit = directive ? fallback[1] : ingredient && ingredient.piece ? "g" : fallback[1];
  return finalize(qty, baseUnit, directive ? "vague:directive" : "vague:default");
}

/** Project per-100 g nutrition onto the resolved gram weight. */
function computeNutrition(grams, ingredient, category) {
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other;
  const per100 = (ingredient && ingredient.nutrition) || profile.nutrition;
  const factor = grams / 100;
  return {
    kcal: round1(factor * per100[0]),
    protein: round1(factor * per100[1]),
    carbs: round1(factor * per100[2]),
    fat: round1(factor * per100[3]),
  };
}

/* ==========================================================================
 * SECTION 6 - LAYER 3: UI FRACTION CALCULATOR
 * ========================================================================== */

/** Human-friendly tenths (exact tenths are rendered as tenths). */
const TENTHS = Object.freeze({
  1: "1/10th",
  2: "1/5th",
  3: "3/10ths",
  4: "2/5ths",
  5: "1/2",
  6: "6/10ths",
  7: "7/10ths",
  8: "4/5ths",
  9: "9/10ths",
});

const SIMPLE_FRACTIONS = Object.freeze([
  [1, 50], [1, 25], [1, 20], [1, 16], [1, 12], [1, 10], [1, 8], [1, 6], [1, 5], [1, 4],
  [3, 8], [2, 5], [1, 2], [5, 8], [3, 4], [4, 5], [5, 6], [7, 8], [9, 10],
]);

function fractionText(n, d) {
  if (d === 2) return n === 1 ? "1/2" : `${n}/2`;
  if (d === 3) return n === 1 ? "1/3rd" : `${n}/3rds`;
  return `${n}/${d}${n === 1 ? "th" : "ths"}`;
}

/**
 * Render a 0..1 ratio as a readable fraction.
 * Preference order: exact thirds -> exact tenths -> simple fractions -> near tenths.
 *  0.02 -> "1/50th"   0.30 -> "1/3rd"   0.60 -> "6/10ths"   0.25 -> "1/4th"
 */
export function toFriendlyFraction(x) {
  const ratio = Number(x);
  if (!isFinite(ratio) || ratio <= 0) return null;
  if (Math.abs(ratio - 1) < 0.005) return null;

  for (const [n, d] of [[1, 3], [2, 3]]) {
    if (Math.abs(ratio - n / d) <= 0.04) return fractionText(n, d);
  }

  const tenths = Math.round(ratio * 10);
  if (Math.abs(ratio * 10 - tenths) < 1e-9 && tenths >= 1 && tenths <= 9) return TENTHS[tenths];

  let best = null;
  for (const [n, d] of SIMPLE_FRACTIONS) {
    const diff = Math.abs(ratio - n / d);
    if (!best || diff < best.diff) best = { n, d, diff };
  }
  if (best && best.diff <= 0.02) return fractionText(best.n, best.d);

  if (Math.abs(ratio * 10 - tenths) <= 0.2 && tenths >= 1 && tenths <= 9) return TENTHS[tenths];
  return null;
}

function nearestFractionText(x) {
  const target = Number(x);
  const candidates = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8]];
  let best = null;
  for (const [n, d] of candidates) {
    const diff = Math.abs(target - n / d);
    if (!best || diff < best.diff) best = { n, d, diff };
  }
  if (best && best.diff <= 0.02) return `${best.n}/${best.d}`;
  return null;
}

/** Format a number as a mixed fraction when it is close enough ("2 1/2"). */
export function formatQuantity(n) {
  const value = Number(n);
  if (!isFinite(value)) return "0";
  if (value === 0) return "0";
  // Fractions only make sense for small amounts; 7.8 g stays "7.8".
  if (Math.abs(value) >= 5 || value < 0) return String(round1(value));
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (Math.abs(frac) < 0.01) return String(whole);
  const fracText = nearestFractionText(frac);
  if (fracText) return whole > 0 ? `${whole} ${fracText}` : fracText;
  const rounded = round2(value);
  return String(rounded);
}

/** Only unambiguous quarters/halves/thirds survive as a ratio fraction. */
function cleanFraction(x) {
  for (const [n, d] of [[1, 4], [1, 3], [1, 2], [2, 3], [3, 4]]) {
    if (Math.abs(x - n / d) <= 0.008) return fractionText(n, d);
  }
  return null;
}

const VOLUME_CONTAINERS = new Set(["bottle", "jug", "carton", "can", "tin", "glass", "cup"]);

function containerLabel(ratio, containerName) {
  if (!isFinite(ratio) || ratio <= 0) return "—";
  if (Math.abs(ratio - 1) <= 0.02) return `~1 ${containerName}`;
  if (ratio > 1) {
    const whole = Math.floor(ratio);
    const fracText = cleanFraction(ratio - whole);
    return fracText ? `~${whole} ${fracText} ${pluralize(containerName)}` : `~${round1(ratio)} ${pluralize(containerName)}`;
  }
  const fracText = toFriendlyFraction(ratio);
  if (fracText) return `~${fracText} of a ${containerName}`;
  return `~${Math.round(ratio * 100)}% of a ${containerName}`;
}

/**
 * Layer 3 entry point: express an exact metric amount as a container ratio.
 *
 *   convertMetricToUIFraction(15, "ml", soySauce)
 *   -> { container: "bottle", size: 750, unit: "ml", ratio: 0.02, fraction: "1/50th",
 *        label: "~1/50th of a bottle" }
 *
 * @param {number} quantity metric amount
 * @param {"g"|"ml"} unit   metric unit
 * @param {object|string} [target] ingredient object or category key
 */
export function convertMetricToUIFraction(quantity, unit, target) {
  const qty = Number(quantity);
  const ingredient = target && typeof target === "object" ? target : null;
  const category = ingredient ? ingredient.category : typeof target === "string" ? target : "other";
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other;
  const density = ingredient && ingredient.density ? ingredient.density : profile.density;

  if (!isFinite(qty) || qty <= 0) {
    return { container: null, size: null, unit: null, ratio: 0, fraction: null, label: "—" };
  }

  const hasExplicitContainer = ingredient && Object.prototype.hasOwnProperty.call(ingredient, "container");
  const key = hasExplicitContainer ? ingredient.container : profile.container;
  const container = key ? CONTAINERS[key] : null;

  if (!container) {
    const piece = ingredient && ingredient.piece;
    if (piece) {
      const count = round2(qty / piece);
      const singular = String(ingredient.name || "portion").toLowerCase();
      const noun = count >= 0.5 && count < 1.5 ? singular : pluralizeName(singular);
      return {
        container: "piece",
        size: piece,
        unit: "g",
        ratio: round3(count),
        fraction: toFriendlyFraction(count >= 1 ? count - Math.floor(count) : count),
        label: `~${Math.abs(count % 1) < 0.001 ? count : round1(count)} ${noun}`,
      };
    }
    return {
      container: null,
      size: null,
      unit: unit || null,
      ratio: 0,
      fraction: null,
      label: `${formatQuantity(round1(qty))} ${unit || ""}`.trim(),
    };
  }

  const size = (ingredient && ingredient.containerSize) || container.size;

  // Match the container's dimension to the ingredient's natural one: coconut
  // milk comes in a 400 ml can even though cans are usually weighed in grams.
  // Only genuine volume vessels get re-interpreted; a yogurt tub stays in grams.
  let containerUnit = container.unit;
  if (category === "liquid" && containerUnit === "g" && VOLUME_CONTAINERS.has(container.name)) containerUnit = "ml";
  else if (category !== "liquid" && containerUnit === "ml") containerUnit = "g";

  let inContainerUnit = qty;
  if (unit && unit !== containerUnit) {
    if (unit === "g" && containerUnit === "ml") inContainerUnit = qty / density;
    else if (unit === "ml" && containerUnit === "g") inContainerUnit = qty * density;
  }
  const ratio = inContainerUnit / size;

  return {
    container: container.name,
    size,
    unit: containerUnit,
    ratio: round3(ratio),
    fraction: toFriendlyFraction(ratio >= 1 ? ratio - Math.floor(ratio) : ratio),
    label: containerLabel(ratio, container.name),
  };
}

/* ==========================================================================
 * SECTION 7 - PIPELINE ORCHESTRATION (Layer 1 -> 2 -> 3)
 * ========================================================================== */

const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((ingredient) => [ingredient.id, ingredient]));

/** Citrus yield table: "juice of 1 lemon" / "zest of 2 limes". */
const CITRUS_YIELDS = Object.freeze({
  lemon: { name: "Lemon", juiceId: "lemon_juice", juice: 45, zest: 5 },
  lime: { name: "Lime", juiceId: "lime_juice", juice: 30, zest: 4 },
  orange: { name: "Orange", juiceId: "orange_juice", juice: 70, zest: 6 },
});

/** Phrasal numerals rewritten to digits before the grammar runs. */
const PHRASE_NUMBERS = Object.freeze([
  [/^a couple of\s+/, "2 "],
  [/^a couple\s+/, "2 "],
  [/^couple of\s+/, "2 "],
  [/^a few\s+/, "3 "],
  [/^a dozen\s+/, "12 "],
  [/^a pair of\s+/, "2 "],
  [/^a quarter of\s+/, "0.25 "],
  [/^a third of\s+/, "0.333 "],
  [/^half of\s+/, "0.5 "],
  [/^half a\s+/, "0.5 "],
]);

const UNIT_WORDS = Object.freeze({
  mg: ["mg", "mg"], g: ["g", "g"], kg: ["kg", "kg"], oz: ["oz", "oz"], lb: ["lb", "lb"],
  ml: ["ml", "ml"], cl: ["cl", "cl"], dl: ["dl", "dl"], l: ["l", "l"],
  tsp: ["tsp", "tsp"], tbsp: ["tbsp", "tbsp"], floz: ["fl oz", "fl oz"],
  cup: ["cup", "cups"], pint: ["pint", "pints"], quart: ["quart", "quarts"],
  gallon: ["gallon", "gallons"], shot: ["shot", "shots"],
});

function unitWord(unit, quantity) {
  const words = UNIT_WORDS[unit.id] || [unit.id, unit.id];
  return quantity != null && quantity > 1 ? words[1] : words[0];
}

/**
 * The unit the line itself used, for UI display: "cup", "tsp", "tbsp", "g",
 * "ml", a measure word such as "clove", the package word for "2 x 400 g cans",
 * or "pcs" when the line just counted items.
 */
function displayUnits(ctx) {
  const { node, multiplier, unit, measure, packageWord, directive } = ctx;
  const count = node && node.value != null ? node.value : null;
  if (directive) return { displayQty: 1, displayUnit: "pinch" };
  if (packageWord) return { displayQty: multiplier != null ? multiplier : count == null ? 1 : count, displayUnit: packageWord };
  if (unit) return { displayQty: count == null ? 1 : count, displayUnit: unit.id };
  if (measure) return { displayQty: count == null ? 1 : count, displayUnit: measure.id };
  if (count != null) return { displayQty: count, displayUnit: "pcs" };
  return { displayQty: 1, displayUnit: "pcs" };
}

/** Human-readable source amount ("3 cloves", "a splash", "2 1/2 cups"). */
function buildDisplayAmount(ctx) {
  const { quantity, node, unit, measure, name, directive } = ctx;
  if (directive) return "Pinch / To taste";
  if (measure) {
    const count = quantity == null ? 1 : quantity;
    const articleUsed = Boolean(node && node.article);
    if (count === 1) return articleUsed ? `a ${measure.id}` : `1 ${measure.id}`;
    return `${formatQuantity(count)} ${pluralize(measure.id)}`;
  }
  if (unit) return `${formatQuantity(quantity == null ? 1 : quantity)} ${unitWord(unit, quantity)}`;
  if (quantity != null) {
    return `${formatQuantity(quantity)} ${quantity > 1 ? pluralizeName(name) : String(name).toLowerCase()}`;
  }
  return String(name || "ingredient");
}

/** Build one rich output item. */
function buildItem(ctx) {
  const { input, component, node, multiplier, unit, packageSize, extraAmount, directive, vagueQuantity, citrus, instructionPrep, packageWord } = ctx;
  let measure = ctx.measure;

  // "3 large garlic cloves" / "2 chicken breasts": a trailing count noun is the
  // real unit even though it follows the ingredient name.
  let componentText = component;
  if (!unit && !measure && node && !multiplier) {
    const words = String(component).split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const last = words[words.length - 1].replace(/[^a-z]/gi, "");
      const trailing = EXACT_MEASURE_ALIAS.get(last) || EXACT_MEASURE_ALIAS.get(singularize(last));
      if (trailing && trailing.id !== "piece") {
        const shortened = words.slice(0, -1).join(" ");
        // "curry leaves" is an ingredient of its own; "garlic cloves" is not,
        // so the count noun stays the measure and the head word is the item.
        const keepWhole = Boolean(resolveIngredientIn(component).ingredient) && !resolveIngredientIn(shortened).ingredient;
        measure = trailing;
        if (!keepWhole) componentText = shortened;
      }
    }
  }

  const resolved = resolveComponent(componentText);

  let ingredient = resolved.ingredient;
  let category = resolved.category;
  let name = resolved.name;
  let preparation = resolved.preparation;

  let quantity = node ? node.value : null;
  if (quantity != null && multiplier) quantity *= multiplier;

  let forcedAmount = null;
  if (citrus && ingredient) {
    const yields = CITRUS_YIELDS[ingredient.id];
    if (yields) {
      const count = quantity == null ? 1 : quantity;
      if (citrus === "juice") {
        const juice = INGREDIENT_BY_ID.get(yields.juiceId);
        forcedAmount = {
          quantity: round1(count * yields.juice),
          unit: "ml",
          grams: round1(count * yields.juice * (juice ? juice.density : 1)),
          source: "citrus:juice",
        };
        ingredient = juice || ingredient;
        category = "liquid";
        name = juice ? juice.name : `${yields.name} Juice`;
      } else {
        forcedAmount = {
          quantity: round1(count * yields.zest),
          unit: "g",
          grams: round1(count * yields.zest),
          source: "citrus:zest",
        };
        name = `${yields.name} Zest`;
        category = "produce";
        ingredient = null;
      }
    }
  }

  const amount = forcedAmount || resolveAmount({ quantity, unit, measure, packageSize, extraAmount, ingredient, category, directive });
  const nutrition = computeNutrition(amount.grams, ingredient, category);
  const ui = convertMetricToUIFraction(amount.quantity, amount.unit, ingredient || category);

  let range = null;
  if (node && node.isRange) {
    const n = quantity == null ? 1 : quantity;
    const scale = n ? amount.quantity / n : 1;
    range = { min: round1(node.min * scale), max: round1(node.max * scale) };
  }

  const confidence = directive
    ? 0.85
    : measure
      ? 0.9
      : unit
        ? 0.99
        : ingredient
          ? 0.95
          : 0.6;

  return {
    input,
    name: name || "Ingredient",
    canonicalName: name || "Ingredient",
    quantity: amount.quantity,
    unit: amount.unit,
    grams: amount.grams,
    density: ingredient && ingredient.density ? ingredient.density : (CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other).density,
    category,
    categoryLabel: (CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other).label,
    preparation: [preparation, instructionPrep ? instructionPrep.join(", ") : ""]
      .filter(Boolean)
      .join(", ")
      .replace(/\s+/g, " ")
      .trim(),
    vague: Boolean(directive || vagueQuantity || (measure && measure.vague)),
    always: Boolean(directive || vagueQuantity),
    metric: `${formatQuantity(amount.quantity)} ${amount.unit}`,
    displayAmount: buildDisplayAmount({ quantity, node, unit, measure, name, directive }),
    ...displayUnits({ node, multiplier, unit, measure, packageWord, directive }),
    uiFraction: ui.label,
    container: { name: ui.container, size: ui.size, unit: ui.unit, ratio: ui.ratio, fraction: ui.fraction },
    range,
    nutrition,
    confidence,
    matchedBy: `${resolved.matchedBy}|${amount.source}`,
  };
}

/**
 * Full pipeline for ONE line of ingredient text.
 * Returns an array because compound phrases ("salt and pepper") expand.
 */
export function analyze(input, options = {}) {
  const raw = String(input == null ? "" : input).trim();
  const normalized = normalizeText(raw);
  if (!normalized) throw new TypeError("parseIngredient(): input must be a non-empty string");

  let text = normalized;

  // --- 0. "juice of 1 lemon" / "zest of 2 limes" -------------------------
  let citrus = null;
  const citrusMatch = /^(juice|zest)\s+of\s+(.+)$/.exec(text);
  if (citrusMatch) {
    citrus = citrusMatch[1];
    text = citrusMatch[2];
  }

  // --- 1. Parenthetical package weights: "1 can (400 g) tomatoes" --------
  let packageSize = null;
  text = text.replace(/\(([^)]*)\)/g, (_match, inner) => {
    const pm = /^(\d+(?:\.\d+)?)\s*([a-z][a-z. ]*)$/.exec(String(inner).trim());
    if (pm) {
      const unit = EXACT_UNIT_ALIAS.get(pm[2].trim());
      if (unit && !packageSize) packageSize = { quantity: parseFloat(pm[1]), unit };
    }
    return " ";
  });
  text = text.replace(/\s+/g, " ").trim();

  // --- 2. Vague directives ("to taste", "optional", ...) -----------------
  let directive = false;
  const directivePhrases = [];
  text = text.replace(/\b(?:to taste|as needed|to serve|for garnish|for serving|for dusting|optional)\b/g, (match) => {
    directive = true;
    directivePhrases.push(match);
    return " ";
  });
  text = text.replace(/\s+/g, " ").trim();

  let vagueQuantity = false;
  const vaguePrefix = /^(?:some|a little|a bit of|a touch of|little)\s+/.exec(text);
  if (vaguePrefix) {
    vagueQuantity = true;
    directive = true;
    text = text.slice(vaguePrefix[0].length);
  }

  // --- 2b. Phrasal numerals: "a couple of", "a few", "half a" -----------
  for (const [pattern, replacement] of PHRASE_NUMBERS) {
    const phrase = pattern.exec(text);
    if (phrase) {
      text = replacement + text.slice(phrase[0].length);
      break;
    }
  }

  // --- 3. Multiplier form: "2 x 400 g cans" ------------------------------
  let multiplier = null;
  const multiplierMatch = /^(\d+(?:\.\d+)?)\s*[x×]\s*(?=\d)/.exec(text);
  if (multiplierMatch) {
    multiplier = parseFloat(multiplierMatch[1]);
    text = text.slice(multiplierMatch[0].length).trim();
  }

  // --- 4. Quantity -------------------------------------------------------
  const node = parseQuantityPrefix(text);
  if (node) {
    text = text.slice(node.pos).trim();
    // "1 dozen eggs" / "half a dozen eggs"
    const dozen = /^dozens?\s+/.exec(text);
    if (dozen) {
      node.value *= 12;
      node.min *= 12;
      node.max *= 12;
      text = text.slice(dozen[0].length).trim();
    }
  }

  // "half a cup" -> the article between the number word and the unit
  if (node && node.kind !== "article") {
    const article = /^(?:a|an)\s+/.exec(text);
    if (article) {
      const after = text.slice(article[0].length);
      if (UNIT_REGEX.test(after) || MEASURE_REGEX.test(after)) text = after;
    }
  }

  // Size adjectives in front of a measure: "a small handful of parsley".
  const sizePrefix = /^(?:small|large|big|generous|heaping|heaped|level|rounded|scant|good)\s+/.exec(text);
  if (sizePrefix && (MEASURE_REGEX.test(text.slice(sizePrefix[0].length)) || UNIT_REGEX.test(text.slice(sizePrefix[0].length)))) {
    text = text.slice(sizePrefix[0].length);
  }

  // --- 5. Unit or fuzzy measure -----------------------------------------
  const hit = parseUnitPrefix(text);
  let unit = null;
  let measure = null;
  if (hit && hit.type === "unit") {
    unit = hit.unit;
    text = text.slice(hit.pos).trim();
  } else if (hit && hit.type === "measure") {
    measure = hit.measure;
    text = text.slice(hit.pos).trim();
  }

  // --- 5b. Additive compound amounts: "1 lb 2 oz", "1 cup plus 2 tbsp" ---
  let extraAmount = null;
  if (unit && node) {
    const additive = /^(?:\+|plus|and)?\s*(\d+(?:\.\d+)?)\s*([a-z]+)\b\s*/i.exec(text);
    if (additive) {
      const extraUnit = EXACT_UNIT_ALIAS.get(additive[2]);
      if (extraUnit && extraUnit.base === unit.base && extraUnit.id !== unit.id) {
        extraAmount = { amount: parseFloat(additive[1]) * extraUnit.factor, base: extraUnit.base };
        text = text.slice(additive[0].length).trim();
      }
    }
  }

  text = text.replace(/^of\s+/, "");

  // "400 g can chickpeas": the package word follows a concrete mass unit.
  let packageWord = null;
  if (unit) {
    const pkg = /^(cans?|tins?|jars?|packets?|packs?|sachets?|bottles?|cartons?|boxes?|bags?|tubs?|blocks?|punnets?|loaves?)\b\s*/.exec(text);
    if (pkg) {
      packageWord = singularize(pkg[1]);
      text = text.slice(pkg[0].length).trim().replace(/^of\s+/, "");
    }
  }

  if (!text) text = measure ? measure.id : unit ? unit.id : "ingredient";

  // --- 6. Components + preparation noise --------------------------------
  const { components, preparation } = splitComponents(text, options.splitCompounds !== false);

  const prepNotes = [...directivePhrases, ...preparation];
  return components.map((component) =>
    buildItem({ input: raw, component, node, multiplier, unit, measure, packageSize, extraAmount, directive, vagueQuantity, citrus, instructionPrep: prepNotes, packageWord })
  );
}

/* ==========================================================================
 * SECTION 8 - PUBLIC API
 * ========================================================================== */

/**
 * Parse one or more ingredient lines (newline / semicolon separated).
 * @returns {Array<object>} rich ingredient objects
 */
export function parseIngredients(input, options = {}) {
  const text = String(input == null ? "" : input);
  const lines = text.split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean);
  const store = options && options.corrections && typeof options.corrections.applyLearned === "function" ? options.corrections : null;
  const items = [];
  for (const line of lines) {
    const parsed = analyze(line, options);
    items.push(...(store ? store.applyLearned(line, parsed) : parsed));
  }
  return items;
}

/** Parse a single line and return its first rich item. */
export function parseIngredient(input, options = {}) {
  const items = parseIngredients(input, options);
  if (items.length === 0) throw new TypeError("parseIngredient(): input must be a non-empty string");
  return items[0];
}

/**
 * STRICT, compact output. This is the primary contract:
 *   { i: [ [name, qty, "unit", kcal, protein, carbs, fat, always] ] }
 */
export function parseFuzzyIngredient(input, options = {}) {
  const items = parseIngredients(input, options);
  return { i: items.map(toTuple) };
}

/** Parse a whole recipe blob (one ingredient per line). */
export function parseRecipe(input, options = {}) {
  return parseFuzzyIngredient(input, options);
}

/** Project a rich item onto the strict tuple schema. */
export function toTuple(item) {
  return [item.name, item.quantity, item.unit, item.nutrition.kcal, item.nutrition.protein, item.nutrition.carbs, item.nutrition.fat, item.always];
}

/** Frozen, JSON-serialisable data matrix (taxonomy + containers + units). */
export function getTaxonomy() {
  return Object.freeze({
    version: VERSION,
    units: UNITS,
    fuzzyMeasures: MEASURES,
    containers: CONTAINERS,
    categories: CATEGORY_PROFILES,
    ingredients: INGREDIENTS,
  });
}

/** Look up a canonical ingredient by id / name / alias. */
export function getIngredient(name) {
  const key = String(name || "").toLowerCase().trim();
  return ALIAS_TO_INGREDIENT.get(key) || ALIAS_TO_INGREDIENT.get(singularize(key)) || INGREDIENT_BY_ID.get(key) || null;
}

const IngredientEngine = Object.freeze({
  VERSION,
  parseFuzzyIngredient,
  parseIngredient,
  parseIngredients,
  parseRecipe,
  analyze,
  toTuple,
  tokenize,
  normalizeText,
  parseQuantityPrefix,
  resolveIngredientIn,
  convertMetricToUIFraction,
  toFriendlyFraction,
  formatQuantity,
  getTaxonomy,
  getIngredient,
  parseRecipeSteps,
  detectDurations,
  splitStepsText,
  createCorrectionStore,
  runSelfTests,
  benchmark,
});

/* ==========================================================================
 * SECTION 8b - RECIPE STEPS (method text -> structured steps)
 * ========================================================================== */

/** Numeric step markers: "1.", "1)", "(1)", "Step 3:" and bullet glyphs. */
const STEP_MARKER_RE = /^(?:step\s*\d+\s*[:.)\-–—]?|\d{1,2}\s*[.)]|[-•*–—])\s*/i;

/** Headings that introduce a method block rather than a step. */
const STEP_HEADING_RE = /^(?:method|instructions?|directions?|steps?|preparation|how to (?:make|cook|bake|prepare).*)\s*:?$/i;

const HTML_ENTITIES = Object.freeze({
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&rsquo;": "'", "&lsquo;": "'",
  "&ldquo;": '"', "&rdquo;": '"', "&deg;": "°", "&frac12;": "1/2",
  "&frac14;": "1/4", "&frac34;": "3/4",
});

/** Remove markup, entities and stray whitespace from method text. */
function stripStepMarkup(text) {
  return String(text == null ? "" : text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] || " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[ \t\f\v\u00a0]+/g, " ");
}

/** Strip a leading list marker from one step and collapse its whitespace. */
function cleanStepText(text) {
  return String(text || "")
    .replace(STEP_MARKER_RE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Split a paragraph into sentences without regex lookbehind (older Safari). */
function splitSentences(paragraph) {
  const sentences = [];
  const re = /[^.!?]+(?:[.!?]+["']?|$)/g;
  let match;
  while ((match = re.exec(paragraph)) !== null) {
    const text = match[0].trim();
    if (!text) continue;
    // A lowercase fragment continues the previous sentence; a short trailing
    // scrap ("Season well.") is still its own step.
    if (sentences.length && /^[a-z]/.test(text)) sentences[sentences.length - 1] += " " + text;
    else sentences.push(text);
  }
  return sentences;
}

/**
 * Split a recipe method into cleaned step strings.
 *
 * Handles numbered ("1.", "1)", "(1)", "Step 1:"), bulleted, one-step-per-line
 * and single-paragraph methods, stripping HTML, list markers and double spaces.
 * Returns string[] in reading order (indices are added by parseRecipeSteps).
 *
 *   splitStepsText("1. Boil water.\n2. Add pasta.")
 *   -> ["Boil water.", "Add pasta."]
 */
export function splitStepsText(text) {
  const source = stripStepMarkup(text);
  if (!source.trim()) return [];

  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Drop a leading "Method" / "Instructions" heading.
  if (STEP_HEADING_RE.test(lines[0])) lines.shift();
  if (!lines.length) return [];

  const hasMarkers = lines.some((line) => STEP_MARKER_RE.test(line));
  let blocks = [];

  if (hasMarkers) {
    let current = null;
    for (const line of lines) {
      if (STEP_MARKER_RE.test(line)) {
        if (current !== null) blocks.push(current);
        current = line.replace(STEP_MARKER_RE, "");
      } else if (current !== null) {
        current += " " + line; // wrapped continuation of the current step
      } else if (!STEP_HEADING_RE.test(line)) {
        blocks.push(line); // preamble before the first marker
      }
    }
    if (current !== null) blocks.push(current);
  } else {
    for (const line of lines) {
      const continuation = /^(?:and|then|or|but|plus|also|next|finally|meanwhile|now)\b/i.test(line);
      if (continuation && blocks.length) blocks[blocks.length - 1] += " " + line;
      else blocks.push(line);
    }
  }

  // A numbered block or a paragraph can hold several sentences: each sentence
  // is its own step ("Step 1: Mix. Rest. Then fry." -> three steps).
  blocks = blocks.flatMap((block) => splitSentences(block));

  return blocks.map(cleanStepText).filter(Boolean);
}

/* --------------------------------------------------------------------------
 * Duration detection
 * ------------------------------------------------------------------------ */

const TIME_UNIT_SECONDS = Object.freeze({
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
});

const DURATION_UNIT_RE = "(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)";
const NUMBER_RE = "(\\d+(?:\\.\\d+)?)";

/** Rewrite worded times into digits so one numeric grammar handles them all. */
function normalizeTimeWords(text) {
  let s = text.toLowerCase();
  s = s.replace(/\ban hour and a half\b/g, "1.5 hours");
  s = s.replace(/\bone and a half hours?\b/g, "1.5 hours");
  s = s.replace(/\bhalf an hour\b/g, "0.5 hour");
  s = s.replace(/\bhalf a minute\b/g, "0.5 minute");
  s = s.replace(/\bhalf a day\b/g, "12 hours");
  s = s.replace(/\ban hour\b/g, "1 hour");
  s = s.replace(/\ba minute\b/g, "1 minute");
  s = s.replace(/\ba second\b/g, "1 second");
  s = s.replace(/\ba day\b/g, "1 day");
  s = s.replace(/\ba couple of (hours?|minutes?|seconds?|days?)\b/g, "2 $1");
  s = s.replace(/\ba few (hours?|minutes?|seconds?|days?)\b/g, "3 $1");
  s = s.replace(/\bseveral (hours?|minutes?|seconds?|days?)\b/g, "3 $1");
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(hours?|minutes?|seconds?|days?)\b/g,
    (whole, word, unit) => `${NUM_WORDS[word] || 1} ${unit}`);
  return s;
}

/** Classify what a duration is waiting for, from the verbs in front of it. */
function durationKind(text, index) {
  const before = text.slice(Math.max(0, index - 70), index);
  const patterns = [
    [/\bmarinat(?:e|ed|ing)\b/g, "marinate"],
    [/\b(?:proo?f(?:ing)?|prove|rising|rise|double in size)\b/g, "proof"],
    [/\b(?:soak|soaking|steep|steeping)\b/g, "soak"],
    [/\b(?:chill|chilling|refrigerat\w*|freeze|freezing|fridge|cool|cooling)\b/g, "chill"],
    [/\b(?:rest|resting|stand|standing|settle|settling)\b/g, "rest"],
    [/\b(?:simmer|simmering)\b/g, "simmer"],
    [/\b(?:bake|baking|roast|roasting|oven|grill|broil)\b/g, "bake"],
    [/\b(?:cook|cooking|boil|boiling|fry|frying|saute|sauté|steam|steaming|poach|poaching|reduce|reducing|caramelis\w*|carameliz\w*|stir|stirring|whisk|blend|knead)\b/g, "cook"],
  ];
  // The closest verb to the duration describes it; an earlier sentence's verb
  // must not win ("Rest for 10 minutes. Then fry for 2 minutes.").
  let closest = -1;
  let kind = "other";
  for (const [pattern, label] of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(before)) !== null) {
      if (match.index >= closest) {
        closest = match.index;
        kind = label;
      }
    }
  }
  return kind;
}

/** "until golden brown" / "until tender": the reason a timer is running. */
function durationPurpose(text, endIndex) {
  // Only the remainder of the current sentence can explain this timer.
  const after = text.slice(endIndex, endIndex + 80).split(/[.!?]/)[0];
  const until = /\buntil\s+([^,.;!?]{2,40})/i.exec(after);
  if (until) return `until ${until[1].trim()}`;
  return null;
}

/** Phrases that describe prep metadata rather than a step timer. */
const NON_TIMER_BEFORE_RE = /\b(?:takes?|taking|needs?|requires?|prep(?:aration)?\s*time|cook(?:ing)?\s*time|total\s+time|ready\s+in)\b/;
const NON_TIMER_AFTER_RE = /^\s*(?:to\s+(?:prepare|prep|make|assemble|serve)\b|of\s+prep(?:aration)?\b)/i;

/**
 * Internal duration scanner. Returns { durations, warnings } so parseRecipeSteps
 * can report phrases such as "for 3 whistles", which look like timers but are not.
 */
function analyzeDurations(stepText) {
  const original = String(stepText == null ? "" : stepText);
  const durations = [];
  const warnings = [];
  if (!original.trim()) return { durations, warnings };

  const text = normalizeTimeWords(original);
  const used = [];
  const overlaps = (start, end) => used.some((span) => start < span.end && end > span.start);

  const rangeRe = new RegExp(`${NUMBER_RE}\\s*(?:-|–|—|\\bto\\b|\\bor\\b)\\s*${NUMBER_RE}\\s*${DURATION_UNIT_RE}\\b`, "g");
  let match;
  while ((match = rangeRe.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const unitSeconds = TIME_UNIT_SECONDS[match[3]];
    if (!unitSeconds || overlaps(start, end)) continue;
    used.push({ start, end });
    durations.push({
      start,
      end,
      seconds: Math.round(parseFloat(match[1]) * unitSeconds), // lower bound of the range
      approximate: /\b(?:about|around|approximately|roughly|approx)\b|~/.test(text.slice(Math.max(0, start - 14), start)),
      rangeText: match[0].replace(/\s+/g, " ").trim(),
    });
  }

  const singleRe = new RegExp(`${NUMBER_RE}\\s*${DURATION_UNIT_RE}\\b`, "g");
  while ((match = singleRe.exec(text)) !== null) {
    const start = match.index;
    let end = match.index + match[0].length;
    if (overlaps(start, end)) continue;
    const unitSeconds = TIME_UNIT_SECONDS[match[2]];
    if (!unitSeconds) continue;

    // "1 hour 30 minutes" -> one 5400 s duration, not two.
    let seconds = parseFloat(match[1]) * unitSeconds;
    let rangeText;
    const compound = new RegExp(`^\\s*(?:and\\s+)?${NUMBER_RE}\\s*(minutes?|mins?|seconds?|secs?)\\b`).exec(text.slice(end));
    if (compound && unitSeconds >= 60) {
      const extraUnit = TIME_UNIT_SECONDS[compound[2]];
      if (extraUnit && extraUnit < unitSeconds) {
        seconds += parseFloat(compound[1]) * extraUnit;
        end += compound[0].length;
        rangeText = text.slice(start, end).replace(/\s+/g, " ").trim();
      }
    }

    const before = text.slice(Math.max(0, start - 60), start);
    const after = text.slice(end, end + 40);
    if (NON_TIMER_BEFORE_RE.test(before) || NON_TIMER_AFTER_RE.test(after)) continue; // "takes 20 minutes to prepare"
    if (overlaps(start, end)) continue;
    used.push({ start, end });

    durations.push({
      start,
      end,
      seconds: Math.round(seconds),
      approximate: /\b(?:about|around|approximately|roughly|approx)\b|~/.test(before),
      rangeText,
    });
  }

  // "overnight" is a real wait with no number attached.
  const overnight = /\bovernight\b/i.exec(text);
  if (overnight) {
    durations.push({
      start: overnight.index,
      end: overnight.index + overnight[0].length,
      seconds: 8 * 3600,
      approximate: true,
      rangeText: "overnight",
    });
  }

  durations.sort((a, b) => a.start - b.start);

  // Attach kind / label / per-side duplication in document order.
  const finalDurations = [];
  for (const duration of durations) {
    const kind = duration.rangeText === "overnight"
      ? (/\b(?:chill|refrigerat|fridge|freeze)\w*/i.test(text) ? "chill" : "rest")
      : durationKind(text, duration.start);
    const purpose = durationPurpose(text, duration.end);
    const perSide = /\b(?:per|each)\s+side\b/i.test(text.slice(duration.end, duration.end + 18));
    const baseLabel = purpose || kind;
    const approximate = Boolean(duration.approximate);
    const entry = { seconds: duration.seconds, approximate, kind };
    if (duration.rangeText) entry.rangeText = duration.rangeText;
    if (perSide) {
      finalDurations.push({ ...entry, label: `${baseLabel} (first side)` });
      finalDurations.push({ ...entry, label: `${baseLabel} (second side)` });
    } else {
      finalDurations.push({ ...entry, label: baseLabel });
    }
  }

  // "for 3 whistles" - a number followed by a non-time noun.
  if (finalDurations.length === 0) {
    const notTime = /\bfor\s+(\d+|a|an|one|two|three|four|five)\s+([a-z][a-z-]{2,})\b/i.exec(original);
    if (notTime && !TIME_UNIT_SECONDS[notTime[2].toLowerCase()]) {
      warnings.push(`"for ${notTime[1]} ${notTime[2]}" is not a recognised time unit and was not counted as a duration`);
    }
  }

  return { durations: finalDurations, warnings };
}

/**
 * Extract the waiting times from one step of method text.
 *
 *   detectDurations("Simmer for 10-15 minutes until tender")
 *   -> [{ seconds: 600, label: "until tender", kind: "simmer",
 *         approximate: false, rangeText: "10-15 minutes" }]
 *
 * Ranges use the lower bound for `seconds` and keep the source in `rangeText`.
 * Compound times ("1 hour 30 minutes") become a single duration. "Overnight" is
 * 8 hours, flagged approximate. Prep metadata ("takes 20 minutes to prepare")
 * is ignored, as are phrases without a time unit.
 */
export function detectDurations(stepText) {
  return analyzeDurations(stepText).durations;
}

/** Oven temperature in one step: "200°C", "400 F", "180 degrees", gas mark. */
function detectTemperature(text) {
  const source = String(text || "");
  const withLetter = /(\d{2,4})\s*(?:°|º|deg(?:rees)?\.?)?\s*(c\b|celsius\b|f\b|fahrenheit\b)/i.exec(source);
  if (withLetter) {
    const fahrenheit = /^f/i.test(withLetter[2]);
    return { value: parseFloat(withLetter[1]), unit: fahrenheit ? "F" : "C" };
  }
  const bare = /(\d{2,4})\s*(?:°|º|degrees?\b)/i.exec(source);
  if (bare) {
    const value = parseFloat(bare[1]);
    // "180 degrees" in a recipe is Celsius far more often than not.
    return { value, unit: value >= 250 ? "F" : "C" };
  }
  const gas = /gas\s*mark\s*(\d)/i.exec(source);
  if (gas) {
    const table = { 1: 140, 2: 150, 3: 160, 4: 180, 5: 190, 6: 200, 7: 220, 8: 230, 9: 240 };
    const value = table[Number(gas[1])];
    if (value) return { value, unit: "C" };
  }
  return undefined;
}

/** Longest-match scan for canonical ingredients mentioned inside a step. */
function collectMentionedIngredients(stepText, allowed) {
  const words = tokenize(stepText)
    .filter((token) => token.type === "word" || token.type === "number")
    .map((token) => String(token.value).toLowerCase());
  const found = [];
  let index = 0;
  while (index < words.length) {
    let hit = null;
    for (let span = Math.min(4, words.length - index); span >= 1; span--) {
      const phrase = words.slice(index, index + span).join(" ");
      const ingredient = ALIAS_TO_INGREDIENT.get(phrase) || (span === 1 ? ALIAS_TO_INGREDIENT.get(singularize(phrase)) : null);
      // A longer phrase may resolve to a variant that is not in this recipe, so
      // keep shortening rather than giving up on the word entirely.
      if (ingredient && (!allowed || allowed.has(ingredient.name.toLowerCase()))) {
        hit = { ingredient, span };
        break;
      }
    }
    if (!hit) {
      index += 1;
      continue;
    }
    const name = hit.ingredient.name;
    if ((!allowed || allowed.has(name.toLowerCase())) && !found.includes(name)) found.push(name);
    index += hit.span;
  }
  return found;
}

/** Build the allowed-name set from options.ingredients (lines, names or items). */
function allowedIngredientNames(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return null;
  const allowed = new Set();
  for (const entry of ingredients) {
    if (!entry) continue;
    if (typeof entry === "string") {
      let name = titleCase(entry);
      try {
        const parsed = analyze(entry)[0];
        if (parsed && parsed.name) name = parsed.name;
      } catch (_error) {
        name = titleCase(entry);
      }
      allowed.add(String(name).toLowerCase());
    } else if (typeof entry === "object" && entry.name) {
      allowed.add(String(entry.canonicalName || entry.name).toLowerCase());
    }
  }
  return allowed;
}

/**
 * Parse a recipe method into structured steps.
 *
 * @param {string} text  free-form method: numbered, bulleted, line-per-step or a
 *                       single paragraph
 * @param {object} [options]
 * @param {Array<string|object>} [options.ingredients]  that recipe's ingredient
 *        lines/names; when given, ingredientsMentioned only returns names from
 *        this list
 * @returns {{ steps: Array<{index:number, text:string, durations:Array<object>,
 *            temperature?:{value:number, unit:"C"|"F"},
 *            ingredientsMentioned:string[]}>, warnings: string[] }}
 *
 * Each duration is { seconds, label, kind, approximate, rangeText? } with kind
 * one of cook|simmer|bake|rest|chill|marinate|soak|proof|other. Steps are
 * 0-indexed and their text has no numbering, bullets, HTML or double spaces.
 */
export function parseRecipeSteps(text, options = {}) {
  const warnings = [];
  const allowed = allowedIngredientNames(options.ingredients);
  const texts = splitStepsText(text);

  const steps = texts.map((stepText, index) => {
    const analysis = analyzeDurations(stepText);
    for (const warning of analysis.warnings) warnings.push(`Step ${index + 1}: ${warning}`);
    const step = {
      index,
      text: stepText,
      durations: analysis.durations.map((duration) => {
        const entry = {
          seconds: duration.seconds,
          label: duration.label,
          kind: duration.kind,
          approximate: Boolean(duration.approximate),
        };
        if (duration.rangeText) entry.rangeText = duration.rangeText;
        return entry;
      }),
      ingredientsMentioned: collectMentionedIngredients(stepText, allowed),
    };
    const temperature = detectTemperature(stepText);
    if (temperature) step.temperature = temperature;
    return step;
  });

  return { steps, warnings };
}

/* ==========================================================================
 * SECTION 8c - CORRECTION STORE (deterministic self-learning)
 * ========================================================================== */

const CORRECTION_SCHEMA_VERSION = 1;

/** Hard caps. Everything the store learns is bounded and LRU-evicted. */
const CORRECTION_LIMITS = Object.freeze({
  lines: 400,   // exact-line overrides
  aliases: 800, // parser-name -> user-name mappings
  data: 300,    // per-ingredient gramsPerPiece / gramsPerMl
  items: 40,    // items kept per corrected line
});

/** Units that mean "the user counted objects" rather than weighed them. */
const COUNT_UNITS = new Set([
  "pcs", "pc", "piece", "pieces", "count", "each", "unit", "units", "item", "items",
  "clove", "cloves", "slice", "slices", "leaf", "leaves", "sprig", "sprigs",
]);

/** Volume units -> millilitres, for learning grams per ml. */
const VOLUME_FACTORS = Object.freeze({
  ml: 1, millilitre: 1, milliliter: 1, cl: 10, dl: 100, l: 1000, litre: 1000, liter: 1000,
  tsp: 5, teaspoon: 5, teaspoons: 5, tbsp: 15, tablespoon: 15, tablespoons: 15,
  cup: 240, cups: 240, glass: 240, floz: 29.5735, pint: 473.176, quart: 946.353,
});

/** Normalise a line into the lookup key: lower case, single spaces, no period. */
function correctionKey(line) {
  return String(line == null ? "" : line)
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .trim()
    .replace(/[.!]+$/g, "")
    .trim();
}

/** Coerce one corrected/original entry into { name, qty, unit }. */
function correctionItem(entry) {
  if (!entry || typeof entry !== "object") return null;
  const name = String(entry.name == null ? "" : entry.name).trim();
  if (!name) return null;
  const rawQty = entry.qty != null ? entry.qty : entry.quantity;
  const qty = Number(rawQty);
  const unit = String(entry.unit == null ? "g" : entry.unit).trim().toLowerCase() || "g";
  return { name, qty: Number.isFinite(qty) ? qty : 0, unit };
}

/** Normalise a whole signature (array of items); null entries are dropped. */
function correctionSignature(items) {
  if (!Array.isArray(items)) return [];
  return items.map(correctionItem).filter(Boolean).slice(0, CORRECTION_LIMITS.items);
}

function signatureEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name.toLowerCase() !== b[i].name.toLowerCase()) return false;
    if (Math.abs(a[i].qty - b[i].qty) > 1e-9) return false;
    if (a[i].unit !== b[i].unit) return false;
  }
  return true;
}

/** Recompute the display-facing fields of an item after a numeric change. */
function retuneItem(item, grams, ingredient, category) {
  const nutrition = computeNutrition(grams, ingredient, category);
  const quantity = roundAmount(grams);
  const ui = convertMetricToUIFraction(quantity, "g", ingredient || category);
  return {
    ...item,
    quantity,
    unit: "g",
    grams: roundAmount(grams),
    nutrition,
    metric: `${formatQuantity(quantity)} g`,
    uiFraction: ui.label,
    container: { name: ui.container, size: ui.size, unit: ui.unit, ratio: ui.ratio, fraction: ui.fraction },
  };
}

/** Build a complete output item from a learned { name, qty, unit } entry. */
function learnedItem(entry, source, input) {
  const ingredient = getIngredient(entry.name);
  const unit = entry.unit === "ml" ? "ml" : "g";
  const quantity = roundAmount(entry.qty);
  const category = ingredient ? ingredient.category : (source && source.category) || "other";
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.other;
  const density = ingredient ? ingredient.density : (source && source.density) || profile.density;
  const grams = unit === "g" ? quantity : quantity * density;
  const nutrition = computeNutrition(grams, ingredient, category);
  const ui = convertMetricToUIFraction(quantity, unit, ingredient || category);
  const name = ingredient ? ingredient.name : titleCase(entry.name);
  return {
    input,
    name,
    canonicalName: name,
    quantity,
    unit,
    grams: roundAmount(grams),
    density,
    category,
    categoryLabel: profile.label,
    preparation: (source && source.preparation) || "",
    vague: false,
    always: source ? Boolean(source.always) : false,
    metric: `${formatQuantity(quantity)} ${unit}`,
    displayAmount: `${formatQuantity(quantity)} ${unit}`,
    displayQty: quantity,
    displayUnit: unit,
    uiFraction: ui.label,
    container: { name: ui.container, size: ui.size, unit: ui.unit, ratio: ui.ratio, fraction: ui.fraction },
    range: null,
    nutrition,
    confidence: 0.99,
    matchedBy: "learned|exact-line",
    learned: true,
  };
}

/**
 * Deterministic correction store: learns from the edits a user makes to parsed
 * ingredients and replays them on later parses.
 *
 * Learning happens at three levels:
 *   a) exact line    - the same normalised line parses the same corrected way
 *   b) aliases       - "curry" -> "curry leaves", applied to any line
 *   c) per-ingredient data - gramsPerPiece / gramsPerMl inferred from the
 *                      corrected quantity and unit, used by later conversions
 *
 * A correction overrides the built-in parse only after 2 agreeing records, or
 * after 1 record from the store's own user (options.userId). A later
 * contradictory correction wins. State is capped per collection and evicted
 * least-recently-used; export()/import() round-trip through JSON with a
 * schemaVersion so older data migrates.
 *
 * @param {object} [initial]  a previous export() payload to restore
 * @param {object} [options]
 * @param {string} [options.userId]  identity whose single correction counts
 * @param {object} [options.limits]  override the caps
 */
export function createCorrectionStore(initial = null, options = {}) {
  const limits = { ...CORRECTION_LIMITS, ...(options.limits || {}) };
  const state = {
    schemaVersion: CORRECTION_SCHEMA_VERSION,
    userId: options.userId != null ? String(options.userId) : null,
    seq: 0,
    corrections: 0,
    lines: new Map(),
    aliases: new Map(),
    data: new Map(),
  };

  const nextSeq = () => (state.seq += 1);
  const sameUser = (userId) => userId != null && state.userId != null && String(userId) === state.userId;
  const meetsThreshold = (entry) => Boolean(entry) && (entry.votes >= 2 || entry.trusted === true);

  /** Drop the least-recently-used entries until the collection fits its cap. */
  function evict(collection, cap) {
    if (collection.size <= cap) return;
    const ordered = [...collection.entries()].sort((a, b) => a[1].lastSeq - b[1].lastSeq);
    let excess = collection.size - cap;
    for (const [key] of ordered) {
      if (excess <= 0) break;
      collection.delete(key);
      excess -= 1;
    }
  }

  function evictAll() {
    evict(state.lines, limits.lines);
    evict(state.aliases, limits.aliases);
    evict(state.data, limits.data);
  }

  /** Level (b): remember that the parser's name should read as the user's. */
  function learnAlias(from, to, trusted) {
    if (!from || !to) return;
    const key = String(from).trim().toLowerCase();
    const target = String(to).trim();
    if (!key || !target || key === target.toLowerCase()) return;
    const existing = state.aliases.get(key);
    if (!existing) {
      state.aliases.set(key, { to: target, votes: 1, trusted, lastSeq: nextSeq() });
      return;
    }
    if (existing.to.toLowerCase() === target.toLowerCase()) {
      existing.votes += 1;
      existing.trusted = existing.trusted || trusted;
      existing.lastSeq = nextSeq();
      return;
    }
    // Contradiction: the most recent correction wins.
    state.aliases.set(key, { to: target, votes: 1, trusted, lastSeq: nextSeq() });
  }

  /** Level (c): remember grams per piece / grams per ml for one ingredient. */
  function learnData(name, field, value, trusted) {
    if (!name || !(value > 0) || !Number.isFinite(value)) return;
    const key = String(name).trim().toLowerCase();
    let entry = state.data.get(key);
    if (!entry) {
      entry = { name: String(name).trim(), lastSeq: nextSeq() };
      state.data.set(key, entry);
    }
    const current = entry[field];
    if (!current) {
      entry[field] = { value, votes: 1, trusted, lastSeq: nextSeq() };
    } else if (Math.abs(current.value - value) <= Math.max(0.05 * current.value, 0.5)) {
      // Agreeing evidence: fold into a running mean.
      current.value = (current.value * current.votes + value) / (current.votes + 1);
      current.votes += 1;
      current.trusted = current.trusted || trusted;
      current.lastSeq = nextSeq();
    } else {
      // Contradiction: the most recent correction wins.
      entry[field] = { value, votes: 1, trusted, lastSeq: nextSeq() };
    }
    entry.lastSeq = nextSeq();
  }

  /** Apply a learned alias to one parsed item, recomputing macros if possible. */
  function renameItem(item, newName) {
    const ingredient = getIngredient(newName);
    const name = ingredient ? ingredient.name : titleCase(newName);
    const next = {
      ...item,
      name,
      canonicalName: name,
      learned: true,
      confidence: Math.max(Number(item.confidence) || 0, 0.97),
      matchedBy: `${item.matchedBy || "learned"}|alias`,
    };
    if (ingredient) {
      next.category = ingredient.category;
      next.categoryLabel = (CATEGORY_PROFILES[ingredient.category] || CATEGORY_PROFILES.other).label;
      next.density = ingredient.density;
      Object.assign(next, retuneItem(next, item.grams, ingredient, ingredient.category));
    }
    return next;
  }

  /** Apply learned gramsPerPiece / gramsPerMl to one parsed item. */
  function applyLearnedData(item, entry) {
    const displayUnit = String(item.displayUnit || "").toLowerCase();
    const displayQty = Number(item.displayQty);
    if (!(displayQty > 0)) return item;
    let grams = null;
    let source = null;
    if (entry.gramsPerPiece && meetsThreshold(entry.gramsPerPiece) && (displayUnit === "pcs" || COUNT_UNITS.has(displayUnit))) {
      grams = displayQty * entry.gramsPerPiece.value;
      source = "piece";
    } else if (entry.gramsPerMl && meetsThreshold(entry.gramsPerMl) && VOLUME_FACTORS[displayUnit] != null) {
      grams = displayQty * VOLUME_FACTORS[displayUnit] * entry.gramsPerMl.value;
      source = "density";
    }
    if (grams == null || !(grams > 0)) return item;
    const ingredient = getIngredient(item.name);
    const updated = retuneItem(item, grams, ingredient, item.category);
    return {
      ...updated,
      learned: true,
      confidence: Math.max(Number(item.confidence) || 0, 0.95),
      matchedBy: `${item.matchedBy || "learned"}|learned:${source}`,
    };
  }

  const api = {
    /**
     * Record one user correction.
     * @param {{line:string, original:Array<{name:string,qty:number,unit:string}>,
     *          corrected:Array<{name:string,qty:number,unit:string}>,
     *          context?:{userId?:string}}} correction  `corrected` may be empty
     *          when the user deleted the parsed item
     * @returns {object} the store (chainable)
     */
    recordCorrection(correction) {
      if (!correction || typeof correction !== "object") return api;
      const key = correctionKey(correction.line);
      if (!key) return api;
      const before = correctionSignature(correction.original);
      const after = correctionSignature(correction.corrected);
      const userId = correction.context && correction.context.userId != null ? String(correction.context.userId) : null;
      const trusted = sameUser(userId);
      state.corrections += 1;

      // (a) exact line
      const existing = state.lines.get(key);
      if (!existing) {
        state.lines.set(key, { items: after, votes: 1, trusted, lastSeq: nextSeq() });
      } else if (signatureEquals(existing.items, after)) {
        existing.votes += 1;
        existing.trusted = existing.trusted || trusted;
        existing.lastSeq = nextSeq();
      } else {
        state.lines.set(key, { items: after, votes: 1, trusted, lastSeq: nextSeq() }); // most recent wins
      }

      const pairs = Math.min(before.length, after.length);
      for (let i = 0; i < pairs; i++) {
        const from = before[i];
        const to = after[i];
        // (b) alias: the parser called it one thing, the user another.
        if (from.name && to.name && from.name.toLowerCase() !== to.name.toLowerCase()) learnAlias(from.name, to.name, trusted);
        // (c) per-ingredient data, only when the ingredient itself is the same.
        if (!from.name || !to.name || from.name.toLowerCase() !== to.name.toLowerCase()) continue;
        if (!(from.qty > 0) || !(to.qty > 0)) continue;
        const fromUnit = String(from.unit || "").toLowerCase();
        const toUnit = String(to.unit || "").toLowerCase();
        if (toUnit === "g" && COUNT_UNITS.has(fromUnit)) {
          learnData(to.name, "gramsPerPiece", to.qty / from.qty, trusted); // "1 lemon" -> "120 g"
        } else if (toUnit === "g" && VOLUME_FACTORS[fromUnit] != null) {
          learnData(to.name, "gramsPerMl", to.qty / (from.qty * VOLUME_FACTORS[fromUnit]), trusted); // "1 cup" -> "90 g"
        } else if (toUnit === "g" && fromUnit === "ml") {
          learnData(to.name, "gramsPerMl", to.qty / from.qty, trusted);
        }
      }

      evictAll();
      return api;
    },

    /**
     * Apply everything learned to one already-parsed line.
     * Returns the original array untouched when nothing clears its threshold.
     * Learned items carry `learned: true` and a raised `confidence`.
     */
    applyLearned(line, parsedItems) {
      const items = Array.isArray(parsedItems) ? parsedItems : [];
      if (!items.length) return items;
      const key = correctionKey(line);
      const lineEntry = key ? state.lines.get(key) : null;
      if (lineEntry && meetsThreshold(lineEntry)) {
        lineEntry.lastSeq = nextSeq();
        return lineEntry.items.map((entry, index) => learnedItem(entry, items[index], String(line)));
      }

      let changed = false;
      const out = items.map((item) => {
        let next = item;
        const alias = state.aliases.get(String(next.name || "").toLowerCase());
        if (alias && meetsThreshold(alias)) {
          alias.lastSeq = nextSeq();
          next = renameItem(next, alias.to);
          changed = true;
        }
        const data = state.data.get(String(next.name || "").toLowerCase());
        if (data) {
          const updated = applyLearnedData(next, data);
          if (updated !== next) {
            data.lastSeq = nextSeq();
            next = updated;
            changed = true;
          }
        }
        return next;
      });
      return changed ? out : items;
    },

    /** Plain JSON snapshot (safe for localStorage / IndexedDB). */
    export() {
      const snapshot = {
        schemaVersion: CORRECTION_SCHEMA_VERSION,
        userId: state.userId,
        seq: state.seq,
        corrections: state.corrections,
        lines: [],
        aliases: [],
        data: [],
      };
      for (const [key, entry] of state.lines) {
        snapshot.lines.push({
          key,
          items: entry.items.map((item) => ({ ...item })),
          votes: entry.votes,
          trusted: Boolean(entry.trusted),
          lastSeq: entry.lastSeq,
        });
      }
      for (const [from, entry] of state.aliases) {
        snapshot.aliases.push({ from, to: entry.to, votes: entry.votes, trusted: Boolean(entry.trusted), lastSeq: entry.lastSeq });
      }
      for (const [, entry] of state.data) {
        const record = { name: entry.name, lastSeq: entry.lastSeq };
        if (entry.gramsPerPiece) record.gramsPerPiece = { ...entry.gramsPerPiece };
        if (entry.gramsPerMl) record.gramsPerMl = { ...entry.gramsPerMl };
        snapshot.data.push(record);
      }
      return snapshot;
    },

    /**
     * Restore an export() payload. Accepts older data without schemaVersion
     * (treated as version 0) and never throws on malformed collections.
     */
    import(payload) {
      if (!payload || typeof payload !== "object") return api;
      state.lines.clear();
      state.aliases.clear();
      state.data.clear();
      const version = Number(payload.schemaVersion || 0);
      state.schemaVersion = CORRECTION_SCHEMA_VERSION;
      if (payload.userId != null) state.userId = String(payload.userId);
      state.seq = Number(payload.seq) || 0;
      state.corrections = Number(payload.corrections) || 0;

      const lines = Array.isArray(payload.lines) ? payload.lines : Object.entries(payload.lines || {}).map(([key, items]) => ({ key, items }));
      for (const entry of lines) {
        if (!entry || !entry.key) continue;
        const items = correctionSignature(Array.isArray(entry.items) ? entry.items : []);
        state.lines.set(correctionKey(entry.key), {
          items,
          votes: Number(entry.votes) || (version >= 1 ? 1 : 2), // v0 stored only accepted lines
          trusted: Boolean(entry.trusted),
          lastSeq: Number(entry.lastSeq) || nextSeq(),
        });
      }
      const aliases = Array.isArray(payload.aliases) ? payload.aliases : Object.entries(payload.aliases || {}).map(([from, to]) => ({ from, to }));
      for (const entry of aliases) {
        if (!entry || !entry.from || !entry.to) continue;
        state.aliases.set(String(entry.from).toLowerCase(), {
          to: String(entry.to),
          votes: Number(entry.votes) || (version >= 1 ? 1 : 2), // v0 stored only accepted aliases
          trusted: Boolean(entry.trusted),
          lastSeq: Number(entry.lastSeq) || nextSeq(),
        });
      }
      const data = Array.isArray(payload.data) ? payload.data : [];
      for (const entry of data) {
        if (!entry || !entry.name) continue;
        const record = { name: String(entry.name), lastSeq: Number(entry.lastSeq) || nextSeq() };
        for (const field of ["gramsPerPiece", "gramsPerMl"]) {
          const value = entry[field];
          const numeric = typeof value === "number" ? value : value && value.value;
          if (numeric > 0) {
            record[field] = {
              value: Number(numeric),
              votes: (value && Number(value.votes)) || (version >= 1 ? 1 : 2),
              trusted: Boolean(value && value.trusted),
              lastSeq: (value && Number(value.lastSeq)) || nextSeq(),
            };
          }
        }
        state.data.set(record.name.toLowerCase(), record);
      }
      evictAll();
      return api;
    },

    /** Counts and remaining capacity, for UI or debugging. */
    stats() {
      let pieces = 0;
      let densities = 0;
      for (const entry of state.data.values()) {
        if (entry.gramsPerPiece) pieces += 1;
        if (entry.gramsPerMl) densities += 1;
      }
      return {
        schemaVersion: CORRECTION_SCHEMA_VERSION,
        userId: state.userId,
        corrections: state.corrections,
        lines: state.lines.size,
        aliases: state.aliases.size,
        ingredients: state.data.size,
        gramsPerPiece: pieces,
        gramsPerMl: densities,
        capacity: { ...limits },
      };
    },
  };

  if (initial) api.import(initial);
  return api;
}

/**
 * Self tests for the v1.1 extensions: recipe steps, the correction store,
 * displayUnit/displayQty and the South Asian staple matrix. Registered from
 * runSelfTests() so `node ingredient-engine.js` covers everything.
 */
function registerExtensionTests(test) {
  /* ---------------- 10. Recipe steps ---------------- */
  test("steps: numbered with periods keeps 0-based indices and strips markers", () => {
    const { steps } = parseRecipeSteps("1. Boil the water.\n2. Add the pasta.");
    assertEqual(steps.length, 2, "step count");
    assertEqual(steps[0].index, 0, "first index");
    assertEqual(steps[1].index, 1, "second index");
    assertEqual(steps[0].text, "Boil the water.", "first text");
    assertEqual(steps[1].text, "Add the pasta.", "second text");
  });

  test("steps: numbered with parentheses", () => {
    const { steps } = parseRecipeSteps("1) Chop the onions\n2) Fry them");
    assertEqual(steps.length, 2, "step count");
    assertEqual(steps[0].text, "Chop the onions", "first text");
    assertEqual(steps[1].text, "Fry them", "second text");
  });

  test("steps: Step N: markers", () => {
    const { steps } = parseRecipeSteps("Step 1: Preheat the oven.\nStep 2: Bake the bread.");
    assertEqual(steps.length, 2, "step count");
    assertEqual(steps[0].text, "Preheat the oven.", "first text");
  });

  test("steps: bulleted list", () => {
    const { steps } = parseRecipeSteps("- Mix well.\n- Serve hot.");
    assertEqual(steps.length, 2, "step count");
    assertEqual(steps[0].text, "Mix well.", "first text");
    assertEqual(steps[1].index, 1, "second index");
  });

  test("steps: one step per line without markers", () => {
    const { steps } = parseRecipeSteps("Heat the oil\nAdd the onions\nStir gently");
    assertEqual(steps.length, 3, "step count");
    assertEqual(steps[1].text, "Add the onions", "second text");
  });

  test("steps: one paragraph splits into sentences", () => {
    const { steps } = parseRecipeSteps("Heat the oil. Add the onions. Stir until golden.");
    assertEqual(steps.length, 3, "step count");
    assertEqual(steps[2].text, "Stir until golden.", "third text");
  });

  test("steps: HTML is stripped and paragraphs split", () => {
    const { steps } = parseRecipeSteps("<p>Boil the pasta.</p><p>Drain it.</p>");
    assertEqual(steps.length, 2, "step count");
    assertEqual(steps[0].text, "Boil the pasta.", "first text");
    assertEqual(steps[1].text, "Drain it.", "second text");
  });

  test("steps: entities and double spaces are cleaned", () => {
    const { steps } = parseRecipeSteps("<p>Mix&nbsp;well  now.</p>");
    assertEqual(steps[0].text, "Mix well now.", "cleaned text");
  });

  test("steps: a Method heading is not a step", () => {
    const { steps } = parseRecipeSteps("Method\n1. Boil the rice.");
    assertEqual(steps.length, 1, "step count");
    assertEqual(steps[0].text, "Boil the rice.", "text");
  });

  test("durations: plain minutes", () => {
    const durations = detectDurations("Cook for 10 minutes.");
    assertEqual(durations.length, 1, "one duration");
    assertEqual(durations[0].seconds, 600, "seconds");
    assertEqual(durations[0].kind, "cook", "kind");
    assertEqual(durations[0].approximate, false, "not approximate");
  });

  test("durations: ranges use the lower bound and keep rangeText", () => {
    const durations = detectDurations("Simmer for 10-15 minutes until tender.");
    assertEqual(durations.length, 1, "one duration");
    assertEqual(durations[0].seconds, 600, "lower bound");
    assertEqual(durations[0].rangeText, "10-15 minutes", "rangeText");
    assertEqual(durations[0].label, "until tender", "label from purpose");
    assertEqual(durations[0].kind, "simmer", "kind");
  });

  test("durations: compound hours and minutes", () => {
    const durations = detectDurations("Bake for 1 hour 30 minutes.");
    assertEqual(durations.length, 1, "one duration");
    assertEqual(durations[0].seconds, 5400, "combined seconds");
    assertEqual(durations[0].kind, "bake", "kind");
  });

  test("durations: worded times", () => {
    assertEqual(detectDurations("Rest for an hour.")[0].seconds, 3600, "an hour");
    assertEqual(detectDurations("Chill for half an hour.")[0].seconds, 1800, "half an hour");
    assertEqual(detectDurations("Stand for half an hour.")[0].kind, "rest", "kind");
  });

  test("durations: overnight is 8 hours and approximate", () => {
    const durations = detectDurations("Chill overnight.");
    assertEqual(durations.length, 1, "one duration");
    assertEqual(durations[0].seconds, 28800, "8 hours");
    assertEqual(durations[0].approximate, true, "approximate");
    assertEqual(durations[0].kind, "chill", "kind");
  });

  test("durations: 'until golden' has no duration", () => {
    assertEqual(detectDurations("Bake until golden brown.").length, 0, "no duration");
  });

  test("durations: '2 min per side' yields two durations", () => {
    const durations = detectDurations("Grill for 2 minutes per side.");
    assertEqual(durations.length, 2, "two sides");
    assertEqual(durations[0].seconds, 120, "first side seconds");
    assertEqual(durations[1].seconds, 120, "second side seconds");
    assert(durations[1].label.includes("second side"), "second side label");
  });

  test("durations: prep metadata is not a timer", () => {
    assertEqual(detectDurations("This takes 20 minutes to prepare.").length, 0, "takes to prepare");
    assertEqual(detectDurations("After 5 minutes you will see the colour change.").length, 1, "real timer");
  });

  test("durations: annotation kinds", () => {
    assertEqual(detectDurations("Simmer for 10 minutes.")[0].kind, "simmer", "simmer");
    assertEqual(detectDurations("Chill for 2 hours.")[0].kind, "chill", "chill");
    assertEqual(detectDurations("Marinate for 4 hours.")[0].kind, "marinate", "marinate");
    assertEqual(detectDurations("Soak for 30 minutes.")[0].kind, "soak", "soak");
    assertEqual(detectDurations("Prove for 1 hour.")[0].kind, "proof", "proof");
  });

  test("steps: 'for 3 whistles' is reported as a warning, not a duration", () => {
    const { steps, warnings } = parseRecipeSteps("Cook for 3 whistles.");
    assertEqual(steps[0].durations.length, 0, "no duration");
    assertEqual(warnings.length, 1, "one warning");
    assert(warnings[0].includes("Step 1"), "warning names the step");
  });

  test("steps: oven temperature", () => {
    const celsius = parseRecipeSteps("Bake at 200°C for 20 minutes.").steps[0];
    assertEqual(celsius.temperature.value, 200, "celsius value");
    assertEqual(celsius.temperature.unit, "C", "celsius unit");
    const fahrenheit = parseRecipeSteps("Roast at 400 F for 30 minutes.").steps[0];
    assertEqual(fahrenheit.temperature.value, 400, "fahrenheit value");
    assertEqual(fahrenheit.temperature.unit, "F", "fahrenheit unit");
  });

  test("steps: ingredientsMentioned matches the recipe's own list", () => {
    const { steps } = parseRecipeSteps("Add the chopped tomatoes and the garlic.", {
      ingredients: ["2 tomatoes", "3 cloves garlic", "1 onion"],
    });
    assert(steps[0].ingredientsMentioned.includes("Tomato"), "tomato mentioned");
    assert(steps[0].ingredientsMentioned.includes("Garlic"), "garlic mentioned");
    assert(!steps[0].ingredientsMentioned.includes("Onion"), "onion not mentioned");
  });

  test("steps: several sentences inside one numbered block are separate steps", () => {
    const { steps } = parseRecipeSteps("Step 1: Mix the atta. Rest for 10 minutes. Then fry the chillies.");
    assertEqual(steps.length, 3, "step count");
    assertEqual(steps[1].text, "Rest for 10 minutes.", "second step text");
    assertEqual(steps[1].durations[0].seconds, 600, "duration stays with its sentence");
  });

  test("durations: the nearest verb decides the kind", () => {
    const durations = detectDurations("Rest for 10 minutes. Then fry for 2 minutes.");
    assertEqual(durations[0].kind, "rest", "first duration");
    assertEqual(durations[1].kind, "cook", "second duration");
  });

  test("durations: purpose does not leak from the next sentence", () => {
    const durations = detectDurations("Rest for 10 minutes. Fry until golden.");
    assertEqual(durations[0].label, "rest", "no borrowed purpose");
  });

  test("splitStepsText is exported and returns plain strings", () => {
    const steps = splitStepsText("1. One.\n2. Two.");
    assertEqual(steps.length, 2, "step count");
    assertEqual(typeof steps[0], "string", "string step");
  });

  /* ---------------- 11. Correction store ---------------- */
  const correctedLine = "1 cup besan";

  test("corrections: one anonymous record does not override the parse", () => {
    const store = createCorrectionStore();
    const parsed = parseIngredients(correctedLine);
    store.recordCorrection({
      line: correctedLine,
      original: [{ name: parsed[0].name, qty: 91.2, unit: "g" }],
      corrected: [{ name: parsed[0].name, qty: 100, unit: "g" }],
    });
    const learned = store.applyLearned(correctedLine, parsed);
    assertEqual(learned[0].quantity, 91.2, "one vote keeps the built-in parse");
  });

  test("corrections: two agreeing records override the line", () => {
    const store = createCorrectionStore();
    const parsed = parseIngredients(correctedLine);
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: correctedLine,
        original: [{ name: parsed[0].name, qty: 91.2, unit: "g" }],
        corrected: [{ name: parsed[0].name, qty: 100, unit: "g" }],
      });
    }
    const learned = store.applyLearned(correctedLine, parsed);
    assertEqual(learned[0].quantity, 100, "two votes override");
    assertEqual(learned[0].learned, true, "learned flag");
    assert(learned[0].confidence >= 0.9, "confidence raised");
  });

  test("corrections: one record from the store's own user is enough", () => {
    const store = createCorrectionStore(null, { userId: "chef-1" });
    const parsed = parseIngredients(correctedLine);
    store.recordCorrection({
      line: correctedLine,
      original: [{ name: parsed[0].name, qty: 91.2, unit: "g" }],
      corrected: [{ name: parsed[0].name, qty: 110, unit: "g" }],
      context: { userId: "chef-1" },
    });
    assertEqual(store.applyLearned(correctedLine, parsed)[0].quantity, 110, "same-user override");
  });

  test("corrections: line keys are normalised (case and spacing)", () => {
    const store = createCorrectionStore();
    const parsed = parseIngredients(correctedLine);
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "  1  CUP   Besan. ",
        original: [{ name: parsed[0].name, qty: 91.2, unit: "g" }],
        corrected: [{ name: parsed[0].name, qty: 100, unit: "g" }],
      });
    }
    assertEqual(store.applyLearned(correctedLine, parsed)[0].quantity, 100, "normalised key matches");
  });

  test("corrections: ingredient aliases learned from renames apply everywhere", () => {
    const store = createCorrectionStore();
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "3 cloves of garlic",
        original: [{ name: "Garlic", qty: 15, unit: "g" }],
        corrected: [{ name: "Garlic Paste", qty: 15, unit: "g" }],
      });
    }
    const items = parseIngredients("4 cloves of garlic", { corrections: store });
    assertEqual(items[0].name, "Garlic Paste", "alias applied to another line");
    assertEqual(items[0].learned, true, "learned flag");
  });

  test("corrections: contradictory records go to the most recent", () => {
    const store = createCorrectionStore();
    const parsed = parseIngredients(correctedLine);
    const original = [{ name: parsed[0].name, qty: 91.2, unit: "g" }];
    for (const qty of [100, 100]) {
      store.recordCorrection({ line: correctedLine, original, corrected: [{ name: parsed[0].name, qty, unit: "g" }] });
    }
    assertEqual(store.applyLearned(correctedLine, parsed)[0].quantity, 100, "first correction");
    store.recordCorrection({ line: correctedLine, original, corrected: [{ name: parsed[0].name, qty: 130, unit: "g" }] });
    assertEqual(store.applyLearned(correctedLine, parsed)[0].quantity, 91.2, "a single contradiction resets the votes");
    store.recordCorrection({ line: correctedLine, original, corrected: [{ name: parsed[0].name, qty: 130, unit: "g" }] });
    assertEqual(store.applyLearned(correctedLine, parsed)[0].quantity, 130, "most recent wins");
  });

  test("corrections: grams per piece is learned from counted items", () => {
    const store = createCorrectionStore();
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "2 lemons",
        original: [{ name: "Lemon", qty: 2, unit: "pcs" }],
        corrected: [{ name: "Lemon", qty: 240, unit: "g" }],
      });
    }
    const items = parseIngredients("1 lemon", { corrections: store });
    assertEqual(items[0].quantity, 120, "learned grams per piece");
    assertEqual(items[0].unit, "g", "unit");
  });

  test("corrections: grams per ml is learned from volume corrections", () => {
    const store = createCorrectionStore();
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "1 cup besan",
        original: [{ name: "Besan (Gram Flour)", qty: 1, unit: "cup" }],
        corrected: [{ name: "Besan (Gram Flour)", qty: 100, unit: "g" }],
      });
    }
    const items = parseIngredients("1 cup besan", { corrections: store });
    assertEqual(items[0].quantity, 100, "learned density applied to a fresh parse");
  });

  test("corrections: deleted items stay deleted", () => {
    const store = createCorrectionStore();
    const parsed = parseIngredients("1 tsp salt and pepper");
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "1 tsp salt and pepper",
        original: parsed.map((item) => ({ name: item.name, qty: item.quantity, unit: item.unit })),
        corrected: [],
      });
    }
    assertEqual(store.applyLearned("1 tsp salt and pepper", parsed).length, 0, "items deleted");
  });

  test("corrections: export / import round-trips through JSON", () => {
    const store = createCorrectionStore(null, { userId: "u-9" });
    for (let i = 0; i < 2; i++) {
      store.recordCorrection({
        line: "1 tbsp besan",
        original: [{ name: "Besan (Gram Flour)", qty: 5.7, unit: "g" }],
        corrected: [{ name: "Besan (Gram Flour)", qty: 8, unit: "g" }],
      });
    }
    const snapshot = JSON.parse(JSON.stringify(store.export()));
    assertEqual(snapshot.schemaVersion, 1, "schemaVersion present");
    const restored = createCorrectionStore(snapshot);
    const parsed = parseIngredients("1 tbsp besan");
    assertEqual(restored.applyLearned("1 tbsp besan", parsed)[0].quantity, 8, "restored override");
    assertEqual(restored.stats().lines, store.stats().lines, "line count survives");
    const legacy = createCorrectionStore({ lines: { "1 cup besan": [{ name: "Besan (Gram Flour)", qty: 100, unit: "g" }] } });
    assertEqual(legacy.applyLearned("1 cup besan", parsed)[0].quantity, 100, "legacy data migrates as accepted");
  });

  test("corrections: stats reports collections and caps", () => {
    const store = createCorrectionStore();
    store.recordCorrection({ line: "1 cup besan", original: [], corrected: [{ name: "Besan (Gram Flour)", qty: 100, unit: "g" }] });
    const stats = store.stats();
    assertEqual(stats.lines, 1, "line count");
    assertEqual(stats.corrections, 1, "correction count");
    assert(stats.capacity.lines > 0, "caps reported");
  });

  test("corrections: the store is bounded and evicts the least recent", () => {
    const store = createCorrectionStore(null, { limits: { lines: 3 } });
    for (let i = 0; i < 5; i++) {
      for (let vote = 0; vote < 2; vote++) {
        store.recordCorrection({
          line: `1 cup besan ${i}`,
          original: [{ name: "Besan (Gram Flour)", qty: 91.2, unit: "g" }],
          corrected: [{ name: "Besan (Gram Flour)", qty: 100 + i, unit: "g" }],
        });
      }
    }
    assertEqual(store.stats().lines, 3, "cap enforced");
    const old = parseIngredients("1 cup besan 0");
    assertEqual(store.applyLearned("1 cup besan 0", old)[0].quantity, 91.2, "oldest entry evicted");
    const fresh = parseIngredients("1 cup besan 4");
    assertEqual(store.applyLearned("1 cup besan 4", fresh)[0].quantity, 104, "newest entry kept");
  });

  test("corrections: optional store leaves parsing unchanged", () => {
    const line = "2 1/2 cups whole milk";
    const plain = parseIngredients(line);
    const withStore = parseIngredients(line, { corrections: createCorrectionStore() });
    assertEqual(withStore[0].quantity, plain[0].quantity, "quantity unchanged");
    assertEqual(withStore[0].name, plain[0].name, "name unchanged");
    assertEqual(withStore[0].learned, undefined, "no learned flag");
  });

  /* ---------------- 12. displayUnit / displayQty ---------------- */
  test("display: cups keep the source unit and quantity", () => {
    const item = parseIngredient("2 1/2 cups whole milk");
    assertEqual(item.displayQty, 2.5, "displayQty");
    assertEqual(item.displayUnit, "cup", "displayUnit");
    assertEqual(item.quantity, 600, "metric quantity unchanged");
  });

  test("display: spoons and grams", () => {
    assertEqual(parseIngredient("3 tbsp olive oil").displayUnit, "tbsp", "tbsp");
    assertEqual(parseIngredient("3 tbsp olive oil").displayQty, 3, "tbsp qty");
    assertEqual(parseIngredient("500 g chicken breast").displayUnit, "g", "g");
    assertEqual(parseIngredient("500 g chicken breast").displayQty, 500, "g qty");
    assertEqual(parseIngredient("2 tsp salt").displayUnit, "tsp", "tsp");
  });

  test("display: counted items use the measure word or pcs", () => {
    assertEqual(parseIngredient("3 cloves of garlic").displayUnit, "clove", "clove");
    assertEqual(parseIngredient("3 cloves of garlic").displayQty, 3, "clove qty");
    assertEqual(parseIngredient("2 eggs").displayUnit, "pcs", "pcs");
    assertEqual(parseIngredient("2 eggs").displayQty, 2, "pcs qty");
    const cans = parseIngredient("2 x 400 g cans chopped tomatoes");
    assertEqual(cans.displayUnit, "can", "package word");
    assertEqual(cans.displayQty, 2, "packages");
  });

  /* ---------------- 13. South Asian staples ---------------- */
  test("staples: flours use measured cup weights", () => {
    assertClose(parseIngredient("1 cup atta").quantity, 120, 0.001, "atta (0.50 g/ml)");
    assertClose(parseIngredient("1 cup besan").quantity, 91.2, 0.001, "besan (0.38 g/ml)");
    assertClose(parseIngredient("1 cup maida").quantity, 124.8, 0.001, "maida (0.52 g/ml)");
    assertClose(parseIngredient("1 cup poha").quantity, 72, 0.001, "poha (0.30 g/ml)");
    assertClose(parseIngredient("1 cup rava").quantity, 168, 0.001, "rava = semolina (0.70 g/ml)");
  });

  test("staples: ghee, paneer, curd and jaggery", () => {
    assertClose(parseIngredient("2 tbsp ghee").quantity, 27.3, 0.01, "ghee density");
    assertEqual(parseIngredient("250 g paneer").name, "Paneer", "paneer");
    assertClose(parseIngredient("250 g paneer").nutrition.protein, 45.8, 0.01, "paneer protein");
    assertEqual(parseIngredient("1 cup curd").unit, "ml", "curd is a liquid");
    assertClose(parseIngredient("1 cup curd").grams, 247.2, 0.01, "curd density");
    assertClose(parseIngredient("100 g jaggery").nutrition.kcal, 383, 0.01, "jaggery kcal");
  });

  test("staples: dals resolve to their own ingredients", () => {
    assertEqual(parseIngredient("1 cup toor dal").name, "Toor Dal", "toor");
    assertEqual(parseIngredient("1 cup moong dal").name, "Moong Dal", "moong");
    assertEqual(parseIngredient("1 cup masoor dal").name, "Masoor Dal", "masoor");
    assertEqual(parseIngredient("1 cup chana dal").name, "Chana Dal", "chana");
    assertEqual(parseIngredient("1 cup urad dal").name, "Urad Dal", "urad");
  });

  test("staples: spices and aromatics", () => {
    assertEqual(parseIngredient("1 tsp haldi").name, "Turmeric", "haldi alias");
    assertEqual(parseIngredient("1 tsp jeera").name, "Cumin", "jeera alias");
    assertEqual(parseIngredient("1 pinch hing").name, "Hing (Asafoetida)", "hing");
    assertEqual(parseIngredient("1 tsp amchur").name, "Amchur (Mango Powder)", "amchur");
    assertEqual(parseIngredient("1 tsp chaat masala").name, "Chaat Masala", "chaat masala");
    assertEqual(parseIngredient("1 tbsp kasuri methi").name, "Kasuri Methi", "kasuri methi");
    assertEqual(parseIngredient("10 curry leaves").name, "Curry Leaves", "curry leaves");
  });

  test("staples: piece weights for small produce", () => {
    const chilies = parseIngredient("2 green chilies");
    assertEqual(chilies.name, "Green Chili", "green chili name");
    assertClose(chilies.quantity, 10, 0.001, "5 g per green chili");
  });

  test("staples: cup weights are no longer the 240 g generic fallback", () => {
    const atta = parseIngredient("1 cup atta");
    assert(atta.quantity < 200, `atta cup should not be 240 g (got ${atta.quantity})`);
    assert(atta.nutrition.kcal > 300, "atta carries real macros");
  });

  test("directives: 'to taste' and 'as needed' both set always", () => {
    for (const line of ["salt, to taste", "salt as needed", "1 tsp salt, or to taste"]) {
      const item = parseIngredient(line);
      assertEqual(item.always, true, `${line} -> always`);
      assertEqual(item.name, "Salt", `${line} -> name`);
    }
    assertEqual(parseIngredient("1 tsp salt").always, false, "plain salt is not always");
  });
}

/* ==========================================================================
 * SECTION 9 - SELF TESTS
 * ========================================================================== */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  const limit = Math.abs(expected * tolerance) + 1e-9;
  if (!(Math.abs(actual - expected) <= limit)) {
    throw new Error(`${message} (expected ~${expected}, got ${actual})`);
  }
}

/** Hand-labelled corpus used by both the accuracy report and the benchmark. */
const ACCURACY_CORPUS = Object.freeze([
  { input: "1 cup all-purpose flour", name: "All-Purpose Flour", qty: 124.8, unit: "g", category: "granular" },
  { input: "2 tbsp olive oil", name: "Olive Oil", qty: 30, unit: "ml", category: "liquid" },
  { input: "1 tsp salt", name: "Salt", qty: 6, unit: "g", category: "granular" },
  { input: "500 g chicken breast", name: "Chicken Breast", qty: 500, unit: "g", category: "protein" },
  { input: "1 lb ground beef", name: "Ground Beef", qty: 453.6, unit: "g", category: "protein" },
  { input: "8 oz cream cheese", name: "Cream Cheese", qty: 226.8, unit: "g", category: "dense" },
  { input: "1 1/2 cups whole milk", name: "Whole Milk", qty: 360, unit: "ml", category: "liquid" },
  { input: "3 cloves of garlic, minced", name: "Garlic", qty: 15, unit: "g", category: "produce" },
  { input: "2 knobs of butter", name: "Butter", qty: 28, unit: "g", category: "fat" },
  { input: "a pinch of salt", name: "Salt", qty: 0.5, unit: "g", category: "granular" },
  { input: "a handful of almonds", name: "Almonds", qty: 45, unit: "g", category: "nut" },
  { input: "a handful of baby spinach", name: "Spinach", qty: 30, unit: "g", category: "leafy" },
  { input: "2 large eggs", name: "Egg", qty: 100, unit: "g", category: "dense" },
  { input: "1 medium onion", name: "Onion", qty: 110, unit: "g", category: "produce" },
  { input: "4 potatoes", name: "Potato", qty: 852, unit: "g", category: "produce" },
  { input: "1 head of lettuce", name: "Lettuce", qty: 500, unit: "g", category: "leafy" },
  { input: "1 bulb of garlic", name: "Garlic", qty: 50, unit: "g", category: "produce" },
  { input: "2 sticks of butter", name: "Butter", qty: 226, unit: "g", category: "fat" },
  { input: "1 block of cheddar cheese", name: "Cheddar Cheese", qty: 225, unit: "g", category: "dense" },
  { input: "1 can of chickpeas", name: "Chickpeas", qty: 400, unit: "g", category: "dense" },
  { input: "1 can coconut milk", name: "Coconut Milk", qty: 400, unit: "ml", category: "liquid" },
  { input: "2 tins of chopped tomatoes", name: "Canned Tomatoes", qty: 800, unit: "g", category: "dense" },
  { input: "1 bunch of parsley", name: "Parsley", qty: 100, unit: "g", category: "herb" },
  { input: "a drizzle of olive oil", name: "Olive Oil", qty: 10, unit: "ml", category: "liquid" },
  { input: "a glug of vegetable oil", name: "Vegetable Oil", qty: 30, unit: "ml", category: "liquid" },
  { input: "a splash of soy sauce", name: "Soy Sauce", qty: 15, unit: "ml", category: "liquid" },
  { input: "1 glass of white wine", name: "White Wine", qty: 240, unit: "ml", category: "liquid" },
  { input: "2 slices of bacon", name: "Bacon", qty: 24, unit: "g", category: "protein" },
  { input: "1 kg of potatoes", name: "Potato", qty: 1000, unit: "g", category: "produce" },
  { input: "1/4 cup sugar", name: "Sugar", qty: 49.5, unit: "g", category: "granular" },
  { input: "3 tbsp honey", name: "Honey", qty: 45, unit: "ml", category: "liquid" },
  { input: "1 tsp vanilla extract", name: "Vanilla Extract", qty: 5, unit: "ml", category: "liquid" },
  { input: "2 1/2 cups flour", name: "All-Purpose Flour", qty: 312, unit: "g", category: "granular" },
  { input: "1-2 tsp chili flakes", name: "Chili Flakes", qty: 2.7, unit: "g", category: "spice" },
  { input: "2 to 3 tbsp milk", name: "Whole Milk", qty: 37.5, unit: "ml", category: "liquid" },
  { input: "about 400 g pasta", name: "Pasta", qty: 400, unit: "g", category: "granular" },
  { input: "juice of 1 lemon", name: "Lemon Juice", qty: 45, unit: "ml", category: "liquid" },
  { input: "zest of 2 limes", name: "Lime Zest", qty: 8, unit: "g", category: "produce" },
  { input: "1 (400 g) can diced tomatoes", name: "Canned Tomatoes", qty: 400, unit: "g", category: "dense" },
  { input: "2 x 400 g cans chopped tomatoes", name: "Canned Tomatoes", qty: 800, unit: "g", category: "dense" },
  { input: "½ cup butter", name: "Butter", qty: 109.3, unit: "g", category: "fat" },
  { input: "1½ cups milk", name: "Whole Milk", qty: 360, unit: "ml", category: "liquid" },
  { input: "2 cups baby spinach", name: "Spinach", qty: 60, unit: "g", category: "leafy" },
  { input: "1 tbsp soy sauce", name: "Soy Sauce", qty: 15, unit: "ml", category: "liquid" },
  { input: "a dash of hot sauce", name: "Hot Sauce", qty: 15, unit: "ml", category: "liquid" },
  { input: "a dash of paprika", name: "Paprika", qty: 0.5, unit: "g", category: "spice" },
  { input: "a tad of salt", name: "Salt", qty: 0.5, unit: "g", category: "granular" },
  { input: "half a cup of sugar", name: "Sugar", qty: 99, unit: "g", category: "granular" },
  { input: "a couple of cloves of garlic", name: "Garlic", qty: 10, unit: "g", category: "produce" },
  { input: "a few sprigs of thyme", name: "Thyme", qty: 1.5, unit: "g", category: "herb" },
  { input: "2 chicken breasts", name: "Chicken Breast", qty: 400, unit: "g", category: "protein" },
  { input: "1 salmon fillet", name: "Salmon", qty: 150, unit: "g", category: "protein" },
  { input: "3 rashers of bacon", name: "Bacon", qty: 36, unit: "g", category: "protein" },
  { input: "1 punnet of strawberries", name: "Strawberry", qty: 250, unit: "g", category: "produce" },
  { input: "1 tin of tuna", name: "Canned Tuna", qty: 145, unit: "g", category: "protein" },
  { input: "1 cup of chicken stock", name: "Chicken Stock", qty: 240, unit: "ml", category: "liquid" },
  { input: "1 tbsp butter", name: "Butter", qty: 13.7, unit: "g", category: "fat" },
  { input: "2 tsp baking powder", name: "Baking Powder", qty: 8, unit: "g", category: "granular" },
  { input: "1 cup grated parmesan", name: "Parmesan", qty: 100.1, unit: "g", category: "dense" },
  { input: "a knob of ginger", name: "Ginger", qty: 14, unit: "g", category: "produce" },
  { input: "1 thumb of ginger", name: "Ginger", qty: 15, unit: "g", category: "produce" },
  { input: "¾ cup sugar", name: "Sugar", qty: 148.5, unit: "g", category: "granular" },
  /* --- second batch: phrasing not used while tuning the rules --- */
  { input: "3 large garlic cloves, crushed", name: "Garlic", qty: 15, unit: "g", category: "produce" },
  { input: "2 pounds boneless skinless chicken thighs", name: "Chicken Thigh", qty: 907.2, unit: "g", category: "protein" },
  { input: "1 can (400 ml) coconut milk", name: "Coconut Milk", qty: 400, unit: "ml", category: "liquid" },
  { input: "1 (14 oz) can coconut milk", name: "Coconut Milk", qty: 396.9, unit: "g", category: "liquid" },
  { input: "2 cups cherry tomatoes", name: "Cherry Tomatoes", qty: 432, unit: "g", category: "produce" },
  { input: "1 tablespoon tomato paste", name: "Tomato Paste", qty: 15, unit: "ml", category: "liquid" },
  { input: "1 dozen eggs", name: "Egg", qty: 600, unit: "g", category: "dense" },
  { input: "half an onion", name: "Onion", qty: 55, unit: "g", category: "produce" },
  { input: "1 kg chicken thighs", name: "Chicken Thigh", qty: 1000, unit: "g", category: "protein" },
  { input: "500 ml milk", name: "Whole Milk", qty: 500, unit: "ml", category: "liquid" },
  { input: "1 litre of vegetable stock", name: "Vegetable Stock", qty: 1000, unit: "ml", category: "liquid" },
  { input: "2 slices of white bread", name: "Bread", qty: 60, unit: "g", category: "dense" },
  { input: "1 sheet of puff pastry", name: "Puff Pastry", qty: 25, unit: "g", category: "dense" },
  { input: "1 packet of instant yeast", name: "Yeast", qty: 7, unit: "g", category: "granular" },
  { input: "1 sachet of saffron", name: "Saffron", qty: 1, unit: "g", category: "spice" },
  { input: "3 cups of baby kale, torn", name: "Kale", qty: 93.6, unit: "g", category: "leafy" },
  { input: "1 bunch of basil", name: "Basil", qty: 50, unit: "g", category: "herb" },
  { input: "2 tbsp of plain flour", name: "All-Purpose Flour", qty: 15.6, unit: "g", category: "granular" },
  { input: "1 tsp of ground cinnamon", name: "Cinnamon", qty: 2.6, unit: "g", category: "spice" },
  { input: "4 x 150 g salmon fillets", name: "Salmon", qty: 600, unit: "g", category: "protein" },
  { input: "1 tsp of baking soda", name: "Baking Soda", qty: 4.5, unit: "g", category: "granular" },
  { input: "2 cups of basmati rice", name: "Rice", qty: 369.6, unit: "g", category: "granular" },
  { input: "1 tbsp of freshly squeezed lemon juice", name: "Lemon Juice", qty: 15, unit: "ml", category: "liquid" },
  { input: "1 red pepper, sliced", name: "Bell Pepper", qty: 120, unit: "g", category: "produce" },
  { input: "2 spring onions, finely sliced", name: "Spring Onion", qty: 30, unit: "g", category: "produce" },
  { input: "1 large sweet potato, cubed", name: "Sweet Potato", qty: 180, unit: "g", category: "produce" },
  { input: "500 g Greek yoghurt", name: "Yogurt", qty: 500, unit: "g", category: "liquid" },
  { input: "1 litre of whole milk", name: "Whole Milk", qty: 1000, unit: "ml", category: "liquid" },
]);

/** The five cases required by the specification. */
const REQUIRED_EDGE_CASES = Object.freeze([
  { input: "a splash of soy sauce", name: "Soy Sauce", qty: 15, unit: "ml", ui: "~1/50th of a bottle" },
  { input: "3 cloves of garlic, minced", name: "Garlic", qty: 15, unit: "g", ui: "~1/3rd of a bulb", display: "3 cloves", prep: "minced" },
  { input: "2 1/2 cups whole milk", name: "Whole Milk", qty: 600, unit: "ml", ui: "~6/10ths of a jug" },
  { input: "a handful of baby spinach", name: "Spinach", qty: 30, unit: "g", ui: "~1/3rd of a bag" },
  { input: "salt and pepper to taste", name: "Salt", qty: 1, unit: "g", ui: null, display: "Pinch / To taste", always: true },
]);

/**
 * Run the embedded test battery (edge cases, schema, fractions, prep noise).
 * @returns {{ passed:number, failed:number, results:Array<{name:string, ok:boolean, error?:string}> }}
 */
export function runSelfTests() {
  const results = [];
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error && error.message ? error.message : String(error) });
    }
  };

  /* ---------------- 1. Required edge cases ---------------- */
  for (const spec of REQUIRED_EDGE_CASES) {
    test(`edge case: ${spec.input}`, () => {
      const items = parseIngredients(spec.input);
      const item = items[0];
      assert(item, "no item returned");
      assertEqual(item.name, spec.name, "canonical name");
      assertClose(item.quantity, spec.qty, 0.001, "quantity");
      assertEqual(item.unit, spec.unit, "unit");
      if (spec.ui) assertEqual(item.uiFraction, spec.ui, "ui fraction");
      if (spec.display) assertEqual(item.displayAmount, spec.display, "display amount");
      if (spec.prep) assert(item.preparation.includes(spec.prep), `preparation should include "${spec.prep}"`);
      if (spec.always) assertEqual(item.always, true, "always flag");
    });
  }

  test("edge case: salt and pepper to taste splits into two spice rows", () => {
    const items = parseIngredients("salt and pepper to taste");
    assertEqual(items.length, 2, "number of rows");
    assertEqual(items[0].name, "Salt", "first row name");
    assertEqual(items[1].name, "Black Pepper", "second row name");
    const expectedCategories = { Salt: "granular", "Black Pepper": "spice" };
    for (const item of items) {
      assertEqual(item.category, expectedCategories[item.name], `category for ${item.name}`);
      assertClose(item.quantity, 1, 0.001, "quantity");
      assertEqual(item.displayAmount, "Pinch / To taste", "display");
      assertEqual(item.always, true, "always");
      assertEqual(item.categoryLabel.includes("Spice") || item.categoryLabel.includes("Granular"), true, "category label");
    }
  });

  /* ---------------- 2. Strict schema ---------------- */
  test("strict schema: shape { i: [[name, qty, unit, kcal, protein, carbs, fat, always]] }", () => {
    const out = parseFuzzyIngredient("a splash of soy sauce");
    assert(Array.isArray(out.i), "out.i must be an array");
    assertEqual(out.i.length, 1, "row count");
    const row = out.i[0];
    assert(Array.isArray(row), "row must be an array");
    assertEqual(row.length, 8, "tuple length");
    assertEqual(typeof row[0], "string", "name type");
    assertEqual(typeof row[2], "string", "unit type");
    for (const index of [1, 3, 4, 5, 6]) assertEqual(typeof row[index], "number", `field ${index} must be a number`);
    assertEqual(typeof row[7], "boolean", "always must be boolean");
    assertEqual(row[0], "Soy Sauce", "name");
    assertEqual(row[2], "ml", "unit");
  });

  test("strict schema: JSON round-trip is stable", () => {
    const a = parseFuzzyIngredient("2 1/2 cups whole milk");
    const b = JSON.parse(JSON.stringify(a));
    assertEqual(JSON.stringify(a), JSON.stringify(b), "JSON round-trip");
    assertEqual(b.i[0][1], 600, "quantity");
  });

  test("strict schema: multi-line recipe returns one row per line", () => {
    const out = parseRecipe("2 eggs\n1 cup flour\n1 tsp salt");
    assertEqual(out.i.length, 3, "row count");
    assertEqual(out.i[0][0], "Egg", "row 1 name");
    assertEqual(out.i[1][0], "All-Purpose Flour", "row 2 name");
  });

  /* ---------------- 3. Unicode & numeral grammar ---------------- */
  test("unicode fractions: ½ ⅓ ¾ ⅛ ⅔ ⅝", () => {
    assertClose(parseIngredient("½ cup sugar").quantity, 99, 0.001, "half");
    assertClose(parseIngredient("1 ⅓ cups milk").quantity, 320, 0.001, "one and a third");
    assertClose(parseIngredient("¾ cup sugar").quantity, 148.5, 0.001, "three quarters");
    assertClose(parseIngredient("⅛ tsp salt").quantity, 0.75, 0.001, "one eighth");
    assertClose(parseIngredient("⅔ cup milk").quantity, 160, 0.001, "two thirds");
    assertClose(parseIngredient("⅝ cup milk").quantity, 150, 0.001, "five eighths");
  });

  test("mixed fractions and hyphenated mixed numbers", () => {
    assertClose(parseIngredient("1 1/2 cups milk").quantity, 360, 0.001, "space mixed");
    assertClose(parseIngredient("1-1/2 cups milk").quantity, 360, 0.001, "hyphen mixed");
    assertClose(parseIngredient("1½ cups milk").quantity, 360, 0.001, "glued mixed");
  });

  test("ranges keep their bounds", () => {
    const item = parseIngredient("2-3 tbsp olive oil");
    assertClose(item.quantity, 37.5, 0.001, "midpoint");
    assertEqual(item.range.min, 30, "min");
    assertEqual(item.range.max, 45, "max");
    assertEqual(parseIngredient("2 to 3 cloves of garlic").range.min, 10, "range min");
    assertEqual(parseIngredient("2 or 3 cloves of garlic").quantity, 12.5, "or-range midpoint");
  });

  test("approx markers are supported and reported", () => {
    const item = parseIngredient("about 400 g pasta");
    assertClose(item.quantity, 400, 0.001, "approx quantity");
    assertEqual(item.unit, "g", "unit");
  });

  test("multiplier form: 2 x 400 g cans", () => {
    assertClose(parseIngredient("2 x 400 g cans chopped tomatoes").quantity, 800, 0.001, "multiplied mass");
    assertClose(parseIngredient("2x400g tins chickpeas").quantity, 800, 0.001, "compact multiplier");
  });

  /* ---------------- 4. Fuzzy measurement matrix ---------------- */
  test("fuzzy: splash / dash / pinch / tad", () => {
    assertClose(parseIngredient("a splash of soy sauce").quantity, 15, 0.001, "splash liquid");
    assertClose(parseIngredient("a dash of hot sauce").quantity, 15, 0.001, "dash liquid");
    assertClose(parseIngredient("a dash of salt").quantity, 1, 0.001, "dash powder");
    assertClose(parseIngredient("a pinch of salt").quantity, 0.5, 0.001, "pinch");
    assertClose(parseIngredient("a tad of salt").quantity, 0.5, 0.001, "tad");
    assertClose(parseIngredient("2 splashes of soy sauce").quantity, 30, 0.001, "two splashes");
  });

  test("fuzzy: handful is category aware", () => {
    assertClose(parseIngredient("a handful of spinach").quantity, 30, 0.001, "leafy");
    assertClose(parseIngredient("a handful of almonds").quantity, 45, 0.001, "nuts");
    assertClose(parseIngredient("a handful of carrots").quantity, 100, 0.001, "produce");
  });

  test("fuzzy: knob/pat/stick/block/clove/head/bulb", () => {
    assertClose(parseIngredient("a knob of butter").quantity, 14, 0.001, "knob");
    assertClose(parseIngredient("a pat of butter").quantity, 14, 0.001, "pat");
    assertClose(parseIngredient("1 stick of butter").quantity, 113, 0.001, "stick");
    assertClose(parseIngredient("1 block of tofu").quantity, 225, 0.001, "block");
    assertClose(parseIngredient("1 clove of garlic").quantity, 5, 0.001, "clove");
    assertClose(parseIngredient("1 head of cabbage").quantity, 500, 0.001, "head");
    assertClose(parseIngredient("1 bulb of garlic").quantity, 50, 0.001, "garlic bulb");
  });

  test("fuzzy: can/tin/glass/cup/glug/drizzle/bunch", () => {
    assertClose(parseIngredient("1 can of chickpeas").quantity, 400, 0.001, "can solid");
    assertClose(parseIngredient("1 tin of coconut milk").quantity, 400, 0.001, "tin liquid");
    assertClose(parseIngredient("1 glass of milk").quantity, 240, 0.001, "glass");
    assertClose(parseIngredient("1 cup of milk").quantity, 240, 0.001, "cup");
    assertClose(parseIngredient("a glug of olive oil").quantity, 30, 0.001, "glug");
    assertClose(parseIngredient("a drizzle of honey").quantity, 10, 0.001, "drizzle");
    // Bunch defaults to 100 g, but a known herb uses its own bunch weight.
    assertClose(parseIngredient("1 bunch of mint").quantity, 50, 0.001, "mint bunch");
    assertClose(parseIngredient("1 bunch of chives").quantity, 30, 0.001, "chives bunch");
  });

  /* ---------------- 5. Density / category resolution ---------------- */
  test("density: volume of a solid becomes grams", () => {
    assertClose(parseIngredient("1 cup flour").quantity, 124.8, 0.001, "flour");
    assertClose(parseIngredient("1 cup grated parmesan").quantity, 100.1, 0.001, "parmesan");
    assertClose(parseIngredient("1 cup spinach").quantity, 30, 0.001, "spinach");
  });

  test("density: liquids stay in millilitres", () => {
    const milk = parseIngredient("2 cups milk");
    assertEqual(milk.unit, "ml", "unit");
    assertClose(milk.quantity, 480, 0.001, "quantity");
    assertClose(milk.grams, 494.4, 0.001, "grams via density");
  });

  test("trailing count nouns are treated as units", () => {
    const item = parseIngredient("3 large garlic cloves, crushed");
    assertEqual(item.name, "Garlic", "name");
    assertEqual(item.displayAmount, "3 cloves", "display");
    assertClose(item.quantity, 15, 0.001, "quantity");
    assertEqual(item.uiFraction, "~1/3rd of a bulb", "container");
  });

  test("phrasal numerals: dozen / couple / few / quarter", () => {
    assertClose(parseIngredient("1 dozen eggs").quantity, 600, 0.001, "dozen");
    assertClose(parseIngredient("a couple of eggs").quantity, 100, 0.001, "couple");
    assertClose(parseIngredient("a few cloves of garlic").quantity, 15, 0.001, "few");
    assertClose(parseIngredient("a quarter of a cabbage").quantity, 125, 0.001, "quarter");
  });

  test("parenthetical package weights win over container defaults", () => {
    assertClose(parseIngredient("1 (14 oz) can coconut milk").quantity, 396.9, 0.001, "ounce can");
    assertClose(parseIngredient("1 can (400 ml) coconut milk").quantity, 400, 0.001, "millilitre can");
    assertClose(parseIngredient("1 can (400 g) chopped tomatoes").quantity, 400, 0.001, "gram can");
  });

  test("container ratios stay consistent with the measure matrix", () => {
    assertEqual(parseIngredient("1 bunch of basil").uiFraction, "~1 bunch", "bunch");
    assertEqual(parseIngredient("1 bunch of parsley").uiFraction, "~1 bunch", "parsley bunch");
    assertEqual(parseIngredient("1 dozen eggs").uiFraction, "~12 eggs", "egg count");
    assertEqual(parseIngredient("500 g Greek yoghurt").uiFraction, "~1 tub", "yoghurt tub");
  });

  test("count units resolve through the piece matrix", () => {
    assertClose(parseIngredient("2 eggs").quantity, 100, 0.001, "eggs");
    assertClose(parseIngredient("4 potatoes").quantity, 852, 0.001, "potatoes");
    assertClose(parseIngredient("2 chicken breasts").quantity, 400, 0.001, "breasts");
    assertClose(parseIngredient("3 slices of bacon").quantity, 36, 0.001, "slices");
  });

  /* ---------------- 6. Preparation noise ---------------- */
  test("preparation directives never contaminate the name", () => {
    const cases = [
      ["2 cloves of garlic, finely chopped", "Garlic", "finely chopped"],
      ["1 onion, peeled and diced", "Onion", "peeled and diced"],
      ["200 g chicken, room temperature", "Chicken Breast", "room temperature"],
      ["1 can of chickpeas, drained and rinsed", "Chickpeas", "drained and rinsed"],
      ["2 tbsp olive oil, optional", "Olive Oil", "optional"],
      ["1 cup rice, washed", "Rice", "washed"],
    ];
    for (const [input, name, prep] of cases) {
      const item = parseIngredient(input);
      assertEqual(item.name, name, `name for "${input}"`);
      assertEqual(item.preparation, prep, `preparation for "${input}"`);
    }
  });

  test("leading size adjectives are treated as preparation", () => {
    const item = parseIngredient("2 large eggs, beaten");
    assertEqual(item.name, "Egg", "name");
    assert(item.preparation.includes("large"), "preparation should mention large");
    assert(item.preparation.includes("beaten"), "preparation should mention beaten");
  });

  /* ---------------- 7. Container / UI fractions ---------------- */
  test("container fractions: canonical cases", () => {
    assertEqual(parseIngredient("a splash of soy sauce").uiFraction, "~1/50th of a bottle", "soy bottle");
    assertEqual(parseIngredient("2 1/2 cups whole milk").uiFraction, "~6/10ths of a jug", "milk jug");
    assertEqual(parseIngredient("a handful of baby spinach").uiFraction, "~1/3rd of a bag", "spinach bag");
    assertEqual(parseIngredient("1 block of cheddar").uiFraction, "~1 block", "cheese block");
  });

  test("container fractions: cross-dimension conversion", () => {
    // 60 g of flour in a 1000 g bag; density is irrelevant for g->g.
    assertEqual(parseIngredient("60 g flour").uiFraction, "~1/16th of a bag", "flour bag");
    // 250 g of butter vs a 113 g stick -> more than one stick.
    const butter = parseIngredient("250 g butter");
    assert(butter.uiFraction.startsWith("~2"), `expected a multi-stick label, got ${butter.uiFraction}`);
  });

  test("convertMetricToUIFraction handles counts and fallbacks", () => {
    const potato = getIngredient("potato");
    assertEqual(convertMetricToUIFraction(600, "g", potato).label, "~2.8 potatoes", "piece fallback");
    assertEqual(convertMetricToUIFraction(0, "g", potato).label, "—", "zero guard");
    assertEqual(convertMetricToUIFraction(15, "ml", "liquid").label, "~1/50th of a bottle", "category fallback");
  });

  test("fraction rendering preferences", () => {
    assertEqual(toFriendlyFraction(0.02), "1/50th", "1/50");
    assertEqual(toFriendlyFraction(0.3), "1/3rd", "one third");
    assertEqual(toFriendlyFraction(0.6), "6/10ths", "six tenths");
    assertEqual(toFriendlyFraction(0.25), "1/4th", "quarter");
    assertEqual(toFriendlyFraction(0.5), "1/2", "half");
    assertEqual(toFriendlyFraction(0.75), "3/4ths", "three quarters");
    assertEqual(toFriendlyFraction(0.6667), "2/3rds", "two thirds");
    assertEqual(toFriendlyFraction(0.45), null, "unrenderable");
  });

  /* ---------------- 8. Citrus, macros, misc ---------------- */
  test("citrus forms: juice and zest", () => {
    assertClose(parseIngredient("juice of 2 lemons").quantity, 90, 0.001, "lemon juice");
    assertEqual(parseIngredient("juice of 1 lemon").name, "Lemon Juice", "juice name");
    assertClose(parseIngredient("zest of 1 lemon").quantity, 5, 0.001, "lemon zest");
    assertEqual(parseIngredient("zest of 2 limes").name, "Lime Zest", "zest name");
  });

  test("macros are projected from grams", () => {
    const garlic = parseIngredient("3 cloves of garlic");
    assertClose(garlic.nutrition.kcal, 22.4, 0.02, "garlic kcal");
    assertClose(garlic.nutrition.protein, 1, 0.05, "garlic protein");
    const salt = parseIngredient("1 tsp salt");
    assertEqual(salt.nutrition.kcal, 0, "salt kcal");
  });

  test("unknown ingredients degrade gracefully", () => {
    const item = parseIngredient("2 tbsp dragonfruit powder");
    assertEqual(item.name, "Dragonfruit Powder", "title-cased name");
    assertEqual(item.unit, "g", "powder falls back to grams");
    assertClose(item.quantity, 18, 0.001, "density 0.6 fallback");
    assertEqual(item.category, "granular", "inferred category");
  });

  test("real-world corpus regressions", () => {
    assertEqual(parseIngredient("12 florets broccoli").name, "Broccoli", "floret name");
    assertEqual(parseIngredient("12 florets broccoli").quantity, 180, "floret weight");
    assertEqual(parseIngredient("330 ml stout").unit, "ml", "beer is a liquid");
    assertEqual(parseIngredient("2 tbsp oil").name, "Vegetable Oil", "generic oil");
    assertEqual(parseIngredient("1 tbsp tobasco sauce").name, "Hot Sauce", "typo: tobasco");
    assertEqual(parseIngredient("3 challots, diced").name, "Shallots", "typo: challots");
    assertEqual(parseIngredient("2 tsp ground cardomom").name, "Cardamom", "typo: cardomom");
    assertEqual(parseIngredient("/6oz digestive biscuits").name, "Digestive Biscuits", "leading junk");
    const sugar = parseIngredient("125 ml sugar");
    assertEqual(sugar.unit, "g", "solids normalise to grams");
    assertClose(sugar.quantity, 103.1, 0.01, "volume -> mass via measured density");
  });

  test("data matrix meets the required minimums", () => {
    const taxonomy = getTaxonomy();
    assert(taxonomy.fuzzyMeasures.length >= 30, `fuzzy measures: ${taxonomy.fuzzyMeasures.length}`);
    assert(taxonomy.ingredients.length >= 50, `ingredients: ${taxonomy.ingredients.length}`);
    assert(Object.keys(taxonomy.containers).length >= 10, "container defaults");
    assert(taxonomy.ingredients.every((i) => typeof i.density === "number" && i.density > 0), "every ingredient needs a density");
    const json = JSON.stringify(taxonomy);
    assert(json.length > 10000, "serialised taxonomy should be substantial");
  });

  test("tokenizer produces typed tokens", () => {
    const tokens = tokenize("1 1/2 cups milk");
    assertEqual(tokens[0].type, "number", "first token type");
    assertEqual(tokens[0].value, 1.5, "mixed fraction value");
    assertEqual(tokens[1].value, "cups", "second token");
  });

  test("quantity AST exposes ranges and approximations", () => {
    const node = parseQuantityPrefix("about 2-3 tbsp");
    assertEqual(node.approximate, true, "approximate flag");
    assertEqual(node.isRange, true, "range flag");
    assertEqual(node.min, 2, "min");
    assertEqual(node.max, 3, "max");
    assertEqual(node.value, 2.5, "midpoint");
  });

  test("empty input is rejected", () => {
    let threw = false;
    try {
      parseIngredient("   ");
    } catch (error) {
      threw = error instanceof TypeError;
    }
    assert(threw, "expected a TypeError for empty input");
  });

  /* ---------------- 10-13. Extensions ---------------- */
  registerExtensionTests(test);

  /* ---------------- 9. Accuracy corpus ---------------- */
  const accuracy = scoreCorpus(ACCURACY_CORPUS);
  test(`accuracy corpus: name ${accuracy.name.pct}%, qty ${accuracy.qty.pct}%, unit ${accuracy.unit.pct}%, category ${accuracy.category.pct}%`, () => {
    assert(accuracy.name.pct >= 95, `name accuracy too low: ${accuracy.name.pct}%`);
    assert(accuracy.qty.pct >= 95, `quantity accuracy too low: ${accuracy.qty.pct}%`);
    assert(accuracy.unit.pct >= 95, `unit accuracy too low: ${accuracy.unit.pct}%`);
    assert(accuracy.category.pct >= 95, `category accuracy too low: ${accuracy.category.pct}%`);
  });

  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results, accuracy };
}

/** Score the labelled corpus field by field. */
export function scoreCorpus(corpus = ACCURACY_CORPUS) {
  const fields = { name: 0, qty: 0, unit: 0, category: 0 };
  const failures = [];

  for (const expected of corpus) {
    let actual;
    try {
      actual = parseIngredient(expected.input);
    } catch (error) {
      failures.push({ input: expected.input, reason: `threw: ${error.message}` });
      continue;
    }
    const checks = {
      name: actual.name === expected.name,
      qty: Math.abs(actual.quantity - expected.qty) <= Math.max(0.01 * Math.abs(expected.qty), 0.05),
      unit: actual.unit === expected.unit,
      category: actual.category === expected.category,
    };
    for (const key of Object.keys(fields)) if (checks[key]) fields[key]++;
    const bad = Object.keys(checks).filter((key) => !checks[key]);
    if (bad.length) {
      failures.push({
        input: expected.input,
        reason: bad.map((key) => `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(key === "qty" ? actual.quantity : actual[key])}`).join("; "),
      });
    }
  }

  const pct = (n) => Math.round((n / corpus.length) * 1000) / 10;
  return {
    total: corpus.length,
    name: { correct: fields.name, pct: pct(fields.name) },
    qty: { correct: fields.qty, pct: pct(fields.qty) },
    unit: { correct: fields.unit, pct: pct(fields.unit) },
    category: { correct: fields.category, pct: pct(fields.category) },
    failures,
  };
}

/* ==========================================================================
 * SECTION 10 - BENCHMARK
 * ========================================================================== */

/**
 * Measure throughput and memory against the labelled corpus.
 * Returns null outside Node (no process.hrtime).
 */
export function benchmark(iterations = 5000) {
  if (typeof process === "undefined" || typeof process.hrtime !== "function") return null;
  const lines = ACCURACY_CORPUS.map((entry) => entry.input);

  for (let i = 0; i < 100; i++) for (const line of lines) parseIngredients(line);
  if (typeof globalThis.gc === "function") globalThis.gc();

  const heapBefore = process.memoryUsage().heapUsed;
  const start = process.hrtime.bigint();
  let parsed = 0;
  for (let i = 0; i < iterations; i++) {
    for (const line of lines) {
      parseIngredients(line);
      parsed++;
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - start);
  const heapAfter = process.memoryUsage().heapUsed;
  const memory = process.memoryUsage();

  return {
    parsed,
    totalMs: round2(elapsedNs / 1e6),
    msPerIngredient: round3(elapsedNs / 1e6 / parsed),
    ingredientsPerSecond: Math.round(parsed / (elapsedNs / 1e9)),
    heapUsedMB: round1(memory.heapUsed / 1024 / 1024),
    rssMB: round1(memory.rss / 1024 / 1024),
    heapDeltaKB: round1((heapAfter - heapBefore) / 1024),
  };
}

/* ==========================================================================
 * SECTION 11 - CLI / DEMO
 * ========================================================================== */

function isMainModule() {
  try {
    if (typeof process === "undefined" || !process.argv || !process.argv[1]) return false;
    return /ingredient-engine(?:\.[a-z]+)?\.(?:m?js|cjs)$/.test(process.argv[1]);
  } catch (_error) {
    return false;
  }
}

function printDemo() {
  console.log("\nIngredientEngine v" + VERSION + " - required edge cases\n" + "=".repeat(64));
  for (const spec of REQUIRED_EDGE_CASES) {
    const items = parseIngredients(spec.input);
    for (const item of items) {
      console.log(`\n  ${JSON.stringify(spec.input)}`);
      console.log(`    name        ${item.name}`);
      console.log(`    amount      ${item.metric}  (display: ${item.displayAmount})`);
      console.log(`    ui fraction ${item.uiFraction}`);
      console.log(`    macros      ${item.nutrition.kcal} kcal / ${item.nutrition.protein}p / ${item.nutrition.carbs}c / ${item.nutrition.fat}f`);
      if (item.preparation) console.log(`    preparation ${item.preparation}`);
    }
    console.log("    strict      " + JSON.stringify(parseFuzzyIngredient(spec.input)));
  }
}

function printReport(report) {
  console.log("\nSelf tests\n" + "=".repeat(64));
  for (const result of report.results) {
    if (result.ok) console.log(`  PASS  ${result.name}`);
    else console.log(`  FAIL  ${result.name}\n        ${result.error}`);
  }
  const accuracy = report.accuracy;
  console.log(`\n  ${report.passed} passed, ${report.failed} failed`);
  console.log(
    `  accuracy (${accuracy.total} labelled lines): name ${accuracy.name.pct}%, qty ${accuracy.qty.pct}%, unit ${accuracy.unit.pct}%, category ${accuracy.category.pct}%`
  );
  if (accuracy.failures.length) {
    console.log("  mismatches:");
    for (const failure of accuracy.failures) console.log(`    - ${failure.input}: ${failure.reason}`);
  }
}

function runCli() {
  const args = typeof process !== "undefined" && process.argv ? process.argv.slice(2) : [];

  // `node ingredient-engine.js --json` dumps the full data matrix.
  if (args.includes("--json")) {
    console.log(JSON.stringify(getTaxonomy(), null, 2));
    return;
  }

  // `node ingredient-engine.js --parse "2 cups flour"` prints one result.
  const parseIndex = args.indexOf("--parse");
  if (parseIndex !== -1) {
    const line = args.slice(parseIndex + 1).join(" ").replace(/^["']|["']$/g, "");
    console.log(JSON.stringify(parseFuzzyIngredient(line), null, 2));
    return;
  }

  printDemo();
  const report = runSelfTests();
  printReport(report);

  const bench = benchmark();
  if (bench) {
    console.log("\nBenchmark\n" + "=".repeat(64));
    console.log(`  ${bench.parsed} ingredient lines parsed in ${bench.totalMs} ms`);
    console.log(`  ${bench.msPerIngredient} ms / line  (${bench.ingredientsPerSecond} lines/sec)`);
    console.log(`  heap ${bench.heapUsedMB} MB, rss ${bench.rssMB} MB, heap delta ${bench.heapDeltaKB} KB`);
  }

  if (report.failed > 0) process.exitCode = 1;
}

if (isMainModule()) runCli();

/* Browser convenience: <script type="module" src="ingredient-engine.js"> then
 * `IngredientEngine.parseFuzzyIngredient(...)`. Harmless in Node/Deno/Bun. */
if (typeof globalThis !== "undefined") {
  globalThis.IngredientEngine = IngredientEngine;
}