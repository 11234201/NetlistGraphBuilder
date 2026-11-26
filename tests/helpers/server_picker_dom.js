// A small DOM double for picker behavior; browser tests own layout and native focus trapping.
export function makePickerDocument() {
  const controls = new Map();
  let document;
  function element(tag = "div") {
    const attributes = new Map(), listeners = new Map();
    let ownText = "", html = "";
    const node = {
      tagName:tag.toUpperCase(), children:[], value:"", type:"", disabled:false,
      hidden:false, open:false, checked:false, className:"", dataset:{}, style:{},
      isConnected:true, parentElement:null,
      get textContent() { return ownText + this.children.map(child => child.textContent ?? String(child)).join(""); },
      set textContent(value) { ownText = String(value ?? ""); this.children = []; },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        this.children = [];
        const stack = [this], voidTags = new Set(["input", "br", "img", "hr", "meta", "link"]);
        for (const match of value.matchAll(/<(\/?)([\w-]+)\b([^>]*)>/g)) {
          const [, closing, tag, attrs] = match;
          if (closing) { if (stack.length > 1) stack.pop(); continue; }
          const control = element(tag);
          for (const attribute of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
            const [, key, value = ""] = attribute;
            control.setAttribute(key, value);
            if (key.startsWith("data-")) controls.set(`[${key}]`, control);
            if (key === "class") control.className = value;
            if (["type", "value", "id"].includes(key)) control[key] = value;
            if (["hidden", "disabled"].includes(key)) control[key] = true;
          }
          stack.at(-1).append(control);
          if (!voidTags.has(tag)) stack.push(control);
        }
      },
      append(...items) {
        for (const item of items) {
          const child = typeof item === "string" ? {textContent:item} : item;
          child.parentElement = this;
          this.children.push(child);
        }
      },
      appendChild(item) { this.append(item); return item; },
      replaceChildren(...items) { ownText = ""; this.children = []; this.append(...items); },
      add(item) { this.append(item); },
      setAttribute(key, value) { attributes.set(key, String(value)); },
      getAttribute(key) { return attributes.get(key) ?? null; },
      removeAttribute(key) { attributes.delete(key); },
      toggleAttribute(key, force = !attributes.has(key)) {
        if (force) this.setAttribute(key, ""); else this.removeAttribute(key);
        return force;
      },
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(listener);
      },
      removeEventListener(name, listener) {
        listeners.set(name, (listeners.get(name) || []).filter(item => item !== listener));
      },
      dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        this["on" + event.type]?.(event);
        for (const listener of listeners.get(event.type) || []) listener(event);
        return !event.defaultPrevented;
      },
      showModal() { this.open = true; },
      close() { this.open = false; this.dispatchEvent(eventOf("close")); },
      focus() { document.activeElement = this; },
      select() { this.focus(); },
      contains(candidate) {
        return this === candidate || this.children.some(child => child.contains?.(candidate));
      },
      querySelector(key) {
        if (/^\[data-[\w-]+\]$/.test(key)) {
          if (!controls.has(key)) controls.set(key, element());
          return controls.get(key);
        }
        return descendants(this).find(child => matches(child, key)) || null;
      },
      querySelectorAll(key) {
        return descendants(this).filter(child => key.split(",").some(selector => matches(child, selector.trim())));
      },
      get options() { return this.children; }
    };
    node.classList = {
      contains:value => node.className.split(/\s+/).includes(value),
      add(...values) { node.className = [...new Set([...node.className.split(/\s+/).filter(Boolean), ...values])].join(" "); },
      remove(...values) { node.className = node.className.split(/\s+/).filter(value => !values.includes(value)).join(" "); },
      toggle(value, force = !this.contains(value)) { if (force) this.add(value); else this.remove(value); return force; }
    };
    return node;
  }
  document = {createElement:element, createTextNode:text => ({textContent:text}), activeElement:null};
  document.body = element("body");
  document.activeElement = element("button");
  return {document, controls, control:name => controls.get(`[data-${name}]`)};
}

export function descendants(node) {
  return (node.children || []).flatMap(child => [child, ...descendants(child)]);
}
function matches(node, selector) {
  if (selector === "input[type=checkbox]" || selector === 'input[type="checkbox"]')
    return node.tagName === "INPUT" && node.type === "checkbox";
  if (selector.startsWith(".")) return node.classList?.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}
export function eventOf(type, fields = {}) {
  return {type, defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...fields};
}
export const settle = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
export function fakeClock() {
  let nextId = 0, now = 0;
  const scheduled = new Map();
  return {
    setTimeout(callback, delay) { const id = ++nextId; scheduled.set(id, {at:now + delay, callback}); return id; },
    clearTimeout(id) { scheduled.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, task] of [...scheduled]) if (task.at <= now) { scheduled.delete(id); task.callback(); }
    },
    get pending() { return scheduled.size; }
  };
}
