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

Patience gebruikt een **eigen** Firebase Realtime Database (`patience-opa`, België), los van Mahjong. Sudoku gebruikt dezelfde database en hetzelfde online familieoverzicht.
`tracking-config.js` bevat alleen het database-adres. Publiceer `firebase/rules.json` in de Firebase-console
bij het inrichten van een nieuwe database; de nieuw aangemaakte database staat aanvankelijk op slot.

Speelmomenten worden **automatisch** bijgehouden zodra iemand speelt. Opa hoeft niets aan te zetten,
geen code in te voeren en geen link te openen. Elke installatie krijgt automatisch een eigen willekeurige
apparaatcode, die bij volgende bezoeken en updates gelijk blijft. Spellen op je eigen apparaat komen dus
niet bij die van opa. Alleen de pagina openen zonder te spelen levert geen speelrecord op.

Voor de familie: open `dash/` en kies de speler in de lijst, net als bij Mahjong. Apparaten verschijnen
vanzelf zodra erop wordt gespeeld. Kies **Alle spellen**, **Patience** of **Sudoku** om de totalen en speelmomenten te filteren.
Het dashboard onthoudt speler en spelkeuze en bewaart ze in de URL, zodat
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
De uitgebreidere records blijven compacte samenvattingen; zie de grootte-inschatting bij spelinzichten. Updates voegen geen nieuwe records toe. Tijden/daggrenzen gebruiken Europe/Amsterdam.

Controle: `node --test tests/*.test.cjs` (offline sync, herhaald verzenden, inactiviteit,
achtergrondtijd, herstel na afsluiten, opslagfouten, automatische migratie, middernacht, spelerskeuze,
naamgeving en live dashboardupdates). Controleer de regels ook met de Rules Playground in Firebase:
hele tellers toestaan, breuken weigeren, spelerslijst lezen toestaan en root lezen weigeren.

## Sudoku in hetzelfde overzicht

Het online familieoverzicht staat op https://dennis10276.github.io/Patience-app-opa/dash/ .
Alle spellen telt de speeltijd en begonnen/voltooide spellen van Patience en Sudoku samen.
Sudoku toont daarnaast moeilijkheid, dagelijks/normaal, gebruikte hints en gemaakte fouten per
speelmoment, plus hint- en fouttotalen over de laatste zeven dagen. Hints en fouten worden als acties
geteld, ook als een zet later wordt teruggedraaid. De geschiedenis begint bij deze update; eerdere lokale
Sudoku-statistieken worden niet als historische sessies geïmporteerd.

Een sessie zonder `app` blijft Patience; Sudoku schrijft `app: "sudoku"` en zijn extra tellers in dezelfde
`sessions/{apparaat}/{sessie}`-structuur. De bestaande lees- en schrijfrechten blijven gelijk.
De validatieregels accepteren de nieuwe velden alleen voor Sudoku en blijven breuken weigeren.
Het dashboard gebruikt dezelfde liveverbinding bij een andere spelkeuze; het downloadt niet opnieuw.

Beide apps delen `patience.sharing.v1` voor hun apparaatcode waar browseropslag gedeeld wordt.
Daarmee verschijnt een apparaat met één naam voor beide spellen. Sommige geïnstalleerde webapps,
privétabs of browsers hebben eigen opslag en verschijnen als apart apparaat. Hun namen kun je in het
overzicht instellen. De uploadwachtrijen en offlinecaches blijven per spel gescheiden. Elke serviceworker
ruimt alleen zijn eigen oude caches op. Sudoku telt vanaf de eerste invoer, notitie of hint, stopt bij
pauzes/menu's/achtergrondtijd en bewaart alleen samenvattingen; geen puzzels, oplossingen of zettenlog.


## Uitgebreide spelinzichten

Het gezamenlijke online dashboard toont nu een periode van 7, 30 of 90 dagen: Nederlandse uren en
weekdagen, typische actieve tijd (mediaan), geobserveerde pogingen, voltooiingen, acties en eindmeldingen.
Een willekeurige pogingcode verbindt pauzes/hervattingen van dezelfde poging; opnieuw beginnen krijgt
een nieuwe code. Een geladen oud spel krijgt een code bij het spelen, zonder historische zetten te importeren.
De vergelijking per spel/niveau is geen definitief winstpercentage: pogingen kunnen later nog worden voltooid.

