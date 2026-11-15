// Pure logica voor de spraak- en Siri-koppeling: tijdzone, schema, normaliseren, samenvatten.
// Geen Deno- of netwerkcode, zodat dit bestand ook met Node getest kan worden (test/logica.test.js).

export const TIJDZONE = "Europe/Amsterdam";

export type Project = { id: string; naam: string; klant: string; standaard_facturabel_pct: number };

// Wat het taalmodel teruggeeft (zie SCHEMA).
export type Ruw = {
  begrepen: boolean;
  vraag: string;
  datum: string;
  type: "werk" | "verlof" | "ziek" | "feestdag" | "compensatie";
  start: string | null;
  eind: string | null;
  duur_min: number | null;
  pauze_min: number;
  locatie: "kantoor" | "thuis" | "onderweg" | null;
  notitie: string;
  projecten: { project_id: string; aandeel_min: number | null; facturabel_min: number | null; facturabel_pct: number | null }[];
};

export type Concept = {
  entry: {
    datum: string; type: Ruw["type"]; start: string | null; eind: string | null;
    duur_min: number | null; pauze_min: number; locatie: Ruw["locatie"]; notitie: string;
  };
  rijen: {
    project_id: string; aandeel_pct: number | null; aandeel_min: number | null;
    facturabel_pct: number | null; facturabel_min: number | null;
  }[];
};

const ofNull = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["begrepen", "vraag", "datum", "type", "start", "eind", "duur_min", "pauze_min", "locatie", "notitie", "projecten"],
  properties: {
    begrepen: { type: "boolean", description: "false als de tekst geen bruikbare urenregistratie is" },
    vraag: { type: "string", description: "Bij begrepen=false: korte Nederlandse zin over wat ontbreekt. Anders leeg." },
    datum: { type: "string", format: "date" },
    type: { type: "string", enum: ["werk", "verlof", "ziek", "feestdag", "compensatie"] },
    start: ofNull({ type: "string", description: "Starttijd HH:MM, 24-uurs" }),
    eind: ofNull({ type: "string", description: "Eindtijd HH:MM, 24-uurs" }),
    duur_min: ofNull({ type: "integer", description: "Alleen als er geen kloktijden genoemd zijn" }),
    pauze_min: { type: "integer" },
    locatie: ofNull({ type: "string", enum: ["kantoor", "thuis", "onderweg"] }),
    notitie: { type: "string" },
    projecten: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["project_id", "aandeel_min", "facturabel_min", "facturabel_pct"],
        properties: {
          project_id: { type: "string" },
          aandeel_min: ofNull({ type: "integer", description: "Minuten voor dit project; null = alle of de resterende tijd" }),
          facturabel_min: ofNull({ type: "integer" }),
          facturabel_pct: ofNull({ type: "integer" }),
        },
      },
    },
  },
} as const;

// Verschil in minuten tussen UTC en de lokale tijd in TIJDZONE op dat moment.
function offsetMin(moment: Date): number {
  const d: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: TIJDZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(moment)) if (p.type !== "literal") d[p.type] = Number(p.value);
  const alsUtc = Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second);
  return Math.round((alsUtc - moment.getTime()) / 60000);
}

// 'JJJJ-MM-DD' + 'HH:MM' in Nederlandse tijd -> ISO-tijdstip in UTC.
export function lokaalNaarUtc(datum: string, hhmm: string): string {
  const gok = new Date(`${datum}T${hhmm}:00Z`);
  const eerste = new Date(gok.getTime() - offsetMin(gok) * 60000);
  // Tweede stap vangt het uur rond de zomer-/wintertijdwissel op.
  return new Date(gok.getTime() - offsetMin(eerste) * 60000).toISOString();
}

