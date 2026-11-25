// Edge Function "uren": spraakinvoer voor de app en een kleine API voor Siri-opdrachten.
//
// POST met JSON { actie, ... } en header Authorization: Bearer <sessie-JWT of persoonlijk token>
//   parse     { tekst, standaarddag? } -> { bericht, id, concept }   tekst naar conceptregel, slaat niets op
//   bevestig  { id }               -> { bericht }                slaat een eerder concept op
//   klok      { richting, project? } -> { bericht }              richting: "in" of "uit"
//   backup-koppel { access_token, locationid } -> status          koppelt pCloud en maakt meteen een back-up
//   backup-status | backup-nu | backup-ontkoppel  -> status
//   backup-alle                   (alleen de nachtelijke taak, met de sleutel uit tabel systeem)
// Elk antwoord heeft een veld "bericht" dat een opdracht direct kan tonen of voorlezen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import {
  type Concept, lokaalNaarUtc, normaliseer, nuLokaal, plusDag, type Project, type Ruw,
  type Standaarddag, samenvatting, SCHEMA, systeemPrompt, zoekProject,
} from "./logica.ts";
import { controleerToken, MAP, PCLOUD_HOSTS, zetBackup } from "./pcloud.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwoord = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function sha256(tekst: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Geeft de gebruiker bij een sessie-JWT (de app) of een persoonlijk token (Siri), anders null.
async function gebruiker(req: Request): Promise<{ id: string; bron: string } | null> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  if (bearer.startsWith("uren_")) {
    const { data } = await db.from("api_tokens").select("id, user_id").eq("token_hash", await sha256(bearer)).maybeSingle();
    if (!data) return null;
    await db.from("api_tokens").update({ laatst_gebruikt: new Date().toISOString() }).eq("id", data.id);
    return { id: data.user_id, bron: "opdracht" };
  }
  const { data } = await db.auth.getUser(bearer);
  return data.user ? { id: data.user.id, bron: "spraak" } : null;
}

async function projectenVan(userId: string): Promise<Project[]> {
  const { data, error } = await db.from("projecten")
    .select("id, naam, standaard_facturabel_pct, klanten(naam)").eq("user_id", userId).eq("actief", true);
  if (error) throw new Error(error.message);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((p: any) => ({
    id: p.id, naam: p.naam, klant: p.klanten?.naam ?? "", standaard_facturabel_pct: p.standaard_facturabel_pct,
  }));
}

async function vraagModel(tekst: string, projecten: Project[]): Promise<Ruw> {
  const anthropic = new Anthropic(); // leest ANTHROPIC_API_KEY uit de secrets van de functie
  const res = await anthropic.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: systeemPrompt(projecten),
    messages: [{ role: "user", content: tekst }],
  });
  if (res.stop_reason === "refusal") throw new Error("Het taalmodel wilde deze tekst niet verwerken.");
  if (res.stop_reason === "max_tokens") throw new Error("Het antwoord van het taalmodel was onvolledig. Probeer het opnieuw.");
  const blok = res.content.find((b) => b.type === "text");
  if (!blok || blok.type !== "text") throw new Error("Het taalmodel gaf geen bruikbaar antwoord.");
  return JSON.parse(blok.text) as Ruw;
}

async function parse(user: { id: string; bron: string }, tekst: string, standaard: Standaarddag | null) {
  const projecten = await projectenVan(user.id);
  const { data: contracten } = await db.from("contract_perioden")
    .select("geldig_vanaf, geldig_tot, norm_min").eq("user_id", user.id);
  const concept = normaliseer(await vraagModel(tekst, projecten), projecten, { standaard, contracten: contracten ?? [] });
  const { data, error } = await db.from("spraak_log")
    .insert({ user_id: user.id, transcript: tekst, concept, bron: user.bron }).select("id").single();
  if (error) throw new Error(error.message);
  return { bericht: samenvatting(concept, projecten), id: data.id, concept };
}

