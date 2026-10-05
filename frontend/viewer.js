import * as OBC from "@thatopen/components";
import * as THREE from "three";

const token = encodeURIComponent(window.viewerToken);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const canvas = byId("canvas");
const failureList = byId("failure-list");
const failureSearch = byId("failure-search");
const classChart = byId("class-chart");
const moreFailures = byId("more-failures");
const inspector = byId("inspector");
const propertiesPanel = byId("properties-panel");
const browserPanel = byId("browser-panel");
const browserTree = byId("browser-tree");
const viewStorageKey = window.viewerWorkspaceId ? `ids-checker-view-${window.viewerWorkspaceId}` : "";
let issues = [];
let failureGroups = [];
let shownFailures = 80;
let model;
let world;
let fragments;
let selectedGuid = "";
let selectedClass = "";
let isolateSelected = false;
let visualRevision = 0;
let appliedRevision = 0;
let visualWork = null;
let pendingFrame = false;
let coloredIds = [];
let opaqueIds = [];
let ghostActive = false;
const guidLocalIds = new Map();
const classLocalIds = new Map();
let selectionVersion = 0;
let treeNodes = null;
let treeIndex = null;
let treeChildren = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
  status.title = message;
}

async function getJson(path, extra = "") {
  const response = await fetch(`${path}?token=${token}${extra}`);
  if (!response.ok) throw new Error(`Could not load ${path.slice(1)} from the IFC model.`);
  return response.json();
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}

function buildFailureGroups() {
  const groups = new Map();
  issues.forEach((issue, index) => {
    const key = issue.globalId || `requirement-${index}`;
    if (!groups.has(key)) groups.set(key, { key, ...issue, checks: [] });
    groups.get(key).checks.push(issue);
  });
  failureGroups = [...groups.values()];
  byId("failure-count").textContent = failureGroups.length.toLocaleString();
  renderChart();
  renderFailures();
}

function rememberView() {
  if (!viewStorageKey) return;
  try {
    sessionStorage.setItem(viewStorageKey, JSON.stringify({
      selectedGuid,
      selectedClass,
      isolateSelected,
      search: failureSearch.value,
    }));
  } catch (_) { /* Private browsing may disable session storage. */ }
}

function restoreView() {
  if (!viewStorageKey) return;
  try {
    const state = JSON.parse(sessionStorage.getItem(viewStorageKey) || "null");
    if (!state || typeof state !== "object") return;
    selectedClass = failureGroups.some((group) => group.ifcClass === state.selectedClass) ? state.selectedClass : "";
    selectedGuid = failureGroups.some((group) => group.globalId === state.selectedGuid) ? state.selectedGuid : "";
    isolateSelected = !!(selectedGuid && state.isolateSelected);
    failureSearch.value = typeof state.search === "string" ? state.search : "";
    renderChart();
    renderFailures();
    updateSelectionControls();
    if (selectedGuid) showProperties(selectedGuid, ++selectionVersion);
  } catch (_) { /* An invalid or unavailable saved view should not block the model. */ }
}

function renderChart() {
  const counts = new Map();
  for (const group of failureGroups) {
    if (!group.globalId || !group.ifcClass) continue;
    counts.set(group.ifcClass, (counts.get(group.ifcClass) || 0) + group.checks.length);
  }
  classChart.replaceChildren();
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!sorted.length) classChart.append(node("p", "empty-note", "No failed model elements to chart."));
  const maximum = sorted[0]?.[1] || 1;
  for (const [ifcClass, count] of sorted) {
    const button = node("button", "chart-bar");
    button.type = "button";
    button.setAttribute("aria-pressed", String(selectedClass === ifcClass));
    button.setAttribute("aria-label", `${ifcClass}: ${count} validation ${count === 1 ? "issue" : "issues"}. Select to filter and isolate this IFC class.`);
    const label = node("span", "chart-bar__label", ifcClass);
    const track = node("span", "chart-bar__track");
    const fill = node("span", "chart-bar__fill");
    fill.style.width = `${Math.max(7, count / maximum * 100)}%`;
    track.append(fill);
    button.append(label, track, node("strong", "chart-bar__count", String(count)));
    button.addEventListener("click", () => selectClass(ifcClass).catch((error) => setStatus(error.message, true)));
    classChart.append(button);
  }
}

