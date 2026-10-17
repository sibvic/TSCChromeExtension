const ACTIVE_PHASES = ["uploading", "parsing", "awaitingOptions", "converting", "awaitingPayment", "downloading"];

function readPineSource() {
  const requestId = String(Date.now()) + Math.random().toString(16).slice(2);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ text: "", approximate: false });
    }, 800);
    function onMessage(event) {
      if (event.source !== window || !event.data || event.data.type !== "tsc-pine-source" || event.data.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({ text: event.data.text || "", approximate: Boolean(event.data.approximate) });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "tsc-read-pine", requestId }, "*");
  });
}

function findPineLabel() {
  if (!document.body) {
    return null;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.trim() === "Pine Editor") {
      return node.parentElement;
    }
  }
  return null;
}

function findSourceCodeTab() {
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    if (tab.getAttribute("aria-selected") !== "true") {
      continue;
    }
    const label = (tab.getAttribute("data-overflow-tooltip-text") || tab.textContent || "").trim();
    if (label === "Source code" || tab.id === "code") {
      return tab;
    }
  }
  return null;
}

function isTransparent(color) {
  return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function textElement(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.trim()) {
      return node.parentElement;
    }
  }
  return root;
}

function visualBox(element) {
  if (!element || element.nodeType !== 1) {
    return null;
  }
  const style = getComputedStyle(element);
  const radius = style.borderRadius && style.borderRadius !== "0px";
  const fill = !isTransparent(style.backgroundColor) || !isTransparent(getComputedStyle(element, "::before").backgroundColor);
  if (fill && radius) {
    return element;
  }
  for (const child of element.children) {
    const found = visualBox(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function horizontalPadding(element) {
  const style = getComputedStyle(element);
  let start = parseFloat(style.paddingLeft) || 0;
  let end = parseFloat(style.paddingRight) || 0;
  if (start + end >= 8) {
    return { start, end };
  }
  for (const child of element.children) {
    const childStyle = getComputedStyle(child);
    const childStart = parseFloat(childStyle.paddingLeft) || 0;
    const childEnd = parseFloat(childStyle.paddingRight) || 0;
    if (childStart + childEnd > start + end) {
      start = childStart;
      end = childEnd;
    }
  }
  return { start, end };
}

function applyReferenceStyle(host, reference) {
  const button = host && host._tscButton;
  if (!button || !reference) {
    return;
  }
  const box = visualBox(reference) || reference;
  const boxStyle = getComputedStyle(box);
  const textStyle = getComputedStyle(textElement(reference));
  const padding = horizontalPadding(box);
  if (boxStyle.height && boxStyle.height !== "auto" && boxStyle.height !== "0px") {
    button.style.height = boxStyle.height;
  }
  if (padding.start + padding.end >= 8) {
    button.style.paddingLeft = padding.start + "px";
    button.style.paddingRight = padding.end + "px";
  }
  if (boxStyle.borderRadius && boxStyle.borderRadius !== "0px") {
    button.style.borderRadius = boxStyle.borderRadius;
  }
  button.style.fontFamily = textStyle.fontFamily;
  button.style.fontSize = textStyle.fontSize;
  button.style.fontWeight = textStyle.fontWeight;
  button.style.lineHeight = textStyle.lineHeight;
  button.style.letterSpacing = textStyle.letterSpacing;
  const parent = reference.parentElement;
  const parentStyle = parent ? getComputedStyle(parent) : null;
  const gap = parentStyle ? parentStyle.columnGap || parentStyle.gap : "";
  host.style.marginLeft = gap && gap !== "normal" && gap !== "0px" ? "0" : "8px";
}

function createButton(reference) {
  const host = document.createElement("span");
  host.dataset.tscConvertHost = "1";
  host.style.display = "inline-flex";
  host.style.alignSelf = "center";
  host.style.marginLeft = "8px";
  host.style.verticalAlign = "middle";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 34px;
      margin: 0;
      padding: 0 16px;
      border: 0;
      border-radius: 80px;
      background: #2962ff;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
      font-size: 14px;
      font-style: normal;
      font-weight: 500;
      line-height: 18px;
      letter-spacing: normal;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    button:hover:not(:disabled) {
      background: #1e53e5;
    }
    button:active:not(:disabled) {
      background: #1848cc;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Convert";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: "openPanel" });
    readPineSource().then((result) => {
      chrome.runtime.sendMessage({
        type: "setSource",
        source: result.text,
        approximate: result.approximate
      });
    });
  });
  shadow.append(style, button);
  host._tscButton = button;
  applyReferenceStyle(host, reference);
  return host;
}

function applyJob(job) {
  const host = document.querySelector("[data-tsc-convert-host]");
  if (!host || !host._tscButton) {
    return;
  }
  const phase = job && job.phase;
  const running = Boolean(phase && ACTIVE_PHASES.includes(phase) && !job.timedOut);
  host._tscButton.disabled = running;
  host._tscButton.textContent = running ? "Converting…" : "Convert";
}

async function refreshButton() {
  const host = document.querySelector("[data-tsc-convert-host]");
  if (!host || !host._tscButton) {
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "getJob" });
    applyJob(response && response.job);
  } catch {
    applyJob(null);
  }
}

let scheduled = false;
function schedulePlace() {
  if (scheduled) {
    return;
  }
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    placeButton();
  }, 400);
}

function placeButton() {
  const label = findPineLabel();
  const sourceTab = label ? null : findSourceCodeTab();
  const reference = sourceTab || (label && label.parentElement ? label.parentElement.querySelector("button") : null);
  const existing = document.querySelector("[data-tsc-convert-host]");
  if (label && label.parentElement) {
    if (existing && existing.parentElement === label.parentElement) {
      applyReferenceStyle(existing, reference);
      return;
    }
    existing?.remove();
    label.parentElement.appendChild(createButton(reference));
    refreshButton();
    return;
  }
  if (sourceTab && sourceTab.parentElement) {
    if (existing && existing.previousElementSibling === sourceTab) {
      applyReferenceStyle(existing, sourceTab);
      return;
    }
    existing?.remove();
    sourceTab.insertAdjacentElement("afterend", createButton(sourceTab));
    refreshButton();
  } else {
    existing?.remove();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "jobChanged") {
    applyJob(message.job);
  }
});

placeButton();
const observer = new MutationObserver(schedulePlace);
observer.observe(document.documentElement, { childList: true, subtree: true });