async function bewaarConcept(db: SupabaseClient, userId: string, c: Concept, bron: string): Promise<string> {
  const e = c.entry;
  const start = e.start ? lokaalNaarUtc(e.datum, e.start) : null;
  const eind = e.start && e.eind ? lokaalNaarUtc(e.eind <= e.start ? plusDag(e.datum) : e.datum, e.eind) : null;
  const { data, error } = await db.from("entries").insert({
    user_id: userId, datum: e.datum, type: e.type, start, eind, duur_min: e.duur_min,
    pauze_min: e.pauze_min, locatie: e.locatie, notitie: e.notitie, bron,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (c.rijen.length) {
    const { error: fout } = await db.from("verdeling").insert(c.rijen.map((r) => ({ ...r, user_id: userId, entry_id: data.id })));
    if (fout) throw new Error(fout.message);
  }
  return data.id;
}

async function bevestig(user: { id: string; bron: string }, id: string) {
  const { data: log } = await db.from("spraak_log").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!log) throw new Error("Dit concept bestaat niet (meer).");
  if (log.entry_id) return { bericht: "Dit was al opgeslagen." };
  const entryId = await bewaarConcept(db, user.id, log.concept as Concept, user.bron);
  await db.from("spraak_log").update({ entry_id: entryId }).eq("id", id);
  return { bericht: "Opgeslagen." };
}

const uurLokaal = (iso: string) => nuLokaal(new Date(iso)).hhmm;

async function klok(user: { id: string; bron: string }, richting: string, projectTekst: string) {
  const { data: lopend } = await db.from("entries").select("id, start, pauze_min")
    .eq("user_id", user.id).is("eind", null).not("start", "is", null).maybeSingle();
  const nu = new Date();
  nu.setSeconds(0, 0);

  if (richting === "uit") {
    if (!lopend) return { bericht: "Er loopt geen klok." };
    const { error } = await db.from("entries").update({ eind: nu.toISOString() }).eq("id", lopend.id);
    if (error) throw new Error(error.message);
    const min = Math.max(0, Math.round((nu.getTime() - new Date(lopend.start).getTime()) / 60000) - lopend.pauze_min);
    return { bericht: `Uitgeklokt om ${uurLokaal(nu.toISOString())}. Dit blok: ${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}.` };
  }
  if (richting !== "in") throw new Error("Onbekende richting; gebruik 'in' of 'uit'.");
  if (lopend) return { bericht: `De klok loopt al sinds ${uurLokaal(lopend.start)}.` };

  const project = projectTekst ? zoekProject(projectTekst, await projectenVan(user.id)) : null;
  const { data, error } = await db.from("entries").insert({
    user_id: user.id, datum: nuLokaal(nu).datum, type: "werk", start: nu.toISOString(), bron: user.bron,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (project) {
    await db.from("verdeling").insert({
      user_id: user.id, entry_id: data.id, project_id: project.id,
      aandeel_pct: 100, facturabel_pct: project.standaard_facturabel_pct,
    });
  }
  const staart = project ? ` op ${project.klant} · ${project.naam}` : projectTekst ? ", project niet herkend: wijs het later toe" : "";
  return { bericht: `Ingeklokt om ${uurLokaal(nu.toISOString())}${staart}.` };
}

// ---------- back-up naar pCloud ----------

const BACKUP_TABELLEN = ["klanten", "projecten", "entries", "verdeling", "contract_perioden", "spraak_log"];

async function backupInhoud(userId: string): Promise<string> {
  const tabellen: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABELLEN) {
    const { data, error } = await db.from(t).select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    tabellen[t] = data ?? [];
  }
  return JSON.stringify({ app: "uren", versie: 1, gemaakt_op: new Date().toISOString(), tabellen }, null, 1);
}

// deno-lint-ignore no-explicit-any
async function maakBackup(rij: any): Promise<void> {
  const nu = new Date().toISOString();
  try {
    const bestand = `uren-${nuLokaal().datum}.json`;
    await zetBackup(rij.hostname, rij.access_token, bestand, await backupInhoud(rij.user_id));
    await db.from("backup_koppeling").update({ laatste_backup: nu, laatste_poging: nu, laatste_bestand: bestand, laatste_fout: null })
      .eq("user_id", rij.user_id);
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e);
    await db.from("backup_koppeling").update({ laatste_poging: nu, laatste_fout: fout }).eq("user_id", rij.user_id);
    throw e;
  }
}

async function backupStatus(userId: string) {
  const { data } = await db.from("backup_koppeling")
    .select("pcloud_email, gekoppeld_op, laatste_backup, laatste_bestand, laatste_fout, laatste_poging")
    .eq("user_id", userId).maybeSingle();
  return data ? { gekoppeld: true, map: MAP, ...data } : { gekoppeld: false };
}

async function backupActie(userId: string, actie: string, body: Record<string, unknown>) {
  if (actie === "backup-koppel") {
    const host = PCLOUD_HOSTS[String(body.locationid ?? "")];
    const token = String(body.access_token ?? "");
    if (!host || !token) throw new Error("Onvolledige gegevens van pCloud ontvangen.");
    const email = await controleerToken(host, token);
    const { error } = await db.from("backup_koppeling").upsert({
      user_id: userId, hostname: host, access_token: token, pcloud_email: email,
      gekoppeld_op: new Date().toISOString(), laatste_fout: null,
    });
    if (error) throw new Error(error.message);
  }
  if (actie === "backup-ontkoppel") {
    await db.from("backup_koppeling").delete().eq("user_id", userId);
    return { bericht: "pCloud is ontkoppeld.", ...(await backupStatus(userId)) };
  }
  if (actie === "backup-koppel" || actie === "backup-nu") {
    const { data: rij } = await db.from("backup_koppeling").select("*").eq("user_id", userId).maybeSingle();
    if (!rij) throw new Error("pCloud is nog niet gekoppeld.");
    await maakBackup(rij);
    return { bericht: "Back-up gemaakt.", ...(await backupStatus(userId)) };
  }
  return { bericht: "", ...(await backupStatus(userId)) };
}

// De nachtelijke taak (pg_cron) stuurt de sleutel uit tabel systeem mee.
async function isNachtTaak(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer.length < 32) return false;
  const { data } = await db.from("systeem").select("waarde").eq("naam", "backup_sleutel").maybeSingle();
  return Boolean(data?.waarde) && (await sha256(data!.waarde)) === (await sha256(bearer));
}

