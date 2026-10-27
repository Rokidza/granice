# Ugovor izlaza: pipeline → web

`python -m granice refresh` (ili `compute`) piše u `data/out/` (izvan verzioniranja) sljedeće datoteke. Web (`web/`) ih samo čita, pa se pipeline i web mogu mijenjati neovisno dok se ovaj ugovor drži. Sve geometrije su u WGS84 (lon, lat), koordinate zaokružene na 5 decimala (oko 1 m). Nazivi svojstava i vrijednosti prate [glosar](../GLOSSARY.md), bez dijakritika.

Promjena oblika podataka podiže `schema` u `meta.json`.

## `meta.json`

| ključ | značenje |
|---|---|
| `schema` | verzija ugovora (trenutno 5) |
| `osm_podaci_od` | vrijeme OSM podataka (ISO 8601), prikazuje se kao „OSM podaci od: …" |
| `generirano` | vrijeme izračuna |
| `podrucje` | `cijela` (cijela granica HR–BiH) \| `pilot` (samo Pilot odsječak) |
| `podrucje_bbox` | `south, west, north, east` izračunatog područja |
| `parametri` | svi parametri izračuna (vidi tablicu ispod); web iz njih računa indeks i Kritična područja |
| `kategorije_izracuna` | kategorije Staza koje ulaze u izračun (trenutno samo `cesta`); ostale se samo prikazuju |
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
| `max_border_distance_m` | 500 | u izračun ulazi samo dio Staze do te udaljenosti od granične linije; ostatak se odreže, pa nijedan kraj najbližeg para nije dalje od granice |

Udaljenost najbližeg para je točna najmanja udaljenost između HR i BiH Staza (GEOS): STR-stablo odsječaka BiH Staza, najprije test presijecanja (udaljenost 0), zatim za svaki HR odsječak pretraga najbližeg uz odbacivanje dalekih čvorova (branch and bound). Spojnica para prelazi granicu, pa je `udaljenost_m` uvijek barem `hr_od_granice_m + bih_od_granice_m`.

Indeks: `1` za `d ≤ near`, `0` za `d ≥ far`, između linearno po `ln(d)`. Oznaka `rijeka` oduzima `river_penalty`.

## `staze.geojson`

`LineString`, jedan dio po Strani (Staza koja prelazi granicu dolazi kao dva dijela s istim `id`).

`id` (OSM way), `strana` (`HR` | `BiH`), `kategorija` (`cesta` | `makadam` | `staza`), `naziv`, `highway`, `izvan_pojasa` (dio dalje od `max_border_distance_m` od granice: ne ulazi u izračun, na karti je zamagljen). Staza koja izlazi iz pojasa dolazi kao više dijelova s istim `id`.

## `granica.geojson`

`LineString` lanci granične linije unutar izračunatog područja (za cijelu granicu to je obično jedan lanac). Svojstvo `lanac` (redni broj). Informativno, nije pravno obvezujuće.

## `segmenti.geojson`

`LineString`, jedan Segment granice po značajci.

| svojstvo | značenje |
|---|---|
| `id` | `"<lanac>-<red>"` |
| `lanac`, `red` | lanac granice i redni broj segmenta u njemu (susjedni segmenti imaju `red` za 1 veći) |
| `stanje` | `procijenjen` \| `nedovoljno_podataka` \| `sluzbeni_prijelaz` \| `sporna_granica` |
| `rizik` | indeks 0–1; `null` osim za `procijenjen` |
| `udaljenost_m` | zračna udaljenost najbližeg para Staza (samo `kategorije_izracuna`); `null` osim za `procijenjen` |
| `duljina_m` | duljina segmenta |
| `rijeka` | vodotok leži između najbližeg para |
| `izravni_prelazak` | Staza presijeca granicu izvan Službenog prijelaza (`rizik` je 1) |
| `hr_staza_id`, `hr_staza_naziv`, `hr_staza_kategorija` | najbliža Staza HR Strane (isto `bih_…`) |
| `hr_od_granice_m`, `bih_od_granice_m` | koliko je kraj najbližeg para na toj Strani udaljen od granične linije; `null` osim za `procijenjen` |

## `rijecna_granica.geojson`

`LineString` dijelovi granične linije koji teku rijekom ili uz vodu: točke granice do 75 m od osi rijeke (`waterway=river`) ili obrisa vodene površine (`natural=water`). Prekidi do 150 m se premošćuju, a dijelovi kraći od 300 m (rijeka samo presijeca granicu) izostavljaju. Pragovi su u `granice/river_border.py`. Svojstva `lanac`, `duljina_m`.

## `prijelazi.geojson`

`Point`. Svojstvo `tip`: `sluzbeni_prijelaz` (OSM `barrier=border_control`) ili `izravni_prelazak` (sredina segmenta s tom oznakom, svojstvo `segment`).

## `kriticna_podrucja.geojson`

Kritična područja pri zadanom pragu, poredana po `rang` (najviši vrh rizika, zatim duljina). Datoteka je namijenjena drugim alatima: web je ne čita, nego Kritična područja računa sam iz raspona udaljenosti najbližeg para koji planer odabere (`udaljenost_m` u `segmenti.geojson`).

`rang`, `lanac`, `prvi_segment`, `zadnji_segment`, `broj_segmenata`, `duljina_m`, `najmanja_udaljenost_m`, `vrh_rizika`.

## Što pipeline očekuje od izvora podataka

Izvor podataka (`granice.osm.OsmSource`) vraća `OsmData`. Svaki vrh svake Staze označen je Stranom (`HR`, `BiH` ili `None` za vrh na samoj granici). Overpass izvor to dobiva upitom čvorova u području države. Geofabrik izvor ( `.pbf` ) morao bi isto, npr. točkom u poligonu države.
