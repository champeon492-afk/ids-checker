# IDS Model Validator

A local web app that reads an Information Delivery Specification (`.ids`), shows the information requirements and their target IFC elements, validates an IFC model, and lets you download the results.

## Run locally

### One-click Windows install

The Windows installer bundles Python and the app. Download `IDS-Checker-Setup.exe` from [GitHub Releases](https://github.com/champeon492-afk/ids-checker/releases), run it once, and use the **IDS Checker** desktop shortcut. The shortcut starts the local validator and opens it in your default browser. No separate Python or Node.js installation is needed. The installer also adds a Start menu shortcut and an uninstaller. Windows may show a security warning for this unsigned installer.

Installed copies save automatic project backups under `%LOCALAPPDATA%\IDS Checker\projects`. These remain available when the app is upgraded. The portable `.idscheck` download is still the easiest way to give a validation session to a colleague. The 3D viewer currently needs internet access for its That Open worker and Web IFC files.

For developers, the installer is built by `.github/workflows/windows-installer.yml` using the scripts in `packaging/`. It is a per-user Windows installer and does not need administrator rights.

### From source

Use Python 3.12. On Windows, double-click `start-validator.cmd` and keep its window open while using the app. This starts the local server and opens the app in your browser. If the browser says **Connection lost**, run the launcher again and refresh the page.

Or, in a terminal inside this folder:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run app.py
```

The app opens in your browser. Upload one or more `.ids` files and one `.ifc` file, review the checks, and select **Run validation**. The app saves a local project copy after each run and adds its address to the browser URL. Refreshing that URL restores the model, IDS files, results and viewer selection. The browser cannot reopen the original file paths directly, so the app keeps its own local copy.

Use **Downloads → Save complete project (.idscheck)** to choose a file location and keep a portable copy for the next session or a colleague. Later, use **Open a saved validation project** to reopen that file without repeating the validation. The automatic copy is stored in `local_workspaces/` beside the app and is excluded from GitHub. Keep the local app running to use the browser URL; the `.idscheck` file also works after restarting the app.

## Results

- Summary: passing and failing checks across every uploaded IDS file.
- Issues: one row per failed requirement and IFC element, including the source IDS file, `GlobalId`, and an actionable explanation of missing property sets, missing properties, empty values, wrong values or data types where the IDS identifies them.
- Building workspace: Failed and Passed panels on the left, with the complete That Open IFC viewer on the right. The Passed panel lists elements that met at least one IDS requirement and marks those that also have failures. Their cards and viewer panel show each successful requirement and the recorded IFC value when available. The failed panel has a searchable list and an IFC class issue chart. Select or click an element in 3D to inspect its checks and IFC properties.
- Selection controls: **Isolate selected** makes other geometry transparent for a selected element, IFC class or relationship tile. This setting stays on as you move between relationship tiles and elements. Turn isolation off to show the rest of the building, or use **Clear selection** to reset the view.
- Properties inspector: view IFC attributes, inherited property sets and quantities for the selected element. Validation errors are shown in the panel inside the viewer.
- Model browser: opens below the results list and 3D viewer. Connected columns show the IFC relationship from project through site, building, storey and class to individual elements. Selecting a tile highlights its elements; **Isolate selected** controls whether the others are transparent. Selecting an element frames only that element in 3D and shows its passed checks or validation errors.
- Downloads: a complete `.idscheck` project, JSON with full validation details, CSV of failures, and an HTML report for one IDS file or a ZIP of HTML reports for several IDS files.

The preview is a readable view of the IDS rules. IfcTester performs the actual standards-based validation. A required specification with no applicable model elements is reported as a failure according to the IDS rules.

For public hosting, note that Streamlit uploads files to the server running this app. Deploy only where your model data is allowed to be processed. The simplest private use is to run it locally.

## Technology

- [IfcTester](https://docs.ifcopenshell.org/ifctester.html) for IDS/IFC checking and reporting
- [Streamlit](https://docs.streamlit.io/) for the browser interface
- [That Open](https://docs.thatopen.com/) for the interactive whole-building IFC viewer

The browser viewer uses That Open's IFC to Fragments conversion. Its first load can take time for a large IFC model and requires access to the That Open worker and Web IFC WASM files on unpkg.com. The app serves the IFC to the viewer through a temporary, token-protected localhost endpoint. The local project copy is not committed to GitHub.

The workspace styling follows the supplied Orion Twin design system, including its tokens, dark surfaces and lime selection state.

The bundled viewer is included in this repository, so Node.js is not needed to run the app. To change the viewer code, run `npm install` and `npm run build` in `frontend/`, then commit the updated bundle.

The app does not require a database or user accounts.
