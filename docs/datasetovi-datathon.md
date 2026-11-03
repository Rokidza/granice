# Javni skupovi podataka za Datathon (data.gov.hr)

Istraživanje od 2026-11-03. Sve je dohvaćeno i provjereno izravno (CKAN API data.gov.hr, DGU geoportal, DZS PX-Web), osim gdje piše drukčije. Licence su s kataloga data.gov.hr, ne pravno tumačenje. Dopunjuje [`podaci-i-licence.md`](podaci-i-licence.md).

## Sažetak preporuke

| # | Skup | Izdavač | Što daje aplikaciji | Vrijednost | Trud |
|---|---|---|---|---|---|
| 1 | **Visine – INSPIRE (DMR 20 m)** | DGU | nadmorska visina, nagib, penjanje uz stazu; cijena puta koja nije zračna | visoka | srednji |
| 2 | **Granični promet, tablica T1–T8** (PX-Web) | DZS | promet po svakom od 44 prijelaza prema BiH, mjesečno 2015–2026 | srednja | malen |
| 3 | **Službene granične točke** | DGU | položaj graničnih oznaka po kilometraži (30 290 točaka BiH linije) | niska do srednja | srednji |
| 4 | Brojenje prometa na cestama 2025 | Hrvatske ceste | promet na državnim cestama uz granicu | niska | srednji |
| 5 | Registar geografskih imena (WFS) | DGU | nazivi naselja i toponima uz granicu | niska | malen |

## 1. Visine – INSPIRE (`visine-inspire`)

Licenca: Otvorena dozvola. Izvor: DMR koji vodi DGU, harmoniziran prema INSPIRE.

- **Preuzimanje:** ATOM `https://geoportal.dgu.hr/services/atom/el-cov/xml` nudi 82 GeoTIFF pločice `RH_ELEV_<n>.tif`, ukupno 2,8 GB.
- **Format:** `float64`, 2070–2074 piksela, **20 m**, EPSG:3045 (ETRS89 / UTM 33N, što je za metarsku matematiku ovdje isto što i `EPSG:32633` iz `config.py`), nepokriveno = `-9999`, bez kompresije.
- **Koridor granice:** granicu HR–BiH dira **28 pločica, oko 920 MB**. Popis se računa iz zaglavlja pločica (prvih 17 KB svake), koordinate kutova su u TIFF tagu 33922.
- **WMS** (`/services/inspire/el/wms`) vraća samo obojenu sliku (RGB `uint8`), ne visine, pa nije za analizu.
- Pogrešna pretpostavka iz `podaci-i-licence.md`: "DMR WMS je samo za registrirane korisnike" vrijedi za *izvorni* DMR (`digitalni-model-reljefa`), ali INSPIRE verzija je anonimno preuzimljiva.

### Mjerenje pokrivenosti (10 203 točke svakih 100 m duž granice)

| Gdje | Pokrivenost |
|---|---|
| na samoj graničnoj liniji | 75,1 % |
| 300 m na hrvatsku stranu | **97,4 %** |
| 300 m na bosansku stranu | **2,3 %** |
| 1 km na hrvatsku / bosansku stranu | 96,1 % / 5,2 % |

Visina na granici: min −2 m, medijan 111 m, max 1750 m.

**Posljedica:** DGU daje visine samo za Hrvatsku. Prazna linija (25 %) su većinom rječni dijelovi (Sava, Una) gdje je granica sredina vode. Za bosansku stranu treba drugi izvor: Copernicus DEM GLO-30 (već naveden u `podaci-i-licence.md`), koji nije na data.gov.hr. Realan prijedlog je DGU za HR i GLO-30 za BiH, ili samo GLO-30 radi dosljednosti obje strane (30 m naspram 20 m).

### Što to omogućuje

1. **Prikaz uzvisina:** hillshade ili izohipse kao sloj, ili boja Staze po nagibu.
2. **Udaljenost koja nije zračna:** danas je `link` najkraća zračna linija između najbližeg para Staza. Uz DMR se može računati trošak hoda (npr. Toblerova funkcija) i penjanje po toj liniji, pa je 300 m uz strmu padinu manje "blizu" nego 300 m po ravnom. To mijenja `risk_index`, pa treba odluku o modelu (vidi ADR 0001 o validaciji).
3. **Razdvajanje Staza strmim terenom:** par Staza s liticom između njih nije jednako lak prelazak kao par u ravnici, slično kao što `river_penalty` već kažnjava rijeku.

## 2. Granični promet (DZS PX-Web)

Lista tablica: `https://web.dzs.hr/PXWeb/api/v1/hr/Transport%20i%20komunikacije/Granični%20promet`. Isti podaci su na data.gov.hr kao XLSX u `statistika-u-nizu-transport-i-komunikacije` (tablica 5.8 i 5.9), ali **PX-Web API je bogatiji i strojno čitljiv**.

- T1/T2 putnici ulaz/izlaz, T3/T4 osobna vozila, T5/T6 autobusi, T7/T8 teretna vozila.
- Dimenzije: `Prijelazi` (116, među njima **44 prema BiH**), `Godina` (2015–2026), `Mjesec` (I–XII i ukupno), `Varijabla` (ukupno, domaći, strani).
- Primjer upita (kodovi su indeksi, ne tekst: godina 2025 = `10`, `I-XII` = `12`, `ukupno` = `0`) vraća npr. Dvor 488 948, Bili Brig 142 893, Čepikuće 109 399 putnika u ulazu 2025.
- Ukupno preko HR–BiH granice 22 613 917 ulazećih putnika u 2025.
- Napomena: URL treba s neprocentno kodiranim `č` ("Granični promet"), procentno kodiran oblik vraća 400.

