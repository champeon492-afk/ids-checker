import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const token = encodeURIComponent(window.viewerToken);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const canvas = byId("canvas");
const failureList = byId("failure-list");
const failureSearch = byId("failure-search");
const passList = byId("pass-list");
const passSearch = byId("pass-search");
const classChart = byId("class-chart");
const selectedIssues = byId("selected-issues");
const moreFailures = byId("more-failures");
const morePasses = byId("more-passes");
const inspector = byId("inspector");
const propertiesPanel = byId("properties-panel");
const relationshipPanel = byId("relationship-panel");
const relationshipGraph = byId("relationship-graph");
const relationshipColumns = byId("relationship-columns");
const relationshipLines = byId("relationship-lines");
const relationshipSearchResults = byId("relationship-search-results");
const viewStorageKey = window.viewerWorkspaceId ? `ids-checker-view-${window.viewerWorkspaceId}` : "";
let issues = [];
let passes = [];
let failureGroups = [];
let passGroups = [];
let passedElementGroups = [];
let shownFailures = 80;
let shownPasses = 80;
let activeResults = "failed";
let model;
let checks = [];
const modelById = new Map();
const modelVisible = new Map();
let activeCheckId = "";
let modelsOpen = false;
let softStyle = true;
let sceneLights = [];
let outlineOverlay;
let outlineRevision = 0;
let composer;
let scenePass;
let silhouettePass;
let walkMode = false;
let walkLocked = false;
let walkFocused = false;
let walkDragging = false;
let walkPointerLockDenied = false;
let walkKeys = new Set();
let walkFrame = 0;
let walkLastTime = 0;
let walkVerticalSpeed = 0;
let walkGrounded = false;
let walkYaw = 0;
let walkPitch = 0;
let walkProbeCamera;
const otherGhosted = new Set();
let world;
let fragments;
let selectedGuid = "";
let selectedClass = "";
let selectedRelationshipGroup = null;
let isolateSelected = false;
let pickEnabled = true;
let selectedName = "";
let selectedRequirementGroup = null;
let pointerStart = null;
let pickRevision = 0;
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
let browserOpen = false;
const relationshipSelection = ["", "", "", "", "", ""];
const relationshipPage = [0, 0, 0, 0, 0, 0];
let relationshipCacheScope = null;
let relationshipCacheElements = null;

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
  byId("failure-count").textContent = failedElementCount().toLocaleString();
  renderChart();
  renderFailures();
}

function failedElementCount() {
  return failureGroups.filter((group) => group.globalId).length;
}

function buildPassGroups() {
  const groups = new Map();
  for (const check of passes) {
    if (!check.globalId) continue;
    if (!groups.has(check.globalId)) groups.set(check.globalId, { key: check.globalId, ...check, checks: [] });
    groups.get(check.globalId).checks.push(check);
  }
  passGroups = [...groups.values()];
  const failed = new Map(failureGroups.filter((group) => group.globalId).map((group) => [group.globalId, group.checks.length]));
  passedElementGroups = passGroups.map((group) => ({ ...group, failedChecks: failed.get(group.globalId) || 0 }));
  byId("pass-count").textContent = passedElementGroups.length.toLocaleString();
  renderPasses();
}

function setResultsPanel(panel) {
  activeResults = panel === "passed" ? "passed" : "failed";
  byId("failed-pane").hidden = activeResults !== "failed";
  byId("passed-pane").hidden = activeResults !== "passed";
  byId("show-failures").setAttribute("aria-selected", String(activeResults === "failed"));
  byId("show-passes").setAttribute("aria-selected", String(activeResults === "passed"));
  rememberView();
}

function rememberView() {
  if (!viewStorageKey) return;
  try {
    sessionStorage.setItem(viewStorageKey, JSON.stringify({
      activeCheckId,
      modelVisible: Object.fromEntries(modelVisible),
      softStyle,
      selectedGuid,
      selectedClass,
      relationshipGroup: selectedRelationshipGroup ? { stage: selectedRelationshipGroup.stage, key: selectedRelationshipGroup.key, label: selectedRelationshipGroup.label, path: relationshipSelection.slice(0, 4) } : null,
      isolateSelected,
      pickEnabled,
      browserOpen,
      search: failureSearch.value,
      passSearch: passSearch.value,
      activeResults,
    }));
  } catch (_) { /* Private browsing may disable session storage. */ }
}