function renderFailures() {
  const query = failureSearch.value.trim().toLocaleLowerCase();
  const filtered = failureGroups.filter((group) => (!selectedClass || group.ifcClass === selectedClass) && (!query || [group.element, group.ifcClass, group.globalId, group.specification, ...group.checks.map((check) => check.reason)].join(" ").toLocaleLowerCase().includes(query)));
  failureList.replaceChildren();
  if (!filtered.length) failureList.append(node("p", "empty-note", query ? "No failures match your search." : selectedClass ? "No failures in this IFC class." : "No failed elements were reported."));
  for (const group of filtered.slice(0, shownFailures)) {
    const item = node("div");
    item.setAttribute("role", "listitem");
    const button = node("button", "failure-card");
    button.type = "button";
    button.dataset.key = group.key;
    button.setAttribute("aria-current", group.globalId && group.globalId === selectedGuid ? "true" : "false");
    const top = node("span", "failure-card__top");
    top.append(node("span", "failure-card__name", group.element || group.specification || "Requirement without a model element"));
    top.append(node("span", "failure-card__badge", `${group.checks.length} ${group.checks.length === 1 ? "issue" : "issues"}`));
    button.append(top);
    button.append(node("span", "failure-card__class", group.ifcClass || "No matching IFC element"));
    button.append(node("span", "failure-card__reason", group.checks[0]?.reason || ""));
    if (group.globalId) button.append(node("span", "failure-card__guid", group.globalId));
    button.addEventListener("click", () => {
      if (group.globalId) selectGuid(group.globalId).catch((error) => setStatus(error.message, true));
      else showRequirementIssue(group);
    });
    item.append(button);
    failureList.append(item);
  }
  moreFailures.hidden = filtered.length <= shownFailures;
  moreFailures.textContent = `Show more (${Math.min(80, filtered.length - shownFailures).toLocaleString()} of ${(filtered.length - shownFailures).toLocaleString()} remaining)`;
}

function showInspector(tab) {
  inspector.hidden = false;
  const properties = tab === "properties";
  propertiesPanel.hidden = !properties;
  browserPanel.hidden = properties;
  byId("properties-tab").setAttribute("aria-pressed", String(properties));
  byId("browser-tab").setAttribute("aria-pressed", String(!properties));
  byId("show-properties").setAttribute("aria-pressed", String(properties));
  byId("show-browser").setAttribute("aria-pressed", String(!properties));
  if (!properties) loadBrowser().catch((error) => { browserTree.replaceChildren(node("p", "empty-note", error.message)); });
}

function clearProperties() {
  propertiesPanel.replaceChildren(node("p", "empty-note", "Select a failed element or choose one in the model browser to inspect its IFC properties."));
}

function showRequirementIssue(group) {
  selectionVersion += 1;
  selectedGuid = "";
  isolateSelected = false;
  renderFailures();
  updateSelectionControls();
  rememberView();
  refreshVisuals(false).catch((error) => setStatus(error.message, true));
  showInspector("properties");
  propertiesPanel.replaceChildren();
  propertiesPanel.append(node("h3", "", group.specification || "Validation requirement"));
  propertiesPanel.append(node("p", "subline", group.idsFile || "IDS file"));
  addIssueCallouts(propertiesPanel, group.checks);
  propertiesPanel.append(node("p", "empty-note", "This requirement has no matching IFC element to display in 3D."));
  setStatus("This failed requirement has no matching model element.");
}

function addIssueCallouts(target, checks) {
  for (const check of checks) {
    const callout = node("div", "issue-callout");
    callout.append(node("strong", "", check.requirement || "Failed requirement"));
    callout.append(node("div", "", check.reason || "Validation failed"));
    callout.append(node("small", "", `${check.idsFile || ""}${check.specification ? ` · ${check.specification}` : ""}`));
    target.append(callout);
  }
}

