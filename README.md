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

## Speeltijd voor de familie

Patience gebruikt een **eigen** Firebase Realtime Database (`patience-opa`, België), los van Mahjong.
`tracking-config.js` bevat alleen het database-adres. Publiceer `firebase/rules.json` in de Firebase-console
bij het inrichten van een nieuwe database; de nieuw aangemaakte database staat aanvankelijk op slot.

Speelmomenten worden **automatisch** bijgehouden zodra iemand speelt. Opa hoeft niets aan te zetten,
geen code in te voeren en geen link te openen. Elke installatie krijgt automatisch een eigen willekeurige
apparaatcode, die bij volgende bezoeken en updates gelijk blijft. Spellen op je eigen apparaat komen dus
niet bij die van opa. Alleen de pagina openen zonder te spelen levert geen speelrecord op.

Voor de familie: open in de Firebase-console `sessions` en kopieer de code van opa's apparaat.
Plak die in `dash/` en bewaar de resulterende link op je eigen telefoon/computer. Het overzicht toont
recente activiteit, speeltijd vandaag/afgelopen week, begonnen/gewonnen spellen en recente speelmomenten.
De database als geheel blijft afgesloten: alleen de eigenaar kan via de console de apparaten bekijken.
Met een apparaatcode kan het dashboard de gegevens van dat apparaat lezen. Iedereen met de link kan
ook via de database-API de records wijzigen. Deel de link alleen met familie. Bestaande privélinks blijven
werken. De oude schakelaar voor delen is verwijderd; ook een eerder uitgeschakelde installatie gaat
na de update automatisch bijhouden.

Er wordt één klein record per speelmoment opgeslagen: begintijd, laatste activiteit, seconden, aantal
begonnen/gewonnen spellen en actief/niet actief. Geen kaarten, zettenlogboek, naam of apparaatdetails.
Hetzelfde record wordt elke 30 seconden bijgewerkt; herhaalde verzending maakt geen dubbele records.
Speeltijd is een schatting: zichtbaar spel, buiten menu's, tot maximaal twee minuten na het laatste
kaartcontact. Achtergrondtijd en lange onderbrekingen van de browsertimer tellen niet mee. Een spel wordt
pas bij de eerste zet als begonnen geteld; verder spelen na een pauze telt niet als nieuw spel.

Zonder internet wachten maximaal 500 samenvattingen lokaal op verzending (oudste vervallen daarna).
Een plots afgesloten app kan de laatste seconden missen; live activiteit vervalt na 75 seconden zonder
update. Het dashboard laadt alleen de laatste 90 dagen; oudere records blijven in Firebase bewaard.
Na het laden ontvangt het dashboard alleen gewijzigde records via een liveverbinding, zodat het
speelverleden niet elke halve minuut opnieuw wordt gedownload. De verbinding stopt in een verborgen tab.
Bij 20 speelmomenten per dag blijft de ruwe recordinhoud ongeveer 1 MB per jaar, exclusief databasesleutels
en transport. Updates voegen geen nieuwe records toe. Tijden/daggrenzen gebruiken Europe/Amsterdam.

Controle: `node --test tests/*.test.cjs` (offline sync, herhaald verzenden, inactiviteit,
achtergrondtijd, herstel na afsluiten, automatische migratie, middernacht en live dashboardupdates).
