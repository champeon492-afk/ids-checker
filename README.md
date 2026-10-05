# IDS Model Validator

A local web app that reads an Information Delivery Specification (`.ids`), shows the information requirements and their target IFC elements, validates an IFC model, and lets you download the results.

## Run locally

Use Python 3.11 or 3.12. In a terminal inside this folder:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run app.py
```

The app opens in your browser. Upload one `.ids` file and one `.ifc` file, review the checks, and select **Run validation**. Uploaded files are processed by the local Streamlit process and deleted from its temporary folder after each run.

## Results

- Summary: passing and failing checks, matching elements, and specifications.
- Issues: one row per failed requirement and IFC element, including `GlobalId` and the reason reported by IfcTester.
- Downloads: JSON with full validation details, CSV of failures, and an HTML report.

The preview is a readable view of the IDS rules. IfcTester performs the actual standards-based validation. A required specification with no applicable model elements is reported as a failure according to the IDS rules.

For public hosting, note that Streamlit uploads files to the server running this app. Deploy only where your model data is allowed to be processed. The simplest private use is to run it locally.

## Technology

- [IfcTester](https://docs.ifcopenshell.org/ifctester.html) for IDS/IFC checking and reporting
- [Streamlit](https://docs.streamlit.io/) for the browser interface

The app does not require a database or user accounts.
