"use strict";

const helpers = require("./helpers.js");

const {core: core} = require("photoshop");

const {UserMessageError: UserMessageError, blendModeValue: blendModeValue, moveLayerToTop: moveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup} = helpers;

const commandOptions = {
  dialogOptions: "silent"
};

const batchPlay = commands => helpers.batchPlay(commands, commandOptions);

const selectLayerById = id => helpers.selectLayerById(id, commandOptions);

const selectTopmostLayer = doc => helpers.selectTopmostLayer(doc, commandOptions);

const makeCurvesAdjustmentLayer = (name, track) => helpers.makeCurvesAdjustmentLayer(name, track, commandOptions);

const setActiveCurvesAdjustment = points => helpers.setActiveCurvesAdjustment(points, commandOptions);

const setCurrentLayerProperties = props => helpers.setCurrentLayerProperties(props, commandOptions);

const DODGE_LAYER_NAME = "光を描く（覆い焼きカラー）";

const BURN_LAYER_NAME = "影を描く（焼き込みカラー）";

async function makeLayerGroup(name, track) {
  let beforeId = null;
  try {
    beforeId = await getTargetLayerId();
  } catch (_) {
    beforeId = null;
  }
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layerSection"
    } ]
  } ]);
  const groupId = await getTargetLayerId();
  if (beforeId == null || groupId == null || groupId === beforeId) {
    throw new UserMessageError("グループを作成できませんでした。もう一度お試しください");
  }
  if (typeof track === "function") {
    track(groupId);
  }
  await setCurrentLayerProperties({
    name: name
  });
  return groupId;
}

async function deselect() {
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
  } ]);
}

async function fillLayerMaskBlack() {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    } ],
    makeVisible: false
  }, {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "black"
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    },
    _options: {
      dialogOptions: "silent"
    }
  } ]);
}

async function makeCurveLayer(name, midpointOutput, track) {
  const layerId = await makeCurvesAdjustmentLayer(name, track);
  await setActiveCurvesAdjustment([ [ 0, 0 ], [ 128, midpointOutput ], [ 255, 255 ] ]);
  await fillLayerMaskBlack();
  return layerId;
}

async function makeGrayOverlayLayer(track) {
  let beforeId = null;
  try {
    beforeId = await getTargetLayerId();
  } catch (_) {
    beforeId = null;
  }
  if (beforeId == null) {
    throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
  }
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer",
      name: "D&B グレー"
    }
  } ]);
  const layerId = await getTargetLayerId();
  if (layerId == null || layerId === beforeId) {
    throw new UserMessageError("「D&B グレー」レイヤーを作成できませんでした。もう一度お試しください");
  }
  if (typeof track === "function") {
    track(layerId);
  }
  await batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "color"
    },
    color: {
      _obj: "RGBColor",
      red: 128,
      grain: 128,
      blue: 128
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    },
    _options: {
      dialogOptions: "silent"
    }
  } ]);
  await setCurrentLayerProperties({
    name: "D&B グレー",
    blendMode: "overlay"
  });
  return layerId;
}

async function prepareBrush(options = {}) {
  const red = options.red == null ? 255 : options.red;
  const green = options.green == null ? 255 : options.green;
  const blue = options.blue == null ? 255 : options.blue;
  const opacity = options.opacity == null ? 10 : options.opacity;
  const manualGuidance = [];
  const attempt = async (work, note) => {
    try {
      if (!await work()) throw new Error("設定の読み返しが一致しません");
      return true;
    } catch (_) {
      manualGuidance.push(note);
      return false;
    }
  };
  const toolApplied = await attempt(async () => {
    await batchPlay([ {
      _obj: "select",
      _target: [ {
        _ref: "paintbrushTool"
      } ]
    } ]);
    return helpers.app.currentTool.id === "paintbrushTool";
  }, "ブラシツールを手で選択してください");
  await attempt(async () => {
    await batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "color",
        _property: "foregroundColor"
      } ],
      to: {
        _obj: "RGBColor",
        red: red,
        grain: green,
        blue: blue
      }
    } ]);
    const rgb = helpers.app.foregroundColor.rgb;
    return Math.abs(rgb.red - red) <= 2 && Math.abs(rgb.green - green) <= 2 && Math.abs(rgb.blue - blue) <= 2;
  }, `描画色をRGB(${red},${green},${blue})に手で設定してください`);
  const setPercent = async (key, value) => {
    if (!toolApplied) return false;
    await batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "paintbrushTool"
      } ],
      to: {
        _obj: "currentToolOptions",
        [key]: {
          _unit: "percentUnit",
          _value: value
        }
      }
    } ]);
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: "currentToolOptions"
      }, {
        _ref: "application",
        _enum: "ordinal",
        _value: "targetEnum"
      } ]
    } ]);
    const actual = result && result[0] && result[0].currentToolOptions && result[0].currentToolOptions[key];
    return actual != null && Math.abs(Number(typeof actual === "object" ? actual._value : actual) - value) < .5;
  };
  await attempt(() => setPercent("opacity", opacity), `ブラシの不透明度を${opacity}%に手で設定してください`);
  const flowApplied = options.flow == null ? null : await attempt(() => setPercent("flow", options.flow), `ブラシの流量を${options.flow}%に手で設定してください`);
  return {
    flowApplied: flowApplied,
    manualGuidance: manualGuidance
  };
}

