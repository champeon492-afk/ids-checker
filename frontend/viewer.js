import * as OBC from "@thatopen/components";
import * as THREE from "three";

const token = encodeURIComponent(window.viewerToken);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const canvas = byId("canvas");
const failureList = byId("failure-list");
const failureSearch = byId("failure-search");
const classChart = byId("class-chart");
const selectedIssues = byId("selected-issues");
const moreFailures = byId("more-failures");
const inspector = byId("inspector");
const propertiesPanel = byId("properties-panel");
const relationshipPanel = byId("relationship-panel");
const relationshipGraph = byId("relationship-graph");
const relationshipColumns = byId("relationship-columns");
const relationshipLines = byId("relationship-lines");
const relationshipSearchResults = byId("relationship-search-results");
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
      pickEnabled,
      browserOpen,
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
    selectedGuid = typeof state.selectedGuid === "string" && state.selectedGuid.length <= 64 ? state.selectedGuid : "";
    selectedName = failureGroups.find((group) => group.globalId === selectedGuid)?.element || "";
    isolateSelected = !!(selectedGuid && state.isolateSelected);
    pickEnabled = state.pickEnabled !== false;
    updatePickControl();
    failureSearch.value = typeof state.search === "string" ? state.search : "";
    renderChart();
    renderFailures();
    renderSelectedIssues();
    updateSelectionControls();
    if (selectedGuid) showProperties(selectedGuid, ++selectionVersion);
    if (state.browserOpen) setBrowserOpen(true);
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
  const group = selectedRequirementGroup || failureGroups.find((item) => item.globalId && item.globalId === selectedGuid);
  if (!selectedGuid && !group) {
    selectedIssues.hidden = true;
    selectedIssues.replaceChildren();
    return;
  }
  selectedIssues.hidden = false;
  selectedIssues.replaceChildren();
  selectedIssues.append(node("span", "ot-eyebrow", group?.globalId || selectedGuid ? "Selected model element" : "Validation requirement"));
  selectedIssues.append(node("h3", "", selectedName || group?.element || group?.specification || "Selected element"));
  selectedIssues.append(node("p", "selected-issues__meta", group?.checks.length
    ? `${group.checks.length} ${group.checks.length === 1 ? "issue" : "issues"} · ${group.ifcClass || "IDS requirement"}`
    : `No IDS errors recorded${selectedGuid ? ` · ${selectedGuid}` : ""}`));
  if (group?.checks.length) {
    const list = node("div", "selected-issues__list");
    addIssueCallouts(list, group.checks);
    selectedIssues.append(list);
  } else {
    selectedIssues.append(node("p", "selected-issues__empty", "This element has no recorded validation failures. Its IFC properties are available in the viewer."));
  }
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
  selectedName = "";
  selectedRequirementGroup = group;
  isolateSelected = false;
  renderFailures();
  renderSelectedIssues();
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
  byId("isolate-selected").disabled = !selectedGuid;
  byId("isolate-selected").setAttribute("aria-pressed", String(isolateSelected && !!selectedGuid));
  byId("clear-selection").disabled = !selectedGuid && !selectedClass && !selectedRequirementGroup;
  byId("view-title").textContent = selectedGuid
    ? (selectedName || failureGroups.find((group) => group.globalId === selectedGuid)?.element || "Selected element")
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
  else if (guid && !failureGroups.some((group) => group.globalId === guid)) setStatus("Selected element has no recorded IDS errors.");
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
  selectedName = "";
  selectedRequirementGroup = null;
  isolateSelected = false;
  selectionVersion += 1;
  clearProperties();
  shownFailures = 80;
  renderChart();
  renderFailures();
  renderSelectedIssues();
  updateSelectionControls();
  rememberView();
  if (!model) { setStatus("Loading model before showing the selected IFC class…"); return; }
  await refreshVisuals();
}

async function clearSelection() {
  selectedClass = "";
  selectedGuid = "";
  selectedName = "";
  selectedRequirementGroup = null;
  isolateSelected = false;
  selectionVersion += 1;
  clearProperties();
  renderChart();
  renderFailures();
  renderSelectedIssues();
  updateSelectionControls();
  rememberView();
  await refreshVisuals();
}

