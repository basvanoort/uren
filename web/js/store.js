// Opslag achter één kleine interface, zodat de app niet weet waar de data staat.
//   laad() -> { klanten, projecten, entries, verdeling, contract_perioden }
//   bewaar(tabel, rij), verwijder(tabel, id)
//   sessie(), login(email, wachtwoord), registreer(email, wachtwoord), logout()
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const TABELLEN = ['klanten', 'projecten', 'entries', 'verdeling', 'contract_perioden'];

function lokaleStore() {
  const SLEUTEL = 'uren-demo';
  const lees = () => {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(SLEUTEL)) || {}; } catch { /* lege start */ }
    for (const t of TABELLEN) data[t] ||= [];
    return data;
  };
  const schrijf = (data) => {
    try { localStorage.setItem(SLEUTEL, JSON.stringify(data)); } catch { /* privémodus */ }
  };
  return {
    demo: true,
    async sessie() { return { email: 'demo' }; },
    async login() {},
    async registreer() { return true; },
    async logout() {},
    async laad() { return lees(); },
    async bewaar(tabel, rij) {
      const data = lees();
      const i = data[tabel].findIndex((r) => r.id === rij.id);
      if (i < 0) data[tabel].push(rij); else data[tabel][i] = rij;
      schrijf(data);
    },
    async verwijder(tabel, id) {
      const data = lees();
      data[tabel] = data[tabel].filter((r) => r.id !== id);
      if (tabel === 'entries') data.verdeling = data.verdeling.filter((r) => r.entry_id !== id);
      schrijf(data);
    },
  };
}

async function supabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    async sessie() {
      const { session } = ok(await sb.auth.getSession());
      return session ? { email: session.user.email } : null;
    },
    // Wachtwoord in plaats van een inloglink: een link uit de mail opent op de iPhone in
    // Safari en logt dan niet de app op het beginscherm in (die heeft eigen opslag).
    async login(email, wachtwoord) {
      ok(await sb.auth.signInWithPassword({ email, password: wachtwoord }));
    },
    // Geeft true als je direct bent ingelogd, false als de mail eerst bevestigd moet worden.
    async registreer(email, wachtwoord) {
      const { session } = ok(await sb.auth.signUp({ email, password: wachtwoord }));
      return Boolean(session);
    },
    async logout() { await sb.auth.signOut(); },
    async laad() {
      const lijsten = await Promise.all(TABELLEN.map(async (t) => ok(await sb.from(t).select('*'))));
      return Object.fromEntries(TABELLEN.map((t, i) => [t, lijsten[i]]));
    },
    async bewaar(tabel, rij) { ok(await sb.from(tabel).upsert(rij)); },
    async verwijder(tabel, id) { ok(await sb.from(tabel).delete().eq('id', id)); },
  };
}

export async function maakStore() {
  return SUPABASE_URL && SUPABASE_ANON_KEY ? supabaseStore() : lokaleStore();
}
