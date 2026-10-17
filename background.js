import { config } from "./config.js";

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function joinUrl(base, path) {
  return base.replace(/\/$/, "") + path;
}

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

async function getToken() {
  const stored = await chrome.storage.local.get("token");
  return stored.token || "";
}

async function request(path, options = {}) {
  const token = await getToken();
  if (!token) {
    throw new ApiError("Sign in again.", 401, null);
  }
  const headers = { Authorization: "Bearer " + token };
  let body;
  if (Object.prototype.hasOwnProperty.call(options, "json")) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let response;
  try {
    response = await fetch(joinUrl(config.serverUrl, path), {
      method: options.method || "GET",
      headers,
      body
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0, null);
  }
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (response.status === 401) {
    await chrome.storage.local.remove("token");
    throw new ApiError("Sign in again.", 401, parsed);
  }
  if (!response.ok) {
    const message = typeof parsed === "string" && parsed
      ? parsed
      : "Request failed (" + response.status + ").";
    throw new ApiError(message, response.status, parsed);
  }
  return parsed;
}

function toBase64(data) {
  if (typeof data === "string") {
    return data;
  }
  if (!Array.isArray(data)) {
    throw new ApiError("The server did not return a file.", 0, null);
  }
  const bytes = Uint8Array.from(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileNameOf(file) {
  const raw = String(prop(file, "FileName") || "converted.txt");
  const base = raw.split(/[/\\]/).pop() || "converted.txt";
  return base.replace(/[<>:"|?*\u0000-\u001F]/g, " ").trim() || "converted.txt";
}

function sidebarApi() {
  if (typeof browser !== "undefined" && browser.sidebarAction) {
    return browser.sidebarAction;
  }
  if (chrome.sidebarAction) {
    return chrome.sidebarAction;
  }
  return null;
}

function bytesFromBase64(data) {
  const binary = atob(toBase64(data));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function downloadFile(scriptId, fileId) {
  const file = await request("/scripts/" + scriptId + "/download/" + fileId);
  const fileName = fileNameOf(file);
  const payload = prop(file, "Data");
  if (sidebarApi()) {
    const url = URL.createObjectURL(new Blob([bytesFromBase64(payload)], { type: "application/octet-stream" }));
    try {
      await (globalThis.browser || chrome).downloads.download({ url, filename: fileName, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } else {
    await chrome.downloads.download({
      url: "data:application/octet-stream;base64," + toBase64(payload),
      filename: fileName,
      saveAs: true
    });
  }
  return { fileName };
}

function failure(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : "Request failed.",
    status: error && error.status ? error.status : 0,
    body: error ? error.body ?? null : null
  };
}

async function handle(message) {
  switch (message.type) {
    case "getJob": {
      const session = await chrome.storage.session.get("job");
      return { ok: true, job: session.job || null };
    }
    case "getState": {
      const token = await getToken();
      const session = await chrome.storage.session.get(["job", "pendingSource", "sourceApproximate"]);
      let balance = null;
      let signedIn = Boolean(token);
      if (token) {
        try {
          balance = await request("/billing/balance");
        } catch (error) {
          if (error.status === 401) {
            signedIn = false;
          } else {
            throw error;
          }
        }
      }
      return {
        ok: true,
        signedIn,
        balance,
        job: session.job || null,
        pendingSource: session.pendingSource || "",
        sourceApproximate: Boolean(session.sourceApproximate),
        clientUrl: config.clientUrl
      };
    }
    case "signOut":
      await chrome.storage.local.remove("token");
      return { ok: true };
    case "addScript":
      return { ok: true, data: await request("/scripts", { method: "POST", json: message.source }) };
    case "getScript":
      return { ok: true, data: await request("/scripts/" + message.scriptId) };
    case "convert":
      return {
        ok: true,
        data: await request(
          "/scripts/" + message.scriptId + "/convert/" + encodeURIComponent(message.fileType),
          { method: "POST", json: message.options || {} }
        )
      };
    case "unlock":
      return {
        ok: true,
        data: await request("/scripts/" + message.scriptId + "/unlock/" + message.fileId, { method: "POST", json: {} })
      };
    case "balance":
      return { ok: true, data: await request("/billing/balance") };
    case "download":
      return { ok: true, data: await downloadFile(message.scriptId, message.fileId) };
    default:
      return { ok: false, error: "Unknown request.", status: 0, body: null };
  }
}

function enablePanelOnClick() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    return;
  }
  const sidebar = sidebarApi();
  const action = (typeof browser !== "undefined" && browser.action) || chrome.action;
  if (!sidebar || !action || enablePanelOnClick.bound) {
    return;
  }
  enablePanelOnClick.bound = true;
  action.onClicked.addListener(() => {
    const toggle = sidebar.toggle || sidebar.open;
    const result = toggle.call(sidebar);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  });
}

function notifyJob(job) {
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) {
        continue;
      }
      chrome.tabs.sendMessage(tab.id, { type: "jobChanged", job: job || null }).catch(() => {});
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.job) {
    notifyJob(changes.job.newValue || null);
  }
});

chrome.runtime.onInstalled.addListener(enablePanelOnClick);
enablePanelOnClick();

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "auth" || typeof message.token !== "string" || message.token.length < 20) {
    sendResponse({ ok: false });
    return;
  }
  chrome.storage.local.set({ token: message.token.trim() }).then(() => {
    sendResponse({ ok: true });
    if (sender.tab && sender.tab.id != null) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
  });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    sendResponse({ ok: false, error: "Empty request." });
    return;
  }
  if (message.type === "openPanel") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: "Open a TradingView tab first." });
      return;
    }
    const sidebar = sidebarApi();
    const open = sidebar
      ? sidebar.open()
      : chrome.sidePanel.open({ tabId });
    Promise.resolve(open).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error && error.message ? error.message : "Could not open the panel." })
    );
    return true;
  }
  if (message.type === "setSource") {
    chrome.storage.session.set({
      pendingSource: message.source || "",
      sourceApproximate: Boolean(message.approximate)
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  handle(message).then(sendResponse).catch((error) => sendResponse(failure(error)));
  return true;
});