function restoreView(savedState = null) {
  if (!viewStorageKey) return;
  try {
    const state = savedState || JSON.parse(sessionStorage.getItem(viewStorageKey) || "null");
    if (!state || typeof state !== "object") return;
    softStyle = state.softStyle !== false;
    for (const [id, visible] of Object.entries(state.modelVisible || {})) if (modelById.has(id)) modelVisible.set(id, visible !== false);
    applyModelVisibility();
    applyStyle();
    selectedClass = failureGroups.some((group) => group.ifcClass === state.selectedClass) ? state.selectedClass : "";
    selectedGuid = typeof state.selectedGuid === "string" && state.selectedGuid.length <= 64 ? state.selectedGuid : "";
    const savedGroup = state.relationshipGroup;
    if (!selectedGuid && savedGroup && Number.isInteger(savedGroup.stage) && savedGroup.stage >= 0 && savedGroup.stage < 5 && typeof savedGroup.key === "string" && savedGroup.key.length <= 64) {
      selectedRelationshipGroup = { stage: savedGroup.stage, key: savedGroup.key, label: String(savedGroup.label || "Selected group").slice(0, 120), guids: [] };
      if (Array.isArray(savedGroup.path)) for (let stage = 0; stage < 4; stage += 1) relationshipSelection[stage] = typeof savedGroup.path[stage] === "string" ? savedGroup.path[stage].slice(0, 64) : "";
      relationshipSelection[savedGroup.stage] = savedGroup.key;
      selectedClass = "";
    }
    selectedName = failureGroups.find((group) => group.globalId === selectedGuid)?.element || "";
    isolateSelected = !!((selectedGuid || selectedClass || selectedRelationshipGroup) && state.isolateSelected);
    pickEnabled = state.pickEnabled !== false;
    updatePickControl();
    failureSearch.value = typeof state.search === "string" ? state.search : "";
    passSearch.value = typeof state.passSearch === "string" ? state.passSearch : "";
    setResultsPanel(state.activeResults);
    renderChart();
    renderFailures();
    renderPasses();
    renderSelectedIssues();
    updateSelectionControls();
    if (selectedGuid) showProperties(selectedGuid, ++selectionVersion);
    if (state.browserOpen) setBrowserOpen(true);
    else if (selectedRelationshipGroup) loadRelationshipBrowser().catch((error) => setStatus(error.message, true));
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

function renderSelectedIssues() {
  const failure = selectedRequirementGroup || failureGroups.find((item) => item.globalId && item.globalId === selectedGuid);
  const passed = passGroups.find((item) => item.globalId === selectedGuid);
  if (!selectedGuid && !failure) {
    selectedIssues.hidden = true;
    selectedIssues.replaceChildren();
    return;
  }
  selectedIssues.hidden = false;
  selectedIssues.replaceChildren();
  selectedIssues.append(node("span", "ot-eyebrow", failure?.globalId || selectedGuid ? "Selected model element" : "Validation requirement"));
  selectedIssues.append(node("h3", "", selectedName || failure?.element || passed?.element || failure?.specification || "Selected element"));
  const counts = [];
  if (failure?.checks.length) counts.push(`${failure.checks.length} ${failure.checks.length === 1 ? "issue" : "issues"}`);
  if (passed?.checks.length) counts.push(`${passed.checks.length} passed ${passed.checks.length === 1 ? "check" : "checks"}`);
  selectedIssues.append(node("p", "selected-issues__meta", counts.length
    ? `${counts.join(" · ")} · ${failure?.ifcClass || passed?.ifcClass || "IDS requirement"}`
    : `No IDS checks recorded${selectedGuid ? ` · ${selectedGuid}` : ""}`));
  if (failure?.checks.length) {
    const list = node("div", "selected-issues__list");
    addIssueCallouts(list, failure.checks);
    selectedIssues.append(list);
  }
  if (passed?.checks.length) {
    const list = node("div", "selected-issues__list");
    addPassCallouts(list, passed.checks);
    selectedIssues.append(list);
  }
  if (!counts.length) selectedIssues.append(node("p", "selected-issues__empty", "This element has no recorded IDS checks. Its IFC properties are available in the viewer."));
}

function updatePickControl() {
  byId("pick-element").setAttribute("aria-pressed", String(pickEnabled));
  byId("viewport-hint").textContent = pickEnabled
    ? "Click an element to inspect · Drag to orbit · Scroll to zoom"
    : "Drag to orbit · Scroll to zoom";
  canvas.classList.toggle("picking-enabled", pickEnabled);
}

function renderFailures() {
  const query = failureSearch.value.trim().toLocaleLowerCase();
  const filtered = failureGroups.filter((group) => (!selectedClass || group.ifcClass === selectedClass) && (!query || [group.element, group.ifcClass, group.globalId, group.specification, ...group.checks.map((check) => check.reason)].join(" ").toLocaleLowerCase().includes(query)));
  const selectedIndex = filtered.findIndex((group) => group.globalId && group.globalId === selectedGuid);
  const displayed = filtered.slice(0, shownFailures);
  if (selectedIndex >= shownFailures) displayed.unshift(filtered[selectedIndex]);
  failureList.replaceChildren();
  if (!filtered.length) failureList.append(node("p", "empty-note", query ? "No failures match your search." : selectedClass ? "No failures in this IFC class." : "No failed elements were reported."));
  for (const group of displayed) {
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

function renderPasses() {
  const query = passSearch.value.trim().toLocaleLowerCase();
  const filtered = passedElementGroups.filter((group) => !query || [group.element, group.ifcClass, group.globalId, ...group.checks.map((check) => `${check.requirement} ${check.reason} ${check.idsFile}`)].join(" ").toLocaleLowerCase().includes(query));
  const selectedIndex = filtered.findIndex((group) => group.globalId === selectedGuid);
  const displayed = filtered.slice(0, shownPasses);
  if (selectedIndex >= shownPasses) displayed.unshift(filtered[selectedIndex]);
  passList.replaceChildren();
  if (!filtered.length) passList.append(node("p", "empty-note", query ? "No passed elements match your search." : "No passed element-level checks were reported."));
  for (const group of displayed) {
    const item = node("div");
    item.setAttribute("role", "listitem");
    const button = node("button", "failure-card pass-card");
    button.type = "button";
    button.setAttribute("aria-current", String(group.globalId === selectedGuid));
    const top = node("span", "failure-card__top");
    top.append(node("span", "failure-card__name", group.element || "Unnamed element"));
    top.append(node("span", "failure-card__badge", `${group.checks.length} ${group.checks.length === 1 ? "check" : "checks"}`));
    button.append(top);
    button.append(node("span", "failure-card__class", group.ifcClass));
    button.append(node("span", "failure-card__reason", group.checks[0]?.reason || ""));
    if (group.failedChecks) button.append(node("span", "pass-card__caution", `Also has ${group.failedChecks} failed ${group.failedChecks === 1 ? "check" : "checks"}`));
    button.append(node("span", "failure-card__guid", group.globalId));
    button.addEventListener("click", () => selectGuid(group.globalId, { panel: "passed" }).catch((error) => setStatus(error.message, true)));
    item.append(button);
    passList.append(item);
  }
  morePasses.hidden = filtered.length <= shownPasses;
  morePasses.textContent = `Show more (${Math.min(80, filtered.length - shownPasses).toLocaleString()} of ${(filtered.length - shownPasses).toLocaleString()} remaining)`;
}

function showInspector() {
  inspector.hidden = false;
  byId("show-properties").setAttribute("aria-pressed", "true");
}

function clearProperties() {
  propertiesPanel.replaceChildren(node("p", "empty-note", "Select a failed element or choose one in the model browser to inspect its IFC properties."));
}

function showRequirementIssue(group) {
  selectionVersion += 1;
  selectedGuid = "";
  selectedRelationshipGroup = null;
  selectedName = "";
  selectedRequirementGroup = group;
  isolateSelected = false;
  renderFailures();
  renderSelectedIssues();
  if (browserOpen) renderRelationships();
  updateSelectionControls();
  rememberView();
  refreshVisuals(false).catch((error) => setStatus(error.message, true));
  clearProperties();
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

function addPassCallouts(target, checks) {
  for (const check of checks) {
    const callout = node("div", "issue-callout pass-callout");
    callout.append(node("strong", "", check.requirement || "Passed requirement"));
    callout.append(node("div", "", check.reason || "Requirement met"));
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
    const data = await getJson("/properties", `&check=${encodeURIComponent(activeCheckId)}&guid=${encodeURIComponent(guid)}`);
    if (version !== selectionVersion) return;
    propertiesPanel.replaceChildren();
    propertiesPanel.append(node("h3", "", `${data.ifcClass} · ${data.name}`));
    propertiesPanel.append(node("p", "subline", data.globalId));
    selectedName = data.name || selectedName;
    renderSelectedIssues();
    updateSelectionControls();
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
  const hasSelection = !!(selectedGuid || selectedClass || selectedRelationshipGroup);
  byId("isolate-selected").disabled = !hasSelection;
  byId("isolate-selected").setAttribute("aria-pressed", String(isolateSelected && hasSelection));
  byId("clear-selection").disabled = !selectedGuid && !selectedClass && !selectedRequirementGroup && !selectedRelationshipGroup;
  byId("view-title").textContent = selectedGuid
    ? (selectedName || failureGroups.find((group) => group.globalId === selectedGuid)?.element || passGroups.find((group) => group.globalId === selectedGuid)?.element || "Selected element")
    : selectedRelationshipGroup ? `${selectedRelationshipGroup.label} · ${selectedRelationshipGroup.guids.length.toLocaleString()} elements`
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

async function localIdsForRelationshipGroup(group) {
  if (!group.idsPromise) group.idsPromise = model.getLocalIdsByGuids(group.guids).then((ids) => ids.filter((id) => id != null));
  return group.idsPromise;
}

async function applyVisualState(revision, frame) {
  const guid = selectedGuid;
  const ifcClass = selectedClass;
  const relationshipGroup = selectedRelationshipGroup;
  const isolate = isolateSelected;
  const classIds = ifcClass ? await localIdsForClass(ifcClass) : [];
  const groupIds = relationshipGroup?.guids.length ? await localIdsForRelationshipGroup(relationshipGroup) : [];
  const id = guid ? await localIdForGuid(guid) : null;
  const elementIds = id == null ? [] : [id];
  if (revision !== visualRevision) return;
  const nextColored = elementIds.length ? elementIds : groupIds.length ? groupIds : classIds;
  const nextOpaque = isolate ? nextColored : [];
  const nextGhost = !!(isolate && nextOpaque.length);

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
    const frameIds = elementIds.length ? elementIds : groupIds.length ? groupIds : classIds;
    if (frameIds.length) {
      const box = relationshipGroup?.stage === 0 && groupIds.length === frameIds.length ? model.box : await model.getMergedBox(frameIds);
      if (!box.isEmpty()) await frameBox(box);
    } else if (!guid && !ifcClass) await frameBox(federationBox());
  }
  await applyOtherModelGhosts(nextGhost);
  await updateOutline(guid && elementIds.length ? elementIds[0] : null);
  fragments.core.update(true);
  if (revision !== visualRevision) return;
  if (modelVisible.get(activeCheckId) === false) setStatus("This IFC is hidden. Turn it on in Models to see the selection.");
  else if (guid && !elementIds.length) setStatus("This element has no viewable geometry. Its IFC properties are shown.");
  else if (relationshipGroup && !groupIds.length) setStatus(`${relationshipGroup.label} contains no viewable model elements.`);
  else if (relationshipGroup) setStatus(`${groupIds.length.toLocaleString()} elements in ${relationshipGroup.label} highlighted${isolate ? "; other elements are transparent" : ""}.`);
  else if (guid && !failureGroups.some((group) => group.globalId === guid) && passGroups.some((group) => group.globalId === guid)) setStatus("Selected element passed its recorded IDS checks.");
  else if (guid && !failureGroups.some((group) => group.globalId === guid)) setStatus("Selected element has no recorded IDS checks.");
  else if (guid && isolate) setStatus("Selected element is opaque; other elements are transparent.");
  else if (ifcClass) setStatus(`${ifcClass} failures are highlighted${isolate ? "; other elements are transparent" : ""}.`);
  else if (guid) setStatus("Selected element highlighted in lime. Building context remains visible.");
  else setStatus(`Whole building loaded · ${failedElementCount().toLocaleString()} failed elements`);
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
  const hadSelection = !!(selectedGuid || selectedClass || selectedRelationshipGroup);
  selectedClass = selectedClass === ifcClass ? "" : ifcClass;
  selectedRelationshipGroup = null;
  selectedGuid = "";
  selectedName = "";
  selectedRequirementGroup = null;
  isolateSelected = selectedClass ? (hadSelection ? isolateSelected : true) : false;
  selectionVersion += 1;
  clearProperties();
  shownFailures = 80;
  renderChart();
  renderFailures();
  renderSelectedIssues();
  if (browserOpen) renderRelationships();
  updateSelectionControls();
  rememberView();
  if (!model) { setStatus("Loading model before showing the selected IFC class…"); return; }
  await refreshVisuals();
}

async function clearSelection() {
  selectedClass = "";
  selectedRelationshipGroup = null;
  selectedGuid = "";
  selectedName = "";
  selectedRequirementGroup = null;
  isolateSelected = false;
  selectionVersion += 1;
  clearProperties();
  renderChart();
  renderFailures();
  renderSelectedIssues();
  if (browserOpen) renderRelationships();
  updateSelectionControls();
  rememberView();
  await refreshVisuals();
}

async function selectGuid(guid, options = {}) {
  const { fromModel = false, frame = true, panel = null } = options;
  const group = failureGroups.find((item) => item.globalId && item.globalId === guid);
  const passed = passGroups.find((item) => item.globalId === guid);
  if (fromModel && group && failureSearch.value) failureSearch.value = "";
  if (group && selectedClass && selectedClass !== group.ifcClass) {
    selectedClass = "";
    renderChart();
  }
  selectedGuid = guid;
  selectedRelationshipGroup = null;
  selectedName = group?.element || passed?.element || "";
  selectedRequirementGroup = null;
  if (treeIndex) syncRelationshipToGuid(guid);
  selectionVersion += 1;
  const version = selectionVersion;
  renderFailures();
  renderPasses();
  renderSelectedIssues();
  if (panel) setResultsPanel(panel);
  else if (fromModel || (activeResults === "failed" && passed && !group) || (activeResults === "passed" && group && !passed)) setResultsPanel(group ? "failed" : passed ? "passed" : "failed");
  updateSelectionControls();
  rememberView();
  showProperties(guid, version);
  if (fromModel && group) failureList.querySelector('.failure-card[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  if (fromModel && passed && !group) passList.querySelector('.pass-card[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  if (!model) {
    setStatus("Loading model before locating the selected element…");
    return;
  }
  await refreshVisuals(frame);
}

async function pickElement(event, renderCanvas) {
  if (!model || !pickEnabled) return;
  const revision = ++pickRevision;
  const data = { camera: world.camera.three, mouse: new THREE.Vector2(event.clientX, event.clientY), dom: renderCanvas };
  let hit;
  if (selectedClass || selectedRelationshipGroup) {
    const allowed = new Set(selectedRelationshipGroup ? await localIdsForRelationshipGroup(selectedRelationshipGroup) : await localIdsForClass(selectedClass));
    const hits = await model.raycastAll(data);
    hit = hits?.find((item) => allowed.has(item.localId));
  } else {
    const hits = await Promise.all([...modelById].filter(([id]) => modelVisible.get(id) !== false).map(async ([id, candidate]) => ({ id, candidate, hit: await candidate.raycast(data) })));
    const nearest = hits.filter((entry) => entry.hit).sort((a, b) => world.camera.three.position.distanceTo(a.hit.point) - world.camera.three.position.distanceTo(b.hit.point))[0];
    if (nearest && nearest.id !== activeCheckId) await activateCheck(nearest.id);
    hit = nearest?.hit;
  }
  if (revision !== pickRevision) return;
  if (!hit) {
    setStatus(selectedRelationshipGroup ? `Click a highlighted element in ${selectedRelationshipGroup.label} to inspect it.` : selectedClass ? `Click a highlighted ${selectedClass} element to inspect it.` : "No model element was found at that point.");
    return;
  }
  const [guid] = await model.getGuidsByLocalIds([hit.localId]);
  if (revision !== pickRevision) return;
  if (!guid) { setStatus("This model element has no IFC GlobalId to inspect."); return; }
  await selectGuid(guid, { fromModel: true, frame: false });
}

function wireModelPicking() {
  const renderCanvas = canvas.querySelector("canvas");
  if (!renderCanvas) return;
  renderCanvas.tabIndex = 0;
  renderCanvas.addEventListener("blur", () => { if (!walkLocked) { walkFocused = false; walkKeys.clear(); } });
  renderCanvas.addEventListener("click", () => {
    if (!walkMode) return;
    walkFocused = true;
    renderCanvas.focus();
    const useDragLook = () => {
      walkPointerLockDenied = true;
      byId("walk-hint").textContent = "Drag to look · WASD move · Space jump · Full viewer supports free mouse look in compatible browsers";
      setStatus("Walk mode is active. Drag to look; full mouse look is available in browsers that support pointer lock.");
    };
    if (!walkLocked && !walkPointerLockDenied) {
      if (typeof renderCanvas.requestPointerLock === "function") renderCanvas.requestPointerLock().catch(useDragLook);
      else useDragLook();
    }
  });
  renderCanvas.addEventListener("pointerdown", (event) => {
    if (walkMode) {
      walkDragging = event.button === 0;
      if (walkDragging) renderCanvas.setPointerCapture(event.pointerId);
      return;
    }
    pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
  }, true);
  renderCanvas.addEventListener("pointerup", (event) => {
    if (walkMode) { walkDragging = false; return; }
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (moved > 5) return;
    pickElement(event, renderCanvas).catch((error) => setStatus(`Could not select model element: ${error.message}`, true));
  }, true);
  renderCanvas.addEventListener("pointercancel", () => { pointerStart = null; walkDragging = false; }, true);
  renderCanvas.addEventListener("pointermove", (event) => {
    if (!walkMode || walkLocked || !walkDragging) return;
    walkYaw -= event.movementX * 0.0022;
    walkPitch = THREE.MathUtils.clamp(walkPitch - event.movementY * 0.0022, -1.48, 1.48);
    updateWalkCamera();
  });
}

const WALK_EYE_HEIGHT = 1.65;
const WALK_RADIUS = 0.28;
const WALK_STEP_HEIGHT = 0.32;
const WALK_SPEED = 3.2;
const WALK_GRAVITY = 9.81;
const WALK_JUMP_SPEED = 4.5;
const WALK_DOWN = new THREE.Vector3(0, -1, 0);
const WALK_FORWARD = new THREE.Vector3();

async function walkRay(origin, direction, maxDistance, predicate = () => true) {
  const renderCanvas = canvas.querySelector("canvas");
  if (!renderCanvas) return null;
  const rect = renderCanvas.getBoundingClientRect();
  walkProbeCamera.position.copy(origin);
  walkProbeCamera.quaternion.setFromUnitVectors(WALK_FORWARD.set(0, 0, -1), direction);
  walkProbeCamera.far = Math.max(maxDistance + 1, 2);
  walkProbeCamera.updateProjectionMatrix();
  const data = { camera: walkProbeCamera, mouse: new THREE.Vector2(rect.left + rect.width / 2, rect.top + rect.height / 2), dom: renderCanvas };
  let nearest = null;
  for (const [checkId, candidate] of modelById) {
    if (modelVisible.get(checkId) === false) continue;
    const hits = await candidate.raycastAll(data);
    for (const hit of hits || []) {
      const distance = origin.distanceTo(hit.point);
      if (distance > 0.025 && distance <= maxDistance && (!nearest || distance < nearest.distance) && predicate(hit)) nearest = { ...hit, distance };
    }
  }
  return nearest;
}

function updateWalkCamera() {
  const camera = world.camera.three;
  camera.rotation.order = "YXZ";
  camera.rotation.set(walkPitch, walkYaw, 0);
  camera.updateMatrixWorld();
  fragments.core.update(true);
}

async function walkMoveAxis(delta) {
  if (Math.abs(delta.x) + Math.abs(delta.z) < 0.0001) return;
  const camera = world.camera.three;
  const distance = delta.length();
  const direction = delta.clone().normalize();
  for (const offset of [0, -0.75, -1.25]) {
    const hit = await walkRay(camera.position.clone().add(new THREE.Vector3(0, offset, 0)), direction, distance + WALK_RADIUS);
    if (!walkMode) return;
    if (hit) return;
  }
  camera.position.add(delta);
}

async function walkTick(now) {
  if (!walkMode) return;
  const dt = Math.min(Math.max((now - walkLastTime) / 1000, 0), 0.05);
  walkLastTime = now;
  try {
    if (walkLocked || walkFocused) {
      const forward = Number(walkKeys.has("KeyW")) - Number(walkKeys.has("KeyS"));
      const strafe = Number(walkKeys.has("KeyD")) - Number(walkKeys.has("KeyA"));
      if (forward || strafe) {
        const magnitude = Math.hypot(forward, strafe);
        const step = WALK_SPEED * dt / magnitude;
        const dx = (Math.sin(walkYaw) * -forward + Math.cos(walkYaw) * strafe) * step;
        const dz = (Math.cos(walkYaw) * -forward - Math.sin(walkYaw) * strafe) * step;
        await walkMoveAxis(new THREE.Vector3(dx, 0, 0));
        if (!walkMode) return;
        await walkMoveAxis(new THREE.Vector3(0, 0, dz));
      }
    }
    if (!walkMode) return;
    const camera = world.camera.three;
    const previousY = camera.position.y;
    walkVerticalSpeed = Math.max(-18, walkVerticalSpeed - WALK_GRAVITY * dt);
    camera.position.y += walkVerticalSpeed * dt;
    const floor = await walkRay(camera.position.clone().add(new THREE.Vector3(0, WALK_STEP_HEIGHT, 0)), WALK_DOWN, WALK_EYE_HEIGHT + WALK_STEP_HEIGHT + 1.2, (hit) => hit.normal?.y > 0.55);
    if (!walkMode) return;
    if (floor) {
      const standingY = floor.point.y + WALK_EYE_HEIGHT;
      if (walkVerticalSpeed <= 0 && camera.position.y <= standingY + 0.04 && standingY - previousY <= WALK_STEP_HEIGHT) {
        camera.position.y = standingY;
        walkVerticalSpeed = 0;
        walkGrounded = true;
      } else walkGrounded = false;
    } else walkGrounded = false;
    if (camera.position.y < federationBox().min.y - 5) {
      setStatus("No floor below this point. Leaving Walk mode to keep the model in view.");
      stopWalk();
      await frameBox(federationBox());
      return;
    }
    updateWalkCamera();
  } catch (error) {
    setStatus(`Walk mode stopped: ${error.message}`, true);
    stopWalk();
    return;
  }
  walkFrame = requestAnimationFrame(walkTick);
}

async function startWalk() {
  if (!modelById.size) return;
  await world.camera.projection.set("Perspective");
  const target = world.camera.controls.getTarget(new THREE.Vector3());
  const box = federationBox();
  const castOrigin = new THREE.Vector3(target.x, box.max.y + 2, target.z);
  let floor = await walkRay(castOrigin, WALK_DOWN, box.getSize(new THREE.Vector3()).y + 5, (hit) => hit.normal?.y > 0.55);
  if (!floor) {
    // A federation box may include distant outliers, leaving its center outside the building.
    for (const [checkId, candidate] of modelById) {
      if (modelVisible.get(checkId) === false) continue;
      const categories = await candidate.getItemsOfCategories([/^IFCSLAB$/i, /^IFCSTAIR$/i, /^IFCSTAIRFLIGHT$/i, /^IFCRAMP$/i, /^IFCCOVERING$/i]);
      const ids = Object.values(categories).flat();
      for (const id of ids.slice(0, 16)) {
        const slabBox = await candidate.getMergedBox([id]);
        if (slabBox.isEmpty()) continue;
        const origin = slabBox.getCenter(new THREE.Vector3()).setY(slabBox.max.y + 0.8);
        floor = await walkRay(origin, WALK_DOWN, 2, (hit) => hit.normal?.y > 0.55);
        if (floor) break;
      }
      if (floor) break;
    }
  }
  if (!floor) { setStatus("No walkable surface was found beneath the view center. Orbit to a floor and try again.", true); return; }
  const camera = world.camera.three;
  const look = camera.getWorldDirection(new THREE.Vector3());
  walkYaw = Math.atan2(-look.x, -look.z);
  walkPitch = Math.asin(THREE.MathUtils.clamp(look.y, -0.95, 0.95));
  camera.position.set(floor.point.x, floor.point.y + WALK_EYE_HEIGHT, floor.point.z);
  world.camera.enabled = false;
  walkMode = true;
  walkFocused = false;
  walkPointerLockDenied = false;
  walkGrounded = true;
  walkVerticalSpeed = 0;
  walkLastTime = performance.now();
  byId("walk-mode").setAttribute("aria-pressed", "true");
  byId("walk-mode").textContent = "Exit walk";
  byId("walk-hint").hidden = false;
  byId("walk-reticle").hidden = false;
  byId("viewport-hint").hidden = true;
  updateWalkCamera();
  walkFrame = requestAnimationFrame(walkTick);
  const renderCanvas = canvas.querySelector("canvas");
  setStatus("Walk mode: click the model for mouse look, WASD movement and Space to jump.");
}

function stopWalk() {
  if (!walkMode) return;
  walkMode = false;
  walkLocked = false;
  walkFocused = false;
  walkDragging = false;
  walkKeys.clear();
  cancelAnimationFrame(walkFrame);
  if (document.pointerLockElement) document.exitPointerLock();
  const camera = world.camera.three;
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const target = camera.position.clone().addScaledVector(forward, 4);
  world.camera.enabled = true;
  world.camera.controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, target.x, target.y, target.z, false);
  byId("walk-mode").setAttribute("aria-pressed", "false");
  byId("walk-mode").textContent = "Walk mode";
  byId("walk-hint").hidden = true;
  byId("walk-hint").textContent = "Click the model to look around · WASD move · Space jump · Esc release mouse";
  byId("walk-reticle").hidden = true;
  byId("viewport-hint").hidden = false;
  fragments.core.update(true);
}

function wireWalkControls() {
  byId("walk-mode").addEventListener("click", () => {
    if (walkMode) stopWalk();
    else startWalk().catch((error) => setStatus(`Could not start Walk mode: ${error.message}`, true));
  });
  document.addEventListener("pointerlockchange", () => {
    walkLocked = walkMode && document.pointerLockElement === canvas.querySelector("canvas");
    if (walkLocked) walkFocused = true;
    else if (walkMode && !walkPointerLockDenied) { walkFocused = false; walkKeys.clear(); }
  });
  document.addEventListener("mousemove", (event) => {
    if (!walkMode || !walkLocked) return;
    walkYaw -= event.movementX * 0.0022;
    walkPitch = THREE.MathUtils.clamp(walkPitch - event.movementY * 0.0022, -1.48, 1.48);
    updateWalkCamera();
  });
  window.addEventListener("keydown", (event) => {
    if (!walkMode || !(walkLocked || walkFocused) || event.target instanceof HTMLInputElement) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "Space" && walkGrounded && !event.repeat) { walkVerticalSpeed = WALK_JUMP_SPEED; walkGrounded = false; }
    walkKeys.add(event.code);
  });
  window.addEventListener("keyup", (event) => walkKeys.delete(event.code));
  window.addEventListener("blur", () => walkKeys.clear());
}

const spatialClasses = ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"];
const relationshipLabels = ["Project", "Site", "Building", "Storey", "IFC class", "Element"];
const relationshipPageSize = 5;

function isUnder(item, ancestorId) {
  if (!ancestorId) return true;
  let current = item;
  const seen = new Set();
  while (current && !seen.has(current.globalId)) {
    if (current.globalId === ancestorId) return true;
    seen.add(current.globalId);
    current = treeIndex.get(current.parentId);
  }
  return false;
}

function scopedElements() {
  const scope = relationshipSelection.slice(0, 4).reverse().find(Boolean) || "";
  if (relationshipCacheScope === scope && relationshipCacheElements) return relationshipCacheElements;
  const elements = treeNodes.filter((item) => !spatialClasses.includes(item.ifcClass));
  const contained = scope ? elements.filter((item) => isUnder(item, scope)) : elements;
  const hasContainment = elements.some((item) => item.parentId && treeIndex.has(item.parentId));
  relationshipCacheScope = scope;
  relationshipCacheElements = !scope || hasContainment ? contained : elements;
  return relationshipCacheElements;
}

function relationshipCandidates(stage) {
  if (stage < 4) {
    const parent = relationshipSelection.slice(0, stage).reverse().find(Boolean);
    return treeNodes.filter((item) => item.ifcClass === spatialClasses[stage] && isUnder(item, parent))
      .map((item) => ({ key: item.globalId, name: item.name, meta: item.ifcClass }));
  }
  const elements = scopedElements();
  if (stage === 4) {
    const counts = new Map();
    for (const item of elements) counts.set(item.ifcClass, (counts.get(item.ifcClass) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, name: key.replace(/^Ifc/, ""), meta: `${count.toLocaleString()} ${count === 1 ? "element" : "elements"}` }));
  }
  return elements.filter((item) => !relationshipSelection[4] || item.ifcClass === relationshipSelection[4])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ key: item.globalId, name: item.name, meta: item.ifcClass }));
}

function relationshipGroupForTile(stage, key, label) {
  const elements = stage === 4 ? scopedElements().filter((item) => item.ifcClass === key)
    : treeNodes.filter((item) => !spatialClasses.includes(item.ifcClass) && isUnder(item, key));
  return { stage, key, label, guids: elements.map((item) => item.globalId) };
}

async function selectRelationshipTile(stage, item) {
  const hadSelection = !!(selectedGuid || selectedClass || selectedRelationshipGroup);
  const scope = relationshipSelection.slice(0, 4).reverse().find(Boolean) || "";
  const sameGroup = selectedRelationshipGroup?.stage === stage && selectedRelationshipGroup.key === item.key
    && (stage !== 4 || selectedRelationshipGroup.scope === scope);
  if (sameGroup) {
    await clearSelection();
    renderRelationships();
    return;
  }
  relationshipSelection[stage] = item.key;
  for (let next = stage + 1; next < 6; next += 1) { relationshipSelection[next] = ""; relationshipPage[next] = 0; }
  selectedRelationshipGroup = relationshipGroupForTile(stage, item.key, item.name);
  selectedRelationshipGroup.scope = relationshipSelection.slice(0, 4).reverse().find(Boolean) || "";
  selectedClass = "";
  selectedGuid = "";
  selectedName = "";
  selectedRequirementGroup = null;
  isolateSelected = hadSelection ? isolateSelected : true;
  selectionVersion += 1;
  clearProperties();
  renderChart();
  renderFailures();
  renderSelectedIssues();
  renderRelationships();
  updateSelectionControls();
  rememberView();
  if (!model) { setStatus(`Loading model before showing ${item.name}…`); return; }
  await refreshVisuals();
}

function syncRelationshipToGuid(guid) {
  const item = treeIndex?.get(guid);
  if (!item) return;
  const ancestors = [];
  const seen = new Set();
  let current = item;
  while (current && !seen.has(current.globalId)) {
    ancestors.push(current);
    seen.add(current.globalId);
    current = treeIndex.get(current.parentId);
  }
  for (let stage = 0; stage < 4; stage += 1) relationshipSelection[stage] = ancestors.find((part) => part.ifcClass === spatialClasses[stage])?.globalId || "";
  relationshipSelection[4] = item.ifcClass;
  relationshipSelection[5] = guid;
  for (let stage = 0; stage < 6; stage += 1) {
    const index = relationshipCandidates(stage).findIndex((candidate) => candidate.key === relationshipSelection[stage]);
    relationshipPage[stage] = Math.max(0, Math.floor(index / relationshipPageSize));
  }
  if (browserOpen) renderRelationships();
}

function drawRelationshipLines() {
  if (!browserOpen || !treeNodes) return;
  const graphBox = relationshipGraph.getBoundingClientRect();
  const width = relationshipColumns.scrollWidth;
  const height = relationshipColumns.clientHeight;
  relationshipLines.setAttribute("viewBox", `0 0 ${width} ${height}`);
  relationshipLines.style.width = `${width}px`;
  relationshipLines.style.height = `${height}px`;
  relationshipLines.replaceChildren();
  const columns = [...relationshipColumns.children];
  for (let stage = 1; stage < columns.length; stage += 1) {
    const targets = columns[stage].querySelectorAll(".relationship-node");
    if (!targets.length) continue;
    let parent;
    for (let previous = stage - 1; previous >= 0; previous -= 1) {
      parent = columns[previous].querySelector('.relationship-node[aria-current="true"]');
      if (parent) break;
    }
    if (!parent) continue;
    const source = parent.getBoundingClientRect();
    const startX = source.right - graphBox.left + relationshipGraph.scrollLeft;
    const startY = source.top + source.height / 2 - graphBox.top + relationshipGraph.scrollTop;
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      const endX = box.left - graphBox.left + relationshipGraph.scrollLeft;
      const endY = box.top + box.height / 2 - graphBox.top + relationshipGraph.scrollTop;
      const bend = Math.max(18, (endX - startX) * .46);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${startX},${startY} C${startX + bend},${startY} ${endX - bend},${endY} ${endX},${endY}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", target.getAttribute("aria-current") === "true" ? "#baff16" : "#9d4eb7");
      path.setAttribute("stroke-width", target.getAttribute("aria-current") === "true" ? "2.5" : "1.2");
      path.setAttribute("opacity", target.getAttribute("aria-current") === "true" ? ".9" : ".55");
      relationshipLines.append(path);
    }
  }
}

function renderRelationships() {
  if (!treeNodes || !browserOpen) return;
  for (let stage = 0; stage < 6; stage += 1) {
    const candidates = relationshipCandidates(stage);
    if (!candidates.some((item) => item.key === relationshipSelection[stage])) relationshipSelection[stage] = stage === 5 ? "" : candidates[0]?.key || "";
  }
  relationshipColumns.replaceChildren();
  for (let stage = 0; stage < 6; stage += 1) {
    const candidates = relationshipCandidates(stage);
    const pages = Math.max(1, Math.ceil(candidates.length / relationshipPageSize));
    relationshipPage[stage] = Math.min(relationshipPage[stage], pages - 1);
    const column = node("section", "relationship-column");
    column.append(node("h3", "relationship-column__head", relationshipLabels[stage]));
    const list = node("div", "relationship-column__nodes");
    for (const item of candidates.slice(relationshipPage[stage] * relationshipPageSize, (relationshipPage[stage] + 1) * relationshipPageSize)) {
      const button = node("button", "relationship-node");
      button.type = "button";
      button.title = `${item.name} · ${item.meta}`;
      button.setAttribute("aria-current", String(item.key === relationshipSelection[stage]));
      if (stage < 5) button.setAttribute("aria-pressed", String(selectedRelationshipGroup?.stage === stage && selectedRelationshipGroup.key === item.key));
      button.append(node("span", "relationship-node__name", item.name), node("span", "relationship-node__meta", item.meta));
      button.addEventListener("click", () => {
        if (stage < 5) { selectRelationshipTile(stage, item).catch((error) => setStatus(error.message, true)); return; }
        relationshipSelection[stage] = item.key;
        selectedClass = "";
        renderChart();
        selectGuid(item.key).catch((error) => setStatus(error.message, true));
      });
      list.append(button);
    }
    if (!candidates.length) list.append(node("p", "relationship-empty", "No items"));
    column.append(list);
    const pager = node("div", "relationship-column__pager");
    pager.append(node("span", "", `${candidates.length ? relationshipPage[stage] + 1 : 0}/${Math.ceil(candidates.length / relationshipPageSize)}`));
    const back = node("button", "", "‹");
    back.type = "button";
    back.disabled = relationshipPage[stage] === 0;
    back.setAttribute("aria-label", `Previous ${relationshipLabels[stage]} page`);
    back.addEventListener("click", () => { relationshipPage[stage] -= 1; renderRelationships(); });
    const forward = node("button", "", "›");
    forward.type = "button";
    forward.disabled = relationshipPage[stage] >= pages - 1;
    forward.setAttribute("aria-label", `Next ${relationshipLabels[stage]} page`);
    forward.addEventListener("click", () => { relationshipPage[stage] += 1; renderRelationships(); });
    pager.append(back, forward);
    column.append(pager);
    relationshipColumns.append(column);
  }
  byId("relationship-count").textContent = selectedRelationshipGroup
    ? `${selectedRelationshipGroup.guids.length.toLocaleString()} selected elements`
    : `${scopedElements().length.toLocaleString()} elements in scope`;
  requestAnimationFrame(drawRelationshipLines);
}

function renderRelationshipSearch() {
  const query = byId("browser-search").value.trim().toLocaleLowerCase();
  relationshipSearchResults.replaceChildren();
  relationshipSearchResults.hidden = !query || !treeNodes;
  if (!query || !treeNodes) return;
  const matches = treeNodes.filter((item) => !spatialClasses.includes(item.ifcClass) && `${item.name} ${item.ifcClass} ${item.globalId}`.toLocaleLowerCase().includes(query)).slice(0, 30);
  if (!matches.length) relationshipSearchResults.append(node("p", "empty-note", "No model elements match your search."));
  for (const item of matches) {
    const button = node("button", "", `${item.name} · ${item.ifcClass}`);
    button.type = "button";
    button.append(node("small", "", item.globalId));
    button.addEventListener("click", () => {
      byId("browser-search").value = "";
      renderRelationshipSearch();
      syncRelationshipToGuid(item.globalId);
      selectGuid(item.globalId).catch((error) => setStatus(error.message, true));
    });
    relationshipSearchResults.append(button);
  }
}

async function loadRelationshipBrowser() {
  if (!treeNodes) {
    relationshipColumns.replaceChildren(node("p", "empty-note", "Reading IFC relationships…"));
    treeNodes = await getJson("/browser", `&check=${encodeURIComponent(activeCheckId)}`);
    treeIndex = new Map(treeNodes.map((item) => [item.globalId, item]));
    relationshipCacheScope = null;
    relationshipCacheElements = null;
  }
  if (selectedRelationshipGroup) {
    selectedRelationshipGroup = relationshipGroupForTile(selectedRelationshipGroup.stage, selectedRelationshipGroup.key, selectedRelationshipGroup.label);
    selectedRelationshipGroup.scope = relationshipSelection.slice(0, 4).reverse().find(Boolean) || "";
    updateSelectionControls();
    if (model) refreshVisuals(false).catch((error) => setStatus(error.message, true));
  } else if (selectedGuid) syncRelationshipToGuid(selectedGuid);
  renderRelationships();
  renderRelationshipSearch();
}

function setBrowserOpen(open) {
  browserOpen = open;
  relationshipPanel.hidden = !open;
  byId("show-browser").setAttribute("aria-pressed", String(open));
  rememberView();
  if (open) loadRelationshipBrowser().catch((error) => { relationshipColumns.replaceChildren(node("p", "empty-note", error.message)); });
}

function wireControls() {
  failureSearch.addEventListener("input", () => { shownFailures = 80; renderFailures(); rememberView(); });
  moreFailures.addEventListener("click", () => { shownFailures += 80; renderFailures(); });
  passSearch.addEventListener("input", () => { shownPasses = 80; renderPasses(); rememberView(); });
  morePasses.addEventListener("click", () => { shownPasses += 80; renderPasses(); });
  byId("show-failures").addEventListener("click", () => setResultsPanel("failed"));
  byId("show-passes").addEventListener("click", () => setResultsPanel("passed"));
  byId("pick-element").addEventListener("click", () => { pickEnabled = !pickEnabled; updatePickControl(); rememberView(); });
  byId("isolate-selected").addEventListener("click", () => {
    if (!selectedGuid && !selectedClass && !selectedRelationshipGroup) return;
    isolateSelected = !isolateSelected;
    updateSelectionControls();
    rememberView();
    refreshVisuals(false).catch((error) => setStatus(error.message, true));
  });
  byId("clear-selection").addEventListener("click", () => clearSelection().catch((error) => setStatus(error.message, true)));
  byId("reset-view").addEventListener("click", () => frameBox(federationBox()));
  byId("show-models").addEventListener("click", () => setModelsOpen(!modelsOpen));
  byId("close-models").addEventListener("click", () => setModelsOpen(false));
  byId("style-toggle").addEventListener("click", () => { softStyle = !softStyle; applyStyle(); rememberView(); });
  byId("show-properties").addEventListener("click", showInspector);
  byId("show-browser").addEventListener("click", () => setBrowserOpen(!browserOpen));
  byId("close-inspector").addEventListener("click", () => { inspector.hidden = true; byId("show-properties").setAttribute("aria-pressed", "false"); });
  byId("close-browser").addEventListener("click", () => setBrowserOpen(false));
  byId("browser-search").addEventListener("input", renderRelationshipSearch);
  window.addEventListener("resize", () => requestAnimationFrame(drawRelationshipLines));
}

function federationBox() {
  const box = new THREE.Box3();
  for (const [id, candidate] of modelById) if (modelVisible.get(id) !== false) box.union(candidate.box);
  return box.isEmpty() && model ? model.box : box;
}

function setModelsOpen(open) {
  modelsOpen = open;
  byId("models-panel").hidden = !open;
  byId("show-models").setAttribute("aria-pressed", String(open));
  if (open) renderModels();
}

function renderModels() {
  const list = byId("models-list");
  list.replaceChildren();
  for (const check of checks) {
    const row = node("div", "model-row");
    const toggle = node("input");
    toggle.type = "checkbox";
    toggle.checked = modelVisible.get(check.id) !== false;
    toggle.setAttribute("aria-label", `Show ${check.filename} in 3D`);
    toggle.addEventListener("change", () => {
      modelVisible.set(check.id, toggle.checked);
      applyModelVisibility().catch((error) => setStatus(error.message, true));
      rememberView();
    });
    const choice = node("button", "model-choice", check.name || check.filename);
    choice.type = "button";
    choice.title = `${check.filename} · ${check.issues.toLocaleString()} issues`;
    choice.setAttribute("aria-current", String(activeCheckId === check.id));
    choice.addEventListener("click", () => activateCheck(check.id).catch((error) => setStatus(error.message, true)));
    row.append(toggle, choice, node("small", "", `${check.issues.toLocaleString()} issues`));
    list.append(row);
  }
}

async function applyModelVisibility() {
  for (const [id, candidate] of modelById) {
    const visible = modelVisible.get(id) !== false;
    candidate.object.visible = visible;
    await candidate.setVisible(undefined, visible);
  }
  if (silhouettePass) silhouettePass.selectedObjects = [...modelById].filter(([id]) => modelVisible.get(id) !== false).map(([, candidate]) => candidate.object);
  if (fragments) fragments.core.update(true);
  renderModels();
}

async function applyOtherModelGhosts(ghost) {
  for (const [id, candidate] of modelById) {
    if (id === activeCheckId) continue;
    if (ghost && modelVisible.get(id) !== false) {
      if (!otherGhosted.has(id)) await candidate.setOpacity(undefined, 0.12);
      otherGhosted.add(id);
    } else if (otherGhosted.has(id)) {
      await candidate.resetOpacity(undefined);
      otherGhosted.delete(id);
    }
  }
}

function clearOutline() {
  outlineRevision += 1;
  if (!outlineOverlay) return;
  outlineOverlay.parent?.remove(outlineOverlay);
  outlineOverlay.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  outlineOverlay = null;
}

async function updateOutline(localId) {
  clearOutline();
  if (!softStyle || localId == null || !model) return;
  const revision = outlineRevision;
  const targetModel = model;
  const targetGuid = selectedGuid;
  const geometryGroups = await targetModel.getItemsGeometry([localId]);
  if (revision !== outlineRevision || targetModel !== model || selectedGuid !== targetGuid || !softStyle) return;
  const group = new THREE.Group();
  for (const part of geometryGroups.flat()) {
    if (!part.positions || !part.indices) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(part.positions), 3));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    geometry.applyMatrix4(part.transform);
    // Draw sharp boundary edges only. An inflated back-face mesh can cover open IFC surfaces.
    const edges = new THREE.EdgesGeometry(geometry, 35);
    geometry.dispose();
    if (!edges.attributes.position.count) { edges.dispose(); continue; }
    const lineGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    edges.dispose();
    const lines = new LineSegments2(lineGeometry, new LineMaterial({ color: 0x050505, linewidth: 2.4, depthTest: true, depthWrite: false, transparent: true, opacity: 0.95 }));
    lines.raycast = () => {};
    lines.renderOrder = 4;
    group.add(lines);
  }
  if (group.children.length) {
    targetModel.object.add(group);
    outlineOverlay = group;
  }
}

