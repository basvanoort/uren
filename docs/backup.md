# Back-up naar pCloud

Elke nacht om 02:17 UTC (03:17 in de winter, 04:17 in de zomer) zet Supabase een kopie van al je
gegevens in je pCloud, in de map **Uren backup**. Elk bestand heet `uren-JJJJ-MM-DD.json`; de
laatste 60 blijven staan, oudere worden verwijderd.

## Hoe het werkt

1. `pg_cron` in de database roept elke nacht de Edge Function `uren` aan met actie `backup-alle`
   en een willekeurige sleutel die alleen in de database staat (tabel `systeem`).
2. De functie leest alle tabellen van de gebruiker en uploadt één JSON-bestand naar pCloud.
3. Het pCloud-token staat in tabel `backup_koppeling`. Die tabel is niet leesbaar voor de app;
   alleen de functie kan erbij.

## Eenmalig: pCloud-app aanmaken

pCloud geeft alleen toegang via een eigen "app". Die maak je één keer aan:

1. Log in op pCloud en ga naar de pagina voor ontwikkelaars (My applications) via docs.pcloud.com.
2. Maak een nieuwe app aan, bijvoorbeeld "Uren backup". Kies bij toegang bij voorkeur alleen een
   eigen app-map (private app folder), dan kan de app niet bij je andere bestanden.
3. Vraagt pCloud om een redirect-adres, vul dan `https://basvanoort.github.io/uren/` in.
4. Zet de **Client ID** in `web/js/config.js` bij `PCLOUD_CLIENT_ID`. De Client ID is niet geheim;
   het **Client secret** is niet nodig en hoort nergens in deze repository.

## Koppelen

In de app: **Beheer → Back-up naar pCloud → Koppel pCloud**. pCloud opent in een nieuw venster;
geef toestemming en ga terug naar de app. De app maakt dan direct de eerste back-up.

## Terugzetten

Het bestand bevat per tabel alle rijen zoals ze in de database stonden (`tabellen.entries`, enz.).
Terugzetten gaat met een SQL-insert of via de Supabase-tabeleditor (CSV/JSON-import), tabel voor
tabel in deze volgorde: `klanten`, `projecten`, `contract_perioden`, `entries`, `verdeling`, `spraak_log`.
