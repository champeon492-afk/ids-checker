"""Browser interface for IDS model validation."""

from __future__ import annotations

import base64
import hashlib
import io
import zipfile
from pathlib import Path

import streamlit as st

from building_viewer import show_building
from validator import csv_bytes, json_bytes, parse_ids_preview, pass_rows, run_validations
from workspace_store import create_project, load_project, project_path, save_project


LOGO = Path(__file__).parent / "assets" / "ids-logo.png"
st.set_page_config(page_title="IDS Model Validator", page_icon=str(LOGO), layout="wide")
logo_data = base64.b64encode(LOGO.read_bytes()).decode("ascii")
st.markdown(
    f'<div style="display:flex;align-items:center;gap:14px">'
    f'<img src="data:image/png;base64,{logo_data}" alt="IDS Checker logo" '
    'style="width:52px;height:52px;flex:none">'
    '<h1 style="margin:0">IDS Model Validator</h1></div>',
    unsafe_allow_html=True,
)
st.caption("Check one IFC model against one or more IDS information requirements files.")

workspace_id = st.query_params.get("workspace", "")
project = None
if workspace_id:
    try:
        project = load_project(workspace_id)
    except (ValueError, FileNotFoundError) as exc:
        st.warning(str(exc))

with st.expander("Open a saved validation project", expanded=project is None):
    project_upload = st.file_uploader("Choose an IDS Checker project (.idscheck)", type=["idscheck"], key="project_upload")
    st.caption("A project contains the IFC model, all IDS files, validation results and reports. Choose the file you previously saved.")
if project_upload is not None:
    project_data = project_upload.getvalue()
    project_digest = hashlib.sha256(project_data).hexdigest()
    if st.session_state.get("opened_project_digest") != project_digest:
        try:
            imported_id = save_project(project_data)
        except ValueError as exc:
            st.error(f"Could not open the project: {exc}")
            st.stop()
        st.session_state["opened_project_digest"] = project_digest
        st.query_params["workspace"] = imported_id
        st.rerun()

if project is not None:
    st.info(f"Restored local project · {project['ifc_filename']} · {len(project['ids_files'])} IDS file(s)")
    if st.button("Start a new validation"):
        st.query_params.clear()
        for key in ("validation", "fingerprint", "viewer_fingerprint", "viewer_token", "opened_project_digest", "project_upload"):
            st.session_state.pop(key, None)
        st.rerun()
    ids_files = project["ids_files"]
    ifc_data = project["ifc_data"]
    ifc_filename = project["ifc_filename"]
else:
    left, right = st.columns(2)
    with left:
        ids_uploads = st.file_uploader(
            "1. Upload IDS requirements",
            type=["ids"],
            accept_multiple_files=True,
            help="Select one or more Information Delivery Specification files",
        )
    with right:
        ifc_file = st.file_uploader("2. Upload IFC model", type=["ifc"], help="An Industry Foundation Classes model")
    if not ids_uploads:
        st.info("Upload one or more IDS files to see their checks and target elements.")
        st.stop()
    ids_files = [(upload.name, upload.getvalue()) for upload in ids_uploads]
    ifc_data = ifc_file.getvalue() if ifc_file else None
    ifc_filename = ifc_file.name if ifc_file else ""

preview = []
for filename, data in ids_files:
    try:
        preview.extend(parse_ids_preview(data, filename))
    except Exception as exc:
        st.error(f"Could not read {filename}: {exc}")
        st.stop()

st.subheader("Checks defined by the IDS files")
st.dataframe(preview, width="stretch", hide_index=True)
st.caption("All uploaded IDS files are checked against the same IFC model. Target facets select the elements; the validation engine applies the full IDS rules.")

if ifc_data is None:
    st.info("Upload an IFC model to run these checks.")
    st.stop()

digest = hashlib.sha256()
digest.update(ifc_data)
for filename, data in ids_files:
    digest.update(filename.encode("utf-8"))
    digest.update(hashlib.sha256(data).digest())
fingerprint = digest.hexdigest()
if project is None and st.session_state.get("fingerprint") != fingerprint:
    st.session_state.pop("validation", None)

if st.button("Re-run validation" if project is not None else "Run validation", type="primary"):
    with st.spinner(f"Checking the IFC model against {len(ids_files)} IDS file(s)..."):
        try:
            results = run_validations(ids_files, ifc_data)
            saved_data = create_project(ids_files, ifc_filename, ifc_data, results)
            workspace_id = save_project(saved_data)
            project = load_project(workspace_id)
            st.session_state["validation"] = results
            st.session_state["fingerprint"] = fingerprint
            st.query_params["workspace"] = workspace_id
        except Exception as exc:
            st.error(f"Validation could not complete: {exc}")
            st.stop()