async function selectVerifiedLayer(layerId) {
  await selectLayerById(layerId);
  const actual = await getTargetLayerId();
  if (actual !== layerId) {
    throw new UserMessageError(`描画対象の選択を確認できませんでした（予定ID:${layerId} / 実際ID:${actual}）`);
  }
}

function targetPixels(doc) {
  const components = Array.from(doc.componentChannels || []);
  if (components.length !== 3) throw new UserMessageError("ピクセルの描画先を確認できませんでした");
  doc.activeChannels = components;
  const actual = Array.from(doc.activeChannels || []);
  if (actual.length !== components.length || actual.some((channel, index) => channel.name !== components[index].name || channel.kind !== components[index].kind)) {
    throw new UserMessageError("ピクセルを描画先に選択できませんでした");
  }
}

async function readMaskState(layerId, expectedMask) {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const layer = result && result[0];
  if (!layer || layer.layerID !== layerId || layer.hasUserMask !== expectedMask) {
    throw new UserMessageError(`マスク作成対象の状態が一致しません（予定ID:${layerId} / 実際ID:${layer && layer.layerID} / マスク:${layer && layer.hasUserMask}）`);
  }
}

async function requireMaskSelection() {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "selection"
    }, {
      _ref: "document",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const selection = result && result[0] && result[0].selection;
  const bounds = selection && (selection.bounds || selection);
  if (!bounds || ![ "top", "left", "bottom", "right" ].every(key => bounds[key] != null)) {
    throw new UserMessageError("中間調の選択範囲を確認できないため、マスク作成を中止しました");
  }
}

async function makeNeutralPaintLayer(name, fillValue, blendMode, track) {
  let beforeId = null;
  try {
    beforeId = await getTargetLayerId();
  } catch (_) {
    beforeId = null;
  }
  if (beforeId == null) {
    throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
  }
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer",
      name: name
    }
  } ]);
  const layerId = await getTargetLayerId();
  if (layerId == null || layerId === beforeId) {
    throw new UserMessageError(`「${name}」レイヤーを作成できませんでした。もう一度お試しください`);
  }
  if (typeof track === "function") {
    track(layerId);
  }
  await batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: fillValue
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    },
    _options: {
      dialogOptions: "silent"
    }
  } ]);
  await setCurrentLayerProperties({
    name: name,
    blendMode: blendMode
  });
  return layerId;
}

async function getTargetLayerId() {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "layerID"
    }, {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const layerId = result && result[0] && result[0].layerID;
  if (layerId == null) {
    throw new Error("レイヤーIDを取得できませんでした");
  }
  return layerId;
}

const DB_MASK_SELECTION = "D&B 中間調退避（自動生成）";

const DB_TEMP_CHANNELS = [ "D&B 作業用1（自動生成）", "D&B 作業用2（自動生成）" ];

async function loadCompositeLuminositySelection() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _enum: "channel",
      _value: "RGB"
    }
  } ]);
}

async function duplicateSelectionToChannel(name) {
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    name: name
  } ]);
}

async function subtractChannelFromSelection(name) {
  await batchPlay([ {
    _obj: "subtract",
    _target: [ {
      _ref: "channel",
      _name: name
    } ],
    from: {
      _ref: "channel",
      _property: "selection"
    }
  } ]);
}

async function selectAllPixels() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _enum: "ordinal",
      _value: "allEnum"
    }
  } ]);
}

async function invertSelection() {
  await batchPlay([ {
    _obj: "inverse"
  } ]);
}

async function deleteTempChannelSilently(doc, name) {
  let domReadable = false;
  try {
    domReadable = !!(doc && doc.channels);
  } catch (_) {
    domReadable = false;
  }
  if (!domReadable) {
    try {
      await batchPlay([ {
        _obj: "delete",
        _target: [ {
          _ref: "channel",
          _name: name
        } ]
      } ]);
    } catch (_) {}
    return;
  }
  try {
    for (const channel of Array.from(doc.channels)) {
      if (String(channel && channel.name || "") !== name || typeof channel.remove !== "function") {
        continue;
      }
      const kind = String(channel && channel.kind || "").toLowerCase();
      if (kind && (kind.includes("component") || kind.includes("spot"))) {
        continue;
      }
      await channel.remove();
    }
  } catch (_) {}
}

