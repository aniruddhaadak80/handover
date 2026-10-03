import { clampText, fetchJson, firstString } from "./http";
import { ingredientTokens } from "./ingredients";
import type { DrugLookup, DrugSafety, SourceMeta, SourceStatus } from "../types";

const OPENFDA = "https://api.fda.gov/drug/label.json";
const RXNORM = "https://rxnav.nlm.nih.gov/REST";

/** Monitoring vocabulary. A term counts only when it appears in the label text. */
const MONITORING_TERMS = [
  "serum creatinine",
  "creatinine",
  "estimated glomerular filtration rate",
  "egfr",
  "blood glucose",
  "hba1c",
  "glycosylated hemoglobin",
  "serum potassium",
  "potassium",
  "serum sodium",
  "inr",
  "prothrombin time",
  "platelet",
  "liver function",
  "serum transaminase",
  "hepatic function",
  "lipid panel",
  "serum lipids",
  "complete blood count",
  "white blood cell",
  "blood pressure",
  "heart rate",
  "electrocardiogram",
  "ecg",
  "thyroid",
  "magnesium",
  "vision",
  "ophthalmologic",
];

export const SOURCE_OPENFDA = {
  id: "openfda-drug-label",
  name: "openFDA drug label API",
  url: "https://open.fda.gov/apis/drug/label/",
} as const;

export const SOURCE_RXNORM = {
  id: "rxnorm-rxcui",
  name: "NIH RxNorm current release",
  url: "https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html",
} as const;

function findMonitoringTerms(text: string): string[] {
  const haystack = text.toLowerCase();
  const found = new Set<string>();
  for (const term of MONITORING_TERMS) {
    if (haystack.includes(term)) found.add(term);
  }
  return [...found].sort();
}

function snippetFor(text: string, term: string): string | undefined {
  const index = text.toLowerCase().indexOf(term);
  if (index < 0) return undefined;
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + term.length + 90);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

type OpenFdaResult = {
  id?: string;
  effective_time?: string;
  openfda?: Record<string, unknown>;
  indications_and_usage?: string | string[];
  dosage_and_administration?: string | string[];
  drug_interactions?: string | string[];
  contraindications?: string | string[];
  warnings?: string | string[];
  warnings_and_cautions?: string | string[];
  boxed_warning?: string | string[];
  monitoring?: string | string[];
};

function normalizeLabel(row: OpenFdaResult): Omit<DrugSafety, "sources" | "sample"> {
  const openfda = row.openfda ?? {};
  const sections = {
    indications: clampText(row.indications_and_usage),
    dosage: clampText(row.dosage_and_administration),
    drugInteractions: clampText(row.drug_interactions),
    contraindications: clampText(row.contraindications),
    warnings: clampText(row.warnings ?? row.warnings_and_cautions),
    monitoring: clampText(row.monitoring),
  };

  const searchable = Object.values(sections)
    .filter((value): value is string => typeof value === "string")
    .join(" \n ");
  const monitoringTerms = findMonitoringTerms(searchable);

  return {
    rxcui: firstString(openfda.rxcui)?.toLowerCase() ?? null,
    // The caller overwrites genericName with the ingredient it searched for.
    genericName: "",
    labelGenericName: firstString(openfda.generic_name) ?? firstString(openfda.substance_name) ?? null,
    brandNames: Array.isArray(openfda.brand_name)
      ? openfda.brand_name.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [],
    route: firstString(openfda.route),
    schedule: null,
    manufacturer: firstString(openfda.manufacturer_name),
    applicationNumber: firstString(openfda.application_number),
    sections,
    flags: {
      hasBoxedWarning: Boolean(clampText(row.boxed_warning)),
      hasContraindications: Boolean(sections.contraindications),
      hasInteractionsSection: Boolean(sections.drugInteractions),
      monitoringTerms,
    },
  };
}

/** Offline shelf. Metadata only — never invents label text or safety flags. */
function shelfResult(query: string): DrugLookup {
  return {
    query,
    drug: {
      rxcui: null,
    genericName: query.trim(),
    labelGenericName: null,
      brandNames: [],
      route: null,
      schedule: null,
      manufacturer: null,
      applicationNumber: null,
      sections: {
        indications: null,
        dosage: null,
        drugInteractions: null,
        contraindications: null,
        warnings: null,
        monitoring: null,
      },
      flags: { hasBoxedWarning: false, hasContraindications: false, hasInteractionsSection: false, monitoringTerms: [] },
      sources: [],
      sample: true,
    },
    ingredientTokens: ingredientTokens(query),
    sources: [],
    status: "fallback",
  };
}

