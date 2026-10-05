"""Browser interface for IDS model validation."""

from __future__ import annotations

import hashlib

import streamlit as st

from validator import csv_bytes, issue_rows, json_bytes, parse_ids_preview, run_validation


st.set_page_config(page_title="IDS Model Validator", page_icon="✅", layout="wide")
st.title("IDS Model Validator")
st.caption("Check whether an IFC model delivers the information required by an IDS file.")

left, right = st.columns(2)
with left:
    ids_file = st.file_uploader("1. Upload IDS requirements", type=["ids"], help="An Information Delivery Specification file")
with right:
    ifc_file = st.file_uploader("2. Upload IFC model", type=["ifc"], help="An Industry Foundation Classes model")

if not ids_file:
    st.info("Upload an IDS file to see the required information and target elements.")
    st.stop()

ids_data = ids_file.getvalue()
try:
    preview = parse_ids_preview(ids_data)
except Exception as exc:
    st.error(f"Could not read the IDS file: {exc}")
    st.stop()

st.subheader("Checks defined by the IDS")
st.dataframe(preview, use_container_width=True, hide_index=True)
st.caption("Target facets in each specification work together to select model elements. The validation engine applies the full IDS rules, including value restrictions.")

if not ifc_file:
    st.info("Upload an IFC model to run these checks.")
    st.stop()

ifc_data = ifc_file.getvalue()
fingerprint = hashlib.sha256(ids_data + ifc_data).hexdigest()
if st.session_state.get("fingerprint") != fingerprint:
    st.session_state.pop("validation", None)

if st.button("Run validation", type="primary"):
    with st.spinner("Checking the IFC model against the IDS..."):
        try:
            st.session_state["validation"] = run_validation(ids_data, ifc_data)
            st.session_state["fingerprint"] = fingerprint
        except Exception as exc:
            st.error(f"Validation could not complete: {exc}")
            st.stop()

if "validation" not in st.session_state:
    st.stop()

result, html_report = st.session_state["validation"]
issues = issue_rows(result)
st.subheader("Validation results")
if result.get("status"):
    st.success("The model passed the IDS checks.")
else:
    st.error("The model has IDS validation failures.")

cols = st.columns(4)
cols[0].metric("Specifications", result.get("total_specifications", 0))
cols[1].metric("Checks passed", result.get("total_checks_pass", 0))
cols[2].metric("Checks failed", result.get("total_checks_fail", 0))
cols[3].metric("Issues listed", len(issues))

tabs = st.tabs(["Issues", "By specification", "Downloads"])
with tabs[0]:
    if issues:
        st.dataframe(issues, use_container_width=True, hide_index=True)
    else:
        st.info("No element-level issues were reported.")
with tabs[1]:
    for spec in result.get("specifications", []):
        label = spec.get("name", "Unnamed specification")
        state = "Skipped" if spec.get("is_skipped") else ("Pass" if spec.get("status") else "Fail")
        with st.expander(f"{state} · {label}"):
            st.write(f"**Matched elements:** {spec.get('total_applicable', 0)}")
            st.write(f"**Applicability:** {', '.join(spec.get('applicability', [])) or 'See IDS preview above'}")
            for requirement in spec.get("requirements", []):
                mark = "✅" if requirement.get("status") else "❌"
                st.write(f"{mark} {requirement.get('description') or requirement.get('label', 'Requirement')} — {requirement.get('total_pass', 0)} passed, {requirement.get('total_fail', 0)} failed")
with tabs[2]:
    st.download_button("Download issues CSV", csv_bytes(issues), file_name="ids-validation-issues.csv", mime="text/csv")
    st.download_button("Download full JSON report", json_bytes(result), file_name="ids-validation-report.json", mime="application/json")
    st.download_button("Download HTML report", html_report, file_name="ids-validation-report.html", mime="text/html")