if project is None and "validation" not in st.session_state:
    st.stop()

results = project["results"] if project is not None else st.session_state["validation"]
issues = [row for item in results for row in item["issues"]]
passed_checks = [row for item in results for row in (item.get("passes") if item.get("passes") is not None else pass_rows(item["report"], item["ids_file"]))]
failed_guids = {row["GlobalId"] for row in issues if row["GlobalId"]}
passed_elements = {row["GlobalId"] for row in passed_checks if row["GlobalId"]}
reports = [item["report"] for item in results]
st.subheader("Validation results")
if all(report.get("status") for report in reports):
    st.success("The model passed every uploaded IDS file.")
else:
    st.error("The model has IDS validation failures.")

cols = st.columns(5)
cols[0].metric("IDS files", len(results))
cols[1].metric("Specifications", sum(report.get("total_specifications", 0) for report in reports))
cols[2].metric("Checks passed", sum(report.get("total_checks_pass", 0) for report in reports))
cols[3].metric("Checks failed", sum(report.get("total_checks_fail", 0) for report in reports))
cols[4].metric("Issues listed", len(issues))

tabs = st.tabs(["Building viewer", "Issues", "Passed elements", "By IDS file", "Downloads"])
with tabs[0]:
    st.caption("Review failed or passed elements beside the 3D model. Select an element to see its IDS checks. Model browser opens the IFC relationship view below.")
    show_building(ifc_data, issues, passed_checks, fingerprint, workspace_id)
with tabs[1]:
    if issues:
        st.dataframe(issues, width="stretch", hide_index=True)
    else:
        st.info("No element-level issues were reported.")
with tabs[2]:
    st.caption("Each row explains an IDS requirement this element met. An element may also have failed other requirements.")
    if passed_elements:
        st.dataframe([{"Element status": "Also has failures" if row["GlobalId"] in failed_guids else "All checks passed", **row} for row in passed_checks if row["GlobalId"] in passed_elements], width="stretch", hide_index=True)
    else:
        st.info("No passed element-level checks were reported.")
with tabs[3]:
    for item in results:
        report = item["report"]
        status = "Pass" if report.get("status") else "Fail"
        with st.expander(f"{status} · {item['ids_file']}"):
            for spec in report.get("specifications", []):
                state = "Skipped" if spec.get("is_skipped") else ("Pass" if spec.get("status") else "Fail")
                st.markdown(f"**{state} · {spec.get('name', 'Unnamed specification')}**")
                st.write(f"Matched elements: {spec.get('total_applicable', 0)}")
                st.write(f"Applicability: {', '.join(spec.get('applicability', [])) or 'See IDS preview above'}")
                for requirement in spec.get("requirements", []):
                    mark = "✅" if requirement.get("status") else "❌"
                    st.write(f"{mark} {requirement.get('description') or requirement.get('label', 'Requirement')} — {requirement.get('total_pass', 0)} passed, {requirement.get('total_fail', 0)} failed")
with tabs[4]:
    if workspace_id:
        st.download_button(
            "Save complete project (.idscheck)",
            project_path(workspace_id).read_bytes(),
            file_name=f"{Path(ifc_filename).stem or 'ids-validation'}.idscheck",
            mime="application/octet-stream",
            on_click="ignore",
        )
        st.caption(f"This validation is also saved locally at: {project_path(workspace_id)}")
    st.download_button("Download issues CSV", csv_bytes(issues), file_name="ids-validation-issues.csv", mime="text/csv")
    full_report = [{"ids_file": item["ids_file"], "report": item["report"]} for item in results]
    st.download_button("Download full JSON report", json_bytes(full_report), file_name="ids-validation-report.json", mime="application/json")
    if len(results) == 1:
        st.download_button("Download HTML report", results[0]["html"], file_name="ids-validation-report.html", mime="text/html")
    else:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, item in enumerate(results, start=1):
                archive.writestr(f"report-{index:02d}.html", item["html"])
            archive.writestr("ids-files.txt", "\n".join(f"report-{index:02d}.html: {item['ids_file']}" for index, item in enumerate(results, start=1)))
        st.download_button("Download HTML reports ZIP", stream.getvalue(), file_name="ids-validation-html-reports.zip", mime="application/zip")
