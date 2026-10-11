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

Voor de familie: open `dash/` en kies de speler in de lijst, net als bij Mahjong. Apparaten verschijnen
vanzelf zodra erop wordt gespeeld. Het dashboard onthoudt de keuze en bewaart hem in de URL, zodat
bestaande links blijven werken. Via **Speler een naam geven** kun je bijvoorbeeld "Opa" invullen;
deze naam blijft in Firebase bewaard en is ook op andere familieapparaten zichtbaar.

`players` bevat één klein profiel per installatie: alleen apparaattype (iPhone/iPad/Android/Computer)
en een optionele naam vanuit het dashboard. De lijst is publiek leesbaar om automatisch te kunnen kiezen.
Daarmee zijn ook de speelgegevens van de genoemde apparaten toegankelijk voor iedereen met dit dashboard
of database-adres. Er is geen aanmelding of toegangscontrole voor familie; namen en records kunnen via de
API gewijzigd worden door iemand die de apparaatcode kent. De rest van de databaseroot is niet leesbaar.
Gebruik geen gevoelige namen. De oude deelknop is verwijderd; alles gaat automatisch.

Als browseropslag niet werkt en er nog geen bewaarde apparaatcode is, slaat het spel tracking over.
Het spel blijft werken en probeert de code bij een volgende zet opnieuw te bewaren. Een al bewaarde code
blijft bruikbaar wanneer alleen nieuwe schrijfacties door volle opslag mislukken.

Er wordt één klein record per speelmoment opgeslagen: begintijd, laatste activiteit, seconden, aantal
begonnen/gewonnen spellen en actief/niet actief. Geen kaarten of zettenlogboek in de sessies. Het kleine spelersprofiel staat apart.
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
achtergrondtijd, herstel na afsluiten, opslagfouten, automatische migratie, middernacht, spelerskeuze,
naamgeving en live dashboardupdates). Controleer de regels ook met de Rules Playground in Firebase:
hele tellers toestaan, breuken weigeren, spelerslijst lezen toestaan en root lezen weigeren.
