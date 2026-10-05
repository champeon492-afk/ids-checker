"""Extract IFC element geometry and make an interactive 3D figure."""

from __future__ import annotations

import tempfile
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import numpy as np
import plotly.graph_objects as go


def open_model(data: bytes) -> ifcopenshell.file:
    """Read uploaded IFC bytes without retaining a disk copy."""
    with tempfile.TemporaryDirectory(prefix="ids-viewer-") as folder:
        path = Path(folder) / "model.ifc"
        path.write_bytes(data)
        return ifcopenshell.open(str(path))


def element_mesh(model: ifcopenshell.file, global_id: str, max_triangles: int = 30000) -> dict:
    """Triangulate one element in world coordinates for browser viewing."""
    try:
        element = model.by_guid(global_id)
    except (RuntimeError, KeyError) as exc:
        raise ValueError("This element was not found in the IFC model.") from exc
    if not getattr(element, "Representation", None):
        raise ValueError("This element has no 3D representation in the IFC model.")

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    try:
        shape = ifcopenshell.geom.create_shape(settings, element)
    except Exception as exc:
        raise ValueError(f"The element's 3D shape could not be generated: {exc}") from exc

    vertices = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3)
    triangles = np.asarray(shape.geometry.faces, dtype=int).reshape(-1, 3)
    if not len(vertices) or not len(triangles):
        raise ValueError("This element has no displayable 3D faces.")
    original_triangles = len(triangles)
    if len(triangles) > max_triangles:
        step = int(np.ceil(len(triangles) / max_triangles))
        triangles = triangles[::step]
    used = np.unique(triangles)
    vertices = vertices[used]
    triangles = np.searchsorted(used, triangles)
    center = (vertices.min(axis=0) + vertices.max(axis=0)) / 2
    dimensions = vertices.max(axis=0) - vertices.min(axis=0)
    vertices = vertices - center
    return {
        "vertices": vertices,
        "triangles": triangles,
        "center": center,
        "dimensions": dimensions,
        "triangle_count": original_triangles,
        "shown_triangles": len(triangles),
        "ifc_class": element.is_a(),
        "name": element.Name or "Unnamed element",
        "global_id": global_id,
    }


def mesh_figure(mesh: dict) -> go.Figure:
    """Create an orbitable Plotly view of the selected element."""
    vertices = mesh["vertices"]
    triangles = mesh["triangles"]
    fig = go.Figure(
        go.Mesh3d(
            x=vertices[:, 0],
            y=vertices[:, 1],
            z=vertices[:, 2],
            i=triangles[:, 0],
            j=triangles[:, 1],
            k=triangles[:, 2],
            color="#0B7984",
            flatshading=True,
            lighting={"ambient": 0.65, "diffuse": 0.7, "specular": 0.15, "roughness": 0.8},
            hoverinfo="skip",
        )
    )
    fig.update_layout(
        margin={"l": 0, "r": 0, "t": 10, "b": 0},
        paper_bgcolor="#F2F6F6",
        scene={
            "aspectmode": "data",
            "xaxis": {"title": "X", "backgroundcolor": "#F2F6F6"},
            "yaxis": {"title": "Y", "backgroundcolor": "#F2F6F6"},
            "zaxis": {"title": "Z", "backgroundcolor": "#F2F6F6"},
            "camera": {"eye": {"x": 1.5, "y": 1.5, "z": 1.2}},
        },
        showlegend=False,
    )
    return fig