function valueText(value) {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function propertyGroup(title, values, open = false) {
  const group = node("details", "property-group");
  group.open = open;
  group.append(node("summary", "", title));
  const rows = node("dl", "property-rows");
  const entries = Object.entries(values || {});
  if (!entries.length) rows.append(node("p", "empty-note", "No values in this section."));
  for (const [key, value] of entries) {
    const row = node("div", "property-row");
    if (value && typeof value === "object") row.classList.add("property-row--nested");
    row.append(node("dt", "", key));
    row.append(node("dd", "", valueText(value)));
    rows.append(row);
  }
  group.append(rows);
  return group;
}

async function showProperties(guid, version) {
  showInspector("properties");
  propertiesPanel.replaceChildren(node("p", "empty-note", "Reading IFC attributes, property sets and quantities…"));
  try {
    const data = await getJson("/properties", `&guid=${encodeURIComponent(guid)}`);
    if (version !== selectionVersion) return;
    propertiesPanel.replaceChildren();
    propertiesPanel.append(node("h3", "", `${data.ifcClass} · ${data.name}`));
    propertiesPanel.append(node("p", "subline", data.globalId));
    addIssueCallouts(propertiesPanel, issues.filter((issue) => issue.globalId === guid));
    propertiesPanel.append(propertyGroup("IFC attributes", data.attributes, true));
    if (data.type) propertiesPanel.append(propertyGroup("Element type", data.type));
    for (const [name, values] of Object.entries(data.propertySets || {})) propertiesPanel.append(propertyGroup(name, values, true));
    for (const [name, values] of Object.entries(data.quantities || {})) propertiesPanel.append(propertyGroup(name, values, true));
  } catch (error) {
    if (version === selectionVersion) propertiesPanel.replaceChildren(node("p", "empty-note", error.message));
  }
}

async function frameBox(box) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  world.renderer.resize();
  world.camera.updateAspect();
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  const distance = radius * Math.max(1, 0.57 * canvas.clientHeight / Math.max(canvas.clientWidth, 1));
  await world.camera.controls.setLookAt(center.x + distance * 0.9, center.y + distance * 0.7, center.z + distance * 0.9, center.x, center.y, center.z, false);
}

