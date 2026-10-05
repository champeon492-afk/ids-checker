"""Browser interface for IDS model validation."""

from __future__ import annotations

import hashlib
import io
import zipfile

import streamlit as st

from validator import csv_bytes, issue_rows, json_bytes, parse_ids_preview, run_validations


st.set_page_config(page_title="IDS Model Validator", page_icon="✅", layout="wide")
st.title("IDS Model Validator")
st.caption("Check one IFC model against one or more IDS information requirements files.")

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
preview = []
for filename, data in ids_files:
    try:
        preview.extend(parse_ids_preview(data, filename))
    except Exception as exc:
        st.error(f"Could not read {filename}: {exc}")
        st.stop()

st.subheader("Checks defined by the IDS files")
st.dataframe(preview, use_container_width=True, hide_index=True)
st.caption("All uploaded IDS files are checked against the same IFC model. Target facets select the elements; the validation engine applies the full IDS rules.")

if not ifc_file:
    st.info("Upload an IFC model to run these checks.")
    st.stop()

ifc_data = ifc_file.getvalue()
digest = hashlib.sha256()
digest.update(ifc_data)
for filename, data in ids_files:
    digest.update(filename.encode("utf-8"))
    digest.update(hashlib.sha256(data).digest())
fingerprint = digest.hexdigest()
if st.session_state.get("fingerprint") != fingerprint:
    st.session_state.pop("validation", None)

if st.button("Run validation", type="primary"):
    with st.spinner(f"Checking the IFC model against {len(ids_files)} IDS file(s)..."):
        try:
            st.session_state["validation"] = run_validations(ids_files, ifc_data)
            st.session_state["fingerprint"] = fingerprint
        except Exception as exc:
            st.error(f"Validation could not complete: {exc}")
            st.stop()

if "validation" not in st.session_state:
    st.stop()

results = st.session_state["validation"]
issues = [row for item in results for row in issue_rows(item["report"], item["ids_file"])]
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

tabs = st.tabs(["Issues", "By IDS file", "Downloads"])
with tabs[0]:
    if issues:
        st.dataframe(issues, use_container_width=True, hide_index=True)
    else:
        st.info("No element-level issues were reported.")
with tabs[1]:
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
with tabs[2]:
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
