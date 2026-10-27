# Dizajn: Granice

Dogovoreno kroz "grilling" sesiju 2026-10-26. Termini su definirani u [`../GLOSSARY.md`](../GLOSSARY.md), a ključna odluka o opsegu i podacima u [`adr/0001-interni-alat-samo-osm-podaci.md`](adr/0001-interni-alat-samo-osm-podaci.md). Objava na javnom URL-u: [`adr/0003-javna-objava.md`](adr/0003-javna-objava.md).

## Svrha i opseg

- Alat za planere granične policije: prikazuje Staze uz granicu HR–BiH i procjenjuje gdje je prelazak najlakši, radi boljeg raspoređivanja resursa.
- Korisnici su planeri i analitičari u uredu. Desktop preglednik. Terenska/mobilna verzija nije u opsegu.
- Aplikacija je bila zamišljena kao isključivo interna (ADR 0001), a objavljuje se javno (ADR 0003).
- Procjena se računa samo iz infrastrukture. Ne koristi podatke o osobama, incidentima ni patrolama.
- Sučelje je na hrvatskom, kod i komentari na engleskom, glosar na hrvatskom.

## Podaci (samo OSM u v1)

- **Staze:** svi `highway=*` osim `motorway`, `motorway_link`, `construction`, `proposed`, `raceway`. Zabrana pristupa (`access=private/no`) se ne uzima u obzir, jer nas zanima fizička prohodnost. Staze se prikazuju u kategorijama: cesta, makadam/šumski put, staza/puteljak.
- **Granična linija:** OSM relacije s `admin_level=2` (Hrvatska 214885, BiH 2528142). Linija je informativna, nije pravno obvezujuća. Sporni dijelovi (Una kod Hrvatske Kostajnice, Klek/Školji, Neum/Sutorina) označavaju se zasebno ("sporna granica") i za njih se rizik ne računa.
- **Vodotoci i vodene površine:** `waterway=river`, `natural=water`, koriste se kao prepreka.
- **Službeni prijelazi:** OSM `barrier=border_control` i/ili ručni popis.
- **Dohvat za pilot:** Overpass API, jedan upit, rezultat spremljen u `data/raw/` da se ne ponavlja bez potrebe. Dohvat je iza jedne funkcije, pa se za cijelu granicu može zamijeniti Geofabrik izvatcima (`croatia-latest.osm.pbf`, `bosnia-herzegovina-latest.osm.pbf`) i `pyosmium`.
- **Nije u v1:** HPS podaci (nema licence, treba pisana dozvola), DGU/data.gov.hr slojevi, minska polja, teren, šuma.

Detalji o izvorima i licencama: [`podaci-i-licence.md`](podaci-i-licence.md).

## Izračun rizika

1. Granica se dijeli na **Segmente granice** od 500 m (duljina je parametar).
2. Za svaki segment tražimo najbliži par Staza, jednu s HR Strane i jednu s BiH Strane, i mjerimo zračnu udaljenost `d`.
3. **Indeks rizika** je kontinuiran, 0–1, linearan po logaritmu udaljenosti: 1 pri `d ≤ 100 m`, 0 pri `d ≥ 1500 m`. Parametri su konfigurabilni.
4. Posebni slučajevi:
   - **Rijeka:** ako između najbližeg para Staza leži širi vodotok ili vodena površina, razina rizika se spusti za jedan stupanj, a segment dobije oznaku "rijeka".
   - **Službeni prijelaz:** označen ikonom, izuzet iz bojenja susjednih segmenata.
   - **Izravni prelazak:** Staza koja presijeca granicu izvan Službenog prijelaza daje segmentu najviši rizik i posebnu oznaku.
   - **Nedovoljno podataka:** ako s barem jedne Strane nema mapiranih Staza, rizik se ne procjenjuje. To nije isto što i nizak rizik, jer je OSM u BiH slabije mapiran.
5. **Kritično područje** je niz susjednih segmenata s najbližim parom Staza na ≤ 500 m. Prag se mijenja u sučelju.

## Prikaz

