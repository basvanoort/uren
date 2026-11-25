// Back-up naar pCloud via de pCloud-API.
// Werkwijze overgenomen uit de officiële pCloud JavaScript-SDK (github.com/pCloud/pcloud-sdk-js):
// - een OAuth-token gaat mee als parameter access_token
// - locationid 1 = api.pcloud.com (VS), 2 = eapi.pcloud.com (EU)
// - antwoorden zijn JSON met result 0 bij succes, anders result + error
// - uploadfile is een multipart POST met folderid en nopartial=1
// Geen Deno-specifieke code, zodat dit bestand met Node getest kan worden (test/pcloud.test.js).

export const PCLOUD_HOSTS: Record<string, string> = { "1": "api.pcloud.com", "2": "eapi.pcloud.com" };
export const MAP = "Uren backup";
export const BEWAAR = 60; // aantal dagelijkse back-ups dat blijft staan
const BESTAND = /^uren-\d{4}-\d{2}-\d{2}\.json$/;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// deno-lint-ignore no-explicit-any
export async function pcloud(host: string, methode: string, params: Record<string, string | number>, token: string, init?: RequestInit, f: Fetch = fetch): Promise<any> {
  if (!Object.values(PCLOUD_HOSTS).includes(host)) throw new Error("Onbekende pCloud-server.");
  const url = new URL(`https://${host}/${methode}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", token);
  const res = await f(url.toString(), init);
  if (!res.ok) throw new Error(`pCloud gaf HTTP-status ${res.status}.`);
  const data = await res.json();
  if (data.result !== 0) throw new Error(`pCloud: ${data.error ?? `fout ${data.result}`}`);
  return data;
}

// Controleert een token en geeft het e-mailadres van het pCloud-account terug.
export async function controleerToken(host: string, token: string, f: Fetch = fetch): Promise<string> {
  const info = await pcloud(host, "userinfo", {}, token, undefined, f);
  return String(info.email ?? "");
}

// Zet één back-up in de map MAP en ruimt back-ups op die ouder zijn dan de laatste BEWAAR.
// Een bestand met dezelfde naam (tweede back-up op een dag) wordt door pCloud overschreven.
export async function zetBackup(host: string, token: string, bestandsnaam: string, inhoud: string, f: Fetch = fetch) {
  const map = await pcloud(host, "createfolderifnotexists", { folderid: 0, name: MAP }, token, undefined, f);
  const folderid = map.metadata.folderid;
  const form = new FormData();
  form.append("file", new Blob([inhoud], { type: "application/json" }), bestandsnaam);
  await pcloud(host, "uploadfile", { folderid, nopartial: 1 }, token, { method: "POST", body: form }, f);

  const lijst = await pcloud(host, "listfolder", { folderid }, token, undefined, f);
  // deno-lint-ignore no-explicit-any
  const oud = (lijst.metadata.contents ?? []).filter((m: any) => !m.isfolder && BESTAND.test(m.name))
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => b.name.localeCompare(a.name)).slice(BEWAAR);
  for (const m of oud) await pcloud(host, "deletefile", { fileid: m.fileid }, token, undefined, f);
  return { verwijderd: oud.length };
}
