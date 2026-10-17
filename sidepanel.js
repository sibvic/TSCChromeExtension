const HINTS = [
  "FXTS2 Lua Indicator",
  "MT4 Indicator",
  "MT5 Indicator",
  "NinjaSctipt 8 Indicator"
];
const SCRIPT_STATUS = { 0: "Parsed", 1: "ParsingError", 2: "Parsing", Parsed: "Parsed", ParsingError: "ParsingError", Parsing: "Parsing" };
const CODE_STATUS = { 0: "Ok", 1: "Failed", 2: "NotPaid", 3: "Generating", Ok: "Ok", Failed: "Failed", NotPaid: "NotPaid", Generating: "Generating" };
const ACTIVE = ["uploading", "parsing", "awaitingOptions", "converting", "awaitingPayment", "downloading"];
const TIMEOUT_MS = 3 * 60 * 1000;

const account = document.getElementById("account");
const signedOut = document.getElementById("signedOut");
const signedIn = document.getElementById("signedIn");
const sourceBox = document.getElementById("source");
const approximate = document.getElementById("approximate");
const platform = document.getElementById("platform");
const optionsBox = document.getElementById("options");
const statusLine = document.getElementById("status");
const errorLine = document.getElementById("error");
const actions = document.getElementById("actions");

let state = { signedIn: false, balance: null, subscription: null, clientUrl: "", job: null };
let ticking = false;
let pollTimer = 0;

function prop(obj, name) {
  if (obj == null || typeof obj !== "object") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(obj, name)) {
    return obj[name];
  }
  const camel = name.charAt(0).toLowerCase() + name.slice(1);
  if (Object.prototype.hasOwnProperty.call(obj, camel)) {
    return obj[camel];
  }
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  if (Object.prototype.hasOwnProperty.call(obj, pascal)) {
    return obj[pascal];
  }
  return undefined;
}

function statusName(value, map) {
  if (value == null) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(map, value)) {
    return map[value];
  }
  return String(value);
}

function api(type, payload) {
  return chrome.runtime.sendMessage(Object.assign({ type }, payload || {})).then((response) => {
    if (!response || !response.ok) {
      const error = new Error((response && response.error) || "Request failed.");
      error.status = response ? response.status : 0;
      error.body = response ? response.body : null;
      throw error;
    }
    return response.data;
  });
}

function job() {
  return state.job;
}

function subscriptionActive() {
  return prop(state.subscription, "Active") === true;
}

function subscriptionUntil() {
  const until = prop(state.subscription, "ActiveUntil");
  return until ? String(until).slice(0, 10) : "";
}

async function saveJob(next) {
  state.job = next;
  if (next) {
    await chrome.storage.session.set({ job: next });
  } else {
    await chrome.storage.session.remove("job");
  }
}

function readCode(row) {
  return {
    id: prop(row, "Id"),
    type: prop(row, "Type") || "",
    status: statusName(prop(row, "Status"), CODE_STATUS),
    error: prop(row, "Error") || "",
    price: prop(row, "Price")
  };
}

function readTarget(row) {
  return {
    group: prop(row, "Group") || "",
    type: prop(row, "Type") || "",
    version: prop(row, "Version") || "",
    parameters: (prop(row, "Parameters") || []).map((parameter) => ({
      name: prop(parameter, "Name") || "",
      options: prop(parameter, "Options") || []
    }))
  };
}

function latestCode(script, fileType) {
  return (prop(script, "Code") || [])
    .map(readCode)
    .filter((code) => code.type === fileType)
    .sort((left, right) => Number(right.id) - Number(left.id))[0];
}

function platformNames() {
  const current = job();
  if (current && current.targets && current.targets.length) {
    return current.targets.map((target) => target.type);
  }
  return HINTS.slice();
}

function fillPlatforms() {
  const names = platformNames();
  const selected = platform.value || (job() && job().fileType) || names[0] || "";
  if (selected && !names.includes(selected)) {
    names.unshift(selected);
  }
  platform.replaceChildren();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === selected) {
      option.selected = true;
    }
    platform.append(option);
  }
}

function button(label, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) {
    element.className = className;
  }
  element.addEventListener("click", onClick);
  return element;
}

