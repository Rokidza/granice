---
status: accepted
---

# Alat se objavljuje na javnom URL-u

Vlasnik projekta odlučio je objaviti alat na javnom URL-u (Netlify), što mijenja dio ADR-a 0001 ("nikad javni URL"). Ostatak ADR-a 0001 vrijedi: rizik se računa samo iz otvorenih OSM podataka, bez podataka o osobama, incidentima i patrolama, a neotvoreni podaci (HPS, minska polja) ostaju isključeni.

## Consequences

- Svatko može vidjeti agregiranu kartu Segmenata granice s procijenjenim Rizikom prelaska i Kritičnim područjima. ADR 0001 je upravo tu sliku smatrao osjetljivom (može koristiti i krijumčarima). To je prihvaćen rizik, a procjena je i u sučelju označena kao indikativna i nevalidirana.
- Objava izračunatog sloja je javno korištenje OSM izvedene baze, pa vrijedi ODbL: atribucija "© OpenStreetMap contributors" i ista licenca za izvedene podatke. Zato stranica nudi preuzimanje izračunatih slojeva (GeoJSON) uz napomenu o licenci. To nije pravni savjet i nije pravno provjereno.
- Podloge s vanjskih servisa (ADR 0002) rade i javno, ali uvjeti korištenja OpenTopoMap i Esri servisa za javnu stranicu nisu provjereni (`docs/podaci-i-licence.md`). Esri World Imagery je najrizičniji; ako uvjeti ne dopuštaju, ukloniti unos `satelit` iz `web/config.js`.
- Stranica ostaje `noindex` (da je tražilice ne indeksiraju), ali to nije zaštita: svatko s URL-om vidi sve.
- Lokalni poslužitelj (`python -m granice serve`) i dalje sluša samo na `127.0.0.1`.
