"""Command line: `python -m granice refresh | compute | serve`."""

from __future__ import annotations

import argparse
import csv
import functools
import http.server
import logging
import os
from dataclasses import fields

from granice.config import (
    CORRIDOR_M,
    DATA_DIR,
    DISPUTED_SECTIONS,
    OUT_DIR,
    PILOT_BBOX,
    RAW_DIR,
    REPO_ROOT,
)
from granice.export import write_layers
from granice.osm import OsmSource, OverpassSource
from granice.prepare import prepare
from granice.risk import Params, assess_crossing_risk

log = logging.getLogger("granice")


def run(source: OsmSource, params: Params) -> None:
    """Fetch (or read from cache), prepare, assess and export. Everything the web page needs."""
    if params.search_radius_m > CORRIDOR_M:
        raise SystemExit(
            f"--search-radius-m {params.search_radius_m:.0f} exceeds the fetched corridor "
            f"({CORRIDOR_M} m): segments would be wrongly reported as Nedovoljno podataka"
        )
    data = source.load()
    log.info(
        "%d Staze, %d border ways, OSM data from %s",
        len(data.paths),
        len(data.border),
        data.timestamp,
    )
    prepared = prepare(data, PILOT_BBOX, DISPUTED_SECTIONS, _manual_crossings())
    log.info(
        "%d Staza pieces, %d border chains",
        len(prepared.risk_input.staze),
        len(prepared.risk_input.border),
    )
    assessment = assess_crossing_risk(prepared.risk_input, params)
    write_layers(OUT_DIR, prepared, assessment, params, data.timestamp, DISPUTED_SECTIONS)
    log.info(
        "%d segments, %d Kritična područja written to %s",
        len(assessment.segments),
        len(assessment.kriticna_podrucja),
        OUT_DIR,
    )


def _manual_crossings() -> list[tuple[float, float]]:
    """Optional hand-kept Službeni prijelazi: data/sluzbeni_prijelazi.csv with columns naziv,lat,lon."""
    path = DATA_DIR / "sluzbeni_prijelazi.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        rows = [(float(r["lon"]), float(r["lat"])) for r in csv.DictReader(handle)]
    log.info("%d manual Službeni prijelazi from %s", len(rows), path.name)
    return rows


def _add_parameter_options(parser: argparse.ArgumentParser) -> None:
    defaults = Params()
    for field in fields(Params):
        parser.add_argument(
            "--" + field.name.replace("_", "-"),
            type=float,
            default=getattr(defaults, field.name),
            help=f"default {getattr(defaults, field.name)}",
        )


def _params(args: argparse.Namespace) -> Params:
    return Params(**{f.name: getattr(args, f.name) for f in fields(Params)})


class _RangeHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler that also answers single-range requests (PMTiles needs them)."""

    def send_head(self):  # type: ignore[no-untyped-def]
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not header or not header.startswith("bytes=") or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start_text, _, end_text = header[len("bytes=") :].partition("-")
        try:
            if start_text:
                start = int(start_text)
                end = min(int(end_text) if end_text else size - 1, size - 1)
            else:  # suffix range: the last N bytes
                start, end = max(size - int(end_text), 0), size - 1
        except ValueError:
            return super().send_head()
        if start > end or start >= size:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None
        handle = open(path, "rb")  # noqa: SIM115 - closed by the caller after copyfile
        handle.seek(start)
        self._remaining = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return handle

    def copyfile(self, source, outputfile):  # type: ignore[no-untyped-def]
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        return None


def _serve(port: int) -> None:
    """Serve the repository root on localhost only (ADR 0001: never a public URL)."""
    handler = functools.partial(_RangeHandler, directory=str(REPO_ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Granice: http://127.0.0.1:{port}/web/  (Ctrl+C to quit)")
        server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(prog="granice", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    refresh = commands.add_parser("refresh", help="re-download OSM data, then recompute and export")
    compute = commands.add_parser("compute", help="recompute from the cached OSM data")
    for command in (refresh, compute):
        _add_parameter_options(command)
    serve = commands.add_parser("serve", help="serve the web page on localhost")
    serve.add_argument("--port", type=int, default=8000)

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.command == "serve":
        _serve(args.port)
    else:
        run(OverpassSource(PILOT_BBOX, RAW_DIR, refresh=args.command == "refresh"), _params(args))


if __name__ == "__main__":
    main()