async function deleteDbTempChannels(doc) {
  for (const name of DB_TEMP_CHANNELS) {
    await deleteTempChannelSilently(doc, name);
  }
}

function tempChannelExistsDom(doc, name) {
  try {
    const channels = doc && doc.channels;
    if (!channels) {
      return null;
    }
    return Array.from(channels).some(channel => String(channel && channel.name || "") === name);
  } catch (_) {
    return null;
  }
}

async function buildMidtoneSelection(doc) {
  await deleteDbTempChannels(doc);
  for (const name of DB_TEMP_CHANNELS) {
    if (tempChannelExistsDom(doc, name) === true) {
      throw new UserMessageError(`作業用チャンネル「${name}」を削除できませんでした。` + "チャンネルパネルから手動で削除してから再実行してください");
    }
  }
  try {
    await loadCompositeLuminositySelection();
    await duplicateSelectionToChannel(DB_TEMP_CHANNELS[0]);
    await loadCompositeLuminositySelection();
    await invertSelection();
    await duplicateSelectionToChannel(DB_TEMP_CHANNELS[1]);
    await selectAllPixels();
    await subtractChannelFromSelection(DB_TEMP_CHANNELS[0]);
    await subtractChannelFromSelection(DB_TEMP_CHANNELS[1]);
  } finally {
    await deleteDbTempChannels(doc);
  }
}

async function addMaskFromSelection() {
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
      _value: "revealSelection"
    }
  } ]);
}

async function createDodgeBurnSet(mode = "curves") {
  return runModalWithCleanup("ドッジ&バーンセットを作成", async ({doc: doc, track: track, began: began}) => {
    began();
    await deselect();
    await selectTopmostLayer(doc);
    await makeLayerGroup("ドッジ&バーン", track);
    const groupLayer = Array.from(doc && doc.activeLayers || [])[0] || null;
    moveLayerToTop(doc, groupLayer);
    if (mode === "gray") {
      const grayId = await makeGrayOverlayLayer(track);
      await selectVerifiedLayer(grayId);
      targetPixels(doc);
      return prepareBrush();
    } else if (mode === "colorDodge") {
      const burnId = await makeNeutralPaintLayer(BURN_LAYER_NAME, "white", "colorBurn", track);
      const dodgeId = await makeNeutralPaintLayer(DODGE_LAYER_NAME, "black", "colorDodge", track);
      if (burnId === dodgeId) {
        throw new UserMessageError("レイヤー作成の結果を確認できませんでした。もう一度お試しください");
      }
      await buildMidtoneSelection(doc);
      await deleteTempChannelSilently(doc, DB_MASK_SELECTION);
      if (tempChannelExistsDom(doc, DB_MASK_SELECTION) === true) {
        throw new UserMessageError("中間調の退避チャンネルを削除できませんでした");
      }
      await requireMaskSelection();
      await duplicateSelectionToChannel(DB_MASK_SELECTION);
      const manualGuidance = [];
      try {
        for (const layerId of [ burnId, dodgeId ]) {
          await selectVerifiedLayer(layerId);
          await batchPlay([ {
            _obj: "set",
            _target: [ {
              _ref: "channel",
              _property: "selection"
            } ],
            to: {
              _ref: "channel",
              _name: DB_MASK_SELECTION
            }
          } ]);
          await requireMaskSelection();
          await readMaskState(layerId, false);
          await addMaskFromSelection();
          await readMaskState(layerId, true);
        }
      } finally {
        await deleteTempChannelSilently(doc, DB_MASK_SELECTION);
        if (tempChannelExistsDom(doc, DB_MASK_SELECTION) !== false) {
          manualGuidance.push(`退避チャンネル「${DB_MASK_SELECTION}」の削除を確認できませんでした。チャンネルパネルから手動で削除してください`);
        }
      }
      await deselect();
      await selectVerifiedLayer(dodgeId);
      targetPixels(doc);
      const brush = await prepareBrush({
        red: 255,
        green: 168,
        blue: 84,
        opacity: 100,
        flow: 5
      });
      brush.manualGuidance.push(...manualGuidance);
      return brush;
    } else {
      await makeCurveLayer("バーン（暗）", 96, track);
      await makeCurveLayer("ドッジ（明）", 160, track);
      return prepareBrush();
    }
  }, {
    rollbackOnError: true,
    commandOptions: commandOptions
  });
}

