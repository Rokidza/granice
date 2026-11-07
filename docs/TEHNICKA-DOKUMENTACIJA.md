# Granice: tehnička i projektna dokumentacija

Rješenje za Datathon Portala otvorenih podataka (MPUDT).

| | |
|---|---|
| **Naziv** | Granice |
| **Tim / mentor** | **[POPUNI]** |
| **Izazov** | **[POPUNI]** |
| **Aplikacija (demo)** | **[POPUNI: Netlify adresa]** |
| **Izvorni kod** | <https://github.com/Rokidza/granice> |
| **Video prezentacija** | **[POPUNI]** |

---

## 1. O rješenju

**Granice** je interaktivna karta koja planerima granične policije pokazuje gdje je prelazak granice između Hrvatske i Bosne i Hercegovine najlakši. Pokriva cijelu kopnenu granicu, oko 1000 km, od Une do Konavala.

Alat povezuje otvorene podatke o cestama, stazama, rijekama, graničnim prijelazima, zaštićenim područjima i naseljima i iz njih za svaki dio granice izračuna koliko su blizu putovi s hrvatske i bosanske strane. Planer na jednom zaslonu vidi cijelu granicu, a jednim klikom ulazi u pojedinost.

### Problem

Granica je duga, većinom prolazi šumom, planinom i uz rijeke, a resursi za nadzor su ograničeni. Bez alata, procjena gdje je potrebno više nadzora ovisi o ručnom pregledu karata i iskustvu pojedinaca.

### Za koga

Planeri i analitičari u uredu (preglednik na računalu). Alat ne zahtijeva instalaciju ni prijavu.

### Što korisnik dobiva

- **Izravni prelasci:** popis svih cesta, makadama i staza koje presijecaju granicu izvan službenog prijelaza, svaki s oznakom na karti.
- **Kritična područja blizu granice:** dijelovi granice na kojima su putovi s obje strane na odabranoj udaljenosti jedan od drugoga. Udaljenost se bira klizačem.
- **Kritična područja preko rijeke:** isto, uz vodotok koji treba prijeći.
- **Objašnjenje:** odabir područja prikazuje najbliži par putova i pješački put između njih, pa je jasno zašto je područje označeno.
- **Promet na graničnim prijelazima:** godišnji broj putnika i vozila te mjesečni obrasci za cestovne prijelaze prema BiH.
- **Kontekst:** zaštićena područja i Natura 2000, nazivi mjesta s brojem stanovnika, satelitska i topografska podloga, mjerenje udaljenosti.
- **Izvoz:** kritična područja kao CSV i GeoJSON.

### Vrijednost

- **Brzina:** cijela granica u jednom pogledu umjesto ručnog pregleda.
- **Razumljivost:** procjena je objašnjiva; korisnik vidi koji putovi i koja udaljenost je razlog.
- **Prilagodljivost:** planer sam bira udaljenost i koliko daleko od granice ceste ulaze u izračun.
- **Poštenost prema podacima:** dijelovi granice za koje nema dovoljno podataka označeni su zasebno i ne prikazuju se kao „siguran” dio.
- **Ponovljivost i održivost:** izračun se jednom naredbom ponavlja nad svježim podacima.

---

## 2. Tehnička arhitektura

Rješenje je namjerno jednostavno: **izračun se obavi unaprijed, a stranica je statična**. Nema poslužitelja aplikacije, baze podataka ni korisničkih računa, pa je brza, jeftina za održavanje i sigurna za javno objavljivanje.

```
  Otvoreni podaci            Izračun (Python)                 Aplikacija (preglednik)
  ───────────────            ────────────────                 ───────────────────────
  OpenStreetMap        ──►   priprema putova, granice,   ──►  karta (MapLibre GL)
  DZS: granični promet       voda i prijelaza                   popis i filtri
  HAOP: zaštićena            procjena po segmentima            detalji i izvoz
   područja, Natura 2000     granice (po 500 m)                        │
  DZS: popis stanovništva    zapis slojeva (GeoJSON)                   ▼
                                                              Netlify (javni URL)
```

