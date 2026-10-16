"""Disposable loopback HTTP adapter around the actual Core FastAPI application.

No deployment settings or customer-data opt-in are read. SQLite replay state lives
only in the caller's disposable directory. This avoids requiring uvicorn in the
existing read-only Python environment while exercising the real ASGI routes.
"""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from akc_product_core.api import create_product_core_app


def main() -> None:
    journal = Path(os.environ["TAVONEL_LOCAL_CORE_JOURNAL"])
    app = create_product_core_app(
        hmac_secret=os.environ["TAVONEL_LOCAL_CORE_TEST_HMAC"].encode(),
        core_release_digest=os.environ["TAVONEL_LOCAL_CORE_RELEASE_DIGEST"],
        allow_customer_data=False,
        journal_path=journal,
    )
    with TestClient(app) as client:
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                pass

            def do_GET(self) -> None:
                response = client.get(self.path)
                self._send(response)

            def do_POST(self) -> None:
                if self.path == "/__local_test_shutdown":
                    self.send_response(204)
                    self.end_headers()
                    threading.Thread(target=server.shutdown, daemon=True).start()
                    return
                length = int(self.headers.get("content-length", "0"))
                if length < 0 or length > 32 * 1024 * 1024:
                    self.send_error(413)
                    return
                tamper = self.path == "/__local_test_tamper/v2/compile"
                response = client.post("/v2/compile" if tamper else self.path,
                                       content=self.rfile.read(length), headers=dict(self.headers))
                if tamper and response.status_code == 200:
                    payload = response.json()
                    payload["candidate"]["validation"]["matchingPolicy"] = "tampered"
                    response = SimpleNamespace(status_code=200, headers={},
                                               content=json.dumps(payload, ensure_ascii=False).encode())
                self._send(response)

            def _send(self, response) -> None:
                self.send_response(response.status_code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(response.content)))
                self.send_header("cache-control", response.headers.get("cache-control", "no-store"))
                self.end_headers()
                self.wfile.write(response.content)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        print(json.dumps({"port": server.server_port, "runtime": "tavonel-python-core-v2"}), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