function link(href, label) {
  const element = document.createElement("a");
  element.href = href;
  element.target = "_blank";
  element.rel = "noreferrer";
  element.textContent = label;
  return element;
}

function render() {
  const current = job();
  signedOut.hidden = state.signedIn;
  signedIn.hidden = !state.signedIn;
  if (state.signedIn) {
    const points = state.balance == null ? "—" : state.balance;
    account.textContent = subscriptionActive()
      ? "Subscription until " + subscriptionUntil() + ". Balance: " + points + " points"
      : "Balance: " + points + " points";
  } else {
    account.textContent = "Not signed in";
  }
  approximate.hidden = !state.sourceApproximate;
  fillPlatforms();
  renderOptions();
  renderStatus();
  const running = current && ACTIVE.includes(current.phase) && !current.timedOut;
  platform.disabled = Boolean(running);
  sourceBox.disabled = Boolean(running && current.phase !== "awaitingOptions" && current.phase !== "awaitingPayment");
}

function renderOptions() {
  optionsBox.replaceChildren();
  const current = job();
  if (!current || current.phase !== "awaitingOptions") {
    return;
  }
  for (const parameter of current.parameters || []) {
    const label = document.createElement("label");
    label.textContent = parameter.name;
    const select = document.createElement("select");
    select.dataset.param = parameter.name;
    for (const optionName of parameter.options || []) {
      const option = document.createElement("option");
      option.value = optionName;
      option.textContent = optionName;
      select.append(option);
    }
    optionsBox.append(label, select);
  }
}

function renderStatus() {
  actions.replaceChildren();
  errorLine.hidden = true;
  errorLine.textContent = "";
  const current = job();
  if (!current) {
    statusLine.textContent = "Choose a platform and convert.";
    actions.append(button("Convert", "", startConversion));
    return;
  }
  if (current.error && current.phase !== "done") {
    errorLine.hidden = false;
    errorLine.textContent = current.error;
  }
  const site = (state.clientUrl || "").replace(/\/$/, "");
  switch (current.phase) {
    case "uploading":
      statusLine.textContent = "Sending the script…";
      break;
    case "parsing":
      statusLine.textContent = current.timedOut ? "Parsing is still running." : "Parsing…";
      break;
    case "awaitingOptions":
      statusLine.textContent = "Choose options, then continue.";
      actions.append(button("Continue", "", continueConvert));
      break;
    case "converting":
      statusLine.textContent = current.timedOut ? "Conversion is still running." : "Converting to " + current.fileType + "…";
      break;
    case "awaitingPayment":
      statusLine.textContent = current.codeStatus === "Ok"
        ? "This file is already unlocked."
        : subscriptionActive()
          ? "Included in your monthly subscription."
          : "Unlock " + current.fileType + " for " + current.price + " points. Balance: " + (current.balance == null ? "—" : current.balance) + ".";
      if (current.codeStatus === "Ok") {
        actions.append(button("Download", "", () => payAndDownload(false)));
      } else if (subscriptionActive()) {
        actions.append(button("Included in subscription", "", () => payAndDownload(true)));
      } else if (Number(current.price) === 0) {
        actions.append(button("Download", "", () => payAndDownload(true)));
      } else if (Number(current.price) > Number(current.balance == null ? -1 : current.balance)) {
        actions.append(link(site + "/Balance", "Subscribe or top up"));
      } else {
        actions.append(button("Unlock for " + current.price + " points", "", () => payAndDownload(true)));
      }
      actions.append(button("Not now", "secondary", clearJob));
      break;
    case "downloading":
      statusLine.textContent = "Downloading…";
      break;
    case "done":
      statusLine.textContent = "Saved " + (current.fileName || "the file") + ".";
      actions.append(button("Convert another", "secondary", clearJob));
      break;
    case "failed":
      statusLine.textContent = "Conversion stopped.";
      if (current.targets && current.targets.length) {
        actions.append(button("Convert selected platform", "", startConversion));
      }
      actions.append(button("Start over", "secondary", clearJob));
      break;
    default:
      statusLine.textContent = current.phase;
      break;
  }
  if (current.timedOut && current.scriptId && (current.phase === "parsing" || current.phase === "converting")) {
    actions.append(button("Check again", "", checkAgain));
    actions.append(link(site + "/Script/" + current.scriptId, "Open on the site"));
  }
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  if (!response || !response.ok) {
    account.textContent = response && response.error ? response.error : "Could not load the extension state.";
    return;
  }
  state = response;
  if (!sourceBox.value && response.pendingSource) {
    sourceBox.value = response.pendingSource;
  }
  render();
  if (job() && (job().phase === "parsing" || job().phase === "converting") && !job().timedOut) {
    ensurePoll();
    tick();
  }
}

