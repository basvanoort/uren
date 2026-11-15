import * as C from './calc.js';
import { maakStore } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();

const TYPES = { werk: 'Werk', verlof: 'Verlof', ziek: 'Ziek', feestdag: 'Feestdag', compensatie: 'Tijd-voor-tijd opgenomen' };
const LOCATIES = { '': '—', kantoor: 'Kantoor', thuis: 'Thuis', onderweg: 'Onderweg' };
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

let store, sessie;
let S = { klanten: [], projecten: [], entries: [], verdeling: [], contract_perioden: [], api_tokens: [] };
let tab = 'vandaag';
let week = C.maandag(C.vandaag());
let maand = C.vandaag().slice(0, 7);
let dlg = null;
let spraak = { bezig: false, melding: '' }; // toestand van het spraakveld
let nieuwToken = ''; // net aangemaakt Siri-token, één keer zichtbaar

// ---------- data ----------

function meld(fout) {
  const el = $('#melding');
  el.textContent = `Opslaan mislukt: ${fout.message || fout}`;
  el.classList.add('toon');
  setTimeout(() => el.classList.remove('toon'), 6000);
}

// Past eerst het geheugen aan (scherm reageert direct) en schrijft dan weg.
// Mislukt het wegschrijven, dan wordt de echte stand opnieuw geladen.
async function bewaar(tabel, rij) {
  const i = S[tabel].findIndex((r) => r.id === rij.id);
  if (i < 0) S[tabel].push(rij); else S[tabel][i] = rij;
  try { await store.bewaar(tabel, rij); } catch (e) { meld(e); S = await store.laad(); }
}
async function verwijder(tabel, id) {
  S[tabel] = S[tabel].filter((r) => r.id !== id);
  if (tabel === 'entries') S.verdeling = S.verdeling.filter((r) => r.entry_id !== id);
  try { await store.verwijder(tabel, id); } catch (e) { meld(e); S = await store.laad(); }
}

