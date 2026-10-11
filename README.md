# Patience voor opa

Patience (Klondike) kaartspel in het Nederlands, zonder reclame. Werkt als web-app: open de pagina in Safari op de iPhone/iPad en kies **Deel → Zet op beginscherm**. Daarna opent het schermvullend met een eigen icoon en werkt het ook zonder internet.

**Speel:** https://dennis10276.github.io/Patience-app-opa/

## Functies
- 1 of 3 kaarten trekken
- Standaard of Vegas telling (Vegas optioneel opgeteld over spellen)
- Tik op een kaart om hem automatisch te verplaatsen, of sleep hem
- Onbeperkt ongedaan maken (blijft bewaard na afsluiten)
- Hints, en melding als er geen zetten meer zijn
- Automatisch afmaken als alle kaarten open liggen
- Statistieken per spelsoort (gespeeld, gewonnen, reeksen, beste score/tijd)
- Staand en liggend scherm, iPhone en iPad
- Instellingen: kaartgrootte (normaal/groot), kaartletters (K Q J / H V B / R D V), rechts- of linkshandig, tijd tonen, dichte kaarten tonen, kolomhoogte, schaduwen, kleur achterkant, achtergrondkleur, snelheid, geluid, knoppen in de menubalk
- Spel wordt automatisch bewaard

## Kaarten
De klassieke kaartafbeeldingen (map `cards/`) komen uit *Vector Playing Cards* van Byron Knoll, vrijgegeven als CC0 / publiek domein (https://opengameart.org/content/playing-cards-vector-png). Voor heer, vrouw en boer zijn de "2"-versies (met plaatjes) gebruikt; voor schoppen-aas de eenvoudige versie. In `cards/groot/` staan dezelfde kaarten (gemaakt vanuit de SVG-versies) met de hoekletter/-cijfer 1,5× zo groot en het kleurtekentje op de originele grootte; de afbeelding in het midden is daarvoor iets kleiner gemaakt, zodat niets van de afbeelding bedekt wordt. In de instellingen kun je ook kiezen voor de zelf getekende Franse kaarten.

## Bestanden
- `index.html`, `style.css`, `game.js` – het spel
- `cards/` – de 52 kaartafbeeldingen (`cards/groot/` met grote hoekcijfers)
- `manifest.webmanifest`, `sw.js`, `icons/` – beginscherm-icoon en offline werken

Bij een nieuwe versie: verhoog `CACHE` in `sw.js` (en `?v=` in `index.html`) zodat iPhones de update meteen ophalen.
