"use strict";

const ps = require("photoshop");

const app = ps.app;

const core = ps.core;

const action = ps.action;

const constants = ps.constants;

class UserMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserMessageError";
  }
}

function enumText(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return String(value._value || value.value || value.name || "");
  }
  return String(value);
}

function getDocuments() {
  if (!app.documents) {
    return [];
  }
  try {
    return Array.from(app.documents);
  } catch (_) {
    return [];
  }
}

function getActiveDocument() {
  return app.activeDocument || getDocuments()[0] || null;
}

function ensureOpenDocument() {
  const doc = getActiveDocument();
  if (!doc) {
    throw new UserMessageError("ドキュメントを開いてください");
  }
  return doc;
}

function ensureSupportedDocument(doc) {
  const modeText = enumText(doc.mode || doc.colorMode).toLowerCase();
  if (modeText && !modeText.includes("rgb")) {
    throw new UserMessageError("RGB 8bit または 16bit のドキュメントで実行してください");
  }
  const bitsText = enumText(doc.bitsPerChannel || doc.bitDepth).toLowerCase();
  if (bitsText && !(bitsText.includes("8") || bitsText.includes("16") || bitsText.includes("eight") || bitsText.includes("sixteen"))) {
    throw new UserMessageError("RGB 8bit または 16bit のドキュメントで実行してください");
  }
}

async function batchPlay(commands, options = {}) {
  const labels = {
    make: "作成",
    set: "設定",
    select: "選択",
    fill: "塗りつぶし",
    get: "状態の読み取り",
    duplicate: "複製",
    delete: "削除",
    subtract: "選択範囲の減算",
    inverse: "選択範囲の反転"
  };
  const commandLabel = command => labels[command && command._obj] || "Photoshop操作";
  const {dialogOptions: dialogOptions, ...executionOptions} = options;
  const descriptors = dialogOptions ? commands.map(command => ({
    ...command,
    _options: {
      ...command._options,
      dialogOptions: dialogOptions
    }
  })) : commands;
  let result;
  try {
    result = await action.batchPlay(descriptors, {
      synchronousExecution: false,
      modalBehavior: "execute",
      ...executionOptions
    });
  } catch (error) {
    const reason = error && error.message && String(error.message) || (error == null ? "コマンドが失敗しました" : String(error)) || "コマンドが失敗しました";
    const description = [ ...new Set(commands.map(commandLabel)) ].join("／") || "Photoshop操作";
    throw new Error(`${description}に失敗しました: ${reason}`);
  }
  if (Array.isArray(result)) {
    for (const [index, entry] of result.entries()) {
      if (entry && entry._obj === "error") {
        const reason = entry.message && String(entry.message) || "コマンドが失敗しました";
        const command = commands[index] || {};
        throw new Error(`${commandLabel(command)}に失敗しました: ${reason}`);
      }
    }
  }
  return result;
}

async function suspendHistory(executionContext, doc, name, work, options = {}) {
  const hostControl = executionContext && executionContext.hostControl;
  if (!hostControl || !hostControl.suspendHistory || !doc || doc.id == null) {
    return work(async error => {
      error.message += "（履歴を復元できませんでした: 履歴停止APIが利用できません）";
      return false;
    });
  }
  const suspensionID = await hostControl.suspendHistory({
    documentID: doc.id,
    name: name
  });
  let resumed = false;
  const rollbackHistory = async error => {
    if (resumed) return false;
    resumed = true;
    try {
      await hostControl.resumeHistory(suspensionID, false);
      return true;
    } catch (rollbackError) {
      error.message += `（履歴を復元できませんでした: ${formatError(rollbackError)}）`;
      return false;
    }
  };
  try {
    const result = await work(rollbackHistory);
    resumed = true;
    await hostControl.resumeHistory(suspensionID);
    return result;
  } catch (error) {
    if (!resumed) {
      if (options.rollbackOnError === true) {
        await rollbackHistory(error);
      } else {
        resumed = true;
        await hostControl.resumeHistory(suspensionID);
      }
    }
    throw error;
  }
}

async function runModal(name, work, options = {}) {
  const doc = ensureOpenDocument();
  ensureSupportedDocument(doc);
  try {
    return await core.executeAsModal(async executionContext => {
      const active = app.activeDocument;
      if (!active || active.id == null || doc.id == null || active.id !== doc.id) {
        throw new UserMessageError("処理の開始前に別の写真へ切り替わったため、中止しました。もう一度お試しください");
      }
      return suspendHistory(executionContext, doc, name, rollbackHistory => work({
        app: app,
        action: action,
        batchPlay: batchPlay,
        doc: doc,
        executionContext: executionContext,
        rollbackHistory: rollbackHistory
      }), options);
    }, {
      commandName: name,
      historyStateInfo: {
        name: name,
        target: doc.id == null ? undefined : [ {
          _ref: "document",
          _id: doc.id
        } ]
      }
    });
  } catch (caught) {
    throw caught instanceof Error ? caught : new Error(formatError(caught));
  }
}

