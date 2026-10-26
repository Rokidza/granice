# Granice

Analitički alat za planere granične policije: interaktivna karta Staza uz granicu Hrvatske i Bosne i Hercegovine te procjena **Rizika prelaska** po Segmentima granice, izračunata iz otvorenih podataka (OpenStreetMap).

**Status:** pokrivena je cijela granica HR–BiH (oko 1000 km, od Une kod Hrvatske Kostajnice do Konavala). Pilot odsječak (Dvor na Uni – Korenica – Donji Lapac) i dalje se može izračunati zasebno (`--podrucje pilot`). Granice HR–Srbija i HR–Crna Gora nisu uključene.

## Pokretanje

Potrebni su Python 3.11, Node i internet (pri prvom dohvatu podataka i za podloge karte). Pri prvom izračunu preuzima se oko 360 MB.

```sh
# 1. izračun (jednom, i kad se podaci žele osvježiti)
cd pipeline
pip install -e ".[dev]"
python -m granice refresh          # ponovno preuzimanje Geofabrik izvadaka (oko 360 MB) i izračun
python -m granice compute          # samo izračun iz već preuzetih podataka (data/raw/)

# 2. web
cd ../web
npm install
npm run vendor                     # kopira MapLibre i PMTiles u web/vendor (rad bez interneta)

# 3. prikaz, samo na ovom računalu (127.0.0.1)
cd ..
python -m granice serve            # http://127.0.0.1:8000/web/
```

Zadani izvor su Geofabrik izvaci Hrvatske i BiH (`data/raw/geofabrik/`, čita ih `pyosmium`): cijela granica se izračuna za nekoliko minuta i ne ovisi o javnom poslužitelju. `--izvor overpass` dohvaća isto s Overpass API-ja u pločicama od pola stupnja (sporo, sat vremena i više, jer javni poslužitelji često vraćaju 502; odgovori se spremaju u `data/raw/`, pa se prekinuti dohvat nastavlja). `--podrucje pilot` računa samo Pilot odsječak, brže je za pokusne izmjene. Parametri izračuna mijenjaju se opcijama, npr. `python -m granice compute --segment-length-m 250 --near-distance-m 80`. Zadane vrijednosti i značenja: [`docs/ugovor-izlaza.md`](docs/ugovor-izlaza.md).

Provjere:

```sh
cd pipeline && python -m pytest && python -m mypy granice tests && python -m ruff check .
cd web && npm run check-colors     # validator boja karte (skala rizika, ceste, krugovi; daltonizam, kontrast, svijetla i tamna tema)
```

### Podloge karte

U bočnoj traci bira se podloga: **Karta**, **Reljef** (topografska s izohipsama), **Satelitska snimka** ili **Bez podloge**. Izbor se pamti u pregledniku. Podloge se dohvaćaju s vanjskih servisa (OpenFreeMap, OpenTopoMap, Esri), pa treba internet, a ti servisi vide koji se dio granice gleda ([ADR 0002](docs/adr/0002-online-podloge.md)). Popis i adrese su u `web/config.js`.

Bez interneta radi stranica na običnoj pozadini sa Stazama, granicom i rizikom. Za lokalnu kartu izradite Protomaps PMTiles izvadak koridora i spremite ga kao `data/basemap.pmtiles`; tada se nudi "Karta (lokalno, bez interneta)" i zadana je:

```sh
pmtiles extract https://build.protomaps.com/<datum>.pmtiles data/basemap.pmtiles --bbox=15.0,44.2,16.9,45.4
```

(`pmtiles` je [go-pmtiles](https://github.com/protomaps/go-pmtiles); aktualni naziv datoteke je na [maps.protomaps.com/builds](https://maps.protomaps.com/builds/).) Za nazive mjesta na lokalnoj karti treba i lokalni skup fontova u `data/fonts/{fontstack}/{range}.pbf` ([protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)); bez njih se crta bez natpisa.

## Objava na Netlifyju (javni URL)

Stranica je statična, pa se objavljuje povlačenjem mape. Izračunati slojevi (`data/`) nisu u gitu, zato se mapa za objavu sastavlja lokalno:

```sh
python -m granice compute          # ili refresh, ako treba svježi OSM
cd web
npm install                        # jednom
npm run vendor && npm run build    # slaže web/dist/
```

Zatim otvorite https://app.netlify.com/drop (prijava je besplatna) i povucite mapu **`web/dist`** na stranicu. Netlify odmah vraća javni URL (`https://<naziv>.netlify.app`, naziv se može promijeniti u postavkama siteta). Za novu verziju ponovno pokrenite `npm run build` i povucite mapu na karticu Deploys tog siteta.

`web/dist/` je potpuno samostalna: stranica, `vendor/`, pet slojeva u `data/` i `_headers` (`noindex`, bez cachea za podatke). Alternativa je Netlify CLI: `netlify deploy --prod --dir=web/dist` (`netlify.toml` u korijenu postavlja `publish`).

Što to znači (ADR 0003): svatko s URL-om vidi kartu rizika. Izračunati slojevi su OSM izvedena baza, pa se objavljuju pod ODbL-om; stranica uz atribuciju nudi njihovo preuzimanje. Podloge (ADR 0002) dolaze s vanjskih servisa, a uvjete Esri i OpenTopoMap za javnu stranicu treba provjeriti; ako ne odgovaraju, uklonite unose `satelit` i `reljef` iz `web/config.js` prije `npm run build`.

## Dokumentacija

- [`docs/DESIGN.md`](docs/DESIGN.md): dogovoreni dizajn (opseg, izračun rizika, prikaz, tehnika, redoslijed gradnje)
- [`docs/ugovor-izlaza.md`](docs/ugovor-izlaza.md): oblik podataka između izračuna i weba
- [`docs/podaci-i-licence.md`](docs/podaci-i-licence.md): istraživanje otvorenih izvora podataka, licencija i ograničenja
- [`GLOSSARY.md`](GLOSSARY.md): jezik domene (Staza, Segment granice, Rizik prelaska...)
- [`docs/adr/`](docs/adr/): zapisi arhitekturnih odluka (0001 samo OSM podaci, 0002 online podloge, 0003 javna objava)

## Struktura

- `pipeline/`: Python izračun. `risk.py` je čista funkcija (jezgra, testirana), `osm.py` dohvat iza sučelja `OsmSource`, `prepare.py` priprema Staza i granice, `export.py` zapisuje slojeve.
- `web/`: statična stranica (MapLibre GL), bez backenda i baze.
- `data/`: sirovi OSM (`raw/`) i izračunati slojevi (`out/`), izvan verzioniranja.

## Napomena

Procjena je indikativna i nije validirana terenskim podacima. Alat se objavljuje javno (ADR 0003). `serve` je razvojni poslužitelj i sluša samo na `127.0.0.1`.