**Primjena:** prijelazi su sada samo točke bez naziva (`prijelazi.geojson`, 78 točaka, jedino svojstvo je `tip`). Uz naziv i promet:
- promet kao težina na karti (veliki prijelazi koje valja držati naspram malih lokalnih, npr. Lička Kaldrma 267 prolaza godišnje);
- mjesečna sezonalnost za plan resursa (mjesečni podaci postoje, ali sezonski uzorak nisam provjeravao);
- usporedba "zatvoreni mali prijelaz uz granicu bez prometa" (Burumi, Davor, Gejkovac, Gabela II, Ričice, Veliki Prolog: 0 u svim godinama) s procjenom rizika.

**Preduvjet:** spojiti naziv iz DZS-a s točkom prijelaza. Imena u OSM-u (`name` na `barrier=border_control`) trebaju biti dohvaćena u `osm.py`, što ga danas ne radi, ili se paše po najbližoj točki iz ručne tablice.

## 3. Službene granične točke (`granicne-tocke`) i crte (`granicne-crte`)

Licenca: Otvorena dozvola. JSON/CSV/XML, 17,7 MB JSON.

- 70 071 zapisa u 5 granica: BiH (id 44) **30 290**, Slovenija (45) 29 431, Mađarska (1) 5 904, Srbija (74) 4 165, Crna Gora (73) 281.
- Atributi: `pointName`, `type` (granična oznaka: I, III, IV, tromeđa, reper/csap, **"Nema granične oznake"** za 66 380 od 70 071), `pointType` (Neposredna/Posredna), `locationKm` (kilometraža duž granice, BiH: 0 do 1001,36), `sector` (A–R).
- **Nema koordinata**: skup je samo atributni, geometrija je u zasebnom INSPIRE sloju koji nije na data.gov.hr.
- Kilometraža 1001,36 km odgovara duljini naše OSM linije (≈1020 km po izračunu u UTM 33N), pa je spajanje po kilometraži moguće samo približno i ovisi o smjeru i početku lanca. Vrijednost je ograničena: pokazuje gdje je granica fizički obilježena, a ne gdje se lako prelazi.
- `granicne-crte` je samo 5 zapisa (status linije: `edgeMatched` samo za Mađarsku, ostale `notEdgeMatched`). Upotrebljivo kao izvor tvrdnje "službena linija prema BiH nije usklađena" za sporne zone.

## 4–5. Ostalo (provjereno, manje važno)

- **Brojenje prometa na cestama 2022–2025** (`hrvatske ceste d.o.o.`, CSV/XLS, otvorena dozvola): promet na državnim cestama, koristan za "ruta koja se koristi" naspram "napuštena".
- **Registar geografskih imena** (WFS): toponimi i nazivi naselja za natpise u sučelju.
- **Mreža javnih cesta** (WFS/WMS): službena kategorija ceste (DC, ŽC, LC) kao dopuna OSM-u.

## Što je pregledano i nije korisno

- **MUP: Godišnje izvješće o provedbi Strategije integriranog upravljanja granicom (2023, 2024):** samo tablica pokazatelja strategije (npr. 27 mobilnih sustava nadzora u 2024.), ne prostorni ni statistički podaci o prelascima.
- **MUP: Pregled stanja javne sigurnosti 2016–2025:** preuzeta je `.xls` datoteka, nije analizirana (traži `xlrd`). Moguće sadrži broj nezakonitih prelazaka po godini; to je agregat, ne prostorni podatak, a ADR 0001 isključuje podatke o incidentima.
- **Minski sumnjiva područja (MUP/MP):** potvrđeno kao u `podaci-i-licence.md`: nema preuzimljivog sloja. `popis-jls-koje-se-nalaze-u-minski-sumnjivom-prostoru` je XLS popisa općina bez geometrije.
- **Digitalni model reljefa** (`digitalni-model-reljefa`): WMS samo za registrirane korisnike.
- Pretraga "granični prijelaz", "nezakonit prijelaz", "granična policija": 0 rezultata na data.gov.hr.

## Što je izgrađeno: promet na prijelazima

Sloj "Promet na prijelazima" (`web/js/promet.js`) radi uz podloge Karta i Reljef: krugovi veličine prema putnicima 2025. (ulaz + izlaz), tooltip pri prelasku mišem, a klik daje tablicu putnika, osobnih, autobusa i teretnih vozila te putnike po mjesecima. Uključuje se i isključuje u "Slojevi".

- 41 od 44 prijelaza ima položaj; **Bili Brig, Imotica i Unka nisu prikazani** jer im u OSM-u nisam našao pouzdan čvor. Položaji Sebišine i Jovića Mosta su procjena (OSM čvorovi bez imena uz istoimeno naselje), vidi stupac `izvor` u `pipeline/granice/prijelazi_dzs.csv`.
- `python -m granice promet` dohvaća DZS PX-Web (8 zahtjeva s pauzom, API je ograničen) i piše `data/out/promet_prijelaza.geojson`.

## Odbačeno: pogled "Visine"

Pokušaj podloge s hipsometrijskim reljefom iz Copernicus GLO-30 (obje strane granice) uklonjen je jer ne donosi ništa preko podloge Reljef. Visine ostaju zanimljive samo kao ulaz u izračun (nagib u cijeni puta), a to nije napravljeno.
