# Granice

Interni analitički alat za planere granične policije: interaktivna karta Staza uz granicu Hrvatske i Bosne i Hercegovine te procjena **Rizika prelaska** po Segmentima granice, izračunata iz otvorenih podataka (OpenStreetMap).

**Status:** pilot odsječak (Dvor na Uni – Korenica – Donji Lapac) je implementiran. Cijela granica je buduća faza.

## Pokretanje

Potrebni su Python 3.11, Node i internet pri prvom dohvatu podataka.

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
cd web && npm run check-colors     # validator skale boja (daltonizam, kontrast, svijetla i tamna tema)
```

### Podloga karte bez interneta (neobavezno)

Bez podloge stranica radi na običnoj pozadini sa Stazama, granicom i rizikom. Za podlogu izradite Protomaps PMTiles izvadak koridora i spremite ga kao `data/basemap.pmtiles`:

```sh
pmtiles extract https://build.protomaps.com/<datum>.pmtiles data/basemap.pmtiles --bbox=15.0,44.2,16.9,45.4
```

(`pmtiles` je [go-pmtiles](https://github.com/protomaps/go-pmtiles); aktualni naziv datoteke je na [maps.protomaps.com/builds](https://maps.protomaps.com/builds/).) Za nazive mjesta na karti treba i lokalni skup fontova u `data/fonts/{fontstack}/{range}.pbf` ([protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)); bez njih podloga se crta bez natpisa. Satelitska podloga (DGU ortofoto) isključena je dok licenca nije potvrđena; vidi `web/config.js`.

## Dokumentacija

- [`docs/DESIGN.md`](docs/DESIGN.md): dogovoreni dizajn (opseg, izračun rizika, prikaz, tehnika, redoslijed gradnje)
- [`docs/ugovor-izlaza.md`](docs/ugovor-izlaza.md): oblik podataka između izračuna i weba
- [`docs/podaci-i-licence.md`](docs/podaci-i-licence.md): istraživanje otvorenih izvora podataka, licencija i ograničenja
- [`GLOSSARY.md`](GLOSSARY.md): jezik domene (Staza, Segment granice, Rizik prelaska...)
- [`docs/adr/`](docs/adr/): zapisi arhitekturnih odluka

## Struktura

- `pipeline/`: Python izračun. `risk.py` je čista funkcija (jezgra, testirana), `osm.py` dohvat iza sučelja `OsmSource`, `prepare.py` priprema Staza i granice, `export.py` zapisuje slojeve.
- `web/`: statična stranica (MapLibre GL), bez backenda i baze.
- `data/`: sirovi OSM (`raw/`) i izračunati slojevi (`out/`), izvan verzioniranja.

## Napomena

Alat je namijenjen isključivo internoj upotrebi. Ne smije imati javno dostupan URL (vidi ADR 0001). `serve` sluša samo na `127.0.0.1`.