function ensurePoll() {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    tick().catch(failJob);
  }, 3000);
}

async function tick() {
  const current = job();
  if (ticking || !current || current.timedOut) {
    return;
  }
  if (current.phase !== "parsing" && current.phase !== "converting") {
    return;
  }
  ticking = true;
  try {
    if (Date.now() - current.startedAt > TIMEOUT_MS) {
      current.timedOut = true;
      await saveJob(current);
      render();
      return;
    }
    const script = await api("getScript", { scriptId: current.scriptId });
    await applyScript(script);
    await saveJob(job());
    render();
  } finally {
    ticking = false;
  }
}

async function applyScript(script) {
  const current = job();
  const scriptStatus = statusName(prop(script, "Status"), SCRIPT_STATUS);
  current.scriptName = prop(script, "Name") || current.scriptName || "";
  const targets = (prop(script, "Targets") || []).map(readTarget);
  if (targets.length) {
    current.targets = targets;
  }
  if (current.phase === "parsing") {
    if (scriptStatus === "Parsing") {
      return;
    }
    if (scriptStatus === "ParsingError") {
      const codes = (prop(script, "Code") || []).map(readCode);
      current.phase = "failed";
      current.error = codes.map((code) => code.error).find(Boolean) || "The script could not be parsed.";
      return;
    }
    if (scriptStatus !== "Parsed") {
      current.phase = "failed";
      current.error = "Unexpected script status.";
      return;
    }
    await beginConvert(script);
    return;
  }
  if (current.phase === "converting") {
    const latest = latestCode(script, current.fileType);
    if (!latest || latest.status === "Generating") {
      return;
    }
    if (latest.status === "Failed") {
      current.phase = "failed";
      current.error = latest.error || "Conversion failed.";
      return;
    }
    if (latest.status === "NotPaid" || latest.status === "Ok") {
      await enterPayment(latest);
    }
  }
}

async function beginConvert(script) {
  const current = job();
  const latest = latestCode(script, current.fileType);
  if (latest && latest.status === "Generating") {
    current.phase = "converting";
    return;
  }
  if (latest && (latest.status === "NotPaid" || latest.status === "Ok")) {
    await enterPayment(latest);
    return;
  }
  const target = (current.targets || []).find((item) => item.type === current.fileType);
  const failed = latest && latest.status === "Failed";
  if (!target && !failed) {
    current.phase = "failed";
    current.error = "That platform is not available for this script.";
    return;
  }
  if (target && target.parameters.length && !current.options) {
    current.phase = "awaitingOptions";
    current.parameters = target.parameters;
    return;
  }
  await runConvert();
}

async function runConvert() {
  const current = job();
  const created = await api("convert", {
    scriptId: current.scriptId,
    fileType: current.fileType,
    options: current.options || {}
  });
  current.fileId = prop(created, "Id");
  current.phase = "converting";
}

async function enterPayment(code) {
  const current = job();
  current.fileId = code.id;
  current.price = code.price == null ? 0 : Number(code.price);
  current.codeStatus = code.status;
  current.phase = "awaitingPayment";
  current.error = "";
  current.balance = await api("balance");
  state.balance = current.balance;
  try {
    state.subscription = await api("subscription");
  } catch (error) {
    if (error.status === 401) {
      throw error;
    }
  }
  await saveJob(current);
  render();
  if (code.status === "Ok" || current.price === 0 || subscriptionActive()) {
    await payAndDownload(code.status !== "Ok");
  }
}

