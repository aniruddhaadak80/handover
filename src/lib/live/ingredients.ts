/**
 * Ingredient normalizer for duplicate-therapy detection.
 *
 * The bundled table is a small, human-curated brand -> ingredient map so the
 * check still works with no network. RxNorm is the live authority: when it
 * answers, its concept id and name replace the bundled guess. Nothing here is
 * medical advice; it only makes two drug strings comparable.
 */

const BRAND_TO_INGREDIENT: Record<string, string> = {
  glophage: "metformin",
  glucophage: "metformin",
  januvia: "sitagliptin",
  zituvia: "sitagliptin",
  amaryl: "glimepiride",
  diamicron: "gliclazide",
  "novo rapid": "insulin aspart",
  novorapid: "insulin aspart",
  lantus: "insulin glargine",
  toujeo: "insulin glargine",
  basalinsulin: "insulin glargine",
  humalog: "insulin lispro",
  nadolol: "nadolol",
  cordarone: "amiodarone",
  coumadin: "warfarin",
  eliquis: "apixaban",
  xarelto: "rivaroxaban",
  pradaxa: "dabigatran",
  plavix: "clopidogrel",
  aspirin: "acetylsalicylic acid",
  lasix: "furosemide",
  furosemide: "furosemide",
  norvasc: "amlodipine",
  amlodipine: "amlodipine",
  lisinopril: "lisinopril",
  zestril: "lisinopril",
  ramipril: "ramipril",
  altace: "ramipril",
  losartan: "losartan",
  cozaar: "losartan",
  pravastatin: "pravastatin",
  lipitor: "atorvastatin",
  atorvastatin: "atorvastatin",
  simvastatin: "simvastatin",
  zocor: "simvastatin",
  synthroid: "levothyroxine",
  levothyroxine: "levothyroxine",
  lexapro: "escitalopram",
  zoloft: "sertraline",
  sertraline: "sertraline",
  prozac: "fluoxetine",
  fluoxetine: "fluoxetine",
  citalopram: "citalopram",
  celexa: "citalopram",
  gabapentin: "gabapentin",
  neurontin: "gabapentin",
  pregabalin: "pregabalin",
  lyrica: "pregabalin",
  alendronate: "alendronate",
  fosamax: "alendronate",
  allopurinol: "allopurinol",
  zyloprim: "allopurinol",
  colchicine: "colchicine",
  methotrexate: "methotrexate",
  trexall: "methotrexate",
  prednisone: "prednisone",
  digoxin: "digoxin",
  lanoxin: "digoxin",
  amiodarone: "amiodarone",
  spironolactone: "spironolactone",
  aldactone: "spironolactone",
  omeprazole: "omeprazole",
  prilosec: "omeprazole",
  pantoprazole: "pantoprazole",
  metformin: "metformin",
  sitagliptin: "sitagliptin",
  glimepiride: "glimepiride",
  gliclazide: "gliclazide",
  insulin: "insulin",
};

/** Words that carry no ingredient meaning and are stripped before comparing. */
const NOISE = new Set([
  "tablet",
  "tablets",
  "tab",
  "tabs",
  "capsule",
  "capsules",
  "cap",
  "caps",
  "pill",
  "pills",
  "mg",
  "mcg",
  "ug",
  "ml",
  "gm",
  "g",
  "daily",
  "d",
  "twice",
  "once",
  "with",
  "food",
  "meal",
  "meals",
  "oral",
  "po",
  "sr",
  "er",
  "xr",
  "dr",
  "and",
  "the",
  "of",
]);

const SALT_TOKENS = [
  "hcl",
  "hydrochloride",
  "sulfate",
  "sulphate",
  "sodium",
  "potassium",
  "calcium",
  "magnesium",
  "succinate",
  "tartrate",
  "maleate",
  "mesylate",
  "besylate",
  "acetate",
  "citrate",
  "phosphate",
  "bitartrate",
  "benzoate",
  "fumarate",
  "monohydrate",
];

/**
 * Reduce a free-text drug string to sorted, de-duplicated ingredient tokens.
 * `Metformin 500 mg (Glucophage) 1 tab twice daily with food` -> ["metformin"].
 */
export function ingredientTokens(raw: string): string[] {
  if (typeof raw !== "string") return [];
  const lowered = raw.toLowerCase().replace(/[()[\]]/g, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const words = lowered.split(/[\s-]+/).filter((word) => word.length > 0 && !NOISE.has(word));

  const tokens = new Set<string>();

  for (let i = 0; i < words.length; ) {
    const word = words[i];
    const clean = word.replace(/^\d+|\d+$/g, "");

    // Longest-first brand match so multi-word brands win over single words.
    let matched = 0;
    for (let span = Math.min(3, words.length - i); span >= 1; span--) {
      const gram = words
        .slice(i, i + span)
        .map((w) => w.replace(/^\d+|\d+$/g, ""))
        .join(" ");
      const mapped = BRAND_TO_INGREDIENT[gram];
      if (mapped) {
        tokens.add(mapped);
        matched = span;
        break;
      }
    }

    if (matched > 0) {
      i += matched;
      continue;
    }
    if (clean.length === 0) {
      i += 1;
      continue;
    }
    if (SALT_TOKENS.includes(clean)) {
      i += 1;
      continue;
    }
    if (clean.length >= 5) tokens.add(clean);
    i += 1;
  }

  return tokens.size === 0 ? [] : [...tokens].sort();
}

/** True when two drug strings share at least one ingredient token. */
export function sharesIngredient(a: string, b: string): string | null {
  const left = new Set(ingredientTokens(a));
  for (const token of ingredientTokens(b)) {
    if (left.has(token)) return token;
  }
  return null;
}