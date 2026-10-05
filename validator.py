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


def parse_ids_preview(data: bytes) -> list[dict[str, str]]:
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


def run_validation(ids_data: bytes, ifc_data: bytes) -> tuple[dict, bytes]:
    """Run IfcTester with temporary files and return JSON plus HTML report bytes."""
    import ifcopenshell
    import ifctester
    from ifctester import reporter

    with tempfile.TemporaryDirectory(prefix="ids-validator-") as folder:
        ids_path = Path(folder) / "requirements.ids"
        ifc_path = Path(folder) / "model.ifc"
        ids_path.write_bytes(ids_data)
        ifc_path.write_bytes(ifc_data)
        specifications = ifctester.open(str(ids_path), validate=True)
        model = ifcopenshell.open(str(ifc_path))
        specifications.validate(model)
        result = reporter.Json(specifications).report()
        html_report = reporter.Html(specifications)
        html_report.report()
        html_path = Path(folder) / "report.html"
        html_report.to_file(str(html_path))
        return result, html_path.read_bytes()


def issue_rows(result: dict) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for spec in result.get("specifications", []):
        if spec.get("is_skipped"):
            continue
        if not spec.get("status") and not spec.get("requirements") and spec.get("total_applicable", 0) != 0:
            rows.append({"Specification": spec.get("name", ""), "Requirement": "Applicable elements", "IFC class": "", "GlobalId": "", "Element": "", "Reason": "Specification failed; check its applicability and cardinality."})
        for requirement in spec.get("requirements", []):
            for entity in requirement.get("failed_entities", []):
                rows.append(
                    {
                        "Specification": spec.get("name", ""),
                        "Requirement": requirement.get("description") or requirement.get("label", ""),
                        "IFC class": entity.get("class") or entity.get("type") or "",
                        "GlobalId": entity.get("global_id") or entity.get("GlobalId") or "",
                        "Element": entity.get("name") or "",
                        "Reason": entity.get("reason") or "Requirement failed",
                    }
                )
        if spec.get("total_applicable", 0) == 0 and not spec.get("status"):
            rows.append({"Specification": spec.get("name", ""), "Requirement": "Applicable elements", "IFC class": "", "GlobalId": "", "Element": "", "Reason": "No matching IFC elements were found for a required specification."})
    return rows


def csv_bytes(rows: list[dict[str, str]]) -> bytes:
    fields = ["Specification", "Requirement", "IFC class", "GlobalId", "Element", "Reason"]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8-sig")


def json_bytes(result: dict) -> bytes:
    return json.dumps(result, ensure_ascii=False, indent=2, default=str).encode("utf-8")
