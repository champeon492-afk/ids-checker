"""Independent IDS checks and a federated IFC viewer."""
from __future__ import annotations

import base64
import hashlib
import io
import uuid
import zipfile
from pathlib import Path

import streamlit as st

from building_viewer import show_building
from validator import csv_bytes, json_bytes, parse_ids_preview, pass_rows, run_validations
from workspace_store import create_federated_project, load_project, project_path, save_project

LOGO = Path(__file__).parent / "assets" / "ids-logo.png"
st.set_page_config(page_title="IDS Model Validator", page_icon=str(LOGO), layout="wide")
logo_data = base64.b64encode(LOGO.read_bytes()).decode("ascii")
st.markdown(f'<div style="display:flex;align-items:center;gap:14px"><img src="data:image/png;base64,{logo_data}" alt="IDS Checker logo" style="width:52px;height:52px;flex:none"><h1 style="margin:0">IDS Model Validator</h1></div>', unsafe_allow_html=True)
st.caption("Check each IFC model against its own IDS files, then review the models together in 3D.")


def new_check():
    return {"id": uuid.uuid4().hex[:12], "name": "", "ids_files": [], "ifc_filename": "", "ifc_data": None}


workspace_id = st.query_params.get("workspace", "")
project = None
if workspace_id:
    try:
        project = load_project(workspace_id)
    except (ValueError, FileNotFoundError) as exc:
        st.warning(str(exc))
with st.expander("Open a saved validation project", expanded=project is None):
    upload = st.file_uploader("Choose an IDS Checker project (.idscheck)", type=["idscheck"], key="project_upload")
    st.caption("A project contains all IFC models, IDS files, results and reports.")
if upload:
    data = upload.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    if st.session_state.get("opened_project_digest") != digest:
        try:
            imported_id = save_project(data)
        except ValueError as exc:
            st.error(f"Could not open the project: {exc}")
            st.stop()
        st.session_state["opened_project_digest"] = digest
        st.query_params["workspace"] = imported_id
        st.rerun()

if "draft_checks" not in st.session_state:
    st.session_state["draft_checks"] = [new_check()]
if project:
    checks = project["checks"]
    st.info(f"Restored local project · {len(checks)} IFC model(s) · {sum(len(c['ids_files']) for c in checks)} IDS file(s)")
    if st.button("+ Add another check to this project"):
        st.session_state["draft_checks"] = [{**check} for check in checks] + [new_check()]
        st.query_params.clear()
        st.rerun()
    if st.button("Start a new validation"):
        st.query_params.clear()
        st.session_state["draft_checks"] = [new_check()]
        for key in ("viewer_fingerprint", "viewer_token", "opened_project_digest", "project_upload"):
            st.session_state.pop(key, None)
        st.rerun()
else:
    checks = st.session_state["draft_checks"]
    st.subheader("Validation sets")
    st.caption("Each set checks one IFC model against one or more IDS files. Add a set for another discipline.")
    for index, check in enumerate(checks, start=1):
        with st.container(border=True):
            st.markdown(f"**Check {index}**")
            check["name"] = st.text_input("Discipline / check name", value=check["name"], placeholder="e.g. Architecture or MEP", key=f"name-{check['id']}")
            left, right = st.columns(2)
            with left:
                ids_uploads = st.file_uploader("IDS requirements", type=["ids"], accept_multiple_files=True, key=f"ids-{check['id']}")
            with right:
                ifc_upload = st.file_uploader("IFC model", type=["ifc"], key=f"ifc-{check['id']}")
            if ids_uploads:
                check["ids_files"] = [(item.name, item.getvalue()) for item in ids_uploads]
            if ifc_upload:
                check["ifc_data"] = ifc_upload.getvalue()
                check["ifc_filename"] = ifc_upload.name
            if check["ifc_filename"]:
                st.caption(f"Selected IFC: {check['ifc_filename']} · IDS: {', '.join(name for name, _ in check['ids_files']) or 'none'}")
            if len(checks) > 1 and st.button("Remove this check", key=f"remove-{check['id']}"):
                checks.remove(check)
                st.rerun()
    if st.button("+ Add another check"):
        checks.append(new_check())
        st.rerun()

preview = []
for check in checks:
    for filename, data in check["ids_files"]:
        try:
            preview.extend({"Check": check["name"] or check["ifc_filename"] or check["id"], "IFC model": check["ifc_filename"], **row} for row in parse_ids_preview(data, filename))
        except Exception as exc:
            st.error(f"Could not read {filename}: {exc}")
            st.stop()
if preview:
    st.subheader("Checks defined by the IDS files")
    st.dataframe(preview, width="stretch", hide_index=True)
    st.caption("Each IDS file applies only to the IFC model in its validation set.")