function updateSelectionControls() {
  byId("isolate-selected").disabled = !selectedGuid;
  byId("isolate-selected").setAttribute("aria-pressed", String(isolateSelected && !!selectedGuid));
  byId("clear-selection").disabled = !selectedGuid && !selectedClass;
  byId("view-title").textContent = selectedGuid
    ? (failureGroups.find((group) => group.globalId === selectedGuid)?.element || "Selected element")
    : selectedClass ? `${selectedClass} failures` : "Building overview";
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function localIdForGuid(guid) {
  if (!guidLocalIds.has(guid)) guidLocalIds.set(guid, model.getLocalIdsByGuids([guid]).then(([id]) => id));
  return guidLocalIds.get(guid);
}

async function localIdsForClass(ifcClass) {
  if (!classLocalIds.has(ifcClass)) {
    const guids = failureGroups.filter((group) => group.ifcClass === ifcClass && group.globalId).map((group) => group.globalId);
    classLocalIds.set(ifcClass, model.getLocalIdsByGuids(guids).then((ids) => ids.filter((id) => id != null)));
  }
  return classLocalIds.get(ifcClass);
}

async function applyVisualState(revision, frame) {
  const guid = selectedGuid;
  const ifcClass = selectedClass;
  const isolate = isolateSelected;
  const classIds = ifcClass ? await localIdsForClass(ifcClass) : [];
  const id = guid ? await localIdForGuid(guid) : null;
  const elementIds = id == null ? [] : [id];
  const nextColored = elementIds.length ? elementIds : classIds;
  const nextOpaque = isolate && elementIds.length ? elementIds : classIds;
  const nextGhost = !!((isolate && elementIds.length) || (ifcClass && classIds.length));

  if (!sameIds(coloredIds, nextColored)) {
    if (coloredIds.length) await model.resetColor(coloredIds);
    if (nextColored.length) await model.setColor(nextColored, new THREE.Color("#baff16"));
    coloredIds = nextColored;
  }
  if (!nextGhost && ghostActive) {
    await model.resetOpacity(undefined);
  } else if (nextGhost) {
    if (!ghostActive) await model.setOpacity(undefined, 0.12);
    else if (!sameIds(opaqueIds, nextOpaque) && opaqueIds.length) await model.setOpacity(opaqueIds, 0.12);
    if (!ghostActive || !sameIds(opaqueIds, nextOpaque)) await model.resetOpacity(nextOpaque);
  }
  ghostActive = nextGhost;
  opaqueIds = nextGhost ? nextOpaque : [];

  if (frame && revision === visualRevision) {
    const frameIds = elementIds.length ? elementIds : classIds;
    if (frameIds.length) {
      const box = await model.getMergedBox(frameIds);
      if (!box.isEmpty()) await frameBox(box);
    } else if (!guid && !ifcClass) await frameBox(model.box);
  }
  fragments.core.update(true);
  if (revision !== visualRevision) return;
  if (guid && !elementIds.length) setStatus("This element has no viewable geometry. Its IFC properties are shown.");
  else if (guid && isolate) setStatus("Selected element is opaque; other elements are transparent.");
  else if (ifcClass) setStatus(`${ifcClass} failures are highlighted; other elements are transparent.`);
  else if (guid) setStatus("Selected element highlighted in lime. Building context remains visible.");
  else setStatus(`Whole building loaded · ${failureGroups.length.toLocaleString()} failed elements`);
}

function refreshVisuals(frame = true) {
  visualRevision += 1;
  pendingFrame ||= frame;
  if (!model) return Promise.resolve();
  if (!visualWork) {
    let failed = false;
    visualWork = (async () => {
      while (appliedRevision < visualRevision) {
        const revision = visualRevision;
        const shouldFrame = pendingFrame;
        pendingFrame = false;
        await applyVisualState(revision, shouldFrame);
        appliedRevision = revision;
      }
    })().catch((error) => {
      failed = true;
      throw error;
    }).finally(() => {
      visualWork = null;
      if (!failed && appliedRevision < visualRevision) refreshVisuals(false).catch((error) => setStatus(error.message, true));
    });
  }
  return visualWork;
}

async function selectClass(ifcClass) {
  selectedClass = selectedClass === ifcClass ? "" : ifcClass;
  selectedGuid = "";
  isolateSelected = false;
  selectionVersion += 1;
  clearProperties();
  shownFailures = 80;
  renderChart();
  renderFailures();
  updateSelectionControls();
  rememberView();
  if (!model) { setStatus("Loading model before showing the selected IFC class…"); return; }
  await refreshVisuals();
}

async function clearSelection() {
  selectedClass = "";
  selectedGuid = "";
  isolateSelected = false;
  selectionVersion += 1;
  clearProperties();
  renderChart();
  renderFailures();
  updateSelectionControls();
  rememberView();
  await refreshVisuals();
}

async function selectGuid(guid) {
  selectedGuid = guid;
  selectionVersion += 1;
  const version = selectionVersion;
  renderFailures();
  updateSelectionControls();
  rememberView();
  showProperties(guid, version);
  if (!model) {
    setStatus("Loading model before locating the selected element…");
    return;
  }
  await refreshVisuals();
}

function makeTreeNode(item, depth = 0) {
  const wrapper = node("div", "tree-node");
  const row = node("div", "tree-row");
  const children = treeChildren.get(item.globalId) || [];
  const toggle = node("button", "tree-toggle", children.length ? "▸" : "·");
  toggle.type = "button";
  toggle.disabled = !children.length;
  toggle.setAttribute("aria-label", `Expand ${item.name}`);
  const label = node("button", "tree-label");
  label.type = "button";
  label.title = `${item.ifcClass} · ${item.name} · ${item.globalId}`;
  label.append(node("span", "", item.name));
  label.append(node("small", "", item.ifcClass));
  label.addEventListener("click", () => selectGuid(item.globalId).catch((error) => setStatus(error.message, true)));
  row.append(toggle, label);
  wrapper.append(row);
  if (children.length) {
    const branch = node("div", "tree-children");
    branch.hidden = true;
    toggle.addEventListener("click", () => {
      if (!branch.childElementCount) for (const child of children) branch.append(makeTreeNode(child, depth + 1));
      branch.hidden = !branch.hidden;
      toggle.textContent = branch.hidden ? "▸" : "▾";
    });
    wrapper.append(branch);
    if (depth < 3) toggle.click();
  }
  return wrapper;
}

function renderBrowser() {
  if (!treeNodes) return;
  const query = byId("browser-search").value.trim().toLocaleLowerCase();
  browserTree.replaceChildren();
  if (query) {
    const found = treeNodes.filter((item) => `${item.name} ${item.ifcClass} ${item.globalId}`.toLocaleLowerCase().includes(query)).slice(0, 150);
    if (!found.length) browserTree.append(node("p", "empty-note", "No model elements match your search."));
    for (const item of found) {
      const row = node("button", "tree-label", `${item.ifcClass} · ${item.name}`);
      row.type = "button";
      row.title = item.globalId;
      row.addEventListener("click", () => selectGuid(item.globalId).catch((error) => setStatus(error.message, true)));
      browserTree.append(row);
    }
    return;
  }
  const roots = treeNodes.filter((item) => !item.parentId || !treeIndex.has(item.parentId));
  for (const item of roots) browserTree.append(makeTreeNode(item));
}

async function loadBrowser() {
  if (treeNodes) return;
  browserTree.replaceChildren(node("p", "empty-note", "Reading model hierarchy…"));
  treeNodes = await getJson("/browser");
  treeIndex = new Map(treeNodes.map((item) => [item.globalId, item]));
  treeChildren = new Map();
  for (const item of treeNodes) {
    if (!item.parentId) continue;
    if (!treeChildren.has(item.parentId)) treeChildren.set(item.parentId, []);
    treeChildren.get(item.parentId).push(item);
  }
  for (const children of treeChildren.values()) children.sort((a, b) => a.ifcClass.localeCompare(b.ifcClass) || a.name.localeCompare(b.name));
  renderBrowser();
}

function wireControls() {
  failureSearch.addEventListener("input", () => { shownFailures = 80; renderFailures(); rememberView(); });
  moreFailures.addEventListener("click", () => { shownFailures += 80; renderFailures(); });
  byId("isolate-selected").addEventListener("click", () => {
    if (!selectedGuid) return;
    isolateSelected = !isolateSelected;
    updateSelectionControls();
    rememberView();
    refreshVisuals(false).catch((error) => setStatus(error.message, true));
  });
  byId("clear-selection").addEventListener("click", () => clearSelection().catch((error) => setStatus(error.message, true)));
  byId("reset-view").addEventListener("click", () => frameBox(model.box));
  byId("show-properties").addEventListener("click", () => showInspector("properties"));
  byId("show-browser").addEventListener("click", () => showInspector("browser"));
  byId("properties-tab").addEventListener("click", () => showInspector("properties"));
  byId("browser-tab").addEventListener("click", () => showInspector("browser"));
  byId("close-inspector").addEventListener("click", () => { inspector.hidden = true; byId("show-properties").setAttribute("aria-pressed", "false"); byId("show-browser").setAttribute("aria-pressed", "false"); });
  byId("browser-search").addEventListener("input", renderBrowser);
}

async function start() {
  wireControls();
  setStatus("Preparing IFC model…");
  issues = await getJson("/issues");
  buildFailureGroups();
  restoreView();
  const response = await fetch(`/model?token=${token}`);
  if (!response.ok) throw new Error("The IFC model could not be retrieved from the local viewer service.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  world = worlds.create();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = new THREE.Color("#8c978d");
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
  await loader.setup({ autoSetWasm: false, wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true } });
  setStatus("Converting IFC geometry for viewing…");
  model = await loader.load(bytes, false, "uploaded-building");
  await frameBox(model.box);
  fragments.core.update(true);
  byId("reset-view").disabled = false;
  updateSelectionControls();
  setStatus(`Whole building loaded · ${failureGroups.length.toLocaleString()} failed elements`);
  if (selectedGuid || selectedClass) refreshVisuals().catch((error) => setStatus(error.message, true));
}

start().catch((error) => { console.error(error); setStatus(`Viewer could not load: ${error.message}`, true); });
