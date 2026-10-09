import assert from "node:assert/strict";
import test from "node:test";
import { classifyMmi, defaultMmiSource } from "./mmi.js";

test("classifies defined levels and rejects unknown values", () => {
  const row = { propertySets: ["NONS_Process"], statusSources: { NONS_Process: "MMI 350" } };
  assert.equal(classifyMmi(row, "NONS_Process").key, "350");
  row.statusSources.NONS_Process = "Review";
  assert.equal(classifyMmi(row, "NONS_Process").key, "invalid");
});

test("distinguishes missing set, property and blank value", () => {
  assert.equal(classifyMmi({ propertySets: [], statusSources: {} }, "NONS_Process").reason, "Property set missing");
  assert.equal(classifyMmi({ propertySets: ["NONS_Process"], statusSources: {} }, "NONS_Process").reason, "ProcessStatus property missing");
  assert.equal(classifyMmi({ propertySets: ["NONS_Process"], statusSources: { NONS_Process: "" } }, "NONS_Process").reason, "ProcessStatus value blank");
});

test("uses NONS_Process when available and can choose another model source", () => {
  assert.equal(defaultMmiSource([{ statusSources: { Other: "200" } }, { statusSources: { NONS_Process: "300" } }]), "NONS_Process");
  assert.equal(defaultMmiSource([{ statusSources: { Project_MMI: "400" } }]), "Project_MMI");
});