export function nuLokaal(nu = new Date()) {
  const lokaal = new Date(nu.getTime() + offsetMin(nu) * 60000).toISOString();
  const weekdag = new Intl.DateTimeFormat("nl-NL", { timeZone: TIJDZONE, weekday: "long" }).format(nu);
  return { datum: lokaal.slice(0, 10), hhmm: lokaal.slice(11, 16), weekdag };
}

export function plusDag(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const minuten = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const fmt = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

// Netto minuten als die uit het concept af te leiden zijn, anders null.
export function nettoMin(e: Concept["entry"]): number | null {
  if (e.start && e.eind) {
    let bruto = minuten(e.eind) - minuten(e.start);
    if (bruto <= 0) bruto += 24 * 60; // over middernacht
    return Math.max(0, bruto - e.pauze_min);
  }
  return e.start ? null : e.duur_min;
}

// Controleert het antwoord van het model en zet het om naar een concept dat de app
// en de database begrijpen. Gooit een Error met een Nederlandse melding bij onbruikbare invoer.
export function normaliseer(ruw: Ruw, projecten: Project[]): Concept {
  if (!ruw.begrepen) throw new Error(ruw.vraag || "Ik kon hier geen urenregistratie uit halen.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ruw.datum)) throw new Error("Ik kon de datum niet bepalen.");
  const start = ruw.start && TIJD.test(ruw.start) ? ruw.start : null;
  const eind = start && ruw.eind && TIJD.test(ruw.eind) ? ruw.eind : null;
  const entry: Concept["entry"] = {
    datum: ruw.datum, type: ruw.type, start, eind,
    duur_min: start ? null : (ruw.duur_min != null && ruw.duur_min >= 0 ? ruw.duur_min : null),
    pauze_min: Math.max(0, ruw.pauze_min || 0), locatie: ruw.locatie, notitie: ruw.notitie.trim(),
  };
  if (entry.type === "werk" && !start && entry.duur_min == null) {
    throw new Error("Ik mis de tijden of de duur. Zeg bijvoorbeeld 'van half negen tot vijf' of 'twee uur'.");
  }
  if (entry.type === "werk" && start && !eind) {
    throw new Error("Ik mis de eindtijd. Gebruik de startknop als je nu wilt inklokken.");
  }

  const netto = nettoMin(entry);
  const gekozen = entry.type === "werk" ? ruw.projecten.filter((p) => projecten.some((x) => x.id === p.project_id)) : [];
  const vast = gekozen.reduce((s, p) => s + (p.aandeel_min ?? 0), 0);
  const rijen = gekozen.map((p) => {
    const standaard = projecten.find((x) => x.id === p.project_id)!.standaard_facturabel_pct;
    // null = "de rest": als vaste minuten wanneer dat uit te rekenen is, anders als 100%
    const rest = p.aandeel_min == null && netto != null && gekozen.length > 1 ? Math.max(0, netto - vast) : null;
    const aandeelMin = p.aandeel_min ?? rest;
    return {
      project_id: p.project_id,
      aandeel_pct: aandeelMin == null ? 100 : null,
      aandeel_min: aandeelMin,
      facturabel_pct: p.facturabel_min != null ? null : Math.min(100, Math.max(0, p.facturabel_pct ?? standaard)),
      facturabel_min: p.facturabel_min,
    };
  });
  return { entry, rijen };
}

// Eén regel die voorgelezen of getoond wordt ter bevestiging.
export function samenvatting(c: Concept, projecten: Project[]): string {
  const e = c.entry;
  const dag = new Intl.DateTimeFormat("nl-NL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${e.datum}T12:00:00Z`));
  const soort = { werk: "", verlof: "verlof", ziek: "ziek", feestdag: "feestdag", compensatie: "tijd-voor-tijd opgenomen" }[e.type];
  const delen = [dag];
  if (soort) delen.push(soort);
  if (e.start) delen.push(`${e.start}–${e.eind}`);
  else if (e.duur_min != null) delen.push(`${fmt(e.duur_min)} uur`);
  if (e.pauze_min) delen.push(`pauze ${e.pauze_min} min`);
  const netto = nettoMin(e);
  if (e.start && netto != null) delen.push(`netto ${fmt(netto)}`);
  if (e.locatie) delen.push(e.locatie);
  for (const r of c.rijen) {
    const p = projecten.find((x) => x.id === r.project_id)!;
    const aandeel = r.aandeel_min != null ? `${fmt(r.aandeel_min)} ` : "";
    const fact = r.facturabel_min != null ? `${fmt(r.facturabel_min)} facturabel` : `${r.facturabel_pct}% facturabel`;
    delen.push(`${aandeel}${p.klant} · ${p.naam} (${fact})`);
  }
  if (e.type === "werk" && !c.rijen.length) delen.push("nog geen project");
  if (e.notitie) delen.push(`notitie: ${e.notitie}`);
  return delen.join(", ");
}

// Zoekt een project op een genoemde naam; alleen een eenduidige treffer telt.
export function zoekProject(tekst: string, projecten: Project[]): Project | null {
  const t = tekst.trim().toLowerCase();
  if (!t) return null;
  const treffers = projecten.filter((p) => {
    const naam = p.naam.toLowerCase(), klant = p.klant.toLowerCase();
    return t.includes(naam) || naam.includes(t) || `${klant} ${naam}`.includes(t);
  });
  return treffers.length === 1 ? treffers[0] : null;
}

export function systeemPrompt(projecten: Project[], nu = new Date()): string {
  const { datum, hhmm, weekdag } = nuLokaal(nu);
  return `Je zet één Nederlandse zin, gesproken of getypt, om naar één urenregistratie.

Vandaag is ${weekdag} ${datum} en het is ${hhmm} (Nederlandse tijd).

Zo lees je de zin:
- Noemt de gebruiker geen dag, dan gaat het over vandaag. Relatieve dagen ("gisteren", "afgelopen vrijdag") reken je om naar een datum; een genoemde weekdag is de meest recente die niet in de toekomst ligt.
- Tijden noteer je als HH:MM in 24 uur. "Half negen" is 08:30, "kwart over vijf" na een ochtendstart is 17:15. Kies de lezing die een normale werkdag oplevert, tenzij de gebruiker avond of nacht noemt.
- Zijn er kloktijden genoemd, vul dan start en eind en laat duur_min leeg. Is alleen een duur genoemd ("twee uur gewerkt"), vul dan duur_min en laat start en eind leeg.
- pauze_min is 0 als er geen pauze genoemd is.
- type is "werk", tenzij de gebruiker verlof, ziekte, een feestdag of het opnemen van tijd-voor-tijd of compensatie noemt. Een hele dag verlof, ziek of feestdag heeft geen tijden en geen duur.
- locatie vul je alleen in als die genoemd is (thuis, kantoor, onderweg).
- notitie is een korte omschrijving van het werk als de gebruiker die geeft, anders leeg.

Projecten van de gebruiker:
${JSON.stringify(projecten.map((p) => ({ project_id: p.id, klant: p.klant, project: p.naam })))}

- Koppel alleen een project als de gebruiker een klant of project noemt dat duidelijk bij precies één regel uit deze lijst hoort. Spraakherkenning maakt fouten in namen, dus een naam die er sterk op lijkt telt. Twijfel je tussen meerdere, koppel er dan geen: de gebruiker wijst het later zelf toe.
- aandeel_min vul je in als de gebruiker een hoeveelheid tijd voor dat project noemt. Laat het leeg als het project alle tijd of "de rest" krijgt.
- facturabel_min of facturabel_pct vul je alleen in als de gebruiker iets over facturabel of declarabel zegt; anders laat je beide leeg en geldt de standaard van het project.

Zet begrepen op false als de zin geen urenregistratie is of als bij werk zowel de tijden als de duur ontbreken, en leg in vraag in één korte zin uit wat je mist.`;
}