Elk nieuw sessierecord bevat optioneel `detail` (versie 1): pogingcode, appversie, spelstand, begin/eindvoortgang,
score/spelklok, relevante spelinstellingen, begrensde actietellers, laatste actie/tijd, laatste voortgangstijd,
langste tijd zonder spelactie (maximaal 120 seconden), en een waargenomen eindmelding.
Patience telt kaartverplaatsingen, stapeltrekken/omdraaien, hints, terugzetten, automatisch uitspelen en
kaartacties die geen zet opleverden. Sudoku telt invoer, foutmeldingen, hints, notities, wissen,
terugzetten en tweede kansen. Fouten worden alleen als foutmelding geteld wanneer de foutencontrole aanstaat.
Voortgang is bij Patience het aantal kaarten op de vier stapels boven (van 52); bij Sudoku het aantal
correct ingevulde niet-vooringevulde vakjes. Een nuttige tableauzet hoeft dus geen stijging te geven.

Eindmeldingen onderscheiden winnen, foutenlimiet, geen-zettenmelding, nieuw spel, opnieuw beginnen,
menu, pauze, app verborgen, pagina verlaten, 2 minuten zonder aanraking, onderbroken browsertimer en
herstel na een crash/offlinebezoek. Een daggrens is alleen boekhouding. De app weet niet of iemand moe,
verveeld of gefrustreerd is; het dashboard presenteert patronen als aanwijzingen, niet als oorzaken.
Een plots afgesloten app kan de eindmelding missen; verouderde actieve records krijgen daarom geen
verzonnen stopreden. De tijd van een eindmelding kan de detectietijd zijn, bijvoorbeeld na timeronderbreking.

Alle metingen blijven automatisch en gebruiken dezelfde publieke database en bestaande toegangsregels.
Er is geen apart klikkenlogboek, kaart-/puzzelinhoud, oplossing, schermopname of externe analyticsdienst.
Oude records blijven zichtbaar met hun beperkte gegevens. De uitgebreide metingen beginnen bij deze update.
Elke 30 seconden wordt hetzelfde compacte record vervangen; offline wachtrijen blijven idempotent.
Reken met grofweg 0,5–1 kB ruwe inhoud per uitgebreid blok (afhankelijk van gebruikte acties), exclusief
sleutels en transport. Bij twintig blokken per dag is dat ongeveer 4–8 MB per jaar. Het dashboard laadt
nog steeds maximaal 90 dagen; ouder materiaal wordt niet automatisch uit Firebase verwijderd.


## Compacte speelrecords (detail v2)

Nieuwe metingen gebruiken één record per poging per Nederlandse dag en browsertab. Pauze, menu,
scherm uit en inactiviteit werken hetzelfde record bij als daarna dezelfde poging wordt hervat.
Een herstart of nieuw spel krijgt een nieuwe poging; een daggrens krijgt een nieuw dagrecord.
Een tab bewaart zijn laatst gebruikte record ook bij herladen. Afzonderlijke tabs voegen hun tellers
niet samen, zodat gelijktijdig spelen geen gegevens overschrijft. Zonder sessionStorage werkt de
tracking nog steeds, maar kan herladen een extra record maken.

`detail.stops` bewaart begrensde tellers per waargenomen onderbreking/einde; `detail.hours` bewaart
maximaal 24 actieve-seconden-tellers (`h00`–`h23`, Europe/Amsterdam). Pauzetijd wordt niet verdeeld
over de tussenliggende uren. Alleen de laatste eindmelding houdt een tijdstip; er is geen log per pauze.
Een record blijft ongeveer 0,5–1,5 kB, afhankelijk van het aantal gebruikte tellers. Herhaald pauzeren
dupliceert de metadata niet meer. Elke 30 seconden wordt hetzelfde record bijgewerkt.

Oude records en testspelers worden niet verwijderd of herschreven. Het dashboard accepteert beide
detailversies. Validatie wordt uitgebreid voor de twee begrensde tellerkaarten; lees-/schrijfrechten blijven gelijk.

Het dashboard groepeert de geschiedenis per dag en poging, met compacte grafieken en een uur/weekdag-heatmap zoals Mahjong. De technische meetrecords zijn standaard ingeklapt. Losse oude records zonder pogingcode worden niet op basis van een gok samengevoegd tot één spel.

Automatische browserruns (`navigator.webdriver`) sturen geen speelgegevens of spelersprofielen naar Firebase. Handmatig spelen, inclusief DennisTEST, blijft automatisch gemeten.