function applyStyle() {
  byId("style-toggle").setAttribute("aria-pressed", String(softStyle));
  if (!world) return;
  world.scene.three.background = new THREE.Color(softStyle ? "#a9b0a9" : "#8c978d");
  for (const light of sceneLights) light.visible = softStyle;
  if (!softStyle) clearOutline();
  else if (selectedGuid) localIdForGuid(selectedGuid).then(updateOutline).catch(() => {});
  if (silhouettePass) silhouettePass.enabled = softStyle;
  fragments?.core.update(true);
}

function setupSilhouette() {
  const size = world.renderer.getSize();
  composer = new EffectComposer(world.renderer.three);
  scenePass = new RenderPass(world.scene.three, world.camera.three);
  silhouettePass = new OutlinePass(size, world.scene.three, world.camera.three, []);
  silhouettePass.visibleEdgeColor.set(0x050505);
  silhouettePass.hiddenEdgeColor.set(0x050505);
  silhouettePass.edgeStrength = 4;
  silhouettePass.edgeThickness = 1.6;
  silhouettePass.edgeGlow = 0;
  // OutlinePass normally adds bright colors. Normal blending lets a black edge darken the image.
  silhouettePass.overlayMaterial.blending = THREE.NormalBlending;
  composer.addPass(scenePass);
  composer.addPass(silhouettePass);
  composer.addPass(new OutputPass());
  world.renderer.onResize.add((nextSize) => composer.setSize(nextSize.x, nextSize.y));
  const originalUpdate = world.renderer.update.bind(world.renderer);
  world.renderer.update = (delta) => {
    if (!softStyle || !silhouettePass.selectedObjects.length) return originalUpdate(delta);
    if (!world.renderer.enabled || !world.renderer.currentWorld) return;
    if (world.renderer.mode === OBC.RendererMode.MANUAL && !world.renderer.needsUpdate) return;
    world.renderer.needsUpdate = false;
    scenePass.camera = world.camera.three;
    silhouettePass.renderCamera = world.camera.three;
    world.renderer.onBeforeUpdate.trigger(world.renderer);
    composer.render(delta);
    world.renderer.onAfterUpdate.trigger(world.renderer);
  };
}