async function backupAlle() {
  const { data, error } = await db.from("backup_koppeling").select("*");
  if (error) throw new Error(error.message);
  let gelukt = 0;
  for (const rij of data ?? []) {
    try { await maakBackup(rij); gelukt++; } catch (e) { console.error("back-up mislukt", rij.user_id, e); }
  }
  return { bericht: `${gelukt} van ${data?.length ?? 0} back-ups gemaakt.` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwoord({ bericht: "Gebruik POST." }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.actie === "backup-alle") {
      if (!(await isNachtTaak(req))) return antwoord({ bericht: "Geen toegang.", fout: true }, 401);
      return antwoord(await backupAlle());
    }
    const user = await gebruiker(req);
    if (!user) return antwoord({ bericht: "Niet ingelogd of ongeldig token.", fout: true }, 401);
    if (typeof body.actie === "string" && body.actie.startsWith("backup-")) {
      // Back-up beheren kan alleen vanuit de ingelogde app, niet met een Siri-token.
      if (user.bron === "opdracht") return antwoord({ bericht: "Niet toegestaan met een Siri-token.", fout: true }, 403);
      return antwoord(await backupActie(user.id, body.actie, body));
    }
    switch (body.actie) {
      case "parse": {
        const tekst = String(body.tekst ?? "").trim();
        if (!tekst) throw new Error("Ik heb geen tekst ontvangen.");
        if (tekst.length > 2000) throw new Error("De tekst is te lang; houd het bij één registratie.");
        const sd = body.standaarddag;
        const standaard = sd && typeof sd === "object"
          ? { start: String(sd.start ?? ""), eind: String(sd.eind ?? ""), pauze: Number(sd.pauze) || 0 } : null;
        return antwoord(await parse(user, tekst, standaard));
      }
      case "bevestig": return antwoord(await bevestig(user, String(body.id ?? "")));
      case "klok": return antwoord(await klok(user, String(body.richting ?? ""), String(body.project ?? "")));
      default: throw new Error("Onbekende actie.");
    }
  } catch (e) {
    // Status 200 met fout=true, zodat een Siri-opdracht het bericht gewoon kan tonen.
    let bericht = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.AuthenticationError) bericht = "De sleutel voor het taalmodel ontbreekt of is ongeldig.";
    else if (e instanceof Anthropic.RateLimitError) bericht = "Het taalmodel is even te druk. Probeer het zo opnieuw.";
    else if (e instanceof Anthropic.APIError) bericht = `Het taalmodel gaf een fout (${e.status ?? "geen verbinding"}).`;
    console.error(e);
    return antwoord({ bericht, fout: true });
  }
});