async function selectGuid(guid, options = {}) {
  const { fromModel = false, frame = true } = options;
  const group = failureGroups.find((item) => item.globalId && item.globalId === guid);
  if (fromModel && group && failureSearch.value) failureSearch.value = "";
  if (group && selectedClass && selectedClass !== group.ifcClass) {
    selectedClass = "";
    renderChart();
  }
  selectedGuid = guid;
  selectedName = group?.element || "";
  selectedRequirementGroup = null;
  if (treeIndex) syncRelationshipToGuid(guid);
  selectionVersion += 1;
  const version = selectionVersion;
  renderFailures();
  renderSelectedIssues();
  updateSelectionControls();
  rememberView();
  showProperties(guid, version);
  if (fromModel && group) failureList.querySelector('.failure-card[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
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
  if (selectedClass) {
    const allowed = new Set(await localIdsForClass(selectedClass));
    const hits = await model.raycastAll(data);
    hit = hits?.find((item) => allowed.has(item.localId));
  } else {
    hit = await model.raycast(data);
  }
  if (revision !== pickRevision) return;
  if (!hit) {
    setStatus(selectedClass ? `Click a highlighted ${selectedClass} element to inspect it.` : "No model element was found at that point.");
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
  renderCanvas.addEventListener("pointerdown", (event) => {
    pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
  }, true);
  renderCanvas.addEventListener("pointerup", (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (moved > 5) return;
    pickElement(event, renderCanvas).catch((error) => setStatus(`Could not select model element: ${error.message}`, true));
  }, true);
  renderCanvas.addEventListener("pointercancel", () => { pointerStart = null; }, true);
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
      button.append(node("span", "relationship-node__name", item.name), node("span", "relationship-node__meta", item.meta));
      button.addEventListener("click", () => {
        relationshipSelection[stage] = item.key;
        for (let next = stage + 1; next < 6; next += 1) { relationshipSelection[next] = ""; relationshipPage[next] = 0; }
        renderRelationships();
        if (stage === 5) {
          selectedClass = "";
          renderChart();
          selectGuid(item.key).catch((error) => setStatus(error.message, true));
        }
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
  byId("relationship-count").textContent = `${scopedElements().length.toLocaleString()} elements in scope`;
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
    treeNodes = await getJson("/browser");
    treeIndex = new Map(treeNodes.map((item) => [item.globalId, item]));
    relationshipCacheScope = null;
    relationshipCacheElements = null;
  }
  if (selectedGuid) syncRelationshipToGuid(selectedGuid);
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
  byId("pick-element").addEventListener("click", () => { pickEnabled = !pickEnabled; updatePickControl(); rememberView(); });
  byId("isolate-selected").addEventListener("click", () => {
    if (!selectedGuid) return;
    isolateSelected = !isolateSelected;
    updateSelectionControls();
    rememberView();
    refreshVisuals(false).catch((error) => setStatus(error.message, true));
  });
  byId("clear-selection").addEventListener("click", () => clearSelection().catch((error) => setStatus(error.message, true)));
  byId("reset-view").addEventListener("click", () => frameBox(model.box));
  byId("show-properties").addEventListener("click", showInspector);
  byId("show-browser").addEventListener("click", () => setBrowserOpen(!browserOpen));
  byId("close-inspector").addEventListener("click", () => { inspector.hidden = true; byId("show-properties").setAttribute("aria-pressed", "false"); });
  byId("close-browser").addEventListener("click", () => setBrowserOpen(false));
  byId("browser-search").addEventListener("input", renderRelationshipSearch);
  window.addEventListener("resize", () => requestAnimationFrame(drawRelationshipLines));
}

async function start() {
  wireControls();
  updatePickControl();
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
  wireModelPicking();
  await frameBox(model.box);
  fragments.core.update(true);
  byId("reset-view").disabled = false;
  updateSelectionControls();
  setStatus(`Whole building loaded · ${failureGroups.length.toLocaleString()} failed elements`);
  if (selectedGuid || selectedClass) refreshVisuals().catch((error) => setStatus(error.message, true));
}

start().catch((error) => { console.error(error); setStatus(`Viewer could not load: ${error.message}`, true); });
