import unittest

import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root

from validator import csv_bytes, issue_rows, parse_ids_preview, run_validations


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

    def test_property_failures_identify_missing_set_property_and_value(self):
        model = ifcopenshell.api.project.create_file()
        wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWall", name="Wall")
        requirement = {
            "facet_type": "Property",
            "label": "Pset_WallCommon.FireRating",
            "metadata": {"propertySet": {"simpleValue": "Pset_WallCommon"}, "baseName": {"simpleValue": "FireRating"}},
            "failed_entities": [{"global_id": wall.GlobalId, "class": "IfcWall", "name": "Wall", "reason": "The required property set does not exist"}],
        }
        report = {"specifications": [{"name": "Wall checks", "requirements": [requirement]}]}
        self.assertIn("Missing property set Pset_WallCommon", issue_rows(report, model=model)[0]["Reason"])

        pset = ifcopenshell.api.pset.add_pset(model, product=wall, name="Pset_WallCommon")
        requirement["failed_entities"][0]["reason"] = "The property set does not contain the required property"
        self.assertIn("Missing required property FireRating", issue_rows(report, model=model)[0]["Reason"])

        property_entity = model.createIfcPropertySingleValue(Name="FireRating", NominalValue=None)
        pset.HasProperties = [property_entity]
        self.assertIn("exists but has no value", issue_rows(report, model=model)[0]["Reason"])

    def test_passed_element_explains_actual_ifc_value_and_ids_rule(self):
        model = ifcopenshell.api.project.create_file()
        ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name="Project")
        wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWall", name="Passing wall")
        pset = ifcopenshell.api.pset.add_pset(model, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(model, pset=pset, properties={"FireRating": "2h"})
        valid_ids = IDS_SAMPLE.replace(b"<ids:specifications>", b"<ids:info><ids:title>Test</ids:title></ids:info><ids:specifications>")
        result = run_validations([("walls.ids", valid_ids)], model.to_string().encode())[0]
        self.assertEqual(result["issues"], [])
        self.assertEqual(len(result["passes"]), 1)
        self.assertEqual(result["passes"][0]["GlobalId"], wall.GlobalId)
        self.assertIn("Pset_WallCommon.FireRating = 2h", result["passes"][0]["Reason"])
        self.assertIn("FireRating data shall be provided", result["passes"][0]["Reason"])


if __name__ == "__main__":
    unittest.main()