- MapLibre GL nad samostalno hostanim Protomaps PMTiles izvatkom za koridor HR–BiH. Ne koristi se `tile.openstreetmap.org` (politika ga zabranjuje za ovakvu upotrebu). Satelitska podloga (DGU ortofoto WMS) neobavezna je opcija ako licenca bude jasna. **Izmijenjeno ADR-om 0002:** podloge Karta (OpenFreeMap), Reljef (OpenTopoMap) i Satelit (Esri) dohvaćaju se online; lokalni izvadak ostaje neobavezan.
- Slojevi koji se uključuju i isključuju: Staze HR, Staze BiH (različite boje, po kategorijama), granica, rizik po segmentima, službeni prijelazi.
- Klik na segment prikazuje: indeks rizika, najbližu udaljenost, uključene Staze i oznake (rijeka, izravni prelazak).
- Bočna lista Top N Kritičnih područja, klik zumira kartu.
- Izvoz Kritičnih područja u CSV i GeoJSON.
- **Boja:** jedan sekvencijalni ton, od svijetle i blijede (nizak rizik) do tamne i zasićene (visok rizik), perceptualno ravnomjerno (interpolacija u OKLab-u). Ne koristi se duga ni semafor. **Nedovoljno podataka** je neutralna siva šrafura, izvan skale. Legenda je kontinuirana traka s oznakama na 250, 500 i 1000 m. Lista Top N služi kao tablični prikaz uz boju. Konkretne boje biraju se pri izradi i provjeravaju validatorom za daltonizam i kontrast, na svijetloj i tamnoj podlozi.
- Bez crtanja, spremanja bilješki i prijave korisnika u v1.
- Trajne napomene u sučelju:
  - granična linija je informativna (izvor OpenStreetMap, nije pravno obvezujuća);
  - procjena je indikativna i nije validirana terenskim podacima;
  - minski sumnjiva područja nisu prikazana, Staze mogu prolaziti kroz njih (istaknuti banner, jer Lika ulazi u pilot);
  - datum OSM podataka ("OSM podaci od: …").

## Pilot odsječak

