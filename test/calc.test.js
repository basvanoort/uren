import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../web/js/calc.js';

const contract = [{ geldig_vanaf: '2026-12-01', geldig_tot: null, norm_min: [480, 480, 480, 480, 480, 0, 0] }];
const werk = (datum, van, tot, extra = {}) => ({
  datum, type: 'werk', start: `${datum}T${van}:00`, eind: tot && `${datum}T${tot}:00`, pauze_min: 0, ...extra,
});

test('weekdag en maandag', () => {
  assert.equal(C.weekdag('2026-12-01'), 1); // dinsdag
  assert.equal(C.maandag('2026-12-06'), '2026-11-30'); // zondag -> maandag ervoor
  assert.equal(C.plusDagen('2027-03-28', 1), '2027-03-29'); // over de zomertijdwissel
});

test('parseDuur en fmt', () => {
  assert.equal(C.parseDuur('1:30'), 90);
  assert.equal(C.parseDuur('1,5'), 90);
  assert.equal(C.parseDuur('45m'), 45);
  assert.equal(C.parseDuur('abc'), null);
  assert.equal(C.fmt(495), '8:15');
  assert.equal(C.fmtSaldo(-30), '−0:30');
  assert.equal(C.fmtSaldo(75), '+1:15');
});

test('netto: kloktijden min pauze, duur, lopende klok', () => {
  assert.equal(C.nettoMin(werk('2026-12-01', '08:30', '17:00', { pauze_min: 30 }), contract), 480);
  assert.equal(C.nettoMin({ datum: '2026-12-01', type: 'werk', duur_min: 120 }, contract), 120);
  const nu = new Date('2026-12-01T10:00:00');
  assert.equal(C.nettoMin(werk('2026-12-01', '08:30', null), contract, nu), 90);
});

test('netto: verlof telt als norm, compensatie als nul', () => {
  assert.equal(C.nettoMin({ datum: '2026-12-02', type: 'verlof' }, contract), 480);
  assert.equal(C.nettoMin({ datum: '2026-12-05', type: 'feestdag' }, contract), 0); // zaterdag
  assert.equal(C.nettoMin({ datum: '2026-12-02', type: 'compensatie' }, contract), 0);
});

test('norm buiten contractperiode is nul', () => {
  assert.equal(C.normMin('2026-11-30', contract), 0);
  assert.equal(C.normMin('2026-12-01', contract), 480);
});

test('saldo: avond- en weekendwerk is plus, compensatiedag is min', () => {
  const entries = [
    werk('2026-12-01', '08:30', '17:00', { pauze_min: 30 }), // 8:00
    werk('2026-12-01', '20:00', '21:30'),                     // +1:30 avond
    werk('2026-12-05', '10:00', '12:00'),                     // +2:00 zaterdag
    { datum: '2026-12-02', type: 'compensatie' },             // −8:00
    { datum: '2026-12-03', type: 'ziek' },                    // neutraal
    werk('2026-12-04', '08:00', '16:00'),                     // 8:00
  ];
  const week = C.saldo(entries, contract, '2026-11-30', '2026-12-06');
  assert.equal(week.norm, 4 * 480); // maandag 30 nov valt voor het contract
  assert.equal(week.verschil, 90 + 120 - 480);
  assert.equal(C.tvtSaldo(entries, contract, '2026-12-01'), 90);
  assert.equal(C.tvtSaldo(entries, contract, '2026-11-20'), 0);
});

test('verdeling: procent schaalt mee, minuten staan vast', () => {
  assert.deepEqual(C.rijMin({ aandeel_pct: 75, facturabel_pct: 50 }, 480), { aandeel: 360, facturabel: 180 });
  assert.deepEqual(C.rijMin({ aandeel_min: 360, facturabel_min: 300 }, 480), { aandeel: 360, facturabel: 300 });
  assert.deepEqual(C.rijMin({ aandeel_min: 60, facturabel_min: 90 }, 480), { aandeel: 60, facturabel: 60 });
});

test('open minuten', () => {
  const e = werk('2026-12-01', '08:00', '16:00');
  assert.equal(C.openMin(e, [], contract), 480);
  assert.equal(C.openMin(e, [{ aandeel_min: 360, facturabel_pct: 100 }], contract), 120);
  assert.equal(C.openMin(e, [{ aandeel_pct: 100, facturabel_pct: 0 }], contract), 0);
  assert.equal(C.openMin({ datum: '2026-12-02', type: 'verlof' }, [], contract), 0);
});
