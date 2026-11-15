// Rekenregels voor uren, saldo en facturabel. Geen DOM, geen opslag: alleen pure functies.
// Datums zijn strings 'JJJJ-MM-DD' in lokale tijd; tijden zijn ISO-strings.

const HELE_DAG_TYPES = ['verlof', 'ziek', 'feestdag'];

export const pad = (n) => String(n).padStart(2, '0');

export function datumVan(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const vandaag = (nu = new Date()) => datumVan(nu);

// Rekent in UTC zodat zomer- en wintertijd geen dag kunnen verschuiven.
export function plusDagen(datum, n) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0 = maandag ... 6 = zondag
export function weekdag(datum) {
  return (new Date(`${datum}T12:00:00Z`).getUTCDay() + 6) % 7;
}
export const maandag = (datum) => plusDagen(datum, -weekdag(datum));

export function fmt(min) {
  const m = Math.round(Math.abs(min));
  return `${min < 0 ? '−' : ''}${Math.floor(m / 60)}:${pad(m % 60)}`;
}
export const fmtSaldo = (min) => (min > 0 ? '+' : '') + fmt(min);

// "1:30", "1,5", "1.5" of "90m" -> minuten; null als het geen geldige invoer is.
export function parseDuur(tekst) {
  const t = String(tekst ?? '').trim().replace(',', '.');
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+)\s*m$/i))) return +m[1];
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  return null;
}

export function normMin(datum, contracten) {
  const c = contracten.find(
    (p) => p.geldig_vanaf <= datum && (!p.geldig_tot || datum <= p.geldig_tot));
  return c ? c.norm_min[weekdag(datum)] : 0;
}

// Netto minuten die een registratie meetelt voor het saldo.
// - compensatie telt 0: het saldo daalt vanzelf doordat de norm niet gehaald wordt
// - verlof/ziek/feestdag zonder tijden tellen als de norm van die dag (neutraal)
// - een lopende klok telt tot 'nu'
export function nettoMin(entry, contracten, nu = new Date()) {
  if (entry.type === 'compensatie') return 0;
  if (entry.start) {
    const eind = entry.eind ? new Date(entry.eind) : nu;
    const bruto = (eind - new Date(entry.start)) / 60000;
    return Math.max(0, Math.round(bruto) - (entry.pauze_min || 0));
  }
  if (entry.duur_min != null) return entry.duur_min;
  if (HELE_DAG_TYPES.includes(entry.type)) return normMin(entry.datum, contracten);
  return 0;
}

// Minuten van één verdelingsrij, gegeven de netto minuten van de registratie.
export function rijMin(rij, netto) {
  const aandeel = rij.aandeel_min ?? Math.round((netto * (rij.aandeel_pct ?? 0)) / 100);
  const facturabel = Math.min(aandeel,
    rij.facturabel_min ?? Math.round((aandeel * (rij.facturabel_pct ?? 0)) / 100));
  return { aandeel, facturabel };
}

// Nog niet aan een project toegewezen minuten van een werkregistratie.
export function openMin(entry, rijen, contracten, nu) {
  if (entry.type !== 'werk') return 0;
  const netto = nettoMin(entry, contracten, nu);
  const toegewezen = rijen.reduce((s, r) => s + rijMin(r, netto).aandeel, 0);
  return Math.max(0, netto - toegewezen);
}

// Gewerkt, norm en verschil over een periode (beide datums inclusief).
export function saldo(entries, contracten, van, tot, nu = new Date()) {
  const perDag = new Map();
  for (const e of entries) {
    if (e.datum < van || e.datum > tot) continue;
    perDag.set(e.datum, (perDag.get(e.datum) || 0) + nettoMin(e, contracten, nu));
  }
  let gewerkt = 0, norm = 0;
  for (let d = van; d <= tot; d = plusDagen(d, 1)) {
    gewerkt += perDag.get(d) || 0;
    norm += normMin(d, contracten);
  }
  return { gewerkt, norm, verschil: gewerkt - norm };
}

// Tijd-voor-tijd-saldo: vanaf de start van het eerste contract t/m 'tot'.
export function tvtSaldo(entries, contracten, tot, nu) {
  if (!contracten.length) return 0;
  const van = contracten.map((c) => c.geldig_vanaf).sort()[0];
  return van > tot ? 0 : saldo(entries, contracten, van, tot, nu).verschil;
}
