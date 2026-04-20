"""Server entry point.

server/app.py only starts the HTTP server on the requested host/port.
Routing lives in server/http_handler.py, and telemetry persistence lives in
server/telemetry_store.py.
"""

from __future__ import annotations

import argparse
import logging
from http.server import ThreadingHTTPServer

from http_handler import TelemetryHandler
from settings import LOGGER
from telemetry_store import ensure_data_dir


def run_server(host: str, port: int) -> None:
    ensure_data_dir()
    httpd = ThreadingHTTPServer((host, port), TelemetryHandler)
    LOGGER.info("Serving on http://%s:%s", host, port)
    httpd.serve_forever()


def main() -> int:
    parser = argparse.ArgumentParser(description="Cobot telemetry JSON backend")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8080, type=int)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    run_server(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
