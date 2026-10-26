# Otvoreni podaci i licence

Izvještaj istraživanja iz 2026-10-26. Činjenice je prikupio pomoćni agent s weba i **nisu neovisno provjerene**. Stavke označene UNVERIFIED agent nije uspio potvrditi. Prije oslanjanja na licence ili brojeve, provjeri izvor.

## Status granice

- Sporazum o granici iz 1999. (Tuđman/Izetbegović) nikad nije ratificiran. Neumski sporazum o privremenoj granici također nije.
- Sporna mjesta: Una kod Kostajnice (RS traži liniju sredinom rijeke), vrh Kleka i otočići Veliki/Mali Školj, voda kod Neuma/Sutorine. Izvori su iz 2000.–2012., stanje 2026. nije provjereno.
- Ne postoji pravno konačna linija. Svaki skup podataka odražava de facto kontrolu ili administrativnu/katastarsku liniju.
- Izvori: https://en.wikipedia.org/wiki/Neum_Agreement, https://www.tportal.hr/vijesti/clanak/dodik-bosnia-croatia-border-must-run-along-middle-of-river-una-20120731

## Geometrija granice

| Izvor | Napomena |
|---|---|
| OSM `admin_level=2` | Relacija BiH 2528142 (verzija 655, uređena 2026-10-15, oko 1000 vanjskih ways), Hrvatska 214885. ODbL. Najbolji izbor, detaljan i aktualan. Preciznost nije objavljena (source tag: "combination of data from 1991 census & data after the war"). Granični ways dijele se između susjednih država. |
| Natural Earth 1:10m | Javno dobro, bez atribucije. Pregrubo, samo za pregled. |
| geoBoundaries | CC BY 4.0, atribucija obavezna. CGAZ je pojednostavljen. Preciznost za HR/BA nije navedena. |
| DGU/data.gov.hr | Namjenski skup državne granice nije pronađen (UNVERIFIED). |

## OSM dohvat i potpunost

- Geofabrik (ažurira se dnevno): `croatia-latest.osm.pbf` 191 MB, `bosnia-herzegovina-latest.osm.pbf` 154 MB. https://download.geofabrik.de/europe/croatia.html, https://download.geofabrik.de/europe/bosnia-herzegovina.html
- Overpass API: smjernica oko 10 000 upita i 1 GB dnevno, a za redovitu programsku upotrebu podijeliti sa 100. Zadani timeout 180 s. Treba identificirajući User-Agent. Za cijelu granicu bolji su Geofabrik izvatci. https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- Potpunost: nema brojčanih podataka za staze i puteljke u pograničnim regijama.
  - Studija iz 2024. (ISO 19157-1, Slovenija naspram Federacije BiH) pokazuje da kvaliteta ovisi o lokalnoj aktivnosti volontera. U visokim planinama BiH potpunost je niža. https://ica-abs.copernicus.org/articles/7/182/2024/ica-abs-7-182-2024.pdf
  - Lokalni maperi opisuju podatke u BiH kao slabo organizirane i nedosljedno označene. https://lists.openstreetmap.org/pipermail/talk-ba/2021-October/000066.html
  - Zaključak (zaključivanje, nije mjereno): Hrvatska je bolje mapirana od BiH. Staze u šumovitim, minskim i planinskim pograničnim zonama treba smatrati nepotpunima. Zato postoji stanje **Nedovoljno podataka**.
- Minska polja u OSM-u: oznaka `hazard=minefield` postoji, ali nema dokaza o sustavnom mapiranju. OSM se ne smije smatrati izvorom sigurnih ruta.

## HPS i data.gov.hr

- **https://www.hps.hr/karta/:** agent je dobio samo naslov i sliku (vjerojatno JavaScript stranica). Licenca nije pronađena. Rasprava iz 2015. kaže da je OSM trebao pisanu dozvolu HPS-a, pa se podaci smatraju neupotrebljivima bez nje. https://lists.openstreetmap.org/pipermail/talk-hr/2015-January/002324.html Dio HPS staza je u OSM-u s oznakom `ref:hr:hps`, ali je li bio formalni uvoz nije potvrđeno (UNVERIFIED).
- **data.gov.hr:**
  - TK25, TK100, TK200 topografske karte i DOF5 ortofoto (2014/16, 2021, 2022, 2023, 2024), uglavnom WMS/WMTS preko geoportal.dgu.hr. Licence se razlikuju po resursu, neki imaju "No License Provided", WMS za TK25 (2026-02) je "Otvorena dozvola". https://data.gov.hr/ckan/hr/dataset?q=DGU
  - DMR WMS je samo za registrirane korisnike. LiDAR (DMR, DMP) navodno je besplatan na zahtjev (izdavanje.podataka@dgu.hr), podaci su nedosljedni.
  - CORINE Land Cover (INSPIRE WMS, servisi.azo.hr), zaštićena područja i Natura 2000 (bioportal.hr).
  - Samostalan DEM skup nije pronađen.

