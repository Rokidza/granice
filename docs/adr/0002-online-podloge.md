---
status: accepted
---

# Podloge karte s vanjskih servisa, lokalni izvadak ostaje neobavezan

Karta nudi četiri podloge: Karta (OpenFreeMap), Reljef (OpenTopoMap), Satelitska snimka (Esri World Imagery) i Bez podloge. Dohvaćaju se izravno iz preglednika s vanjskih poslužitelja. Time mijenjamo raniju odluku (DESIGN Q18) da se podloga poslužuje samo iz lokalnog Protomaps izvatka, jer ona nije davala reljef ni satelit i bez nje je karta bila neupotrebljiva za planiranje.

## Consequences

- Operatori tih servisa vide koje se pločice, dakle koji dio granice, gledaju. To je u suprotnosti s duhom ADR-a 0001 (agregirana slika slabih točaka je osjetljiva). Izračunati slojevi (Staze, Segmenti, rizik) i dalje se poslužuju samo lokalno i nikad ne idu vanjskim servisima.
- Ako `data/basemap.pmtiles` postoji, nudi se "Karta (lokalno, bez interneta)" i zadana je podloga. Reljef i satelit nemaju lokalnu zamjenu dok se ne nabavi licenciran izvor (npr. DGU ortofoto).
- Uvjeti korištenja OpenTopoMap i Esri servisa nisu pravno provjereni (vidi `docs/podaci-i-licence.md`), a oba su "best effort" bez SLA-a. Prije šire upotrebe provjeriti ili zamijeniti vlastitim izvorom.
- Podloge se definiraju u `web/config.js` i lako se mijenjaju ili uklanjaju (npr. uklanjanjem unosa `reljef` i `satelit` za potpuno lokalni rad).
- Boje podataka na karti prate podlogu: Reljef koristi svijetlu, Satelit tamnu paletu, a Karta paletu sustavske teme. Paleta na satelitskoj snimci nije obuhvaćena `npm run check-colors` (provjera vrijedi za plohe svijetle i tamne teme).
