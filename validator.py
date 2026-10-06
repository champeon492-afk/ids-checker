"""IDS preview and IFC validation, separate from the browser interface."""

from __future__ import annotations

import csv
import io
import json
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


FACETS = {"entity", "attribute", "classification", "property", "material", "partOf"}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _value(node: ET.Element | None) -> str:
    if node is None:
        return ""
    simple = node.find("{*}simpleValue")
    if simple is not None:
        return (simple.text or "").strip()
    restriction = node.find("{*}restriction")
    if restriction is not None:
        options = [
            child.attrib.get("value", "")
            for child in restriction
            if local_name(child.tag) == "enumeration"
        ]
        if options:
            return "One of: " + ", ".join(options)
        return "Restricted value"
    return (node.text or "").strip()


def _facet_description(facet: ET.Element) -> str:
    kind = local_name(facet.tag)
    if kind == "entity":
        name = _value(facet.find("{*}name"))
        predefined = _value(facet.find("{*}predefinedType"))
        return f"{name} ({predefined})" if predefined else name
    if kind == "attribute":
        name = _value(facet.find("{*}name"))
        value = _value(facet.find("{*}value"))
        return f"{name} = {value}" if value else name
    if kind == "property":
        pset = _value(facet.find("{*}propertySet"))
        name = _value(facet.find("{*}baseName"))
        value = _value(facet.find("{*}value"))
        data_type = facet.attrib.get("dataType", "")
        detail = f" = {value}" if value else " must be populated"
        detail += f" [{data_type}]" if data_type else ""
        return f"{pset}.{name}{detail}"
    if kind == "classification":
        system = _value(facet.find("{*}system"))
        value = _value(facet.find("{*}value"))
        return " / ".join(x for x in (system, value) if x) or "Classification present"
    if kind == "material":
        return _value(facet.find("{*}value")) or "Material present"
    if kind == "partOf":
        entity = facet.find("{*}entity")
        name = _value(entity.find("{*}name")) if entity is not None else ""
        relation = facet.attrib.get("relation", "")
        return " / ".join(x for x in (relation, name) if x) or "Parent relationship present"
    return kind


def parse_ids_preview(data: bytes, filename: str = "") -> list[dict[str, str]]:
    """Make one readable row per requirement, preserving all applicability facets."""
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("IDS files with DTD or entity declarations are not supported.")
    root = ET.fromstring(data)
    if local_name(root.tag) != "ids":
        raise ValueError("This file is not an IDS document.")
    rows: list[dict[str, str]] = []
    for spec in root.findall(".//{*}specification"):
        applicability = spec.find("{*}applicability")
        requirements = spec.find("{*}requirements")
        if applicability is None:
            continue
        targets = [
            f"{local_name(f.tag)}: {_facet_description(f)}"
            for f in applicability
            if local_name(f.tag) in FACETS
        ]
        min_occurs = applicability.attrib.get("minOccurs", "1")
        max_occurs = applicability.attrib.get("maxOccurs", "unbounded")
        selection = "Required" if min_occurs != "0" else ("Prohibited" if max_occurs == "0" else "Optional")
        facets = [f for f in requirements if local_name(f.tag) in FACETS] if requirements is not None else []
        for facet in facets or [None]:
            rows.append(
                {
                    "IDS file": filename,
                    "Specification": spec.attrib.get("name", "Unnamed specification"),
                    "IFC version": spec.attrib.get("ifcVersion", ""),
                    "Target elements": " AND ".join(targets) or "All applicable IFC data",
                    "Selection": selection,
                    "Requirement": (
                        f"{local_name(facet.tag)}: {_facet_description(facet)}" if facet is not None else "No information requirement"
                    ),
                    "Rule": facet.attrib.get("cardinality", "required") if facet is not None else "—",
                }
            )
    if not rows:
        raise ValueError("No IDS specifications were found.")
    return rows