## Teren i pokrov (faza 2)

- **Copernicus DEM GLO-30:** 30 m, besplatan (AWS Open Data), točniji od SRTM-a. Provjeriti da su pločice za HR i BiH prisutne. https://registry.opendata.aws/copernicus-dem/
- **ESA WorldCover 2021 v200:** 10 m, 11 klasa, ukupna točnost 76,7 %, CC BY 4.0. DOI 10.5281/zenodo.7254221.
- **CORINE CLC 2018:** 100 m, premalo detaljan za razinu puta.
- **DGU LiDAR:** znatno bolji od globalnih DEM-ova, ali samo za Hrvatsku.

## Licence

- **OSM ODbL:** atribucija "© OpenStreetMap contributors" obavezna. Rizik-sloj izračunat nad OSM geometrijom koji dodaje atribute OSM objektima vjerojatno je **izvedena baza** (Derivative Database) i mora se ponuditi pod ODbL-om. Obveze nastaju pri javnom korištenju ili distribuciji, ne pri čisto internoj upotrebi. Nije pravni savjet. Miješanje s ne-ODbL podacima (HPS, ograničeni DGU) može biti u sukobu s share-alike. https://osmfoundation.org/wiki/Licence_and_Legal_FAQ
- **OSM tile server** (`tile.openstreetmap.org`): samo interaktivni pregled, zabranjeno masovno preuzimanje i offline, bez SLA-a. Nije prikladan za proizvod institucije. https://operations.osmfoundation.org/policies/tiles/
- **OpenFreeMap:** MIT, bez ograničenja zahtjeva, atribucija "OpenMapTiles + OpenStreetMap", podržava samostalno hostanje. https://openfreemap.org/
- **Protomaps:** jedna PMTiles datoteka pod ODbL-om, regionalni izvadak `pmtiles extract`, hostanje na vlastitoj statičnoj pohrani. Teren iz Mapterhorn (Terrarium PMTiles). https://docs.protomaps.com/basemaps/downloads
- **Odabrano:** MapLibre GL s vlastitim Protomaps izvatkom, bez rizika politike tile servera i s radom bez interneta.

## Mine

- **Hrvatska:**
  - Mine Action Review: 47,2 km² minirano na kraju 2024. u 16 općina u 3 županije (Ličko-senjska 43,0 km², Splitsko-dalmatinska 0,66 km², Sisačko-moslavačka 3,5 km²), 98,5 % u šumi. Uz to 10,1 km² pod vojnom kontrolom i 2,1 km² NUS-a u Karlovačkoj županiji. https://www.mineactionreview.org/assets/downloads/Croatia_Clearing_the_Mines_2025.pdf
  - Izvješće Sabora: sumnjivo područje na kraju 2025. oko 1,9 km² (Donji Lapac i Otočac, 194 oznake). https://www.sabor.hr/sites/default/files/uploads/sabor/2026-02-26/151006/IZV_PROTUMINSKO_2025.pdf
  - data.gov.hr ima "Evidencija minski sumnjivih područja (MSP)" (MUP), ali samo kao poveznica na misportal.hcr.hr, a ne preuzimljiva datoteka. Naslov kaže CC BY-ND, a stranica CC BY 4.0. Uvid u miniranost traži formalni zahtjev (hcr@civilna-zastita.hr). Preuzimljiv sloj nije potvrđen.
- **BiH (BHMAC):**
  - Oko 823 km² sumnjivog područja na kraju 2024., ali Mine Action Review smatra to jako napuhanim (stvarno vjerojatno 2–10 %, oko 50 km²). Rok iz članka 5. je 1. ožujka 2027., BiH ne ostvaruje plan. https://www.mineactionreview.org/assets/downloads/BiH_Clearing_the_Mines_2025.pdf
  - Javno postoji samo mobilna aplikacija za pregled. Licenca "Sva prava zadržana", preuzimljiv GIS skup nije pronađen. Zapisi su nepotpuni. https://www.bhmac.org
- **Zaključak:** u v1 se minski podaci ne koriste. Karta nosi istaknutu napomenu da minski sumnjiva područja nisu prikazana. U Hrvatskoj je zagađenje malo i koncentrirano u Ličko-senjskoj županiji, a BiH je veliko, nesigurno i slabo digitalizirano.

## Neriješeno

Trenutni podaci i licenca HPS karte, precizna točnost OSM granice, uvjeti DOF5/DMR preuzimanja, licenca SRTM-a, brojke potpunosti staza, trenutni status javne karte misportal.hcr.hr, licenca CLC+.
