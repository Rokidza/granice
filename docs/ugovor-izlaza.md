# Ugovor izlaza: pipeline → web

`python -m granice refresh` (ili `compute`) piše u `data/out/` (izvan verzioniranja) sljedeće datoteke. Web (`web/`) ih samo čita, pa se pipeline i web mogu mijenjati neovisno dok se ovaj ugovor drži. Sve geometrije su u WGS84 (lon, lat), koordinate zaokružene na 5 decimala (oko 1 m). Nazivi svojstava i vrijednosti prate [glosar](../GLOSSARY.md), bez dijakritika.

Promjena oblika podataka podiže `schema` u `meta.json`.

## `meta.json`

| ključ | značenje |
|---|---|
| `schema` | verzija ugovora (trenutno 1) |
| `osm_podaci_od` | vrijeme OSM podataka (ISO 8601), prikazuje se kao „OSM podaci od: …" |
| `generirano` | vrijeme izračuna |
| `pilot_bbox` | `south, west, north, east` Pilot odsječka |
| `parametri` | svi parametri izračuna (vidi tablicu ispod); web iz njih računa indeks i Kritična područja |
| `sporne_zone` | nazivi područja označenih kao sporna granica |
| `broj_segmenata_po_stanju` | brojač po `stanje` |
| `atribucija` | „© OpenStreetMap contributors" |

### Parametri

| ključ | zadano | značenje |
|---|---|---|
| `segment_length_m` | 500 | duljina Segmenta granice |
| `near_distance_m` | 100 | do te udaljenosti indeks je 1 |
| `far_distance_m` | 1500 | od te udaljenosti indeks je 0 |
| `critical_distance_m` | 500 | prag Kritičnog područja (udaljenost čiji indeks je prag) |
| `river_penalty` | 0,25 | koliko se indeks spušta kad rijeka leži između najbližeg para („jedan stupanj") |
| `sluzbeni_prijelaz_radius_m` | 500 | segmenti bliže od toga Službenom prijelazu izuzeti su iz procjene |
| `search_radius_m` | 3000 | koliko daleko od segmenta Staza još vrijedi kao „mapirana" |

Indeks: `1` za `d ≤ near`, `0` za `d ≥ far`, između linearno po `ln(d)`. Oznaka `rijeka` oduzima `river_penalty`.

## `staze.geojson`

`LineString`, jedan dio po Strani (Staza koja prelazi granicu dolazi kao dva dijela s istim `id`).

`id` (OSM way), `strana` (`HR` | `BiH`), `kategorija` (`cesta` | `makadam` | `staza`), `naziv`, `highway`.

## `granica.geojson`

`LineString` lanci granične linije unutar Pilot odsječka. Svojstvo `lanac` (redni broj). Informativno, nije pravno obvezujuće.

## `segmenti.geojson`

`LineString`, jedan Segment granice po značajci.

| svojstvo | značenje |
|---|---|
| `id` | `"<lanac>-<red>"` |
| `lanac`, `red` | lanac granice i redni broj segmenta u njemu (susjedni segmenti imaju `red` za 1 veći) |
| `stanje` | `procijenjen` \| `nedovoljno_podataka` \| `sluzbeni_prijelaz` \| `sporna_granica` |
| `rizik` | indeks 0–1; `null` osim za `procijenjen` |
| `udaljenost_m` | zračna udaljenost najbližeg para Staza; `null` osim za `procijenjen` |
| `duljina_m` | duljina segmenta |
| `rijeka` | vodotok leži između najbližeg para |
| `izravni_prelazak` | Staza presijeca granicu izvan Službenog prijelaza (`rizik` je 1) |
| `hr_staza_id`, `hr_staza_naziv`, `hr_staza_kategorija` | najbliža Staza HR Strane (isto `bih_…`) |

## `prijelazi.geojson`

`Point`. Svojstvo `tip`: `sluzbeni_prijelaz` (OSM `barrier=border_control`) ili `izravni_prelazak` (sredina segmenta s tom oznakom, svojstvo `segment`).

## `kriticna_podrucja.geojson`

Kritična područja pri zadanom pragu, poredana po `rang` (najviši vrh rizika, zatim duljina). Web ih sam preračunava kad planer promijeni prag, pa je ova datoteka namijenjena drugim alatima.

`rang`, `lanac`, `prvi_segment`, `zadnji_segment`, `broj_segmenata`, `duljina_m`, `najmanja_udaljenost_m`, `vrh_rizika`.

## Što pipeline očekuje od izvora podataka

Izvor podataka (`granice.osm.OsmSource`) vraća `OsmData`. Svaki vrh svake Staze označen je Stranom (`HR`, `BiH` ili `None` za vrh na samoj granici). Overpass izvor to dobiva upitom čvorova u području države. Geofabrik izvor ( `.pbf` ) morao bi isto, npr. točkom u poligonu države.
