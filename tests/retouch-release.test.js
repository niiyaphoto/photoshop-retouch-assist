"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const fs = require("node:fs");

const path = require("node:path");

const vm = require("node:vm");

const root = path.join(__dirname, "..");

const plugin = path.join(root, "plugin");

const html = fs.readFileSync(path.join(plugin, "index.html"), "utf8");

const published = fs.existsSync(path.join(root, "tools", "build-ccx.js"));

test("配布形態に対応したパネルとモジュールが揃う", () => {
  const hasPresets = fs.existsSync(path.join(plugin, "js", "ps", "presets.js"));
  assert.equal(hasPresets, !published);
  assert.equal(fs.existsSync(path.join(plugin, "js", "logic", "presetvalues.js")), !published);
  assert.equal(html.includes('data-section="presets"'), !published);
  if (published) {
    assert.doesNotMatch(fs.readFileSync(path.join(plugin, "js", "main.js"), "utf8"), /\bpresets\b|presetButtons|presetSCurve/);
  }
});

for (const readyState of [ "complete", "loading" ]) {
  test(`パネルがエラーなく読み込まれ各機能を初期化する (${readyState})`, () => {
    const elements = new Map;
    function element(id) {
      return {
        id: id,
        value: "",
        textContent: "",
        listeners: new Map,
        classList: {
          add() {},
          toggle() {
            return true;
          }
        },
        addEventListener(type, fn) {
          this.listeners.set(type, fn);
        },
        querySelectorAll() {
          return [];
        }
      };
    }
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
      elements.set(match[1], element(match[1]));
    }
    const titles = Array.from(html.matchAll(/data-section="([^"]+)"/g), m => {
      const title = element("");
      title.dataset = {
        section: m[1]
      };
      return title;
    });
    const hints = Array.from(html.matchAll(/<p class="hint">/g), () => {
      const hint = element("");
      hint.parentNode = {
        insertBefore() {}
      };
      return hint;
    });
    let domReady;
    const document = {
      readyState: readyState,
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll(selector) {
        return selector === ".section-title" ? titles : hints;
      },
      createElement() {
        return element("");
      },
      addEventListener(type, fn) {
        assert.equal(type, "DOMContentLoaded");
        domReady = fn;
      }
    };
    const cache = new Map;
    const loaded = [];
    const photoshop = {
      app: {
        documents: []
      },
      core: {},
      action: {},
      constants: {}
    };
    function load(filename) {
      filename = path.resolve(filename);
      assert.ok(filename.startsWith(plugin + path.sep), "モジュールはこのプラグイン内で解決する");
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = {
        exports: {}
      };
      cache.set(filename, module);
      loaded.push(path.relative(plugin, filename));
      const localRequire = request => {
        if (request === "photoshop") return photoshop;
        assert.ok(request.startsWith("."), `想定外の外部モジュール: ${request}`);
        return load(path.resolve(path.dirname(filename), request));
      };
      const context = vm.createContext({
        document: document,
        require: localRequire,
        module: module,
        exports: module.exports,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        console: console
      });
      new vm.Script(fs.readFileSync(filename, "utf8"), {
        filename: filename
      }).runInContext(context);
      return module.exports;
    }
    assert.doesNotThrow(() => load(path.join(plugin, "js", "main.js")));
    if (readyState === "loading") {
      assert.equal(typeof domReady, "function");
      assert.doesNotThrow(() => domReady());
    }
    for (const id of [ "analyzeLuminosity", "createMasks", "applyMidtone", "applyColorCast", "createSaturationMask", "createDodgeBurn", "dbPaintDodge", "dbPaintBurn", "cgCool", "cgWarm", "applyHighPass", "applyOrton", "applyOrtonColor" ]) {
      assert.equal(typeof elements.get(id).listeners.get("click"), "function", id);
    }
    if (published) assert.ok(loaded.every(name => !/preset/i.test(name))); else assert.equal(typeof elements.get("presetSCurve").listeners.get("click"), "function");
    assert.equal(titles.length, published ? 7 : 8);
    assert.ok(titles.every(title => title.listeners.has("click")));
  });
}