async function loadSelectionFromActiveLayerMask() {
  return runModal("マスクを選択範囲に読み込み", async ({doc: doc}) => {
    const layer = Array.from(doc && doc.activeLayers || [])[0] || null;
    if (!layer) {
      throw new UserMessageError("範囲として使いたいマスク付きレイヤー（例: ルミノシティマスクの「明部 2」）を選択してください");
    }
    await selectVerifiedLayer(layer.id);
    await readMaskState(layer.id, true);
    await batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "channel",
        _property: "selection"
      } ],
      to: {
        _ref: "channel",
        _enum: "channel",
        _value: "mask"
      }
    } ]);
    return {
      layerName: layer.name
    };
  });
}

async function clearSelection() {
  return runModal("選択範囲を解除", async () => {
    await deselect();
  });
}

function findLayerByNameDeep(doc, name) {
  const stack = Array.from(doc && doc.layers || []);
  while (stack.length > 0) {
    const layer = stack.shift();
    if (String(layer.name) === name) {
      return layer;
    }
    if (layer.layers) {
      stack.push(...Array.from(layer.layers));
    }
  }
  return null;
}

async function preparePaintTarget(layerName, brushOptions, label) {
  let paintDoc;
  const result = await runModal(label, async ({doc: doc}) => {
    paintDoc = doc;
    const layer = findLayerByNameDeep(doc, layerName);
    if (!layer) {
      throw new UserMessageError(`「${layerName}」レイヤーがありません。方式「光と影を描く」で「セットを作成」を先に実行してください`);
    }
    await selectVerifiedLayer(layer.id);
    targetPixels(doc);
    const result = await prepareBrush(brushOptions);
    await selectVerifiedLayer(layer.id);
    await batchPlay([ {
      _obj: "select",
      _target: [ {
        _ref: "channel",
        _enum: "channel",
        _value: "RGB"
      } ],
      makeVisible: false
    } ]);
    try {
      const activeLayers = Array.from(doc.activeLayers || []);
      if (activeLayers.length !== 1 || activeLayers[0].id !== layer.id) {
        throw new UserMessageError(`描画対象の選択を確認できませんでした（予定ID:${layer.id} / 実際ID:${activeLayers[0] && activeLayers[0].id}）`);
      }
      const components = Array.from(doc.componentChannels || []);
      const channels = Array.from(doc.activeChannels || []);
      if (components.length !== 3 || channels.length !== 3 || channels.some((channel, index) => channel.name == null || channel.kind == null || channel.name !== components[index].name || channel.kind !== components[index].kind)) {
        throw new UserMessageError("RGBのピクセルを描画先に選択できませんでした。マスクではなくRGBチャンネルを選択してください");
      }
    } catch (error) {
      if (error instanceof UserMessageError) throw error;
      throw new UserMessageError(`描画対象のレイヤーとRGBチャンネルを確認できませんでした: ${helpers.formatError(error)}`);
    }
    return result;
  });
  const {red: red, green: green, blue: blue} = brushOptions;
  const colorNote = `描画色をRGB(${red},${green},${blue})に手で設定してください`;
  const guideColor = () => {
    if (!result.manualGuidance.includes(colorNote)) result.manualGuidance.push(colorNote);
  };
  try {
    await core.executeAsModal(async () => {
      if (!helpers.app.activeDocument || helpers.app.activeDocument.id !== paintDoc.id) {
        throw new Error("描画色設定前にドキュメントが切り替わりました");
      }
      await batchPlay([ {
        _obj: "set",
        _target: [ {
          _ref: "color",
          _property: "foregroundColor"
        } ],
        to: {
          _obj: "RGBColor",
          red: red,
          grain: green,
          blue: blue
        }
      } ]);
    }, {
      commandName: label
    });
  } catch (_) {
    guideColor();
  }
  try {
    const rgb = helpers.app.foregroundColor.rgb;
    if (!(Math.abs(rgb.red - red) <= 2 && Math.abs(rgb.green - green) <= 2 && Math.abs(rgb.blue - blue) <= 2)) {
      guideColor();
    }
  } catch (_) {
    guideColor();
  }
  return result;
}

async function preparePaintDodge() {
  return preparePaintTarget(DODGE_LAYER_NAME, {
    red: 255,
    green: 168,
    blue: 84,
    opacity: 100,
    flow: 5
  }, "光を塗る準備");
}

async function preparePaintBurn() {
  return preparePaintTarget(BURN_LAYER_NAME, {
    red: 0,
    green: 0,
    blue: 0,
    opacity: 50,
    flow: 1
  }, "影を塗る準備");
}

module.exports = {
  clearSelection: clearSelection,
  createDodgeBurnSet: createDodgeBurnSet,
  loadSelectionFromActiveLayerMask: loadSelectionFromActiveLayerMask,
  preparePaintDodge: preparePaintDodge,
  preparePaintBurn: preparePaintBurn,
  blendModeValue: blendModeValue
};