Pilot je završen i alat pokriva cijelu granicu (vidi „Odluke pri implementaciji (cijela granica)"). Pilot je bio: od Dvora na Uni (južno od spornog dijela kod Hrvatske Kostajnice) preko Cetingrada, Slunja i Plitvica do Korenice, Donjeg Lapca i sjeverne Like. Pokriva Bihaćki džep (Velika Kladuša, Cazin, Bihać) i Lička Plješivicu. Procjena je oko 250 km, a točnu duljinu izmjerit će pipeline.

Zahtjev HCR-u/MUP-u za podatke o minama se ne šalje.

## Tehnika

- `pipeline/`: Python 3.11, dohvat OSM-a, izračun segmenata i rizika, izvoz GeoJSON-a.
- `web/`: statična stranica (MapLibre GL JS), učitava unaprijed izračunati GeoJSON. Bez backenda i baze.
- `data/`: sirovi OSM i generirani GeoJSON/PMTiles, izvan verzioniranja.
- `docs/adr/`: zapisi odluka. `GLOSSARY.md`: jezik domene.
- Osvježavanje podataka je ručno, jednom naredbom (ponovni dohvat i izračun).
- Dostupno na razvojnom računalu: Python 3.11, Node 24, npm, Git, Docker. Nisu instalirani `osmium`, `ogr2ogr`, `pmtiles`, `tippecanoe`.

## Redoslijed gradnje

1. Pipeline za pilot: Staze i granica u GeoJSON.
2. Web prikaz tih slojeva.
3. Izračun rizika i bojanje.
4. Lista Top N, izvoz, napomene.

**Testiranje:** test-first samo za izračun rizika, na malim sintetičkim primjerima:
- dvije paralelne staze na 200 m;
- rijeka između staza;
- staza koja presijeca granicu (izravni prelazak);
- službeni prijelaz;
- prazna strana (Nedovoljno podataka).

Web dio ide bez automatskih testova, uz ručnu provjeru u pregledniku.

## Prihvaćena ograničenja i faza 2

- Rezultati nisu validirani terenskim podacima, što je naznačeno u sučelju.
- Faza 2: teren i šuma (Copernicus DEM GLO-30, ESA WorldCover), minska polja uz formalni dogovor s HCR-om/MUP-om. Cijela granica (Overpass u pločicama) je gotova; Geofabrik izvatci ostaju moguća zamjena.
- Ako se rizik-sloj ikad dijeli izvan organizacije, treba ga objaviti pod ODbL-om i prije toga pravno provjeriti.

## Odluke redom (iz sesije)

| # | Odluka |
|---|---|
| Q1 | Desktop alat za planere, ne terenska aplikacija |
| Q2 | Rizik iz udaljenosti HR–BiH Staza, bez podataka o osobama |
| Q3 | V1 samo otvoreni podaci |
| Q4/Q8 | Pilot na dijelu granice koji uključuje Bihaćki džep i Plješivicu |
| Q5 | Interna aplikacija, nikad javni URL (promijenjeno ADR-om 0003: javna objava) |
| Q6 | Statična stranica plus Python pipeline |
| Q7 | Sučelje hrvatski, kod engleski |
| Q9 | Segment 500 m |
| Q10 | Kontinuirani indeks i sekvencijalna skala (zamijenilo razrede) |
| Q11 | Staze: svi `highway=*` osim navedenih iznimaka |
| Q12 | Službeni prijelazi izuzeti, izravni prelazak najviši rizik |
| Q13 | Rijeka spušta rizik za jedan stupanj |
| Q14 | Sučelje kako je opisano gore |
| Q15 | Izbačeno (nema terenske validacije u v1) |
| Q16 | Nedovoljno podataka je zasebno stanje (siva šrafura) |
| Q17 | OSM granica, informativna, sporni dijelovi zasebno |
| Q18 | Protomaps PMTiles, ne OSM tile server |
| Q19 | Samo OSM, bez HPS-a, ODbL za slučaj dijeljenja (ADR 0001) |
| Q20 | Mine nisu u v1, istaknuta napomena |
| Q21 | Overpass za pilot |
| Q22 | Ručno osvježavanje, predložena struktura repozitorija |
| Q23 | Test-first za izračun rizika, dogovoreni redoslijed |

## Odluke pri implementaciji (pilot)

Detalji koje dizajn nije propisivao, a implementacija ih je morala odabrati. Sve su parametri ili se lako mijenjaju.

- **„Jedan stupanj" za rijeku** (Q13) uz kontinuirani indeks (Q10): oduzima se `river_penalty` = 0,25 od indeksa (donja granica 0).
- **Kritično područje i rijeka:** segment je kritičan kad njegov *indeks* dosegne indeks praga (zadano udaljenost 500 m), a ne sama udaljenost. Tako rijeka može izbaciti segment iz područja. Isto računa web kad planer pomakne prag (`web/js/critical.js` zrcali `risk.py`).
- **Segment i Staze:** Staza se za segment računa unutar „zone" segmenta (pojas `search_radius_m` = 3000 m oko njega, okomito odrezan na krajevima), pa najbliži par pripada onom dijelu granice gdje se doista nalazi. Staza koja samo dodiruje rub zone ne računa se kao mapirana.
- **Strana Staze** dolazi iz OSM-a: svaki vrh Staze označen je državom u čijem se području nalazi (Overpass `area`). Staza koja prelazi granicu reže se na dva dijela na presjecištu s graničnom linijom; ako oba dijela pripadaju istom OSM wayu, to je **Izravni prelazak**.
- **Službeni prijelaz** je OSM `barrier=border_control` unutar 1 km od granice (čvorovi bliži od 100 m smatraju se jednim prijelazom) ili redak u neobaveznoj datoteci `data/sluzbeni_prijelazi.csv` (stupci `naziv,lat,lon`). Segmenti bliže od `sluzbeni_prijelaz_radius_m` (500 m, jer je čvor često mapiran stotinjak metara od same granice) dobivaju stanje `sluzbeni_prijelaz` i nemaju rizik. Prvenstvo stanja: sporna granica, službeni prijelaz, izravni prelazak, nedovoljno podataka.
- **Sporne zone** su gruba pravokutna područja u `config.py`, nijedno nije u pilotu. Treba ih pregledati prije proširenja na cijelu granicu.
- **Kategorije Staza:** `track` je makadam/šumski put; `path`, `footway`, `bridleway`, `steps`, `cycleway`, `pedestrian`, `corridor` su staza/puteljak; sve ostalo (osim isključenih) je cesta.
- **Vodotok:** `waterway=river` (crta) i `natural=water` (površina, uključujući vanjske rubove multipoligona). Rijeka „leži između" kad spojnica najbližeg para siječe vodotok.
- **Boja u tamnoj temi:** tamni kraj skale nestao bi u podlozi, pa se sidro okreće: u tamnoj temi niski rizik je prigušen, a visoki svijetao i zasićen. Prominentnost uvijek znači rizik. Obje skale prolaze `npm run check-colors`.
- **Podloga:** MapLibre stranica radi i bez podloge. PMTiles izvadak i fontovi su neobavezni i ne verzioniraju se (README).

## Odluke pri implementaciji (cijela granica)

Proširenje pilota na cijelu granicu HR–BiH (oko 1000 km). Izračun, ugovor izlaza i sučelje ostali su isti; promijenili su se dohvat podataka, popis spornih zona i opseg.

- **Opseg:** samo granica HR–BiH. Granice prema Srbiji i Crnoj Gori nisu uključene (drukčije Strane, drugi relacijski ID-evi); `config.py` i `OverpassSource` bi se morali poopćiti na par država.
- **Izvor (zadani): Geofabrik.** `GeofabrikSource` čita izvatke `croatia` i `bosnia-herzegovina` (`.osm.pbf`) pyosmiumom, a cijela granica se izračuna za nekoliko minuta. Granica je presjek članova relacija 214885 i 2528142 (svaka se čita iz izvatka svoje države). Overpass označava vrhove Staze državom (`area`), a Geofabrik toga nema, pa se Strana određuje točkom u poligonu države koji se gradi iz vanjskih članova njezine granične relacije; vrhovi na samoj granici nemaju Stranu, kao i prije. Na pilotu daje identičan rezultat kao Overpass (svih 338 segmenata isto stanje i isti rizik). Preuzimanje je ručno (`refresh`), a izvaci su dnevni.
- **Dohvat s Overpassa (`--izvor overpass`):** granica se dohvaća jednim upitom (svi wayevi zajednički objema relacijama). Okolina (Staze, vodotoci, prijelazi) dohvaća se u pločicama od 0,5° koje granica siječe (`tiles_along`), jer jedan upit za cijelu granicu ne bi stao u Overpass limite. Svaki odgovor se kešira u `data/raw/`, pa se prekinuti dohvat nastavlja. Wayevi na rubu pločica deduplicirani su po OSM ID-u, a Strana vrha računa se iz unije ID-eva čvorova svih pločica.
- **Granica kao lanac:** cijela granica spaja se u jedan lanac (pilot ih je imao nekoliko), pa Kritična područja ne prelaze preko praznina, a `id` segmenata je `0-<red>`.
- **Projekcija:** i dalje UTM 33N (EPSG:32633). Istočni kraj granice (oko 19°E) je izvan zone, ali je pogreška mjerila oko 0,08 %, nebitna uz prag od 100 m i više.
- **Sporne zone:** okvir „Neum i Sutorina" pokrivao je cijelo zaleđe Dubrovnika do Konavala (lat 42,4–42,95, lon 17,6–18,55) i sve bi to isključio iz procjene. Sutorina nije na granici HR–BiH, pa je okvir sužen na „Klek, Školji i Neum" (lat 42,86–43,00, lon 17,50–17,72). Okvir Une proširen je do ušća kod Jasenovca (lon 16,95). Oba su i dalje gruba; treba ih provjeriti.
- **Rijeka:** Sava je granica na stotinjak kilometara, pa će većina tih segmenata dobiti oznaku „rijeka" i spušten rizik. To je namjerno, ali rezultat za Savu treba tumačiti uz to.
- **Nepromijenjeno:** nema podataka o minama, a banner je sada relevantan za cijelu granicu (minski sumnjiva područja ima i u Baniji, Lici, zaleđu Zadra i Dubrovnika).

## Izmjene prikaza (raspon udaljenosti)

Planeri ne smatraju Staze na 0 m (npr. cesta koja prelazi granicu) nužno najrizičnijima, nego žele sami odabrati raspon udaljenosti. Zamjenjuje boju iz odjeljka „Prikaz” i Q10 na karti; izračun i ugovor izlaza nisu promijenjeni.

- **Raspon umjesto praga:** u bočnoj traci biraju se dvije granice, „od” i „do” (zadano 1000–1200 m, `web/config.js`), za zračnu udaljenost najbližeg para Staza. Klizači sežu do najveće udaljenosti u podacima (zaokruženo na 500 m).
- **Bez skale boja:** segment u rasponu je crven (ista crvena kao krugovi), ostali procijenjeni segmenti nisu obojeni (vidi se samo granična linija, a klik i dalje otvara opis). Nedovoljno podataka, Službeni prijelaz i sporna granica prikazuju se kao i prije.
- **Rijeka:** raspon gleda samo udaljenost, pa je segment s vodotokom između para crven ako je u rasponu. Oznaka „rijeka” ostaje u opisu segmenta.
- **Kritična područja:** nizovi susjednih segmenata u rasponu, zaokruženi i numerirani kao i prije, poredani po duljini pa po najbližem paru. Izvoz CSV/GeoJSON umjesto `vrh_rizika` ima `najveca_udaljenost_m`. Datoteka `kriticna_podrucja.geojson` iz izračuna i dalje koristi prag indeksa.
- **Krugovi:** polumjer kruga na karti računao se za pločice od 256 px, pa je krug bio upola manji od zamišljenog i nije obuhvaćao veća područja, a broj nije stajao na rubu kruga. Ispravljeno za MapLibre (512 px).
- **Ikone:** Izravni prelazak i Službeni prijelaz crtaju se dvostruko većima (oko 22 px pri pogledu na cijelu granicu, 36 px na razini ulica), oznake rangova su veće.
- **Crvena u svijetloj temi** je `#c73751` umjesto `#d7263d`: gotovo ista, a uz daltonizam (protanopija, deuteranopija) ostaje odvojena od smeđih makadama i staza. Provjerava `npm run check-colors`.