function sourceMeta(
  base: typeof SOURCE_OPENFDA | typeof SOURCE_RXNORM,
  status: SourceStatus,
  fetchedAt: string,
  note?: string,
): SourceMeta {
  return {
    id: base.id,
    name: base.name,
    status,
    url: base.url,
    fetchedAt,
    ...(note ? { note } : {}),
  };
}

/**
 * Resolve one drug name against RxNorm and openFDA.
 * Both upstreams are optional: whatever answers, answers honestly, and the
 * response always carries source metadata and a live/fallback status.
 */
export async function lookupDrug(rawQuery: string): Promise<DrugLookup> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 2) return shelfResult(query);

  const sources: SourceMeta[] = [];
  const tokens = ingredientTokens(query);
  let status: SourceStatus = "live";

  // --- RxNorm: concept id + official name -------------------------------
  let rxcui: string | null = null;
  let officialName: string | null = null;
  const rxnormTerm = ingredientTokens(query)[0] ?? query;
  try {
    // `rxcui.json?name=` is the stable name lookup; approximateTerm matches
    // too loosely to be the primary answer here.
    const url = `${RXNORM}/rxcui.json?name=${encodeURIComponent(rxnormTerm)}`;
    const { data, status: fetchStatus, fetchedAt } = await fetchJson<{
      idGroup?: { rxnormId?: string[] };
    }>(url, { timeoutMs: 6000, retries: 1 });
    const id = data.idGroup?.rxnormId?.[0];
    if (id) {
      rxcui = id;
      officialName = rxnormTerm;
      sources.push(sourceMeta(SOURCE_RXNORM, fetchStatus, fetchedAt));
      if (fetchStatus === "cached") status = "cached";
    } else {
      sources.push(
        sourceMeta(SOURCE_RXNORM, "fallback", new Date().toISOString(), "no RxNorm concept matched this name"),
      );
      status = "fallback";
    }
  } catch (error) {
    sources.push(
      sourceMeta(
        SOURCE_RXNORM,
        "fallback",
        new Date().toISOString(),
        `RxNorm lookup failed: ${error instanceof Error ? error.message : "network error"}`,
      ),
    );
    status = "fallback";
  }

  // --- openFDA: label sections ------------------------------------------
  // Boards store "Metformin 500 mg"; the label index stores "METFORMIN".
  // Search on the normalized ingredient, never the whole free-text string.
  const searchTerm = ingredientTokens(query)[0] ?? query;
  const genericSearch = officialName ?? searchTerm;
  try {
    const url = `${OPENFDA}?search=${encodeURIComponent(`openfda.generic_name:"${genericSearch}"`)}&limit=1`;
    const { data, status: fetchStatus, fetchedAt } = await fetchJson<{ results?: OpenFdaResult[] }>(url, {
      timeoutMs: 8000,
      retries: 2,
    });
    const row = data.results?.[0];
    if (row) {
      const normalized = normalizeLabel(row);
      // openFDA answers with whatever label matched first, which can be a
      // combination product. Show what we asked for; report the match honestly.
      const drug: DrugSafety = {
        ...normalized,
        rxcui: normalized.rxcui ?? rxcui,
        genericName: genericSearch,
        labelGenericName: normalized.genericName || null,
        sources,
        sample: false,
      };
      sources.push(sourceMeta(SOURCE_OPENFDA, fetchStatus, fetchedAt));
      if (fetchStatus === "cached") status = "cached";
      return {
        query,
        drug,
        ingredientTokens: tokens.length > 0 ? tokens : ingredientTokens(normalized.genericName),
        sources,
        status: status === "fallback" ? "cached" : status,
      };
    }
    sources.push(sourceMeta(SOURCE_OPENFDA, "fallback", new Date().toISOString(), "no label matched this name"));
  } catch (error) {
    sources.push(
      sourceMeta(SOURCE_OPENFDA, "fallback", new Date().toISOString(), `label fetch failed: ${error instanceof Error ? error.message : "network error"}`),
    );
  }

  const shelf = shelfResult(query);
  if (rxcui || officialName) {
    return {
      ...shelf,
      drug: { ...shelf.drug, rxcui, genericName: officialName ?? shelf.drug.genericName },
      sources,
      status: "fallback",
    };
  }
  return { ...shelf, sources };
}

export { MONITORING_TERMS, findMonitoringTerms, snippetFor };