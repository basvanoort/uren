# Siri-opdrachten voor Uren

Met drie opdrachten in de app Opdrachten (Shortcuts) kun je in- en uitklokken en uren inspreken,
ook via Siri, de actieknop of een widget.

## Voorbereiding

1. Open de Uren-app, ga naar **Beheer → Siri-opdrachten** en tik op **Nieuw token**.
2. Kopieer het token (begint met `uren_`) en het adres dat eronder staat. Het token wordt één keer getoond.

In elke opdracht hieronder gebruik je de actie **Haal inhoud van URL op** met deze instellingen:

- URL: het adres uit de app
- Methode: **POST**
- Koptekst: `Authorization` met waarde `Bearer ` gevolgd door je token (let op de spatie)
- Aanvraagtekst: **JSON**, met de velden die per opdracht genoemd staan

Het antwoord is altijd JSON met een veld `bericht`. Haal dat eruit met **Haal woordenboekwaarde op**
(sleutel `bericht`) en toon het met **Toon resultaat**.

## Opdracht "Klok in"

1. Haal inhoud van URL op, met JSON-velden `actie` = `klok` en `richting` = `in`
2. Haal woordenboekwaarde op: `bericht`
3. Toon resultaat

Wil je direct op een project inklokken, voeg dan het veld `project` toe met (een deel van) de projectnaam.

## Opdracht "Klok uit"

Hetzelfde als "Klok in", maar met `richting` = `uit`.

## Opdracht "Log uren"

1. **Dicteer tekst** (taal: Nederlands)
2. Haal inhoud van URL op, met JSON-velden `actie` = `parse` en `tekst` = *Gedicteerde tekst*
3. Haal woordenboekwaarde op: `bericht` → dit is de samenvatting van wat de app begrepen heeft
4. Haal woordenboekwaarde op: `id` (uit het antwoord van stap 2)
5. **Toon melding** met de samenvatting, met de knop Annuleer aan. Annuleer je, dan stopt de opdracht en wordt er niets opgeslagen.
6. Haal inhoud van URL op, met JSON-velden `actie` = `bevestig` en `id` = de waarde uit stap 4
7. Toon resultaat: `bericht`

Voorbeelden van wat je kunt zeggen:

- "Gisteren van half negen tot kwart over vijf, half uur pauze, thuisgewerkt"
- "Vandaag acht tot vier, zes uur voor Website waarvan vijf facturabel, de rest intern"
- "Zaterdag twee uur gewerkt aan de offerte"
- "Vrijdag verlof"

## Automatisch klokken op locatie

In Opdrachten → Automatisering → **Aankomst** kies je je werkadres en laat je de opdracht "Klok in"
uitvoeren; maak er een tweede voor **Vertrek** met "Klok uit". Zet "Voer direct uit" aan.
Klok je al en kom je opnieuw aan, dan gebeurt er niets: de app meldt dat de klok al loopt.

## Token intrekken

Onder Beheer → Siri-opdrachten trek je een token in. Opdrachten die het gebruiken werken daarna niet meer.
