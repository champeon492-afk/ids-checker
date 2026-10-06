import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import workspace_store


class WorkspaceStoreTests(unittest.TestCase):
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