if not project:
    if not all(c["ids_files"] and c["ifc_data"] for c in checks):
        st.info("Add an IFC model and at least one IDS file to every validation set, then run validation.")
        st.stop()
    if st.button("Run all checks", type="primary"):
        with st.spinner(f"Validating {len(checks)} IFC model(s)…"):
            try:
                for check in checks:
                    check["name"] = check["name"].strip() or Path(check["ifc_filename"]).stem
                    check["results"] = run_validations(check["ids_files"], check["ifc_data"])
                st.query_params["workspace"] = save_project(create_federated_project(checks))
                st.rerun()
            except Exception as exc:
                st.error(f"Validation could not complete: {exc}")
    st.stop()

if st.button("Re-run all checks"):
    with st.spinner("Running all IDS checks again…"):
        try:
            for check in checks:
                check["results"] = run_validations(check["ids_files"], check["ifc_data"])
            st.query_params["workspace"] = save_project(create_federated_project(checks))
            st.rerun()
        except Exception as exc:
            st.error(f"Validation could not complete: {exc}")
    st.stop()

results = [(check, item) for check in checks for item in check["results"]]
issues = [{"Check ID": check["id"], "Check": check["name"], "IFC model": check["ifc_filename"], **row} for check, item in results for row in item["issues"]]
passed = [{"Check ID": check["id"], "Check": check["name"], "IFC model": check["ifc_filename"], **row} for check, item in results for row in (item.get("passes") if item.get("passes") is not None else pass_rows(item["report"], item["ids_file"]))]
failed_keys = {(row["Check ID"], row["GlobalId"]) for row in issues if row["GlobalId"]}
reports = [item["report"] for _, item in results]
st.subheader("Validation results")
if all(report.get("status") for report in reports):
    st.success("All IFC models passed their IDS requirements.")
else:
    st.error("One or more IFC models have IDS validation failures.")
cols = st.columns(6)
for col, label, value in zip(cols, ("IFC models", "IDS files", "Specifications", "Checks passed", "Checks failed", "Issues listed"), (len(checks), len(results), sum(r.get("total_specifications", 0) for r in reports), sum(r.get("total_checks_pass", 0) for r in reports), sum(r.get("total_checks_fail", 0) for r in reports), len(issues))):
    col.metric(label, value)

tabs = st.tabs(["Federated viewer", "Issues", "Passed elements", "By IDS file", "Downloads"])
with tabs[0]:
    st.caption("Show or hide IFC models in the shared viewer. Models use their IFC coordinates; confirm alignment before uploading.")
    show_building(checks, hashlib.sha256(workspace_id.encode()).hexdigest(), workspace_id)
with tabs[1]:
    if issues:
        st.dataframe(issues, width="stretch", hide_index=True)
    else:
        st.info("No element-level issues were reported.")
with tabs[2]:
    if passed:
        st.dataframe([{"Element status": "Also has failures" if (row["Check ID"], row["GlobalId"]) in failed_keys else "All checks passed", **row} for row in passed], width="stretch", hide_index=True)
    else:
        st.info("No passed element-level checks were reported.")
with tabs[3]:
    for check, item in results:
        report = item["report"]
        with st.expander(f"{'Pass' if report.get('status') else 'Fail'} · {check['name']} · {item['ids_file']}"):
            st.caption(f"IFC model: {check['ifc_filename']}")
            for spec in report.get("specifications", []):
                state = "Skipped" if spec.get("is_skipped") else ("Pass" if spec.get("status") else "Fail")
                st.markdown(f"**{state} · {spec.get('name', 'Unnamed specification')}**")
                st.write(f"Matched elements: {spec.get('total_applicable', 0)}")
                st.write(f"Applicability: {', '.join(spec.get('applicability', [])) or 'See IDS preview above'}")
                for requirement in spec.get("requirements", []):
                    st.write(f"{'✅' if requirement.get('status') else '❌'} {requirement.get('description') or requirement.get('label', 'Requirement')} — {requirement.get('total_pass', 0)} passed, {requirement.get('total_fail', 0)} failed")
with tabs[4]:
    st.download_button("Save complete project (.idscheck)", project_path(workspace_id).read_bytes(), file_name="ids-federated-validation.idscheck", mime="application/octet-stream", on_click="ignore")
    st.caption(f"Also saved locally at: {project_path(workspace_id)}")
    st.download_button("Download issues CSV", csv_bytes(issues), file_name="ids-validation-issues.csv", mime="text/csv")
    st.download_button("Download full JSON report", json_bytes([{"check": check["name"], "ifc_model": check["ifc_filename"], "ids_file": item["ids_file"], "report": item["report"]} for check, item in results]), file_name="ids-validation-report.json", mime="application/json")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index, (_, item) in enumerate(results, start=1):
            archive.writestr(f"report-{index:02d}.html", item["html"])
        archive.writestr("ids-files.txt", "\n".join(f"report-{index:02d}.html: {check['name']} / {check['ifc_filename']} / {item['ids_file']}" for index, (check, item) in enumerate(results, start=1)))
    st.download_button("Download HTML reports ZIP", stream.getvalue(), file_name="ids-validation-html-reports.zip", mime="application/zip")
