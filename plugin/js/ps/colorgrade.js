"use strict";

const {UserMessageError: UserMessageError, batchPlay: batchPlay, formatError: formatError, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer, setCurrentLayerProperties: setCurrentLayerProperties} = require("./helpers.js");

const PRESETS = {
  cool: {
    name: "色を乗せる：青灰色（自動生成）",
    color: {
      red: 70,
      green: 86,
      blue: 110
    }
  },
  warm: {
    name: "色を乗せる：オレンジ（自動生成）",
    color: {
      red: 149,
      green: 133,
      blue: 110
    }
  }
};

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

function hasSelectionBounds(selection) {
  if (!selection || typeof selection !== "object") {
    return false;
  }
  const bounds = selection.bounds || selection;
  return [ "top", "left", "bottom", "right" ].every(key => bounds[key] != null);
}

async function hasActiveSelection() {
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
  if (!result || !result[0]) {
    throw new UserMessageError("選択範囲の状態を読み取れませんでした");
  }
  return hasSelectionBounds(result[0].selection);
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

function savedSelectionChannel(doc, name) {
  const channel = Array.from(doc.channels).find(entry => entry.name === name);
  const kind = String(channel && channel.kind || "").toLowerCase();
  if (!channel || kind.includes("component") || kind.includes("spot")) {
    throw new UserMessageError("選択範囲の退避チャンネルを確認できませんでした");
  }
  return channel;
}

async function fillExistingMask(value) {
  await batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: value
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
      dialogOptions: "dontDisplay"
    }
  } ]);
}

async function makeSolidColorLayer(name, color, track) {
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
      _ref: "contentLayer"
    } ],
    using: {
      _obj: "contentLayer",
      name: name,
      type: {
        _obj: "solidColorLayer",
        color: {
          _obj: "RGBColor",
          red: color.red,
          grain: color.green,
          blue: color.blue
        }
      }
    }
  } ]);
  const layerId = await getTargetLayerId();
  if (layerId === beforeId) {
    throw new UserMessageError("ベタ塗りレイヤーを作成できませんでした。もう一度お試しください");
  }
  if (typeof track === "function") {
    track(layerId);
  }
  const applied = await readActiveSolidColor();
  if (applied && !colorsRoughlyEqual(applied, color)) {
    await batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "contentLayer",
        _enum: "ordinal",
        _value: "targetEnum"
      } ],
      to: {
        _obj: "solidColorLayer",
        color: {
          _obj: "RGBColor",
          red: color.red,
          grain: color.green,
          blue: color.blue
        }
      }
    } ]);
    const second = await readActiveSolidColor();
    if (!second || !colorsRoughlyEqual(second, color)) {
      await deleteLayerByIdSilently(layerId);
      throw new UserMessageError("ベタ塗りの色を設定できませんでした（既定色のまま作られたため中止しました）");
    }
  }
  return layerId;
}

async function readActiveSolidColor() {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _ref: "contentLayer",
        _enum: "ordinal",
        _value: "targetEnum"
      } ]
    } ]);
    const descriptor = result && result[0];
    const adjustment = descriptor && Array.isArray(descriptor.adjustment) ? descriptor.adjustment[0] : null;
    const c = adjustment && adjustment.color;
    if (!c || typeof c.red !== "number") {
      return null;
    }
    return {
      red: c.red,
      green: c.grain,
      blue: c.blue
    };
  } catch (_) {
    return null;
  }
}

function colorsRoughlyEqual(a, b) {
  return Math.abs(Number(a.red) - Number(b.red)) <= 2 && Math.abs(Number(a.green) - Number(b.green)) <= 2 && Math.abs(Number(a.blue) - Number(b.blue)) <= 2;
}

async function deleteLayerByIdSilently(layerId) {
  try {
    await batchPlay([ {
      _obj: "delete",
      _target: [ {
        _ref: "layer",
        _id: layerId
      } ]
    } ]);
  } catch (_) {}
}

async function createSoftLightFill(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) {
    throw new UserMessageError(`未知のプリセットです: ${presetKey}`);
  }
  return runModalWithCleanup("ベタ塗り（ソフトライト）を作成", async ({doc: doc, track: track, began: began}) => {
    const withSelection = await hasActiveSelection();
    began();
    const selectionName = `色を乗せる 選択退避（自動生成）${Date.now()}`;
    if (withSelection) {
      await batchPlay([ {
        _obj: "duplicate",
        _target: [ {
          _ref: "channel",
          _property: "selection"
        } ],
        name: selectionName
      } ]);
    }
    let bodyError = null;
    try {
      if (withSelection) savedSelectionChannel(doc, selectionName);
      await selectTopmostLayer(doc);
      await makeSolidColorLayer(preset.name, preset.color, track);
      moveActiveLayerToTop(doc);
      if (withSelection) {
        await batchPlay([ {
          _obj: "select",
          _target: [ {
            _ref: "channel",
            _enum: "channel",
            _value: "mask"
          } ],
          makeVisible: false
        } ]);
        await deselect();
        await fillExistingMask("black");
        await batchPlay([ {
          _obj: "set",
          _target: [ {
            _ref: "channel",
            _property: "selection"
          } ],
          to: {
            _ref: "channel",
            _name: selectionName
          }
        } ]);
        await fillExistingMask("white");
      }
      await setCurrentLayerProperties({
        name: preset.name,
        blendMode: "softLight"
      });
      return {
        name: preset.name,
        withSelection: withSelection
      };
    } catch (caught) {
      bodyError = caught instanceof Error ? caught : new Error(formatError(caught));
      throw bodyError;
    } finally {
      if (withSelection) {
        try {
          const channel = savedSelectionChannel(doc, selectionName);
          await channel.remove();
          if (Array.from(doc.channels).some(entry => entry.name === selectionName)) {
            throw new UserMessageError("選択範囲の退避チャンネルを削除できませんでした");
          }
        } catch (cleanupError) {
          const note = `選択範囲の退避チャンネルを削除できませんでした: ${formatError(cleanupError)}。チャンネルパネルを確認してください`;
          if (!bodyError) throw new UserMessageError(note);
          bodyError.message += `（${note}）`;
        }
        try {
          await deselect();
        } catch (cleanupError) {
          if (!bodyError) throw cleanupError;
          bodyError.message += `（選択範囲を解除できませんでした: ${formatError(cleanupError)}）`;
        }
      }
    }
  });
}

module.exports = {
  createSoftLightFill: createSoftLightFill
};
