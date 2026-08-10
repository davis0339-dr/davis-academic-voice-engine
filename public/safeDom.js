(() => {
  "use strict";

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (!descriptor?.get || !descriptor?.set || window.__academicSafeDomInstalled) return;
  window.__academicSafeDomInstalled = true;

  const allowedTags = new Set([
    "A", "B", "BR", "BUTTON", "DETAILS", "DIV", "EM", "H3", "H4", "H5", "INPUT",
    "LABEL", "LI", "OL", "OPTION", "P", "PRE", "SECTION", "SELECT", "SPAN", "STRONG",
    "SUMMARY", "TABLE", "TBODY", "TD", "TEXTAREA", "TH", "THEAD", "TR", "UL",
  ]);
  const allowedAttrs = new Set([
    "class", "id", "href", "target", "rel", "readonly", "rows", "cols", "title", "role",
    "type", "value", "placeholder", "checked", "disabled", "selected", "for", "accept", "multiple",
    "maxlength", "minlength", "min", "max", "step", "autocomplete", "name", "size",
  ]);
  const dropEntirely = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM"]);
  const safeInputTypes = new Set(["text", "checkbox", "radio", "file", "number", "range", "search", "email", "url", "hidden"]);
  const safeButtonTypes = new Set(["button", "submit", "reset"]);

  function safeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return raw;
    try {
      const url = new URL(raw, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? raw : "";
    } catch {
      return "";
    }
  }

  function cleanElement(el) {
    const tag = el.tagName;
    if (!allowedTags.has(tag)) {
      if (dropEntirely.has(tag)) {
        el.remove();
        return;
      }
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
      return;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const allowedData = name.startsWith("data-") || name.startsWith("aria-");
      if (name.startsWith("on") || (!allowedAttrs.has(name) && !allowedData)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href") {
        const safe = safeUrl(attr.value);
        if (safe) el.setAttribute("href", safe);
        else el.removeAttribute("href");
      }
    }

    if (tag === "INPUT") {
      const type = String(el.getAttribute("type") || "text").toLowerCase();
      el.setAttribute("type", safeInputTypes.has(type) ? type : "text");
    }
    if (tag === "BUTTON") {
      const type = String(el.getAttribute("type") || "button").toLowerCase();
      el.setAttribute("type", safeButtonTypes.has(type) ? type : "button");
    }
    if (tag === "A" && el.getAttribute("target") === "_blank") {
      el.setAttribute("rel", "noopener noreferrer");
    }
  }

  function sanitize(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html ?? ""), "text/html");
    const elements = [...doc.body.querySelectorAll("*")];
    for (const el of elements) cleanElement(el);
    return descriptor.get.call(doc.body);
  }

  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      return descriptor.set.call(this, sanitize(value));
    },
  });

  const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function safeInsertAdjacentHTML(position, value) {
    return nativeInsertAdjacentHTML.call(this, position, sanitize(value));
  };
})();