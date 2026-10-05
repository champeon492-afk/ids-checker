"""Serve an uploaded IFC to the embedded That Open viewer on localhost."""

from __future__ import annotations

import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import streamlit as st
import streamlit.components.v1 as components


_BUNDLE = (Path(__file__).parent / "frontend" / "viewer.bundle.js").read_bytes()
_LOCK = threading.Lock()
_SERVER = None


class ViewerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), ViewerHandler)
        self.uploads: dict[str, tuple[bytes, bytes, float]] = {}

    def publish(self, token: str, ifc_data: bytes, issues: list[dict]) -> None:
        viewer_issues = [
            {
                "globalId": row["GlobalId"],
                "ifcClass": row["IFC class"],
                "element": row["Element"],
                "requirement": row["Requirement"],
                "reason": row["Reason"],
            }
            for row in issues
            if row["GlobalId"]
        ]
        data = json.dumps(viewer_issues, ensure_ascii=False).encode("utf-8")
        with _LOCK:
            now = time.monotonic()
            self.uploads = {key: value for key, value in self.uploads.items() if now - value[2] < 7200}
            self.uploads[token] = (ifc_data, data, now)


class ViewerHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        token = parse_qs(parsed.query).get("token", [""])[0]
        with _LOCK:
            upload = self.server.uploads.get(token)
        if not upload:
            self.send_error(404, "Viewer session expired")
            return
        if parsed.path == "/":
            body = _viewer_html(token).encode("utf-8")
            kind = "text/html; charset=utf-8"
        elif parsed.path == "/viewer.js":
            body = _BUNDLE
            kind = "text/javascript; charset=utf-8"
        elif parsed.path == "/model":
            body = upload[0]
            kind = "application/octet-stream"
        elif parsed.path == "/issues":
            body = upload[1]
            kind = "application/json; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        pass


def _viewer_html(token: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body {{ margin: 0; font: 14px system-ui, sans-serif; color: #24313b; background: #fff; }}
#toolbar {{ display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 12px; }}
#status {{ flex: 1 1 100%; color: #455765; }}
#status.error {{ color: #b83228; }}
#canvas {{ width: 100%; height: 560px; background: #eef3f7; }}
#issue-select {{ flex: 1; min-width: 240px; padding: 8px; }}
button {{ padding: 8px 12px; cursor: pointer; }}
#issue-details {{ white-space: pre-wrap; line-height: 1.5; padding: 0 12px 12px; }}
</style></head><body>
<div id="toolbar">
  <div id="status" role="status">Starting viewer…</div>
  <label for="issue-select">Locate failed element</label>
  <select id="issue-select" disabled><option value="">Show whole building</option></select>
  <button id="reset-view" disabled>Fit building</button>
</div>
<div id="canvas"></div>
<div id="issue-details">Drag to rotate; scroll to zoom. The whole IFC building stays visible.</div>
<script>window.viewerToken="{token}";</script>
<script src="/viewer.js?token={token}"></script>
</body></html>"""


def _get_server() -> ViewerServer:
    global _SERVER
    with _LOCK:
        if _SERVER is None:
            _SERVER = ViewerServer()
            threading.Thread(target=_SERVER.serve_forever, daemon=True, name="ids-building-viewer").start()
        return _SERVER


def show_building(ifc_data: bytes, issues: list[dict], fingerprint: str) -> None:
    """Display the whole IFC model without putting its bytes in Streamlit messages."""
    server = _get_server()
    if st.session_state.get("viewer_fingerprint") != fingerprint:
        st.session_state["viewer_token"] = secrets.token_urlsafe(32)
        st.session_state["viewer_fingerprint"] = fingerprint
    token = st.session_state["viewer_token"]
    server.publish(token, ifc_data, issues)
    url = f"http://127.0.0.1:{server.server_port}/?token={token}"
    components.iframe(url, height=690, scrolling=False)
