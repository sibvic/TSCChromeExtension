(function () {
  function readMonaco() {
    const monaco = window.monaco;
    if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") {
      return "";
    }
    const values = monaco.editor.getModels().map((model) => {
      try {
        return model.getValue();
      } catch {
        return "";
      }
    }).filter(Boolean);
    const pine = values.filter((text) => /@version\s*=/.test(text) || /\b(indicator|strategy|study)\s*\(/.test(text));
    const pool = pine.length ? pine : values;
    pool.sort((left, right) => right.length - left.length);
    return pool[0] || "";
  }

  function looksLikePine(text) {
    return /@version\s*=/.test(text) || /\b(indicator|strategy|study)\s*\(/.test(text);
  }

  function readDom() {
    const lines = document.querySelectorAll(".monaco-editor .view-line");
    if (!lines.length) {
      return "";
    }
    const text = Array.from(lines).map((line) => line.textContent.replace(/\u00a0/g, " ")).join("\n");
    return looksLikePine(text) ? text : "";
  }

  function readPublishedViewer() {
    const editors = document.querySelectorAll('[class*="monaco-editor-tv-pine"]');
    let best = "";
    for (const editor of editors) {
      const hidden = getComputedStyle(editor).visibility === "hidden" || editor.offsetParent === null;
      const lines = [];
      for (const child of editor.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "SPAN") {
          lines.push((child.textContent || "").replace(/\u00a0/g, " "));
        }
      }
      const text = lines.join("\n");
      if (!looksLikePine(text)) {
        continue;
      }
      if (!hidden) {
        return text;
      }
      if (text.length > best.length) {
        best = text;
      }
    }
    return best;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "tsc-read-pine") {
      return;
    }
    let text = "";
    let approximate = false;
    try {
      text = readMonaco();
      if (!text) {
        text = readDom();
        approximate = Boolean(text);
      }
      if (!text) {
        text = readPublishedViewer();
        approximate = false;
      }
    } catch {
      text = "";
    }
    window.postMessage({
      type: "tsc-pine-source",
      requestId: event.data.requestId,
      text,
      approximate
    }, "*");
  });
})();