const project = (id) => S.projecten.find((p) => p.id === id);
const klant = (id) => S.klanten.find((k) => k.id === id);
const projNaam = (id) => { const p = project(id); return p ? `${klant(p.klant_id)?.naam ?? '?'} · ${p.naam}` : '?'; };
const rijenVan = (entryId) => S.verdeling.filter((r) => r.entry_id === entryId);
const netto = (e) => C.nettoMin(e, S.contract_perioden);
const lopend = () => S.entries.find((e) => e.start && !e.eind);
const uur = (iso) => { const d = new Date(iso); return `${C.pad(d.getHours())}:${C.pad(d.getMinutes())}`; };
const isoVan = (datum, hhmm) => new Date(`${datum}T${hhmm}:00`).toISOString();
const nuMinuut = () => { const d = new Date(); d.setSeconds(0, 0); return d; };
const dagLabel = (datum, opties = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${datum}T12:00:00`).toLocaleDateString('nl-NL', opties);
const kleur = (min) => (min > 0 ? 'plus' : min < 0 ? 'min' : '');
const opDatum = (datum) => S.entries.filter((e) => e.datum === datum)
  .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

function standaarddag() {
  try { return { start: '08:30', eind: '17:00', pauze: 30, ...JSON.parse(localStorage.getItem('uren-standaarddag')) }; }
  catch { return { start: '08:30', eind: '17:00', pauze: 30 }; }
}

// Actieve projecten, meest recent gebruikte eerst.
function recenteProjecten() {
  const laatst = new Map();
  for (const r of S.verdeling) {
    const e = S.entries.find((x) => x.id === r.entry_id);
    const wanneer = e ? (e.start || e.datum) : '';
    if (wanneer > (laatst.get(r.project_id) || '')) laatst.set(r.project_id, wanneer);
  }
  return S.projecten.filter((p) => p.actief)
    .sort((a, b) => (laatst.get(b.id) || '').localeCompare(laatst.get(a.id) || ''));
}

// ---------- klokken ----------

async function start(projectId) {
  const nu = nuMinuut();
  const e = {
    id: uid(), datum: C.datumVan(nu), type: 'werk', start: nu.toISOString(), eind: null,
    duur_min: null, pauze_min: 0, locatie: null, notitie: '', bron: 'app',
  };
  await bewaar('entries', e);
  if (projectId) await koppel(e.id, projectId);
}
async function koppel(entryId, projectId) {
  await bewaar('verdeling', {
    id: uid(), entry_id: entryId, project_id: projectId, aandeel_pct: 100, aandeel_min: null,
    facturabel_pct: project(projectId)?.standaard_facturabel_pct ?? 100, facturabel_min: null,
  });
}
async function stop() {
  const e = lopend();
  if (e) await bewaar('entries', { ...e, eind: nuMinuut().toISOString() });
}

// ---------- schermen ----------

function entryRij(e) {
  const rijen = rijenVan(e.id);
  const open = C.openMin(e, rijen, S.contract_perioden);
  const tijd = e.start ? `${uur(e.start)}–${e.eind ? uur(e.eind) : '…'}` : (e.type === 'werk' ? 'duur' : 'dag');
  const delen = [];
  if (e.type !== 'werk') delen.push(TYPES[e.type]);
  if (rijen.length) delen.push(rijen.map((r) => projNaam(r.project_id)).join(', '));
  if (e.pauze_min) delen.push(`pauze ${e.pauze_min}m`);
  if (e.notitie) delen.push(e.notitie);
  const badge = e.type === 'werk' && open > 0
    ? `<span class="badge">${rijen.length ? `${C.fmt(open)} open` : 'geen project'}</span>` : '';
  return `<button class="entry" data-act="bewerk" data-id="${e.id}">
    <span class="tijd">${tijd}</span>
    <span class="wat">${esc(delen.join(' · '))} ${badge}</span>
    <span class="duur">${C.fmt(netto(e))}</span></button>`;
}

function chips(act) {
  return recenteProjecten().slice(0, 6).map((p) =>
    `<button class="klein" data-act="${act}" data-id="${p.id}">${esc(projNaam(p.id))}</button>`).join('');
}

function schermVandaag() {
  const dag = C.vandaag();
  const l = lopend();
  const vandaagMin = opDatum(dag).reduce((s, e) => s + netto(e), 0);
  const wk = C.saldo(S.entries, S.contract_perioden, C.maandag(dag), C.plusDagen(C.maandag(dag), 6));
  const tvt = C.tvtSaldo(S.entries, S.contract_perioden, C.plusDagen(dag, -1));
  const openLijst = S.entries
    .filter((e) => e.datum !== dag && e.eind !== null && C.openMin(e, rijenVan(e.id), S.contract_perioden) > 0)
    .sort((a, b) => b.datum.localeCompare(a.datum));
  const lijst = opDatum(dag);

  let klok;
  if (l) {
    const rijen = rijenVan(l.id);
    klok = `<div class="status">Klok loopt sinds ${uur(l.start)}<b>${C.fmt(netto(l))}</b>
        <span class="zacht">${rijen.length ? esc(rijen.map((r) => projNaam(r.project_id)).join(', ')) : 'nog geen project'}</span></div>
      <button class="stop groot" data-act="stop">Stop</button>
      ${S.projecten.some((p) => p.actief) ? `<h2>${rijen.length ? 'Wissel naar' : 'Kies project'}</h2>
        <div class="chips">${chips(rijen.length ? 'wissel' : 'koppel-lopend')}</div>` : ''}`;
  } else {
    const sd = standaarddag();
    klok = `<button class="start groot" data-act="start">Start</button>
      ${S.projecten.some((p) => p.actief) ? `<h2>Start op project</h2><div class="chips">${chips('start')}</div>` : ''}
      ${lijst.length ? '' : `<div class="chips"><button data-act="standaarddag">Standaarddag ${sd.start}–${sd.eind}</button></div>`}`;
  }

  return `<h1>${esc(dagLabel(dag, { weekday: 'long', day: 'numeric', month: 'long' }))}</h1>
    <div class="tegels">
      <div class="tegel"><small>Vandaag</small><b>${C.fmt(vandaagMin)}</b></div>
      <div class="tegel"><small>Deze week</small><b>${C.fmt(wk.gewerkt)}</b><small>van ${C.fmt(wk.norm)}</small></div>
      <div class="tegel"><small>Tijd-voor-tijd</small><b class="${kleur(tvt)}">${C.fmtSaldo(tvt)}</b><small>t/m gisteren</small></div>
    </div>
    <div class="kaart">${klok}</div>
    ${lijst.length ? `<h2>Vandaag</h2><div class="kaart">${lijst.map(entryRij).join('')}</div>` : ''}
    ${store.demo ? '' : `<form class="kaart" data-form="spraak">
      <label>Zeg of typ wat je gewerkt hebt
        <input name="tekst" placeholder="gisteren half negen tot vijf, half uur pauze" autocomplete="off" required ${spraak.bezig ? 'disabled' : ''}></label>
      <div class="rij" style="margin-top:8px"><span class="groei ${spraak.melding ? 'min' : 'zacht'}" style="font-size:.85rem">${esc(spraak.melding || 'Tik op de microfoon van je toetsenbord om te dicteren.')}</span>
        <button class="primair" ${spraak.bezig ? 'disabled' : ''}>${spraak.bezig ? 'Bezig…' : 'Verwerk'}</button></div>
    </form>`}
    <div class="chips"><button data-act="nieuw" data-datum="${dag}">＋ Handmatig invoeren</button></div>
    ${openLijst.length ? `<h2>Nog toe te wijzen (${openLijst.length})</h2>
      <div class="kaart">${openLijst.slice(0, 8).map((e) =>
        `<div class="zacht" style="font-size:.8rem;margin-top:6px">${esc(dagLabel(e.datum))}</div>${entryRij(e)}`).join('')}</div>` : ''}`;
}

function schermWeek() {
  const dag = C.vandaag();
  const eind = C.plusDagen(week, 6);
  const wk = C.saldo(S.entries, S.contract_perioden, week, eind);
  const dagen = DAGEN.map((_, i) => {
    const d = C.plusDagen(week, i);
    const lijst = opDatum(d);
    const s = C.saldo(S.entries, S.contract_perioden, d, d);
    const verschil = (s.norm || s.gewerkt) && (d < dag || (d === dag && lijst.length))
      ? `<span class="${kleur(s.verschil)}">${C.fmtSaldo(s.verschil)}</span>` : '';
    const leeg = d < dag && s.norm > 0 && !lijst.length ? '<span class="badge">niet ingevuld</span>' : '';
    return `<div class="kaart">
      <div class="dagkop"><b>${esc(dagLabel(d))}</b> ${leeg}
        <span class="rij"><span class="zacht">${C.fmt(s.gewerkt)} / ${C.fmt(s.norm)}</span> ${verschil}
        <button class="klein" data-act="nieuw" data-datum="${d}" aria-label="Toevoegen">＋</button></span></div>
      ${lijst.map(entryRij).join('')}</div>`;
  });
  return `<div class="weeknav">
      <button data-act="week" data-stap="-7" aria-label="Vorige week">‹</button>
      <span class="groei">Week ${weeknr(week)} · ${esc(dagLabel(week, { day: 'numeric', month: 'short' }))} – ${esc(dagLabel(eind, { day: 'numeric', month: 'short' }))}</span>
      <button data-act="week" data-stap="7" aria-label="Volgende week">›</button>
    </div>
    <div class="tegels">
      <div class="tegel"><small>Gewerkt</small><b>${C.fmt(wk.gewerkt)}</b></div>
      <div class="tegel"><small>Norm</small><b>${C.fmt(wk.norm)}</b></div>
      <div class="tegel"><small>Verschil</small><b class="${kleur(wk.verschil)}">${C.fmtSaldo(wk.verschil)}</b></div>
    </div>${dagen.join('')}`;
}

function weeknr(datum) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // donderdag van deze week
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

// Cijfers voor één maand: per project, niet toegewezen, afwezigheid en saldo per week.
function maandCijfers() {
  const entries = S.entries.filter((e) => e.datum.startsWith(maand));
  const perProject = new Map();
  const afwezig = {};
  let gewerkt = 0, open = 0;
  for (const e of entries) {
    const n = netto(e);
    if (e.type !== 'werk') { afwezig[e.type] = (afwezig[e.type] || 0) + (e.type === 'compensatie' ? 1 : n); continue; }
    gewerkt += n;
    const rijen = rijenVan(e.id);
    open += C.openMin(e, rijen, S.contract_perioden);
    for (const r of rijen) {
      const m = C.rijMin(r, n);
      const p = perProject.get(r.project_id) || { aandeel: 0, facturabel: 0 };
      p.aandeel += m.aandeel; p.facturabel += m.facturabel;
      perProject.set(r.project_id, p);
    }
  }
  const eerste = `${maand}-01`;
  const [j, m] = maand.split('-').map(Number);
  const laatste = `${maand}-${C.pad(new Date(j, m, 0).getDate())}`;
  const grens = [laatste, C.plusDagen(C.vandaag(), -1)].sort()[0]; // saldo loopt t/m gisteren
  const weken = [];
  for (let w = C.maandag(eerste); w <= grens; w = C.plusDagen(w, 7)) {
    const van = w < eerste ? eerste : w;
    const tot = [C.plusDagen(w, 6), grens].sort()[0];
    weken.push({ nr: weeknr(w), van, tot, ...C.saldo(S.entries, S.contract_perioden, van, tot) });
  }
  return { entries, perProject, afwezig, gewerkt, open, weken, grens };
}

function schermRapport() {
  const c = maandCijfers();
  const pct = (deel, geheel) => (geheel ? `${Math.round((deel / geheel) * 100)}%` : '–');
  let fact = 0;
  const rijen = [];
  for (const k of S.klanten) {
    const ps = S.projecten.filter((p) => p.klant_id === k.id && c.perProject.has(p.id));
    if (!ps.length) continue;
    const som = ps.reduce((s, p) => ({ a: s.a + c.perProject.get(p.id).aandeel, f: s.f + c.perProject.get(p.id).facturabel }), { a: 0, f: 0 });
    fact += som.f;
    rijen.push(`<tr class="klant"><td>${esc(k.naam)}</td><td>${C.fmt(som.a)}</td><td>${C.fmt(som.f)}</td><td>${pct(som.f, som.a)}</td></tr>`);
    for (const p of ps) {
      const v = c.perProject.get(p.id);
      rijen.push(`<tr><td class="inspring">${esc(p.naam)}</td><td>${C.fmt(v.aandeel)}</td><td>${C.fmt(v.facturabel)}</td><td>${pct(v.facturabel, v.aandeel)}</td></tr>`);
    }
  }
  if (c.open) rijen.push(`<tr><td>Niet toegewezen</td><td>${C.fmt(c.open)}</td><td>–</td><td>–</td></tr>`);
  const afwezig = Object.entries(c.afwezig).map(([t, v]) =>
    `<tr><td>${TYPES[t]}</td><td>${t === 'compensatie' ? `${v}×` : C.fmt(v)}</td></tr>`).join('');
  const tvt = C.tvtSaldo(S.entries, S.contract_perioden, c.grens);
  const som = c.weken.reduce((s, w) => ({ g: s.g + w.gewerkt, n: s.n + w.norm, v: s.v + w.verschil }), { g: 0, n: 0, v: 0 });

  return `<div class="rij" style="margin-bottom:12px">
      <label class="groei">Maand<input type="month" id="maand" value="${maand}"></label>
      <button data-act="csv" style="align-self:flex-end">CSV</button>
    </div>
    <h2>Klanten en projecten</h2>
    <div class="kaart tabelwrap"><table>
      <tr><th>Klant / project</th><th>Uren</th><th>Facturabel</th><th>%</th></tr>
      ${rijen.join('') || '<tr><td colspan="4" class="zacht">Geen uren deze maand</td></tr>'}
      <tr class="totaal"><td>Totaal gewerkt</td><td>${C.fmt(c.gewerkt)}</td><td>${C.fmt(fact)}</td><td>${pct(fact, c.gewerkt)}</td></tr>
    </table></div>
    ${afwezig ? `<h2>Afwezigheid</h2><div class="kaart tabelwrap"><table>${afwezig}</table></div>` : ''}
    <h2>Saldo per week (t/m gisteren)</h2>
    <div class="kaart tabelwrap"><table>
      <tr><th>Week</th><th>Gewerkt</th><th>Norm</th><th>Verschil</th></tr>
      ${c.weken.map((w) => `<tr><td>${w.nr} <span class="zacht">${esc(dagLabel(w.van, { day: 'numeric', month: 'short' }))}</span></td>
        <td>${C.fmt(w.gewerkt)}</td><td>${C.fmt(w.norm)}</td><td class="${kleur(w.verschil)}">${C.fmtSaldo(w.verschil)}</td></tr>`).join('')}
      <tr class="totaal"><td>Maand</td><td>${C.fmt(som.g)}</td><td>${C.fmt(som.n)}</td><td class="${kleur(som.v)}">${C.fmtSaldo(som.v)}</td></tr>
      <tr><td>Tijd-voor-tijd-saldo, cumulatief</td><td></td><td></td><td class="${kleur(tvt)}"><b>${C.fmtSaldo(tvt)}</b></td></tr>
    </table></div>`;
}

function csv() {
  const { entries } = maandCijfers();
  const regels = [['datum', 'type', 'start', 'eind', 'pauze_min', 'netto_min', 'klant', 'project', 'uren_min', 'facturabel_min', 'locatie', 'notitie']];
  for (const e of entries.sort((a, b) => (a.datum + (a.start || '')).localeCompare(b.datum + (b.start || '')))) {
    const n = netto(e);
    const basis = [e.datum, e.type, e.start ? uur(e.start) : '', e.eind ? uur(e.eind) : '', e.pauze_min || 0, n];
    const staart = [e.locatie || '', e.notitie || ''];
    const rijen = rijenVan(e.id);
    if (!rijen.length) regels.push([...basis, '', '', '', '', ...staart]);
    for (const r of rijen) {
      const p = project(r.project_id), m = C.rijMin(r, n);
      regels.push([...basis, klant(p?.klant_id)?.naam ?? '', p?.naam ?? '', m.aandeel, m.facturabel, ...staart]);
    }
  }
  const tekst = regels.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + tekst], { type: 'text/csv' }));
  a.download = `uren-${maand}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function schermBeheer() {
  const klantOpties = (gekozen) => S.klanten.map((k) =>
    `<option value="${k.id}" ${k.id === gekozen ? 'selected' : ''}>${esc(k.naam)}</option>`).join('');
  const veld = (tabel, r, naam, extra = '') =>
    `data-tabel="${tabel}" data-id="${r.id}" data-veld="${naam}" ${extra}`;
  const sd = standaarddag();
  return `<h1>Beheer</h1>
    ${store.demo ? '<div class="demo">Demo-modus: de data staat alleen in deze browser.</div>' : ''}
    <h2>Klanten</h2>
    <div class="kaart">
      ${S.klanten.map((k) => `<div class="rij" style="margin-bottom:8px">
        <input class="groei" value="${esc(k.naam)}" aria-label="Naam klant" ${veld('klanten', k, 'naam')}>
        <label class="rij"><input type="checkbox" style="width:auto;min-height:0" ${k.actief ? 'checked' : ''} ${veld('klanten', k, 'actief')}> actief</label></div>`).join('')}
      <form class="rij" data-form="klant"><input class="groei" name="naam" placeholder="Nieuwe klant" required>
        <button class="primair">Toevoegen</button></form>
    </div>
    <h2>Projecten</h2>
    <div class="kaart">
      ${S.projecten.map((p) => `<div class="rij" style="margin-bottom:14px">
        <input style="flex:1 1 100%" value="${esc(p.naam)}" aria-label="Naam project" ${veld('projecten', p, 'naam')}>
        <select class="groei" style="width:auto" aria-label="Klant" ${veld('projecten', p, 'klant_id')}>${klantOpties(p.klant_id)}</select>
        <input style="width:64px" inputmode="numeric" value="${p.standaard_facturabel_pct}" aria-label="Standaard facturabel procent" ${veld('projecten', p, 'standaard_facturabel_pct')}>%
        <label class="rij"><input type="checkbox" style="width:auto;min-height:0" ${p.actief ? 'checked' : ''} ${veld('projecten', p, 'actief')}> actief</label></div>`).join('')}
      ${S.klanten.length ? `<form class="rij" data-form="project">
        <input style="flex:1 1 100%" name="naam" placeholder="Nieuw project" required>
        <select class="groei" name="klant_id" style="width:auto" aria-label="Klant">${klantOpties()}</select>
        <button class="primair">Toevoegen</button></form>
        <p class="zacht" style="font-size:.85rem;margin:8px 0 0">Het percentage is het standaard facturabele deel; per registratie kun je ervan afwijken.</p>`
      : '<p class="zacht">Voeg eerst een klant toe.</p>'}
    </div>
    <h2>Contract: normuren per dag</h2>
    <div class="kaart">
      ${[...S.contract_perioden].sort((a, b) => a.geldig_vanaf.localeCompare(b.geldig_vanaf)).map((c) => `
        <label>Geldig vanaf<input type="date" value="${c.geldig_vanaf}" ${veld('contract_perioden', c, 'geldig_vanaf')}></label>
        <div class="norm7" style="margin:8px 0 14px">${DAGEN.map((d, i) =>
          `<label>${d}<input inputmode="decimal" value="${c.norm_min[i] / 60}" data-tabel="contract_perioden" data-id="${c.id}" data-norm="${i}"></label>`).join('')}</div>`).join('')}
      <button data-act="contract-nieuw">Nieuwe periode vanaf vandaag</button>
    </div>
    <h2>Standaarddag</h2>
    <div class="kaart raster" id="standaarddag">
      <label>Start<input type="time" name="start" value="${sd.start}"></label>
      <label>Eind<input type="time" name="eind" value="${sd.eind}"></label>
      <label class="breed">Pauze (minuten)<input inputmode="numeric" name="pauze" value="${sd.pauze}"></label>
    </div>
    ${store.demo ? '' : `<h2>Siri-opdrachten</h2>
    <div class="kaart">
      ${S.api_tokens.map((t) => `<div class="rij" style="margin-bottom:8px"><span class="groei">${esc(t.naam)}
        <span class="zacht" style="font-size:.85rem">· ${t.laatst_gebruikt ? `laatst gebruikt ${esc(dagLabel(t.laatst_gebruikt.slice(0, 10)))}` : 'nog niet gebruikt'}</span></span>
        <button class="klein gevaar" data-act="token-weg" data-id="${t.id}">Intrekken</button></div>`).join('')}
      ${nieuwToken ? `<p style="margin:0 0 4px">Kopieer dit token nu; het wordt niet opnieuw getoond.</p>
        <div class="token">${esc(nieuwToken)}</div>
        <p class="zacht" style="font-size:.85rem;margin:8px 0 4px">Adres voor de opdrachten:</p>
        <div class="token">${esc(store.functieUrl)}</div>` : ''}
      <div class="rij"><button data-act="token-nieuw">Nieuw token</button>
        <a class="zacht" style="font-size:.85rem" href="https://github.com/basvanoort/uren/blob/main/docs/siri.md" target="_blank" rel="noopener">Zo maak je de opdrachten</a></div>
    </div>` + `<h2>Account</h2><div class="kaart rij"><span class="groei">${esc(sessie.email)}</span>
      <button data-act="logout">Uitloggen</button></div>`}`;
}

function schermLogin(bericht = '') {
  $('#tabs').hidden = true;
  $('#scherm').innerHTML = `<h1>Uren</h1>
    <form class="kaart" data-form="login" style="display:grid;gap:10px">
      <label>E-mail<input type="email" name="email" autocomplete="username" required></label>
      <label>Wachtwoord<input type="password" name="wachtwoord" autocomplete="current-password" minlength="8" required></label>
      <button class="primair" name="actie" value="login">Inloggen</button>
      <button name="actie" value="registreer">Account aanmaken</button>
      <p class="zacht" style="margin:0">${esc(bericht)}</p>
    </form>`;
}

function render() {
  if (!sessie) return schermLogin();
  $('#tabs').hidden = false;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('actief', b.dataset.tab === tab);
  const schermen = { vandaag: schermVandaag, week: schermWeek, rapport: schermRapport, beheer: schermBeheer };
  $('#scherm').innerHTML = schermen[tab]();
}

// ---------- bewerkvenster ----------

// entry = bestaande registratie; concept = voorstel uit spraakinvoer; anders een lege regel op datum.
function openDlg(entry, datum, concept) {
  const c = concept?.entry;
  const e = entry ? { ...entry } : c ? {
    id: uid(), datum: c.datum, type: c.type, duur_min: c.duur_min, pauze_min: c.pauze_min,
    locatie: c.locatie, notitie: c.notitie, bron: 'spraak',
    start: c.start ? isoVan(c.datum, c.start) : null,
    eind: c.start && c.eind ? isoVan(c.eind <= c.start ? C.plusDagen(c.datum, 1) : c.datum, c.eind) : null,
  } : {
    id: uid(), datum, type: 'werk', start: null, eind: null, duur_min: null,
    pauze_min: 0, locatie: null, notitie: '', bron: 'app',
  };
  const bron = concept ? concept.rijen.map((r) => ({ id: uid(), ...r })) : rijenVan(e.id);
  dlg = {
    nieuw: !entry,
    e,
    v: { // formulierwaarden als tekst
      datum: e.datum, type: e.type, start: e.start ? uur(e.start) : '', eind: e.eind ? uur(e.eind) : '',
      duur: e.duur_min != null ? C.fmt(e.duur_min) : '', pauze: String(e.pauze_min || 0),
      locatie: e.locatie || '', notitie: e.notitie || '',
    },
    rijen: bron.map((r) => ({
      id: r.id, project_id: r.project_id,
      aandeel: r.aandeel_min != null ? C.fmt(r.aandeel_min) : String(r.aandeel_pct),
      aandeelEenheid: r.aandeel_min != null ? 'uur' : 'pct',
      fact: r.facturabel_min != null ? C.fmt(r.facturabel_min) : String(r.facturabel_pct),
      factEenheid: r.facturabel_min != null ? 'uur' : 'pct',
    })),
    fout: '',
  };
  tekenDlg();
  $('#dlg').showModal();
}

function tekenDlg() {
  const { v, rijen } = dlg;
  const opties = (obj, gekozen) => Object.entries(obj).map(([k, t]) =>
    `<option value="${k}" ${k === gekozen ? 'selected' : ''}>${t}</option>`).join('');
  const eenheid = (naam, i, gekozen) => `<select name="${naam}${i}" aria-label="Eenheid">
    <option value="pct" ${gekozen === 'pct' ? 'selected' : ''}>%</option>
    <option value="uur" ${gekozen === 'uur' ? 'selected' : ''}>uur</option></select>`;
  const keuze = S.projecten.filter((p) => p.actief || rijen.some((r) => r.project_id === p.id));
  $('#dlg').innerHTML = `<form method="dialog" id="dlgform" tabindex="-1" autofocus style="outline:none">
    <div class="raster">
      <label>Datum<input type="date" name="datum" value="${v.datum}" required></label>
      <label>Soort<select name="type">${opties(TYPES, v.type)}</select></label>
      <label>Start<input type="time" name="start" value="${v.start}"></label>
      <label>Eind<input type="time" name="eind" value="${v.eind}"></label>
      <label>Pauze (min)<input inputmode="numeric" name="pauze" value="${esc(v.pauze)}"></label>
      <label>Of alleen duur<input name="duur" placeholder="bijv. 1:30" value="${esc(v.duur)}"></label>
      <label>Locatie<select name="locatie">${opties(LOCATIES, v.locatie)}</select></label>
      <label>Notitie<input name="notitie" value="${esc(v.notitie)}"></label>
    </div>
    ${v.type === 'werk' ? `<h2>Projecten</h2>
      ${rijen.map((r, i) => `<div class="vrij">
        <div class="breed rij"><select class="groei" name="project${i}" data-wijzig="project" data-i="${i}" aria-label="Project">
          ${keuze.map((p) => `<option value="${p.id}" ${p.id === r.project_id ? 'selected' : ''}>${esc(projNaam(p.id))}</option>`).join('')}</select>
          <button type="button" class="klein gevaar" data-act="rij-weg" data-i="${i}" aria-label="Project verwijderen">✕</button></div>
        <label>Aandeel<span class="duo"><input name="aandeel${i}" value="${esc(r.aandeel)}">${eenheid('aandeelEenheid', i, r.aandeelEenheid)}</span></label>
        <label>Facturabel<span class="duo"><input name="fact${i}" value="${esc(r.fact)}">${eenheid('factEenheid', i, r.factEenheid)}</span></label>
      </div>`).join('')}
      ${keuze.length ? '<div class="chips"><button type="button" class="klein" data-act="rij-erbij">＋ Project</button></div>'
        : '<p class="zacht">Nog geen projecten. Voeg ze toe onder Beheer.</p>'}` : ''}
    <p class="min" style="margin:12px 0 0">${esc(dlg.fout)}</p>
    <div class="knoppen">
      ${dlg.nieuw ? '' : '<button type="button" class="gevaar" data-act="entry-weg">Verwijderen</button>'}
      <button type="button" data-act="dlg-sluit">Annuleren</button>
      <button type="button" class="primair" data-act="dlg-bewaar">Bewaren</button>
    </div></form>`;
}

// Neemt de getypte waarden over in dlg, zodat opnieuw tekenen niets weggooit.
function leesDlg() {
  const f = new FormData($('#dlgform'));
  for (const k of Object.keys(dlg.v)) if (f.has(k)) dlg.v[k] = f.get(k);
  dlg.rijen.forEach((r, i) => {
    if (!f.has(`project${i}`)) return;
    r.project_id = f.get(`project${i}`);
    r.aandeel = f.get(`aandeel${i}`); r.aandeelEenheid = f.get(`aandeelEenheid${i}`);
    r.fact = f.get(`fact${i}`); r.factEenheid = f.get(`factEenheid${i}`);
  });
}

// Zet tekst + eenheid om naar { pct, min }; null bij ongeldige invoer.
function waarde(tekst, eenheid) {
  if (eenheid === 'uur') { const m = C.parseDuur(tekst); return m == null ? null : { pct: null, min: m }; }
  const p = Number(String(tekst).replace(',', '.'));
  return tekst === '' || !(p >= 0 && p <= 100) ? null : { pct: p, min: null };
}

async function bewaarDlg() {
  leesDlg();
  const { v, e } = dlg;
  const fout = (t) => { dlg.fout = t; tekenDlg(); };
  if (!v.datum) return fout('Vul een datum in.');
  const nieuw = { ...e, datum: v.datum, type: v.type, pauze_min: parseInt(v.pauze, 10) || 0, locatie: v.locatie || null, notitie: v.notitie.trim() };
  if (v.start) {
    nieuw.start = isoVan(v.datum, v.start);
    nieuw.eind = v.eind ? isoVan(v.eind <= v.start ? C.plusDagen(v.datum, 1) : v.datum, v.eind) : null;
    nieuw.duur_min = null;
    const ander = lopend();
    if (!nieuw.eind && ander && ander.id !== e.id) return fout('Er loopt al een klok. Vul een eindtijd in.');
  } else {
    if (v.eind) return fout('Vul ook een starttijd in, of gebruik alleen duur.');
    nieuw.start = nieuw.eind = null;
    nieuw.duur_min = v.duur ? C.parseDuur(v.duur) : null;
    if (v.duur && nieuw.duur_min == null) return fout('Duur niet herkend. Gebruik bijvoorbeeld 1:30 of 1,5.');
    if (v.type === 'werk' && nieuw.duur_min == null) return fout('Vul kloktijden of een duur in.');
  }
  const rijen = [];
  for (const r of v.type === 'werk' ? dlg.rijen : []) {
    const a = waarde(r.aandeel, r.aandeelEenheid), f = waarde(r.fact, r.factEenheid);
    if (!a || !f) return fout('Aandeel of facturabel niet herkend. Gebruik een percentage (0–100) of uren zoals 1:30.');
    rijen.push({ id: r.id, entry_id: e.id, project_id: r.project_id, aandeel_pct: a.pct, aandeel_min: a.min, facturabel_pct: f.pct, facturabel_min: f.min });
  }
  $('#dlg').close();
  await bewaar('entries', nieuw);
  for (const oud of rijenVan(e.id)) if (!rijen.some((r) => r.id === oud.id)) await verwijder('verdeling', oud.id);
  for (const r of rijen) await bewaar('verdeling', { ...S.verdeling.find((x) => x.id === r.id), ...r });
  render();
}

// ---------- gebeurtenissen ----------

const acties = {
  async start(d) { await start(d.id); },
  async stop() { await stop(); },
  async wissel(d) { await stop(); await start(d.id); },
  async 'koppel-lopend'(d) { await koppel(lopend().id, d.id); },
  async standaarddag() {
    const sd = standaarddag(), dag = C.vandaag();
    await bewaar('entries', {
      id: uid(), datum: dag, type: 'werk', start: isoVan(dag, sd.start), eind: isoVan(dag, sd.eind),
      duur_min: null, pauze_min: Number(sd.pauze) || 0, locatie: null, notitie: '', bron: 'app',
    });
  },
  nieuw(d) { openDlg(null, d.datum); },
  bewerk(d) { openDlg(S.entries.find((e) => e.id === d.id)); },
  week(d) { week = C.plusDagen(week, Number(d.stap)); },
  csv() { csv(); },
  async logout() { await store.logout(); sessie = null; },
  async 'contract-nieuw'() {
    const dag = C.vandaag();
    const laatste = [...S.contract_perioden].sort((a, b) => b.geldig_vanaf.localeCompare(a.geldig_vanaf))[0];
    if (laatste && laatste.geldig_vanaf >= dag) return;
    if (laatste) await bewaar('contract_perioden', { ...laatste, geldig_tot: C.plusDagen(dag, -1) });
    await bewaar('contract_perioden', { id: uid(), geldig_vanaf: dag, geldig_tot: null, norm_min: laatste ? [...laatste.norm_min] : [480, 480, 480, 480, 480, 0, 0] });
  },
  async 'token-nieuw'() {
    const token = `uren_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    await bewaar('api_tokens', {
      id: uid(), naam: `Siri (${dagLabel(C.vandaag(), { day: 'numeric', month: 'short' })})`,
      token_hash: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      laatst_gebruikt: null,
    });
    nieuwToken = token;
  },
  async 'token-weg'(d) { nieuwToken = ''; await verwijder('api_tokens', d.id); },
  'dlg-sluit'() { $('#dlg').close(); },
  'dlg-bewaar'() { return bewaarDlg(); },
  async 'entry-weg'() { $('#dlg').close(); await verwijder('entries', dlg.e.id); },
  'rij-erbij'() {
    leesDlg();
    const p = recenteProjecten()[0];
    const eerste = !dlg.rijen.length;
    dlg.rijen.push({
      id: uid(), project_id: p.id, aandeel: eerste ? '100' : '', aandeelEenheid: eerste ? 'pct' : 'uur',
      fact: String(p.standaard_facturabel_pct), factEenheid: 'pct',
    });
    tekenDlg(); return 'geen-render';
  },
  'rij-weg'(d) { leesDlg(); dlg.rijen.splice(Number(d.i), 1); tekenDlg(); return 'geen-render'; },
};

document.addEventListener('click', async (ev) => {
  const tabKnop = ev.target.closest('#tabs button');
  if (tabKnop) { tab = tabKnop.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-act]');
  if (!el || !acties[el.dataset.act]) return;
  if ((await acties[el.dataset.act](el.dataset)) !== 'geen-render' && !el.dataset.act.startsWith('dlg-')) render();
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'maand' && el.value) { maand = el.value; return render(); }
  if (el.closest('#standaarddag')) {
    const blok = el.closest('#standaarddag');
    const sd = Object.fromEntries([...blok.querySelectorAll('input')].map((i) => [i.name, i.value]));
    try { localStorage.setItem('uren-standaarddag', JSON.stringify(sd)); } catch { /* privémodus */ }
    return;
  }
  if (el.dataset.wijzig === 'project') { // ander project gekozen: neem zijn standaardpercentage over
    leesDlg();
    const r = dlg.rijen[Number(el.dataset.i)];
    r.fact = String(project(r.project_id).standaard_facturabel_pct); r.factEenheid = 'pct';
    return tekenDlg();
  }
  if (el.name === 'type' && el.closest('#dlgform')) { leesDlg(); return tekenDlg(); }
  if (!el.dataset.tabel) return;
  const rij = { ...S[el.dataset.tabel].find((r) => r.id === el.dataset.id) };
  if (el.dataset.norm != null) {
    const min = C.parseDuur(el.value);
    if (min == null) return render();
    rij.norm_min = rij.norm_min.map((m, i) => (i === Number(el.dataset.norm) ? min : m));
  } else if (el.type === 'checkbox') rij[el.dataset.veld] = el.checked;
  else if (el.dataset.veld === 'standaard_facturabel_pct') rij[el.dataset.veld] = Math.min(100, Math.max(0, parseInt(el.value, 10) || 0));
  else if (!el.value.trim()) return render(); // lege naam of datum: terug naar de oude waarde
  else rij[el.dataset.veld] = el.value.trim();
  await bewaar(el.dataset.tabel, rij);
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form, ev.submitter);
  if (form.dataset.form === 'klant') await bewaar('klanten', { id: uid(), naam: f.get('naam').trim(), actief: true });
  if (form.dataset.form === 'project') {
    await bewaar('projecten', { id: uid(), klant_id: f.get('klant_id'), naam: f.get('naam').trim(), standaard_facturabel_pct: 100, actief: true });
  }
  if (form.dataset.form === 'spraak') {
    spraak = { bezig: true, melding: '' };
    render();
    try {
      const res = await store.functie({ actie: 'parse', tekst: f.get('tekst'), standaarddag: standaarddag() });
      spraak = { bezig: false, melding: res.fout ? res.bericht : '' };
      render();
      if (!res.fout) openDlg(null, null, res.concept);
    } catch (e) { spraak = { bezig: false, melding: e.message }; render(); }
    return;
  }
  if (form.dataset.form === 'login') {
    try {
      if (f.get('actie') === 'registreer') {
        const direct = await store.registreer(f.get('email'), f.get('wachtwoord'));
        if (!direct) return schermLogin('Account aangemaakt. Bevestig via de link in je mail en log daarna hier in.');
      } else await store.login(f.get('email'), f.get('wachtwoord'));
    } catch (e) { return schermLogin(e.message); }
    return begin();
  }
  render();
});

async function begin() {
  sessie = await store.sessie();
  if (sessie) {
    S = await store.laad();
    if (!S.contract_perioden.length) {
      await bewaar('contract_perioden', { id: uid(), geldig_vanaf: '2026-12-01', geldig_tot: null, norm_min: [480, 480, 480, 480, 480, 0, 0] });
    }
  }
  render();
}

store = await maakStore();
await begin();
// Houd de lopende klok en de dagwissel bij zonder een open venster te verstoren.
setInterval(() => {
  const typt = document.activeElement?.matches?.('#scherm input');
  if (sessie && tab === 'vandaag' && !$('#dlg').open && !typt && !spraak.bezig) render();
}, 30000);
