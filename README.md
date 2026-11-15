# Uren

Persoonlijke urenregistratie: kloktijden, tijd-voor-tijd-saldo, klanten/projecten en facturabele uren.
Eén webapp voor iPhone (op het beginscherm) en desktop; data in Supabase (project `uren`, Frankfurt).

## Opbouw

- `web/` – de app, zonder bouwstap (gewone HTML, CSS en JavaScript-modules)
  - `js/calc.js` – alle rekenregels (netto uren, norm, saldo, verdeling); getest in `test/`
  - `js/store.js` – opslag: Supabase, of demo-modus in de browser als `js/config.js` leeg is
  - `js/app.js` – schermen: Vandaag, Week, Rapport, Beheer
- `supabase/migrations/` – databaseschema (al toegepast op het project)

## Rekenregels

- Saldo = gewerkt − norm, per dag opgeteld vanaf de start van het contract (1 dec 2026, ma–vr 8 uur).
- Avond- en weekendwerk telt volledig als plus; "tijd-voor-tijd opgenomen" telt 0 uur.
- Verlof, ziek en feestdag zonder tijden tellen als de norm van die dag.
- Een registratie zonder projectverdeling is "open" en telt wel mee voor het saldo.
- Verdeling en facturabel worden opgeslagen zoals ingevoerd: als percentage of als minuten.

## Hosting

Elke push naar `main` draait de tests en publiceert `web/` via GitHub Pages
(`.github/workflows/pages.yml`). De app staat op https://basvanoort.github.io/uren/.

## Ontwikkelen

    npm test     # rekenregels
    npm start    # app op http://localhost:8080

## Nog te doen

- Site URL in Supabase instellen op het adres van de app
- Spraakinvoer en Siri-opdrachten (Edge Function die tekst omzet naar een conceptregel)
- Nachtelijke back-up naar pCloud
- PDF-export
