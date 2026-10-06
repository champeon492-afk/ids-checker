import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import workspace_store


class WorkspaceStoreTests(unittest.TestCase):
    def test_federated_round_trip_keeps_models_and_results_separate(self):
        checks = [
            {"id": "ark", "name": "Architecture", "ifc_filename": "ARK.ifc", "ifc_data": b"ARK model", "ids_files": [("ARK-1.ids", b"ark one"), ("ARK-2.ids", b"ark two")], "results": [{"ids_file": name, "report": {"status": True}, "html": b"report", "issues": [], "passes": []} for name in ("ARK-1.ids", "ARK-2.ids")]},
            {"id": "mep", "name": "MEP", "ifc_filename": "MEP.ifc", "ifc_data": b"MEP model", "ids_files": [("MEP.ids", b"mep")], "results": [{"ids_file": "MEP.ids", "report": {"status": False}, "html": b"report", "issues": [{"Reason": "Missing"}], "passes": []}]},
        ]
        data = workspace_store.create_federated_project(checks)
        with tempfile.TemporaryDirectory() as folder, patch.object(workspace_store, "STORE", Path(folder)):
            restored = workspace_store.load_project(workspace_store.save_project(data))
        self.assertEqual([check["id"] for check in restored["checks"]], ["ark", "mep"])
        self.assertEqual(restored["checks"][0]["ids_files"], checks[0]["ids_files"])
        self.assertEqual(restored["checks"][1]["ifc_data"], b"MEP model")
        self.assertEqual(restored["checks"][1]["results"][0]["issues"][0]["Reason"], "Missing")

    def test_project_round_trip_restores_inputs_and_results(self):
        ids_files = [("walls.ids", b"<ids />"), ("doors.ids", b"<ids />")]
        results = [
            {"ids_file": name, "report": {"status": False, "specifications": []}, "html": b"<html>report</html>", "issues": [{"Reason": "Missing property"}], "passes": [{"Reason": "Met requirement"}]}
            for name, _ in ids_files
        ]
        results[1].pop("passes")  # Older saved projects have no passed-check file.
        data = workspace_store.create_project(ids_files, "building.ifc", b"ISO-10303-21;", results)
        with tempfile.TemporaryDirectory() as folder, patch.object(workspace_store, "STORE", Path(folder)):
            workspace_id = workspace_store.save_project(data)
            restored = workspace_store.load_project(workspace_id)
            self.assertEqual(restored["ids_files"], ids_files)
            self.assertEqual(restored["ifc_data"], b"ISO-10303-21;")
            self.assertEqual(restored["ifc_filename"], "building.ifc")
            self.assertEqual(restored["results"][1]["issues"][0]["Reason"], "Missing property")
            self.assertEqual(restored["results"][0]["passes"][0]["Reason"], "Met requirement")
            self.assertIsNone(restored["results"][1]["passes"])
            self.assertEqual(workspace_store.project_path(workspace_id).read_bytes(), data)

    def test_rejects_invalid_project_and_address(self):
        with self.assertRaises(ValueError):
            workspace_store.save_project(b"not a project")
        with self.assertRaises(ValueError):
            workspace_store.load_project("../outside")


if __name__ == "__main__":
    unittest.main()
