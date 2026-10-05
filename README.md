# IDS Model Validator

A local web app that reads an Information Delivery Specification (`.ids`), shows the information requirements and their target IFC elements, validates an IFC model, and lets you download the results.

## Run locally

Use Python 3.12. On Windows, double-click `start-validator.cmd` and keep its window open while using the app. This starts the local server and opens the app in your browser. If the browser says **Connection lost**, run the launcher again and refresh the page.

Or, in a terminal inside this folder:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run app.py
```

The app opens in your browser. Upload one or more `.ids` files and one `.ifc` file, review the checks, and select **Run validation**. Uploaded files are processed by the local Streamlit process; its temporary disk copies are deleted after each run.

## Results

- Summary: passing and failing checks across every uploaded IDS file.
- Issues: one row per failed requirement and IFC element, including the source IDS file, `GlobalId`, and the reason reported by IfcTester.
- Downloads: JSON with full validation details, CSV of failures, and an HTML report for one IDS file or a ZIP of HTML reports for several IDS files.

The preview is a readable view of the IDS rules. IfcTester performs the actual standards-based validation. A required specification with no applicable model elements is reported as a failure according to the IDS rules.

For public hosting, note that Streamlit uploads files to the server running this app. Deploy only where your model data is allowed to be processed. The simplest private use is to run it locally.

## Technology

- [IfcTester](https://docs.ifcopenshell.org/ifctester.html) for IDS/IFC checking and reporting
- [Streamlit](https://docs.streamlit.io/) for the browser interface

The app does not require a database or user accounts.