function formatError(error) {
  if (!error) {
    return "処理に失敗しました";
  }
  return error.message || String(error);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

const BLEND_MODES = {
  overlay: "overlay",
  softLight: "softLight",
  vividLight: "vividLight",
  screen: "screen",
  multiply: "multiply",
  colorDodge: "colorDodge",
  colorBurn: "colorBurn",
  lighten: "lighten",
  darken: "darken",
  normal: "normal"
};

function blendModeValue(value) {
  return BLEND_MODES[value] || BLEND_MODES.overlay;
}

const BLEND_CONSTANT_KEYS = {
  overlay: "OVERLAY",
  softLight: "SOFTLIGHT",
  vividLight: "VIVIDLIGHT",
  screen: "SCREEN",
  multiply: "MULTIPLY",
  colorDodge: "COLORDODGE",
  colorBurn: "COLORBURN",
  lighten: "LIGHTEN",
  darken: "DARKEN",
  normal: "NORMAL"
};

function domBlendMode(value) {
  const key = BLEND_CONSTANT_KEYS[value] || BLEND_CONSTANT_KEYS.overlay;
  const modes = constants && constants.BlendMode;
  return modes && modes[key] || blendModeValue(value);
}

function findLayerById(doc, layerId) {
  const stack = Array.from(doc && doc.layers || []);
  while (stack.length > 0) {
    const layer = stack.shift();
    if (layer.id === layerId) {
      return layer;
    }
    if (layer.layers) {
      stack.push(...Array.from(layer.layers));
    }
  }
  return null;
}

function applyLayerPropsViaDom(layer, props = {}) {
  if (!layer) {
    return false;
  }
  if (props.name) {
    layer.name = props.name;
    if (String(layer.name) !== String(props.name)) {
      return false;
    }
  }
  if (props.blendMode) {
    const expected = domBlendMode(props.blendMode);
    layer.blendMode = expected;
    if (String(layer.blendMode).toLowerCase() !== String(expected).toLowerCase()) {
      return false;
    }
  }
  if (props.opacity != null) {
    const expected = clampNumber(props.opacity, 0, 100);
    layer.opacity = expected;
    if (Math.abs(Number(layer.opacity) - expected) > 1) {
      return false;
    }
  }
  return true;
}

async function setLayerPropsViaBatchPlay(targetRef, props = {}, commandOptions = {}) {
  if (props.name) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        name: props.name
      }
    } ], commandOptions);
  }
  if (props.blendMode) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        mode: {
          _enum: "blendMode",
          _value: blendModeValue(props.blendMode)
        }
      }
    } ], commandOptions);
  }
  if (props.opacity != null) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        opacity: {
          _unit: "percentUnit",
          _value: clampNumber(props.opacity, 0, 100)
        }
      }
    } ], commandOptions);
  }
}

function verifyBlendMode(layer, blendMode) {
  if (!layer || !blendMode) {
    return;
  }
  const expected = String(domBlendMode(blendMode)).toLowerCase();
  const actual = String(layer.blendMode || "").toLowerCase();
  if (actual && actual !== expected) {
    throw new Error(`ブレンドモードを「${blendMode}」に設定できませんでした（現在値: ${layer.blendMode}）`);
  }
}

async function selectLayerById(layerId, commandOptions = {}) {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ],
    makeVisible: false
  } ], commandOptions);
}

async function selectTopmostLayer(doc, commandOptions = {}) {
  const top = doc && doc.layers && doc.layers[0];
  if (top && top.id != null) {
    await selectLayerById(top.id, commandOptions);
  }
}

function moveLayerToTop(doc, layer) {
  try {
    const top = doc && doc.layers && doc.layers[0];
    if (!layer || !top || layer.id === top.id || typeof layer.move !== "function") {
      return;
    }
    const placement = constants && constants.ElementPlacement && constants.ElementPlacement.PLACEBEFORE || "placeBefore";
    layer.move(top, placement);
  } catch (_) {}
}

function moveActiveLayerToTop(doc) {
  const layer = Array.from(doc && doc.activeLayers || [])[0] || null;
  moveLayerToTop(doc, layer);
}