async function activateCheck(checkId) {
  if (checkId === activeCheckId || !modelById.has(checkId)) return;
  if (visualWork) await visualWork.catch(() => {});
  clearOutline();
  if (model) {
    if (coloredIds.length) await model.resetColor(coloredIds);
    if (ghostActive) await model.resetOpacity(undefined);
  }
  activeCheckId = checkId;
  model = modelById.get(checkId);
  coloredIds = [];
  opaqueIds = [];
  ghostActive = false;
  guidLocalIds.clear();
  classLocalIds.clear();
  treeNodes = null;
  treeIndex = null;
  relationshipCacheScope = null;
  relationshipCacheElements = null;
  relationshipSelection.fill("");
  relationshipPage.fill(0);
  selectedGuid = "";
  selectedClass = "";
  selectedRelationshipGroup = null;
  selectedRequirementGroup = null;
  selectedName = "";
  selectionVersion += 1;
  clearProperties();
  selectedIssues.hidden = true;
  const scope = `&check=${encodeURIComponent(checkId)}`;
  [issues, passes] = await Promise.all([getJson("/issues", scope), getJson("/passes", scope)]);
  buildFailureGroups();
  buildPassGroups();
  renderSelectedIssues();
  updateSelectionControls();
  await applyOtherModelGhosts(false);
  renderModels();
  rememberView();
  setStatus(`${checks.find((c) => c.id === checkId)?.filename || "Model"} selected · ${failedElementCount().toLocaleString()} failed elements`);
  if (browserOpen) loadRelationshipBrowser().catch((error) => setStatus(error.message, true));
}

