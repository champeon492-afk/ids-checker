## IDS Checker 2.1.0

- Soft outline now stays visible around the entire visible model federation, including when no element is selected. Selected elements keep their lime highlight and thin black edges.
- Added Walk mode with WASD movement, mouse look, gravity, wall collision, floor contact, and Space to jump. Exit walk returns to orbit.
- Added an **Open full viewer** link. The embedded viewer supports drag to look; browsers that allow pointer lock support free mouse look in the full viewer.

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
## IDS Checker 2.2.0

- Added an **MMI overview** to the federated IFC viewer. It reads each model object's declared `ProcessStatus`, groups objects by the MMI levels in the supplied reference, and colors or highlights the matching objects in 3D.
- Filter the overview by model, IFC zone, storey, and IFC class. Select a level or a specific object to inspect its IFC properties and recorded IDS checks.
- Objects without a usable status remain visible under **MMI not assigned**, with separate counts for a missing property set, missing property, and blank value. Unknown values have their own review group.
- The overview and its filters are restored when the viewer page reloads. The assigned percentage describes data coverage, not project completion.