async function setLayerPropsById(layerId, props = {}) {
  let layer = null;
  try {
    layer = findLayerById(getActiveDocument(), layerId);
    if (applyLayerPropsViaDom(layer, props)) {
      return;
    }
  } catch (_) {}
  await setLayerPropsViaBatchPlay([ {
    _ref: "layer",
    _id: layerId
  } ], props);
  verifyBlendMode(layer, props.blendMode);
}

async function getTargetLayerId(commandOptions = {}) {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: "layerID"
      }, {
        _ref: "layer",
        _enum: "ordinal",
        _value: "targetEnum"
      } ]
    } ], commandOptions);
    const id = result && result[0] && result[0].layerID;
    if (typeof id === "number") {
      return id;
    }
  } catch (_) {}
  try {
    const doc = getActiveDocument();
    const layer = Array.from(doc && doc.activeLayers || [])[0] || null;
    return layer && typeof layer.id === "number" ? layer.id : null;
  } catch (_) {
    return null;
  }
}

async function verifyLayerCreated(beforeId, message, commandOptions = {}) {
  const afterId = await getTargetLayerId(commandOptions);
  if (beforeId == null || afterId == null || afterId === beforeId) {
    throw new UserMessageError(message || "レイヤーを作成できませんでした。もう一度お試しください");
  }
  return afterId;
}

function topLevelLayerIds(doc) {
  try {
    return new Set(Array.from(doc && doc.layers || []).map(layer => layer.id));
  } catch (_) {
    return null;
  }
}

async function deleteLayerByIdSilently(layerId, commandOptions = {}) {
  try {
    await batchPlay([ {
      _obj: "delete",
      _target: [ {
        _ref: "layer",
        _id: layerId
      } ],
      deleteContained: true
    } ], commandOptions);
    return true;
  } catch (_) {
    return false;
  }
}

async function deselectSilently(commandOptions = {}) {
  try {
    await batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "channel",
        _property: "selection"
      } ],
      to: {
        _enum: "ordinal",
        _value: "none"
      }
    } ], commandOptions);
  } catch (_) {}
}

async function cleanupAfterFailure(state, io) {
  const {beforeTop: beforeTop, beforeActiveId: beforeActiveId, createdIds: createdIds} = state;
  let leftover = false;
  const seen = new Set;
  for (const id of [ ...createdIds ].reverse()) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (beforeTop && beforeTop.has(id)) {
      continue;
    }
    if (!await io.layerExists(id)) {
      continue;
    }
    await io.deleteLayer(id);
    if (await io.layerExists(id)) {
      leftover = true;
    }
  }
  if (beforeTop) {
    const after = await io.listTopLevelIds();
    if (after) {
      for (const id of after) {
        if (beforeTop.has(id) || seen.has(id)) {
          continue;
        }
        await io.deleteLayer(id);
        if (await io.layerExists(id)) {
          leftover = true;
        }
      }
    }
  }
  await io.deselect();
  if (beforeActiveId != null) {
    await io.selectLayer(beforeActiveId);
  }
  return leftover;
}

function cleanupIoFor(doc, commandOptions = {}) {
  return {
    layerExists: async id => {
      try {
        return !!findLayerById(doc, id);
      } catch (_) {
        return true;
      }
    },
    deleteLayer: id => deleteLayerByIdSilently(id, commandOptions),
    deselect: () => deselectSilently(commandOptions),
    selectLayer: async id => {
      try {
        await selectLayerById(id, commandOptions);
      } catch (_) {}
    },
    listTopLevelIds: async () => topLevelLayerIds(doc)
  };
}

async function runModalWithCleanup(name, work, options = {}) {
  return runModal(name, async context => {
    const doc = context.doc;
    const beforeTop = topLevelLayerIds(doc);
    let beforeActiveId = null;
    try {
      beforeActiveId = await getTargetLayerId(options.commandOptions);
    } catch (_) {
      beforeActiveId = null;
    }
    const createdIds = [];
    let mutated = false;
    const began = () => {
      mutated = true;
    };
    const track = layerId => {
      mutated = true;
      if (typeof layerId === "number") {
        createdIds.push(layerId);
      }
      return layerId;
    };
    try {
      return await work({
        ...context,
        track: track,
        began: began
      });
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(formatError(caught));
      if (!mutated) {
        throw error;
      }
      if (options.rollbackOnError === true && await context.rollbackHistory(error)) {
        throw error;
      }
      const leftover = await cleanupAfterFailure({
        beforeTop: beforeTop,
        beforeActiveId: beforeActiveId,
        createdIds: createdIds
      }, cleanupIoFor(doc, options.commandOptions));
      if (leftover && error && typeof error.message === "string") {
        error.message += "（作りかけのレイヤーを削除できませんでした。レイヤーパネルを確認してください）";
      }
      throw error;
    }
  }, options);
}

