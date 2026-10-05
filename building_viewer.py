"""Serve an uploaded IFC to the embedded That Open viewer on localhost."""

from __future__ import annotations

import json
import secrets
import threading
import tempfile
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import ifcopenshell
import ifcopenshell.util.element

import streamlit as st
import streamlit.components.v1 as components


_FRONTEND = Path(__file__).parent / "frontend"
_ASSETS = {
    "/viewer.js": (_FRONTEND / "viewer.bundle.js", "text/javascript; charset=utf-8"),
    "/viewer.css": (_FRONTEND / "viewer.css", "text/css; charset=utf-8"),
    "/tokens.css": (_FRONTEND / "design" / "tokens.css", "text/css; charset=utf-8"),
    "/components.css": (_FRONTEND / "design" / "components.css", "text/css; charset=utf-8"),
    "/icons.svg": (_FRONTEND / "design" / "icons.svg", "image/svg+xml"),
}
_LOCK = threading.Lock()
_SERVER = None


@dataclass
class ViewerUpload:
    ifc_data: bytes
    issues_data: bytes
    last_access: float
    model: ifcopenshell.file | None = None
    browser_data: bytes | None = None
    model_lock: threading.Lock = field(default_factory=threading.Lock)


def _read_model(upload: ViewerUpload) -> ifcopenshell.file:
    with upload.model_lock:
        if upload.model is None:
            with tempfile.TemporaryDirectory(prefix="ids-browser-") as folder:
                path = Path(folder) / "model.ifc"
                path.write_bytes(upload.ifc_data)
                upload.model = ifcopenshell.open(str(path))
        return upload.model


def _plain(value):
    if isinstance(value, ifcopenshell.entity_instance):
        label = getattr(value, "Name", None) or getattr(value, "GlobalId", None) or ""
        return f"{value.is_a()} #{value.id()} {label}".strip()
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _parent_guid(entity) -> str | None:
    for relation_name, parent_name in (
        ("ContainedInStructure", "RelatingStructure"),
        ("Decomposes", "RelatingObject"),
    ):
        relations = getattr(entity, relation_name, ()) or ()
        if relations:
            return getattr(relations[0], parent_name).GlobalId
    return None


def _browser_json(upload: ViewerUpload) -> bytes:
    with upload.model_lock:
        if upload.browser_data is not None:
            return upload.browser_data
    model = _read_model(upload)
    nodes = []
    for entity in [*model.by_type("IfcProject"), *model.by_type("IfcProduct")]:
        guid = getattr(entity, "GlobalId", None)
        if not guid:
            continue
        nodes.append({
            "globalId": guid,
            "parentId": _parent_guid(entity),
            "ifcClass": entity.is_a(),
            "name": getattr(entity, "Name", None) or "Unnamed element",
            "hasGeometry": bool(getattr(entity, "Representation", None)),
        })
    data = json.dumps(nodes, ensure_ascii=False).encode("utf-8")
    with upload.model_lock:
        upload.browser_data = data
    return data


def _properties_json(upload: ViewerUpload, guid: str) -> bytes:
    model = _read_model(upload)
    try:
        element = model.by_guid(guid)
    except (RuntimeError, KeyError) as exc:
        raise ValueError("IFC element not found") from exc
    element_type = ifcopenshell.util.element.get_type(element)
    data = {
        "globalId": guid,
        "ifcClass": element.is_a(),
        "name": getattr(element, "Name", None) or "Unnamed element",
        "attributes": _plain(element.get_info(include_identifier=False, recursive=False)),
        "propertySets": _plain(ifcopenshell.util.element.get_psets(element, psets_only=True)),
        "quantities": _plain(ifcopenshell.util.element.get_psets(element, qtos_only=True)),
        "type": None if element_type is None else {
            "ifcClass": element_type.is_a(),
            "name": getattr(element_type, "Name", None),
            "globalId": getattr(element_type, "GlobalId", None),
        },
    }
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


class ViewerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), ViewerHandler)
        self.uploads: dict[str, ViewerUpload] = {}

    def publish(self, token: str, ifc_data: bytes, issues: list[dict]) -> None:
        viewer_issues = [
            {
                "globalId": row["GlobalId"],
                "idsFile": row["IDS file"],
                "specification": row["Specification"],
                "ifcClass": row["IFC class"],
                "element": row["Element"],
                "requirement": row["Requirement"],
                "reason": row["Reason"],
            }
            for row in issues
        ]
        data = json.dumps(viewer_issues, ensure_ascii=False).encode("utf-8")
        with _LOCK:
            now = time.monotonic()
            self.uploads = {key: value for key, value in self.uploads.items() if now - value.last_access < 7200}
            if token in self.uploads:
                self.uploads[token].last_access = now
            else:
                self.uploads[token] = ViewerUpload(ifc_data, data, now)


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
        elif parsed.path in _ASSETS:
            asset, kind = _ASSETS[parsed.path]
            body = asset.read_bytes()
        elif parsed.path == "/model":
            body = upload.ifc_data
            kind = "application/octet-stream"
        elif parsed.path == "/issues":
            body = upload.issues_data
            kind = "application/json; charset=utf-8"
        elif parsed.path == "/browser":
            body = _browser_json(upload)
            kind = "application/json; charset=utf-8"
        elif parsed.path == "/properties":
            guid = parse_qs(parsed.query).get("guid", [""])[0]
            try:
                body = _properties_json(upload, guid)
            except ValueError:
                self.send_error(404, "IFC element not found")
                return
            kind = "application/json; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        pass


def _viewer_html(token: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tokens.css?token={token}">
<link rel="stylesheet" href="/components.css?token={token}">
<link rel="stylesheet" href="/viewer.css?token={token}">
</head><body>
<main class="workspace">
  <header class="workspace-head">
    <div class="brand"><svg class="ot-icon ot-icon--large"><use href="/icons.svg?token={token}#orion"/></svg><div><span class="ot-eyebrow">Orion Twin interface</span><strong>IDS CHECKER</strong></div></div>
    <div class="head-right"><span class="ot-pill ot-pill--dark">IFC model workspace</span><span id="status" role="status">Starting viewer…</span></div>
  </header>
  <div class="workspace-main">
    <aside class="failures ot-dark-card" aria-label="Failed elements">
      <div class="panel-head"><span class="ot-eyebrow">Validation results</span><h2>Failed elements <span id="failure-count" class="count-pill">0</span></h2><p>Select an IFC class to filter the failures, or choose an element to inspect it.</p></div>
      <section class="chart-panel" aria-label="Errors by IFC class"><div class="chart-heading"><strong>Errors by IFC class</strong><span>Validation issues</span></div><div id="class-chart" class="class-chart"></div></section>
      <label class="search-field"><svg class="ot-icon"><use href="/icons.svg?token={token}#search"/></svg><input id="failure-search" type="search" placeholder="Search failures" aria-label="Search failed elements"></label>
      <div id="failure-list" class="failure-list" role="list"></div>
      <button id="more-failures" class="more-button" type="button" hidden>Show more</button>
    </aside>
    <section class="viewer ot-dark-card" aria-label="IFC 3D viewer">
      <div class="viewer-head"><div><span class="ot-eyebrow">Model view</span><h2 id="view-title">Building overview</h2></div><div class="viewer-actions"><button id="isolate-selected" class="view-button" type="button" aria-pressed="false" disabled>Isolate selected</button><button id="clear-selection" class="view-button" type="button" disabled>Clear selection</button><button id="reset-view" class="view-button" type="button" disabled>Fit building</button><button id="show-properties" class="view-button" type="button">Properties</button><button id="show-browser" class="view-button" type="button">Model browser</button></div></div>
      <div class="viewport"><div id="canvas" aria-label="Interactive 3D model"></div><div class="viewport-hint">Drag to orbit · Scroll to zoom</div>
        <aside id="inspector" class="inspector ot-glass-card" aria-label="Element inspector" hidden>
          <div class="inspector-head"><div class="inspector-tabs"><button id="properties-tab" type="button" aria-pressed="true">Properties</button><button id="browser-tab" type="button" aria-pressed="false">Model browser</button></div><button id="close-inspector" class="close-inspector" type="button" aria-label="Close inspector">×</button></div>
          <section id="properties-panel" class="inspector-content"><p class="empty-note">Select a failed element or choose one in the model browser to inspect its IFC properties.</p></section>
          <section id="browser-panel" class="inspector-content" hidden><label class="search-field browser-search"><svg class="ot-icon"><use href="/icons.svg?token={token}#search"/></svg><input id="browser-search" type="search" placeholder="Search model elements" aria-label="Search model elements"></label><div id="browser-tree" class="browser-tree"></div></section>
        </aside>
      </div>
    </section>
  </div>
</main>
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
    components.iframe(url, height=840, scrolling=False)
