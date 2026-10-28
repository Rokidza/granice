# Granice

Analitički alat za planere granične policije: na karti prikazuje prohodne putove uz granicu Hrvatske i Bosne i Hercegovine te procjenjuje na kojim je mjestima prelazak najlakši, kako bi se resursi rasporedili po granici.

## Language

**Staza**:
Bilo koji put kojim se može proći pješice: cesta, makadam, šumski put, pješačka staza ili puteljak.
_Avoid_: Cesta (preusko), put, trail

**Strana**:
Jedna od dviju država uz granicu, HR ili BiH, kojoj Staza pripada prema položaju u odnosu na graničnu liniju.
_Avoid_: Obala, zemlja

**Segment granice**:
Odsječak granične linije fiksne duljine kojem se pridružuje jedna procjena rizika.
_Avoid_: Dionica, ćelija, sektor

**Rizik prelaska**:
Procjena koliko je lako prijeći granicu unutar jednog Segmenta granice, izvedena iz blizine Staza na HR Strani i Staza na BiH Strani. Ne odnosi se ni na koju stvarnu osobu ni događaj.
_Avoid_: Prijetnja, opasnost, vjerojatnost prelaska

**Nedovoljno podataka**:
Stanje Segmenta granice u kojem s barem jedne Strane nema mapiranih Staza, pa se Rizik prelaska ne procjenjuje. Nije isto što i nizak rizik.
_Avoid_: Nema rizika, sigurno, prazno

**Službeni prijelaz**:
Granični prijelaz na kojem je prelazak granice dopušten i nadziran. Izuzet je iz procjene Rizika prelaska.
_Avoid_: Granični prijelaz (dvosmisleno), checkpoint

**Izravni prelazak**:
Staza koja presijeca graničnu liniju izvan Službenog prijelaza. Segment u kojem postoji dobiva najviši Rizik prelaska.
_Avoid_: Probijanje, rupa

**Kritično područje**:
Skup susjednih Segmenata granice koje planer smatra visokim rizikom. Na karti su to segmenti čiji je najbliži par Staza (cesta, makadam ili staza s obje Strane) na najviše onoliko metara koliko planer odabere. Dijele se na dvije vrste: **blizu granice** (bez vodotoka između para) i **preko rijeke** (spojnica para siječe vodotok). Izravni prelazak nije Kritično područje, nego zaseban popis. Izračun (`kriticna_podrucja.geojson`) i dalje koristi prag Rizika prelaska.
_Avoid_: Žarište, hotspot, crna točka

**Pilot odsječak**:
Dio granice na kojem se alat prvo provjeravao prije proširenja na cijelu granicu. Alat sada pokriva cijelu granicu HR–BiH, a Pilot odsječak se još može izračunati zasebno.
_Avoid_: Testno područje, demo