async function start() {
  wireControls();
  wireWalkControls();
  updatePickControl();
  setStatus("Preparing federated IFC models…");
  checks = await getJson("/checks");
  if (!checks.length) throw new Error("This project contains no IFC models.");
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  world = worlds.create();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.renderer = new OBC.SimpleRenderer(components, canvas);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x69766e, 1.1);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(12, 25, 16);
  const fillLight = new THREE.DirectionalLight(0xd8e5ff, 0.45);
  fillLight.position.set(-18, 9, -12);
  sceneLights = [hemisphere, keyLight, fillLight];
  for (const light of sceneLights) world.scene.three.add(light);
  components.init();
  setupSilhouette();
  walkProbeCamera = new THREE.PerspectiveCamera(12, Math.max(canvas.clientWidth / Math.max(canvas.clientHeight, 1), 1), 0.01, 100);
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
  for (const [index, check] of checks.entries()) {
    setStatus(`Loading IFC model ${index + 1} of ${checks.length}: ${check.filename}`);
    const response = await fetch(`/model?token=${token}&check=${encodeURIComponent(check.id)}`);
    if (!response.ok) throw new Error(`Could not retrieve ${check.filename} from the local viewer service.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const loaded = await loader.load(bytes, true, check.id);
    modelById.set(check.id, loaded);
    modelVisible.set(check.id, true);
  }
  silhouettePass.selectedObjects = [...modelById.values()].map((candidate) => candidate.object);
  applyStyle();
  const savedState = viewStorageKey ? JSON.parse(sessionStorage.getItem(viewStorageKey) || "null") : null;
  await activateCheck(checks.some((check) => check.id === savedState?.activeCheckId) ? savedState.activeCheckId : checks[0].id);
  restoreView(savedState);
  await applyModelVisibility();
  wireModelPicking();
  await frameBox(federationBox());
  fragments.core.update(true);
  byId("reset-view").disabled = false;
  updateSelectionControls();
  setStatus(`${checks.length} IFC model(s) loaded · ${failedElementCount().toLocaleString()} failed elements in ${checks.find((c) => c.id === activeCheckId)?.filename}`);
  if (selectedGuid || selectedClass || selectedRelationshipGroup) refreshVisuals().catch((error) => setStatus(error.message, true));
}

start().catch((error) => { console.error(error); setStatus(`Viewer could not load: ${error.message}`, true); });