async function startConversion() {
  const source = sourceBox.value;
  const fileType = platform.value;
  if (!source.trim()) {
    showMessage("Paste the Pine source, or open it in the TradingView editor and click Convert there.");
    return;
  }
  if (!fileType) {
    showMessage("Choose a platform.");
    return;
  }
  const next = {
    phase: "uploading",
    fileType,
    startedAt: Date.now(),
    error: ""
  };
  await saveJob(next);
  render();
  ensurePoll();
  try {
    const created = await api("addScript", { source });
    const scriptId = prop(created, "Id");
    if (!scriptId) {
      throw new Error("The server did not accept this source. It has to be Pine Script.");
    }
    next.scriptId = scriptId;
    next.phase = "parsing";
    await saveJob(next);
    render();
    await tick();
  } catch (error) {
    await failJob(error);
  }
}

async function continueConvert() {
  const current = job();
  const options = {};
  for (const parameter of current.parameters || []) {
    const select = optionsBox.querySelector('[data-param="' + CSS.escape(parameter.name) + '"]');
    options[parameter.name] = select ? select.value : (parameter.options[0] || "");
  }
  current.options = options;
  current.phase = "converting";
  current.error = "";
  await saveJob(current);
  render();
  try {
    await runConvert();
    await saveJob(current);
    render();
    ensurePoll();
    await tick();
  } catch (error) {
    await failJob(error);
  }
}

async function payAndDownload(needUnlock) {
  const current = job();
  current.phase = "downloading";
  current.error = "";
  await saveJob(current);
  render();
  try {
    if (needUnlock) {
      await api("unlock", { scriptId: current.scriptId, fileId: current.fileId });
      current.codeStatus = "Ok";
    }
    const saved = await api("download", { scriptId: current.scriptId, fileId: current.fileId });
    current.phase = "done";
    current.fileName = saved.fileName;
    const balance = await api("balance");
    current.balance = balance;
    state.balance = balance;
    await saveJob(current);
  } catch (error) {
    if (error.status === 402) {
      current.phase = "awaitingPayment";
      current.price = prop(error.body, "price") == null ? current.price : Number(prop(error.body, "price"));
      current.balance = prop(error.body, "balance") == null ? current.balance : Number(prop(error.body, "balance"));
      state.balance = current.balance;
      current.error = "Not enough points to unlock this file.";
    } else if (error.status === 401) {
      state.signedIn = false;
      current.phase = "failed";
      current.error = "Sign in again.";
    } else if (current.codeStatus === "Ok") {
      current.phase = "awaitingPayment";
      current.error = error.message || "Download failed.";
    } else {
      current.phase = "failed";
      current.error = error.message || "Unlock failed.";
    }
    await saveJob(current);
  }
  render();
}

async function checkAgain() {
  const current = job();
  if (!current) {
    return;
  }
  current.timedOut = false;
  current.startedAt = Date.now();
  current.error = "";
  await saveJob(current);
  render();
  ensurePoll();
  try {
    await tick();
  } catch (error) {
    await failJob(error);
  }
}

async function clearJob() {
  await saveJob(null);
  render();
}

async function failJob(error) {
  const current = job();
  if (error && error.status === 401) {
    state.signedIn = false;
  }
  if (current) {
    current.phase = "failed";
    current.error = error && error.message ? error.message : "Request failed.";
    await saveJob(current);
  }
  render();
}

function showMessage(message) {
  errorLine.hidden = false;
  errorLine.textContent = message;
}

document.getElementById("signIn").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  const clientUrl = (response && response.clientUrl ? response.clientUrl : "").replace(/\/$/, "");
  await chrome.tabs.create({ url: clientUrl + "/extension-auth" });
});

document.getElementById("signOut").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "signOut" });
  state.signedIn = false;
  state.balance = null;
  state.subscription = null;
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) {
    refresh().catch(failJob);
  }
  if (area !== "session") {
    return;
  }
  if (changes.pendingSource && document.activeElement !== sourceBox) {
    sourceBox.value = changes.pendingSource.newValue || "";
  }
  if (changes.sourceApproximate) {
    state.sourceApproximate = Boolean(changes.sourceApproximate.newValue);
    approximate.hidden = !state.sourceApproximate;
  }
});

refresh().catch((error) => {
  account.textContent = error.message || "Could not load the extension.";
});
