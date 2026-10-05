import * as OBC from "@thatopen/components";
import * as THREE from "three";

const status = document.getElementById("status");
const canvas = document.getElementById("canvas");
const issueSelect = document.getElementById("issue-select");
const issueDetails = document.getElementById("issue-details");
const resetButton = document.getElementById("reset-view");
let issues = [];
let model;
let world;
let fragments;
let previousIds = [];

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function frameBox(box) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length(), 1);
  await world.camera.controls.setLookAt(
    center.x + radius * 0.9,
    center.y + radius * 0.7,
    center.z + radius * 0.9,
    center.x,
    center.y,
    center.z,
    true,
  );
}

async function focusIssue(index) {
  if (previousIds.length) {
    await model.resetColor(previousIds);
    previousIds = [];
  }
  const issue = issues[index];
  if (!issue) {
    issueDetails.textContent = "Choose a failed element to locate it in the building.";
    await frameBox(model.box);
    fragments.core.update(true);
    return;
  }
  issueDetails.textContent = `${issue.ifcClass} · ${issue.element || "Unnamed element"}\n${issue.requirement}\n${issue.reason}`;
  const [localId] = await model.getLocalIdsByGuids([issue.globalId]);
  if (localId == null) {
    setStatus("This issue has no viewable geometry. The rest of the building remains visible.");
    return;
  }
  previousIds = [localId];
  await model.setColor(previousIds, new THREE.Color("#f05a43"));
  const box = await model.getMergedBox(previousIds);
  if (!box.isEmpty()) await frameBox(box);
  fragments.core.update(true);
  setStatus("Showing the complete building. Selected issue element is orange.");
}

async function start() {
  setStatus("Preparing the whole-building viewer…");
  const token = encodeURIComponent(window.viewerToken);
  const issueResponse = await fetch(`/issues?token=${token}`);
  const modelResponse = await fetch(`/model?token=${token}`);
  if (!issueResponse.ok || !modelResponse.ok) throw new Error("The model could not be retrieved from the local viewer service.");
  issues = await issueResponse.json();
  const bytes = new Uint8Array(await modelResponse.arrayBuffer());
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  world = worlds.create();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = new THREE.Color("#eef3f7");
  world.renderer = new OBC.SimpleRenderer(components, canvas);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  components.init();

  fragments = components.get(OBC.FragmentsManager);
  const workerUrl = await OBC.FragmentsManager.getWorker();
  fragments.init(workerUrl);
  world.camera.controls.addEventListener("update", () => fragments.core.update());
  fragments.list.onItemSet.add(({ value }) => {
    value.useCamera(world.camera.three);
    world.scene.three.add(value.object);
    fragments.core.update(true);
  });

  const loader = components.get(OBC.IfcLoader);
  await loader.setup({
    autoSetWasm: false,
    wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
  });
  setStatus("Converting IFC geometry for viewing… this can take a while for a large building.");
  model = await loader.load(bytes, false, "uploaded-building");
  await frameBox(model.box);
  fragments.core.update(true);

  const unique = new Set();
  issues.forEach((issue, index) => {
    if (!issue.globalId || unique.has(issue.globalId)) return;
    unique.add(issue.globalId);
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${issue.ifcClass} · ${issue.element || issue.globalId} · ${issue.globalId}`;
    issueSelect.append(option);
  });
  issueSelect.disabled = false;
  issueSelect.addEventListener("change", () => {
    focusIssue(issueSelect.value === "" ? -1 : Number(issueSelect.value)).catch((error) => setStatus(error.message, true));
  });
  resetButton.disabled = false;
  resetButton.addEventListener("click", () => frameBox(model.box));
  setStatus(`Whole building loaded. ${unique.size.toLocaleString()} failed elements can be located below.`);
}

start().catch((error) => {
  console.error(error);
  setStatus(`Viewer could not load: ${error.message}`, true);
});
