## IDS Checker 2.0.2

- Fixed selected IFC objects sometimes appearing as solid black surfaces when **Soft outline** was enabled. The viewer now draws thin black edge lines while retaining each object's original surface color.

## IDS Checker 2.0.1

- Create multiple validation sets, each pairing one IFC with one or more IDS files. Add another set to an existing saved project.
- Review the models together in one That Open viewer using their IFC coordinates. Use **Models** to choose the active model's validation results and show or hide each IFC independently.
- Select elements and review issues, passes, IFC properties, and relationships within the correct model, even if models reuse element IDs.
- Use the optional **Soft outline** style for gentler lighting and a black silhouette around the selected object. IFC geometry remains unchanged.
- Save or reopen all models, IDS files, and reports in one `.idscheck` project. Existing single-model projects still open.
- Uses Streamlit's supported iframe interface for the 3D viewer.

The Windows installer includes the app and its Python runtime. Download `IDS-Checker-Setup.exe`, run it, and open the **IDS Checker** shortcut to launch the browser interface.
