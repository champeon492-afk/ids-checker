import unittest

from validator import csv_bytes, issue_rows, parse_ids_preview


IDS_SAMPLE = b'''<?xml version="1.0" encoding="utf-8"?>
<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS">
  <ids:specifications>
    <ids:specification name="Wall fire rating" ifcVersion="IFC4">
      <ids:applicability minOccurs="1" maxOccurs="unbounded">
        <ids:entity><ids:name><ids:simpleValue>IFCWALL</ids:simpleValue></ids:name></ids:entity>
      </ids:applicability>
      <ids:requirements>
        <ids:property cardinality="required" dataType="IFCLABEL">
          <ids:propertySet><ids:simpleValue>Pset_WallCommon</ids:simpleValue></ids:propertySet>
          <ids:baseName><ids:simpleValue>FireRating</ids:simpleValue></ids:baseName>
        </ids:property>
      </ids:requirements>
    </ids:specification>
  </ids:specifications>
</ids:ids>'''


class ValidatorTests(unittest.TestCase):
    def test_preview_maps_target_to_requirement(self):
        rows = parse_ids_preview(IDS_SAMPLE)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["Specification"], "Wall fire rating")
        self.assertEqual(parse_ids_preview(IDS_SAMPLE, "walls.ids")[0]["IDS file"], "walls.ids")
        self.assertIn("IFCWALL", rows[0]["Target elements"])
        self.assertIn("Pset_WallCommon.FireRating", rows[0]["Requirement"])

    def test_rejects_entity_declarations(self):
        with self.assertRaises(ValueError):
            parse_ids_preview(b'<!DOCTYPE ids [<!ENTITY x "foo">]><ids/>')

    def test_missing_required_elements_is_an_issue(self):
        report = {"specifications": [{"name": "Walls", "status": False, "total_applicable": 0, "requirements": []}]}
        rows = issue_rows(report)
        self.assertEqual(len(rows), 1)
        self.assertIn("No matching", rows[0]["Reason"])
        self.assertIn(b"Specification", csv_bytes(rows))


if __name__ == "__main__":
    unittest.main()