### Kako radi procjena

1. Granica se dijeli na segmente od 500 m.
2. Za svaki segment traži se najbliži par putova, jedan s hrvatske i jedan s bosanske strane, i mjeri njihova udaljenost.
3. Što su putovi bliže, procjena je viša. Rijeka između putova snižava procjenu, a put koji izravno presijeca granicu izvan službenog prijelaza dobiva najvišu.
4. Službeni prijelazi izuzeti su iz procjene, a dijelovi bez dovoljno podataka označeni su zasebno.
5. Susjedni segmenti spajaju se u kritična područja, a prag udaljenosti planer mijenja u sučelju.

### Komponente

| Dio | Opis |
|---|---|
| Izračun (`pipeline/`) | Python: priprema geometrija, procjena rizika, izvoz slojeva. Jezgra procjene je zasebna, testirana funkcija. |
| Aplikacija (`web/`) | Statična stranica, MapLibre GL JS. Kritična područja računa izravno u pregledniku prema odabranom pragu. |
| Podaci (`data/out/`) | Izračunati slojevi u GeoJSON-u; dokumentirani ugovor između izračuna i aplikacije. |
| Objava | Netlify gradi stranicu iz repozitorija pri svakoj promjeni. |

### Tehnologije

Python 3.11 (shapely, pyproj, numpy, pyosmium), MapLibre GL JS, PMTiles, Node, Netlify. Sve su komponente softver otvorenog koda. Kvaliteta koda provjerava se testovima (pytest), strogom provjerom tipova (mypy) i lintom (ruff); boje karte provjeravaju se za daltonizam i kontrast u svijetloj i tamnoj temi.

### Pokretanje

```sh
cd pipeline && pip install -e ".[dev]"
python -m granice refresh        # preuzimanje podataka i izračun
python -m granice mjesta         # naselja uz granicu
python -m granice stanovnistvo   # broj stanovnika
python -m granice zasticena      # zaštićena područja i Natura 2000
python -m granice promet         # promet na prijelazima
cd ../web && npm install && npm run vendor
cd .. && python -m granice serve # http://127.0.0.1:8000/web/
```

### Privatnost i sigurnost

Aplikacija ne prikuplja osobne podatke, nema prijave ni kolačića za praćenje. Procjena se temelji isključivo na infrastrukturi (putovi, vode, prijelazi); ne koristi podatke o osobama, događajima ni patrolama. Stranica šalje sigurnosna HTTP zaglavlja.

### Napomena o procjeni

Procjena je **indikativna** i izračunata iz javnih podataka; ne zamjenjuje terensku procjenu. Granična linija je informativna. Ta je napomena trajno vidljiva u aplikaciji.

---

## 3. Korišteni skupovi podataka i izvori