def run_validations(ids_files: list[tuple[str, bytes]], ifc_data: bytes) -> list[dict]:
    """Validate one IFC model against every IDS file and preserve source names."""
    import ifcopenshell
    import ifctester
    from ifctester import reporter

    if not ids_files:
        raise ValueError("Upload at least one IDS file.")
    with tempfile.TemporaryDirectory(prefix="ids-validator-") as folder:
        ifc_path = Path(folder) / "model.ifc"
        ifc_path.write_bytes(ifc_data)
        model = ifcopenshell.open(str(ifc_path))
        results = []
        for index, (filename, ids_data) in enumerate(ids_files, start=1):
            ids_path = Path(folder) / f"requirements-{index}.ids"
            ids_path.write_bytes(ids_data)
            try:
                specifications = ifctester.open(str(ids_path), validate=True)
                specifications.validate(model)
                result = reporter.Json(specifications).report()
                html_report = reporter.Html(specifications)
                html_report.report()
                html_path = Path(folder) / f"report-{index}.html"
                html_report.to_file(str(html_path))
            except Exception as exc:
                raise ValueError(f"{filename}: {exc}") from exc
            results.append({"ids_file": filename, "report": result, "html": html_path.read_bytes(), "issues": issue_rows(result, filename, model), "passes": pass_rows(result, filename, model)})
        return results


def run_validation(ids_data: bytes, ifc_data: bytes) -> tuple[dict, bytes]:
    """Compatibility wrapper for a single IDS file."""
    item = run_validations([("requirements.ids", ids_data)], ifc_data)[0]
    return item["report"], item["html"]


def _ids_value(field) -> str:
    if isinstance(field, dict):
        if "simpleValue" in field:
            return str(field["simpleValue"])
        restriction = field.get("restriction", {})
        if isinstance(restriction, dict):
            choices = restriction.get("enumeration", [])
            if isinstance(choices, dict):
                choices = [choices]
            values = [str(choice.get("@value", "")) for choice in choices if isinstance(choice, dict)]
            return " or ".join(value for value in values if value)
    return str(field or "") if not isinstance(field, dict) else ""


def _issue_reason(requirement: dict, entity: dict, model=None) -> str:
    """Turn IfcTester's generic result into an actionable IDS-specific message."""
    raw = entity.get("reason") or "Requirement failed"
    metadata = requirement.get("metadata") or {}
    facet = (requirement.get("facet_type") or "").lower()
    if facet != "property":
        label = requirement.get("label") or requirement.get("description") or ""
        return f"{label}: {raw}" if label and label.lower() not in raw.lower() else raw
    pset = _ids_value(metadata.get("propertySet"))
    prop = _ids_value(metadata.get("baseName"))
    target = ".".join(part for part in (pset, prop) if part) or requirement.get("label", "property")
    expected = _ids_value(metadata.get("value"))
    if raw == "The required property set does not exist":
        return f"Missing property set {pset}. Add it with the required property {prop} and a value." if pset and prop else f"Missing required property set {pset or target}."
    if raw == "The property set does not contain the required property":
        if model is not None and pset and prop and entity.get("global_id"):
            try:
                import ifcopenshell.util.element

                element = model.by_guid(entity["global_id"])
                properties = ifcopenshell.util.element.get_psets(element).get(pset, {})
                if prop in properties:
                    return f"Missing information: {target} exists but has no value. Populate the required value."
                return f"Missing required property {prop} in {pset}. Add the property and provide a value."
            except (RuntimeError, KeyError, TypeError):
                pass
        return f"Missing required property or value for {target}. Add or populate it."
    if "data type" in raw.lower():
        return f"Wrong data type for {target}. {raw}."
    if "does not match" in raw.lower():
        suffix = f" Expected {expected}." if expected else " Check the IDS value rule."
        return f"Incorrect value for {target}. {raw}.{suffix}".replace("..", ".")
    return f"{target}: {raw}"


