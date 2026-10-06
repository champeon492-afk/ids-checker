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
    def test_federated_endpoints_scope_models_and_colliding_guids(self):
        model_a = ifcopenshell.api.project.create_file()
        wall_a = ifcopenshell.api.root.create_entity(model_a, ifc_class="IfcWall", name="Architecture wall")
        model_b = ifcopenshell.api.project.create_file()
        wall_b = ifcopenshell.api.root.create_entity(model_b, ifc_class="IfcWall", name="MEP wall")
        wall_b.GlobalId = wall_a.GlobalId
        common = {"GlobalId": wall_a.GlobalId, "IDS file": "check.ids", "Specification": "Spec", "IFC class": "IfcWall", "Element": "Wall", "Requirement": "FireRating", "Reason": "Missing"}
        checks = [
            {"id": "ark", "name": "Architecture", "ifc_filename": "ARK.ifc", "ifc_data": model_a.to_string().encode(), "results": [{"issues": [common], "passes": []}]},
            {"id": "mep", "name": "MEP", "ifc_filename": "MEP.ifc", "ifc_data": model_b.to_string().encode(), "results": [{"issues": [], "passes": [dict(common, Reason="Met")]}]},
        ]
        server = ViewerServer()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            server.publish_checks("federated", checks)
            url = f"http://127.0.0.1:{server.server_port}"
            with urlopen(f"{url}/checks?token=federated") as response:
                self.assertEqual([item["id"] for item in json.load(response)], ["ark", "mep"])
            with urlopen(f"{url}/model?token=federated&check=mep") as response:
                self.assertEqual(response.read(), checks[1]["ifc_data"])
            with urlopen(f"{url}/issues?token=federated&check=ark") as response:
                self.assertEqual(len(json.load(response)), 1)
            with urlopen(f"{url}/issues?token=federated&check=mep") as response:
                self.assertEqual(json.load(response), [])
            with urlopen(f"{url}/properties?token=federated&check=mep&guid={wall_a.GlobalId}") as response:
                self.assertEqual(json.load(response)["name"], "MEP wall")
            with self.assertRaises(HTTPError) as missing:
                urlopen(f"{url}/model?token=federated&check=missing")
            self.assertEqual(missing.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

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
            with urlopen(f"{url}/logo.png?token=test-token") as response:
                self.assertEqual(response.headers["Content-Type"], "image/png")
                self.assertTrue(response.read().startswith(b"\x89PNG\r\n\x1a\n"))
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