| Skup podataka | Izdavatelj | Izvor | Za što se koristi |
|---|---|---|---|
| **Granični promet** (putnici i vozila po prijelazu i mjesecu, 2025.) | Državni zavod za statistiku | [data.gov.hr: Statistika u nizu, Transport i komunikacije](https://data.gov.hr/ckan/hr/dataset/statistika-u-nizu-transport-i-komunikacije); API: [web.dzs.hr/PXWeb](https://web.dzs.hr/PXWeb/) | Sloj „Promet na prijelazima”: veličina i obrasci prometa na 41 prijelazu prema BiH |
| **Zaštićena područja Republike Hrvatske, INSPIRE** | Hrvatska agencija za okoliš i prirodu / Državna geodetska uprava | [data.gov.hr](https://data.gov.hr/ckan/hr/dataset/zatiena-podruja-republike-hrvatske-inspire); WFS: `services.bioportal.hr/inspire/geos1/ps/wfs` | Sloj zaštićenih područja uz granicu |
| **Ekološka mreža Natura 2000 RH, INSPIRE** | Hrvatska agencija za okoliš i prirodu / Državna geodetska uprava | [data.gov.hr](https://data.gov.hr/ckan/hr/dataset/ekoloka-mrea-natura-2000-republike-hrvatske-inspire); WFS: `services.bioportal.hr/inspire/geos2/ps/wfs` | Isti sloj, područja Natura 2000 |
| **Popis stanovništva 2011., stanovništvo po naseljima** | Državni zavod za statistiku | [data.gov.hr](https://data.gov.hr/ckan/hr/dataset/popis-stanovni-tva-2011-stanovni-tvo-po-naseljima) | Broj stanovnika uz nazive naselja |
| **OpenStreetMap** (izvadci Hrvatske i BiH, stanje 26. 10. 2026.) | OpenStreetMap suradnici; izvadci Geofabrik | [download.geofabrik.de](https://download.geofabrik.de/) | Granična linija, ceste i staze, vodotoci, službeni prijelazi, naselja i upravne jedinice |
| **Podloge karte** | Esri, OpenTopoMap, OpenFreeMap | prikazuju se u pregledniku uz atribuciju | Satelitska i topografska podloga, nazivi mjesta |

Uz podatke koristimo programske biblioteke otvorenog koda: shapely, pyproj, numpy, pyosmium, MapLibre GL JS, PMTiles, geojson-vt i vt-pbf (točne verzije u `pipeline/uv.lock` i `web/package-lock.json`).

**Atribucija i licence.** Podaci OpenStreetMapa: © OpenStreetMap contributors (ODbL); izračunati slojevi izvedeni iz njih dostupni su za preuzimanje u aplikaciji uz istu napomenu. Podaci s Portala koriste se uz navođenje izvora i izdavatelja, kao što je navedeno u tablici.

---

## 4. Daljnji razvoj

**Glavni smjer: nadopuna podacima kojima raspolaže samo MUP.** Aplikacija je zamišljena kao otvorena osnova koju MUP i policija mogu u svojoj zatvorenoj okolini nadopuniti vlastitim podacima, koji se nikada ne objavljuju:

- **Lokacije termovizijskih kamera i tornjeva** te njihov doseg i vidno polje.
- **Položaji i područja djelovanja dronova** i mobilnih sustava nadzora.
- **Raspored i dostupnost službenika** po sektorima i smjenama.

Kritična područja tada se ne određuju samo prema blizini putova, nego prema **nepokrivenosti nadzorom**: područje s lakim prelaskom, a bez kamere, drona ili patrole u dometu, dobiva najviši prioritet. Na toj osnovi alat može:

- pronaći **praznine u nadzoru** i predložiti gdje postaviti nove kamere ili tornjeve;
- **optimalno rasporediti** službenike i mobilne jedinice po kritičnim područjima i smjenama;
- simulirati učinak promjene (npr. „što ako toranj ispadne” ili „što ako se dron premjesti”).

Arhitektura to omogućuje bez prerade: izračun se već odvaja od prikaza, a dodatni slojevi unose se kao nove datoteke u istom formatu. Alat se tada pokreće interno, unutar sustava MUP-a, a javna inačica ostaje temeljena samo na otvorenim podacima.

**Ostala poboljšanja**

- Uključivanje reljefa (nagib i penjanje) u udaljenost putova.
- Pokrov terena (šuma, naselja) za procjenu prohodnosti.
- Proširenje na granice s Republikom Srbijom i Crnom Gorom.
- Težinski podaci o prometu na cestama za sezonsko planiranje.
- Terenska provjera procjene s krajnjim korisnicima.
- Automatsko osvježavanje podataka.

## 5. Dodatna dokumentacija u repozitoriju

[`README.md`](../README.md) (pokretanje i objava), [`ugovor-izlaza.md`](ugovor-izlaza.md) (oblik podataka), [`DESIGN.md`](DESIGN.md) (dizajnerske odluke), [`../GLOSSARY.md`](../GLOSSARY.md) (pojmovnik).