def issue_rows(result: dict, ids_file: str = "", model=None) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for spec in result.get("specifications", []):
        if spec.get("is_skipped"):
            continue
        if not spec.get("status") and not spec.get("requirements") and spec.get("total_applicable", 0) != 0:
            rows.append({"IDS file": ids_file, "Specification": spec.get("name", ""), "Requirement": "Applicable elements", "IFC class": "", "GlobalId": "", "Element": "", "Reason": "Specification failed; check its applicability and cardinality."})
        for requirement in spec.get("requirements", []):
            for entity in requirement.get("failed_entities", []):
                rows.append(
                    {
                        "IDS file": ids_file,
                        "Specification": spec.get("name", ""),
                        "Requirement": requirement.get("description") or requirement.get("label", ""),
                        "IFC class": entity.get("class") or entity.get("type") or "",
                        "GlobalId": entity.get("global_id") or entity.get("GlobalId") or "",
                        "Element": entity.get("name") or "",
                        "Reason": _issue_reason(requirement, entity, model),
                    }
                )
        if spec.get("total_applicable", 0) == 0 and not spec.get("status"):
            rows.append({"IDS file": ids_file, "Specification": spec.get("name", ""), "Requirement": "Applicable elements", "IFC class": "", "GlobalId": "", "Element": "", "Reason": "No matching IFC elements were found for a required specification."})
    return rows


def _pass_reason(requirement: dict, entity: dict, model=None) -> str:
    """Explain a successful facet using its IDS rule and the IFC value when available."""
    description = requirement.get("description") or requirement.get("label") or "IDS information requirement"
    metadata = requirement.get("metadata") or {}
    facet = (requirement.get("facet_type") or "").lower()
    if facet == "property":
        pset = _ids_value(metadata.get("propertySet"))
        prop = _ids_value(metadata.get("baseName"))
        target = ".".join(part for part in (pset, prop) if part)
        if model is not None and pset and prop and entity.get("global_id"):
            try:
                import ifcopenshell.util.element

                element = model.by_guid(entity["global_id"])
                properties = ifcopenshell.util.element.get_psets(element).get(pset, {})
                if prop in properties and properties[prop] is not None:
                    value = str(properties[prop])
                    if len(value) > 160:
                        value = value[:157] + "…"
                    return f"{target} = {value}. Meets IDS requirement: {description}."
                cardinality = metadata.get("@cardinality", "required")
                if cardinality == "optional":
                    return f"{target} is optional and may be absent. Meets IDS requirement: {description}."
                if cardinality == "prohibited":
                    return f"{target} is absent as required. Meets IDS requirement: {description}."
            except (RuntimeError, KeyError, TypeError):
                pass
    return f"Meets IDS requirement: {description}."


def pass_rows(result: dict, ids_file: str = "", model=None) -> list[dict[str, str]]:
    """One successful IDS check per applicable IFC element and requirement."""
    rows: list[dict[str, str]] = []
    for spec in result.get("specifications", []):
        if spec.get("is_skipped") or spec.get("cardinality") == "prohibited":
            continue
        for requirement in spec.get("requirements", []):
            for entity in requirement.get("passed_entities", []):
                guid = entity.get("global_id") or entity.get("GlobalId") or ""
                if not guid:
                    continue
                rows.append({
                    "IDS file": ids_file,
                    "Specification": spec.get("name", ""),
                    "Requirement": requirement.get("description") or requirement.get("label", ""),
                    "IFC class": entity.get("class") or entity.get("type") or "",
                    "GlobalId": guid,
                    "Element": entity.get("name") or "",
                    "Reason": _pass_reason(requirement, entity, model),
                })
    return rows


def csv_bytes(rows: list[dict[str, str]]) -> bytes:
    fields = (["Check", "IFC model"] if any("Check" in row for row in rows) else []) + ["IDS file", "Specification", "Requirement", "IFC class", "GlobalId", "Element", "Reason"]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8-sig")


def json_bytes(result: dict) -> bytes:
    return json.dumps(result, ensure_ascii=False, indent=2, default=str).encode("utf-8")
