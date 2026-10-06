import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root

from building_viewer import ViewerServer


class ViewerServerTests(unittest.TestCase):
    def test_serves_only_published_model(self):
        server = ViewerServer()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            server.publish("test-token", b"IFC model bytes", [], [{"GlobalId": "abc", "IDS file": "x.ids", "Specification": "Test", "IFC class": "IfcWall", "Element": "Wall", "Requirement": "FireRating", "Reason": "Value meets IDS rule"}])
            url = f"http://127.0.0.1:{server.server_port}"
            with urlopen(f"{url}/model?token=test-token") as response:
                self.assertEqual(response.read(), b"IFC model bytes")
                self.assertEqual(response.headers["Content-Type"], "application/octet-stream")
            with urlopen(f"{url}/issues?token=test-token") as response:
                self.assertEqual(response.read(), b"[]")
            with urlopen(f"{url}/passes?token=test-token") as response:
                self.assertEqual(json.load(response)[0]["reason"], "Value meets IDS rule")
            with self.assertRaises(HTTPError) as missing:
                urlopen(f"{url}/model?token=wrong-token")
            self.assertEqual(missing.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_model_browser_and_properties_include_ifc_data(self):
        model = ifcopenshell.api.project.create_file()
        project = ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name="Test project")
        wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWall", name="Test wall")
        pset = ifcopenshell.api.pset.add_pset(model, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(model, pset=pset, properties={"FireRating": "2h"})
        server = ViewerServer()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            server.publish("metadata-token", model.to_string().encode("utf-8"), [])
            url = f"http://127.0.0.1:{server.server_port}"
            with urlopen(f"{url}/browser?token=metadata-token") as response:
                browser = json.load(response)
            self.assertIn(project.GlobalId, {item["globalId"] for item in browser})
            self.assertIn(wall.GlobalId, {item["globalId"] for item in browser})
            with urlopen(f"{url}/properties?token=metadata-token&guid={wall.GlobalId}") as response:
                properties = json.load(response)
            self.assertEqual(properties["attributes"]["Name"], "Test wall")
            self.assertEqual(properties["propertySets"]["Pset_WallCommon"]["FireRating"], "2h")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
