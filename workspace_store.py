"""Save and restore complete, local IDS validation projects."""

from __future__ import annotations

import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path


STORE = Path(os.environ.get("IDS_CHECKER_DATA_DIR", Path(__file__).parent / "local_workspaces"))
FORMAT_VERSION = 2


def _safe_name(name: str) -> str:
    return Path(str(name).replace("\\", "/")).name or "unnamed"


def _read_project(data: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > 1000 or sum(member.file_size for member in members) > 2 * 1024**3:
                raise ValueError("This project contains too much data to open safely.")
            if archive.getinfo("manifest.json").file_size > 1024 * 1024:
                raise ValueError("The project manifest is too large.")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != "ids-checker" or manifest.get("version") not in (1, 2):
                raise ValueError("This is not a supported IDS Checker project file.")
            if manifest["version"] == 2:
                checks = []
                for check_index, entry in enumerate(manifest["checks"], start=1):
                    root = f"checks/{check_index:03d}"
                    ids_files = [(_safe_name(name), archive.read(f"{root}/requirements/{index:03d}.ids")) for index, name in enumerate(entry["ids_files"], start=1)]
                    results = []
                    for index, name in enumerate(entry["ids_files"], start=1):
                        prefix = f"{root}/results/{index:03d}"
                        passes_path = f"{prefix}-passes.json"
                        results.append({"ids_file": _safe_name(name), "report": json.loads(archive.read(f"{prefix}.json")), "html": archive.read(f"{prefix}.html"), "issues": json.loads(archive.read(f"{prefix}-issues.json")), "passes": json.loads(archive.read(passes_path)) if passes_path in archive.namelist() else None})
                    ifc_data = archive.read(f"{root}/model.ifc")
                    if not ids_files or not ifc_data:
                        raise ValueError("The project file is incomplete.")
                    checks.append({"id": str(entry["id"]), "name": str(entry["name"]), "ifc_filename": _safe_name(entry["ifc_filename"]), "ifc_data": ifc_data, "ids_files": ids_files, "results": results})
                if not checks or len({check["id"] for check in checks}) != len(checks):
                    raise ValueError("The project file has no valid validation sets.")
                return {"checks": checks, "saved_at": manifest.get("saved_at", "")}
            ids_files = []
            for index, name in enumerate(manifest["ids_files"], start=1):
                ids_files.append((_safe_name(name), archive.read(f"requirements/{index:03d}.ids")))
            ifc_data = archive.read("model.ifc")
            results = []
            for index, name in enumerate(manifest["result_files"], start=1):
                report = json.loads(archive.read(f"results/{index:03d}.json"))
                html = archive.read(f"results/{index:03d}.html")
                issues = json.loads(archive.read(f"results/{index:03d}-issues.json"))
                passes_path = f"results/{index:03d}-passes.json"
                passes = json.loads(archive.read(passes_path)) if passes_path in archive.namelist() else None
                results.append({"ids_file": _safe_name(name), "report": report, "html": html, "issues": issues, "passes": passes})
            if not ids_files or not ifc_data or len(results) != len(ids_files):
                raise ValueError("The project file is incomplete.")
            legacy = {
                "ids_files": ids_files,
                "ifc_filename": _safe_name(manifest["ifc_filename"]),
                "ifc_data": ifc_data,
                "results": results,
                "saved_at": manifest.get("saved_at", ""),
            }
            legacy["checks"] = [{"id": "check-1", "name": Path(legacy["ifc_filename"]).stem, "ifc_filename": legacy["ifc_filename"], "ifc_data": ifc_data, "ids_files": ids_files, "results": results}]
            return legacy
    except (KeyError, json.JSONDecodeError, zipfile.BadZipFile, UnicodeDecodeError) as exc:
        raise ValueError("The project file is damaged or incomplete.") from exc


def create_project(ids_files: list[tuple[str, bytes]], ifc_filename: str, ifc_data: bytes, results: list[dict]) -> bytes:
    if not ids_files or not ifc_data or len(results) != len(ids_files):
        raise ValueError("A project needs an IFC model, its IDS files, and their validation results.")
    manifest = {
        "format": "ids-checker",
        "version": 1,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "ifc_filename": _safe_name(ifc_filename),
        "ids_files": [_safe_name(name) for name, _ in ids_files],
        "result_files": [_safe_name(item["ids_file"]) for item in results],
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("model.ifc", ifc_data)
        for index, (_, ids_data) in enumerate(ids_files, start=1):
            archive.writestr(f"requirements/{index:03d}.ids", ids_data)
        for index, item in enumerate(results, start=1):
            archive.writestr(f"results/{index:03d}.json", json.dumps(item["report"], ensure_ascii=False, default=str))
            archive.writestr(f"results/{index:03d}.html", item["html"])
            archive.writestr(f"results/{index:03d}-issues.json", json.dumps(item["issues"], ensure_ascii=False))
            if item.get("passes") is not None:
                archive.writestr(f"results/{index:03d}-passes.json", json.dumps(item["passes"], ensure_ascii=False))
    return stream.getvalue()


def create_federated_project(checks: list[dict]) -> bytes:
    """Save independent IFC/IDS validation sets in one portable project."""
    if not checks or len({check["id"] for check in checks}) != len(checks):
        raise ValueError("A project needs uniquely identified validation sets.")
    manifest = {"format": "ids-checker", "version": FORMAT_VERSION, "saved_at": datetime.now(timezone.utc).isoformat(), "checks": []}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for check_index, check in enumerate(checks, start=1):
            ids_files = check["ids_files"]
            results = check["results"]
            if not ids_files or not check["ifc_data"] or len(results) != len(ids_files):
                raise ValueError("Each validation set needs an IFC model, IDS files and results.")
            root = f"checks/{check_index:03d}"
            manifest["checks"].append({"id": str(check["id"]), "name": str(check["name"]), "ifc_filename": _safe_name(check["ifc_filename"]), "ids_files": [_safe_name(name) for name, _ in ids_files]})
            archive.writestr(f"{root}/model.ifc", check["ifc_data"])
            for index, (_, ids_data) in enumerate(ids_files, start=1):
                archive.writestr(f"{root}/requirements/{index:03d}.ids", ids_data)
                item = results[index - 1]
                prefix = f"{root}/results/{index:03d}"
                archive.writestr(f"{prefix}.json", json.dumps(item["report"], ensure_ascii=False, default=str))
                archive.writestr(f"{prefix}.html", item["html"])
                archive.writestr(f"{prefix}-issues.json", json.dumps(item["issues"], ensure_ascii=False))
                if item.get("passes") is not None:
                    archive.writestr(f"{prefix}-passes.json", json.dumps(item["passes"], ensure_ascii=False))
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return stream.getvalue()


def save_project(data: bytes) -> str:
    _read_project(data)
    STORE.mkdir(parents=True, exist_ok=True)
    workspace_id = uuid.uuid4().hex
    path = STORE / f"{workspace_id}.idscheck"
    temporary = STORE / f".{workspace_id}.tmp"
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return workspace_id


def load_project(workspace_id: str) -> dict:
    if len(workspace_id) != 32 or any(character not in "0123456789abcdef" for character in workspace_id):
        raise ValueError("Invalid local project address.")
    path = STORE / f"{workspace_id}.idscheck"
    if not path.is_file():
        raise FileNotFoundError("This local project could not be found. Open a saved .idscheck file to restore it.")
    return _read_project(path.read_bytes())


def project_path(workspace_id: str) -> Path:
    if len(workspace_id) != 32 or any(character not in "0123456789abcdef" for character in workspace_id):
        raise ValueError("Invalid local project address.")
    return STORE / f"{workspace_id}.idscheck"
