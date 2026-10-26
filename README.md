# Granice

Interni analitički alat za planere granične policije: interaktivna karta Staza uz granicu Hrvatske i Bosne i Hercegovine te procjena **Rizika prelaska** po Segmentima granice, izračunata iz otvorenih podataka (OpenStreetMap).

**Status:** pilot odsječak (Dvor na Uni – Korenica – Donji Lapac) je implementiran. Cijela granica je buduća faza.

## Pokretanje

Potrebni su Python 3.11, Node i internet (pri prvom dohvatu podataka i za podloge karte).

```sh
# 1. izračun (jednom, i kad se podaci žele osvježiti)
cd pipeline
pip install -e ".[dev]"
python -m granice refresh          # ponovni dohvat OSM-a s Overpassa i izračun
python -m granice compute          # samo izračun iz već dohvaćenih podataka (data/raw/)

# 2. web
cd ../web
npm install
npm run vendor                     # kopira MapLibre i PMTiles u web/vendor (rad bez interneta)

# 3. prikaz, samo na ovom računalu (127.0.0.1)
cd ..
python -m granice serve            # http://127.0.0.1:8000/web/
```

Parametri izračuna mijenjaju se opcijama, npr. `python -m granice compute --segment-length-m 250 --near-distance-m 80`. Zadane vrijednosti i značenja: [`docs/ugovor-izlaza.md`](docs/ugovor-izlaza.md).

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

## Deploy na Netlify

Stranica je statična, ali izračunati slojevi (`data/`) nisu u gitu, pa se ne gradi na Netlifyju iz repozitorija nego se mapa za objavu sastavi lokalno i pošalje Netlify CLI-jem. Cijeli site je iza prijave (HTTP Basic, `netlify/edge-functions/auth.js`), jer alat ne smije imati javno dostupan URL (ADR 0001). Bez postavljenih lozinki site ne poslužuje ništa (503).

Jednokratno:

```sh
npm install -g netlify-cli
netlify login
netlify init                       # povezuje s novim ili postojećim Netlify siteom
netlify env:set BASIC_AUTH_USER <korisnik>
netlify env:set BASIC_AUTH_PASSWORD <jaka-lozinka>
```

Svaki put kad se podaci ili kod promijene:

```sh
python -m granice compute          # ili refresh, ako treba svježi OSM
cd web && npm run vendor && npm run build
cd .. && netlify deploy --prod --dir=web/dist
```

`npm run build` slaže `web/dist/` (stranica, `vendor/` i pet slojeva u `data/`) i prilagodi putanje u `config.js`. `web/dist/` je izvan gita. Za provjeru prije objave: `netlify deploy --dir=web/dist` (bez `--prod`) daje privremeni URL, također iza prijave.

Napomene: Netlify tada poslužuje izračunati rizik-sloj (OSM izvedena baza, vidi ADR 0001 o ODbL-u). Podloge s vanjskih servisa rade i na Netlifyju, vidi ADR 0002.

## Dokumentacija

- [`docs/DESIGN.md`](docs/DESIGN.md): dogovoreni dizajn (opseg, izračun rizika, prikaz, tehnika, redoslijed gradnje)
- [`docs/ugovor-izlaza.md`](docs/ugovor-izlaza.md): oblik podataka između izračuna i weba
- [`docs/podaci-i-licence.md`](docs/podaci-i-licence.md): istraživanje otvorenih izvora podataka, licencija i ograničenja
- [`GLOSSARY.md`](GLOSSARY.md): jezik domene (Staza, Segment granice, Rizik prelaska...)
- [`docs/adr/`](docs/adr/): zapisi arhitekturnih odluka (0001 interni alat, 0002 online podloge)

## Struktura

- `pipeline/`: Python izračun. `risk.py` je čista funkcija (jezgra, testirana), `osm.py` dohvat iza sučelja `OsmSource`, `prepare.py` priprema Staza i granice, `export.py` zapisuje slojeve.
- `web/`: statična stranica (MapLibre GL), bez backenda i baze.
- `data/`: sirovi OSM (`raw/`) i izračunati slojevi (`out/`), izvan verzioniranja.

## Napomena

Alat je namijenjen isključivo internoj upotrebi. Ne smije imati javno dostupan URL (vidi ADR 0001); na Netlifyju je zato iza prijave. `serve` sluša samo na `127.0.0.1`.
