import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../supabase/functions/uren/logica.ts';

const projecten = [
  { id: 'p1', naam: 'Website', klant: 'Acme', standaard_facturabel_pct: 100 },
  { id: 'p2', naam: 'Intern', klant: 'Acme', standaard_facturabel_pct: 0 },
];
const ruw = (extra = {}) => ({
  begrepen: true, vraag: '', hele_dag: false, datum: '2026-12-01', type: 'werk', start: '08:30', eind: '17:00',
  duur_min: null, pauze_min: 30, locatie: null, notitie: '', projecten: [], ...extra,
});

test('lokale tijd naar UTC, winter en zomer', () => {
  assert.equal(L.lokaalNaarUtc('2026-12-01', '08:30'), '2026-12-01T07:30:00.000Z');
  assert.equal(L.lokaalNaarUtc('2027-07-01', '08:30'), '2027-07-01T06:30:00.000Z');
  assert.equal(L.lokaalNaarUtc('2027-03-28', '09:00'), '2027-03-28T07:00:00.000Z'); // dag van de wissel
});

test('nuLokaal geeft Nederlandse datum en tijd', () => {
  assert.deepEqual(L.nuLokaal(new Date('2026-12-01T23:30:00Z')), { datum: '2026-12-02', hhmm: '00:30', weekdag: 'woensdag' });
});

test('normaliseer: kloktijden zonder project', () => {
  const c = L.normaliseer(ruw(), projecten);
  assert.equal(L.nettoMin(c.entry), 480);
  assert.deepEqual(c.rijen, []);
});

test('normaliseer: één project krijgt alles, standaard facturabel', () => {
  const c = L.normaliseer(ruw({ projecten: [{ project_id: 'p2', aandeel_min: null, facturabel_min: null, facturabel_pct: null }] }), projecten);
  assert.deepEqual(c.rijen, [{ project_id: 'p2', aandeel_pct: 100, aandeel_min: null, facturabel_pct: 0, facturabel_min: null }]);
});

test('normaliseer: zes uur waarvan vijf facturabel, de rest intern', () => {
  const c = L.normaliseer(ruw({ projecten: [
    { project_id: 'p1', aandeel_min: 360, facturabel_min: 300, facturabel_pct: null },
    { project_id: 'p2', aandeel_min: null, facturabel_min: null, facturabel_pct: null },
    { project_id: 'bestaat-niet', aandeel_min: 60, facturabel_min: null, facturabel_pct: null },
  ] }), projecten);
  assert.deepEqual(c.rijen, [
    { project_id: 'p1', aandeel_pct: null, aandeel_min: 360, facturabel_pct: null, facturabel_min: 300 },
    { project_id: 'p2', aandeel_pct: null, aandeel_min: 120, facturabel_pct: 0, facturabel_min: null },
  ]);
  assert.match(L.samenvatting(c, projecten), /dinsdag 1 december, 08:30–17:00, pauze 30 min, netto 8:00, 6:00 Acme · Website \(5:00 facturabel\), 2:00 Acme · Intern \(0% facturabel\)/);
});

test('normaliseer: weigert onbruikbare invoer met een duidelijke melding', () => {
  assert.throws(() => L.normaliseer(ruw({ begrepen: false, vraag: 'Welke dag bedoel je?' }), projecten), /Welke dag/);
  assert.throws(() => L.normaliseer(ruw({ start: null, eind: null }), projecten), /tijden of de duur/);
  assert.throws(() => L.normaliseer(ruw({ eind: null }), projecten), /eindtijd/);
});

test('normaliseer: alleen duur, en hele dag verlof', () => {
  const duur = L.normaliseer(ruw({ start: null, eind: null, duur_min: 90, pauze_min: 0 }), projecten);
  assert.equal(L.nettoMin(duur.entry), 90);
  const verlof = L.normaliseer(ruw({ type: 'verlof', start: null, eind: null, pauze_min: 0, projecten: [{ project_id: 'p1', aandeel_min: null, facturabel_min: null, facturabel_pct: null }] }), projecten);
  assert.deepEqual(verlof.rijen, []);
  assert.equal(L.samenvatting(verlof, projecten), 'dinsdag 1 december, verlof');
});

test('hele dag gewerkt: standaarddag, anders norm, anders 8 uur', () => {
  const heleDag = ruw({ hele_dag: true, start: null, eind: null, pauze_min: 0 });
  const contracten = [{ geldig_vanaf: '2026-12-01', geldig_tot: null, norm_min: [480, 450, 480, 480, 480, 0, 0] }];
  const metSd = L.normaliseer(heleDag, projecten, { standaard: { start: '08:00', eind: '16:30', pauze: '30' }, contracten });
  assert.deepEqual([metSd.entry.start, metSd.entry.eind, metSd.entry.pauze_min, metSd.entry.duur_min], ['08:00', '16:30', 30, null]);
  const eigenPauze = L.normaliseer({ ...heleDag, pauze_min: 45 }, projecten, { standaard: { start: '08:00', eind: '16:30', pauze: 30 } });
  assert.equal(eigenPauze.entry.pauze_min, 45);
  assert.equal(L.normaliseer(heleDag, projecten, { contracten }).entry.duur_min, 450); // dinsdag
  assert.equal(L.normaliseer({ ...heleDag, datum: '2026-12-05' }, projecten, { contracten }).entry.duur_min, 480); // zaterdag, norm 0
  assert.equal(L.normaliseer(heleDag, projecten, { standaard: { start: 'x', eind: '', pauze: 0 } }).entry.duur_min, 480);
  // genoemde tijden gaan voor op hele_dag
  assert.equal(L.normaliseer(ruw({ hele_dag: true }), projecten, { standaard: { start: '08:00', eind: '16:30', pauze: 30 } }).entry.start, '08:30');
});

test('avondblok over middernacht', () => {
  const c = L.normaliseer(ruw({ start: '22:00', eind: '00:30', pauze_min: 0 }), projecten);
  assert.equal(L.nettoMin(c.entry), 150);
});

test('zoekProject: alleen een eenduidige treffer', () => {
  assert.equal(L.zoekProject('website', projecten)?.id, 'p1');
  assert.equal(L.zoekProject('acme', projecten), null);
  assert.equal(L.zoekProject('onbekend', projecten), null);
});

test('systeemprompt bevat datum en projecten', () => {
  const p = L.systeemPrompt(projecten, new Date('2026-12-01T09:00:00Z'));
  assert.match(p, /Vandaag is dinsdag 2026-12-01 en het is 10:00/);
  assert.match(p, /"project_id":"p1"/);
});