async function requireTargetLayerId(commandOptions = {}) {
  const beforeId = await getTargetLayerId(commandOptions);
  if (beforeId == null) {
    throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
  }
  return beforeId;
}

async function makeCurvesAdjustmentLayer(name, track, commandOptions = {}) {
  const beforeId = await requireTargetLayerId(commandOptions);
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "contentLayer"
    } ],
    using: {
      _obj: "contentLayer",
      name: name,
      type: {
        _obj: "curves",
        presetKind: {
          _enum: "presetKindType",
          _value: "presetKindDefault"
        }
      }
    }
  } ], commandOptions);
  const layerId = await verifyLayerCreated(beforeId, "カーブ調整レイヤーを作成できませんでした。もう一度お試しください", commandOptions);
  if (typeof track === "function") {
    track(layerId);
  }
  await setCurrentLayerProperties({
    name: name
  }, commandOptions);
  return layerId;
}

async function setActiveCurvesAdjustment(points, commandOptions = {}) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "adjustmentLayer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    to: {
      _obj: "curves",
      presetKind: {
        _enum: "presetKindType",
        _value: "presetKindCustom"
      },
      adjustment: [ {
        _obj: "curvesAdjustment",
        channel: {
          _ref: "channel",
          _enum: "channel",
          _value: "composite"
        },
        curve: points.map(([horizontal, vertical]) => ({
          _obj: "point",
          horizontal: horizontal,
          vertical: vertical
        }))
      } ]
    }
  } ], commandOptions);
}

async function stampVisible(doc) {
  const countLayers = () => doc && doc.layers ? Array.from(doc.layers).length : 0;
  const before = countLayers();
  try {
    await batchPlay([ {
      _obj: "mergeVisible",
      duplicate: true
    } ]);
  } catch (_) {}
  if (countLayers() > before) {
    return;
  }
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  if (countLayers() <= before) {
    throw new Error("作業用のコピーを作成できませんでした");
  }
}

async function addRevealAllMask() {
  await batchPlay([ {
    _obj: "make",
    new: {
      _class: "channel"
    },
    at: {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    },
    using: {
      _enum: "userMaskEnabled",
      _value: "revealAll"
    }
  } ]);
}

async function setSmartFilterById(layerId, filterDescriptor) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "filterFX",
      _index: 1
    }, {
      _ref: "layer",
      _id: layerId
    } ],
    filterFX: {
      _obj: "filterFX",
      filter: filterDescriptor
    }
  } ]);
}

async function setCurrentLayerProperties(options = {}, commandOptions = {}) {
  let layer = null;
  try {
    const doc = getActiveDocument();
    layer = Array.from(doc && doc.activeLayers || [])[0] || null;
    if (applyLayerPropsViaDom(layer, options)) {
      return;
    }
  } catch (_) {}
  await setLayerPropsViaBatchPlay([ {
    _ref: "layer",
    _enum: "ordinal",
    _value: "targetEnum"
  } ], options, commandOptions);
  verifyBlendMode(layer, options.blendMode);
}

module.exports = {
  UserMessageError: UserMessageError,
  addRevealAllMask: addRevealAllMask,
  app: app,
  action: action,
  batchPlay: batchPlay,
  constants: constants,
  blendModeValue: blendModeValue,
  clampNumber: clampNumber,
  ensureOpenDocument: ensureOpenDocument,
  ensureSupportedDocument: ensureSupportedDocument,
  findLayerById: findLayerById,
  formatError: formatError,
  getActiveDocument: getActiveDocument,
  getTargetLayerId: getTargetLayerId,
  requireTargetLayerId: requireTargetLayerId,
  verifyLayerCreated: verifyLayerCreated,
  makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer,
  moveActiveLayerToTop: moveActiveLayerToTop,
  moveLayerToTop: moveLayerToTop,
  runModal: runModal,
  runModalWithCleanup: runModalWithCleanup,
  cleanupAfterFailure: cleanupAfterFailure,
  selectLayerById: selectLayerById,
  selectTopmostLayer: selectTopmostLayer,
  setActiveCurvesAdjustment: setActiveCurvesAdjustment,
  setCurrentLayerProperties: setCurrentLayerProperties,
  setLayerPropsById: setLayerPropsById,
  setSmartFilterById: setSmartFilterById,
  stampVisible: stampVisible
};
