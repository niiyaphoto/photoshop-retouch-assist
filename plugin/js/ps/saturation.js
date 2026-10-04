"use strict";

const {batchPlay: batchPlay, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer, setCurrentLayerProperties: setCurrentLayerProperties, requireTargetLayerId: requireTargetLayerId, stampVisible: stampVisible, verifyLayerCreated: verifyLayerCreated} = require("./helpers.js");

const WORK_NAME = "彩度 作業";

async function step(label, fn) {
  try {
    return await fn();
  } catch (error) {
    const reason = error && error.message || String(error);
    throw new Error(`ステップ「${label}」で失敗: ${reason}`);
  }
}

function activeLayer(doc) {
  return Array.from(doc && doc.activeLayers || [])[0] || null;
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

async function duplicateActiveLayer(name) {
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    name: name
  } ]);
}

async function desaturateActiveLayer() {
  await batchPlay([ {
    _obj: "desaturate"
  } ]);
}

async function setActiveLayerBlend(blendValue) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    to: {
      _obj: "layer",
      mode: {
        _enum: "blendMode",
        _value: blendValue
      }
    }
  } ]);
}

async function addLayerToSelection(layerId) {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ],
    makeVisible: false,
    selectionModifier: {
      _enum: "selectionModifierType",
      _value: "addToSelection"
    }
  } ]);
}

async function mergeSelectedLayers() {
  await batchPlay([ {
    _obj: "mergeLayersNew"
  } ]);
}

async function applyLevelsToActiveLayer(inputBlack, inputWhite) {
  await batchPlay([ {
    _obj: "levels",
    presetKind: {
      _enum: "presetKindType",
      _value: "presetKindCustom"
    },
    adjustment: [ {
      _obj: "levelsAdjustment",
      channel: {
        _ref: "channel",
        _enum: "channel",
        _value: "composite"
      },
      input: [ inputBlack, inputWhite ]
    } ]
  } ]);
}

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
    },
    _options: {
      dialogOptions: "dontDisplay"
    }
  } ]);
}

async function makeHueSaturationLayer(name, track) {
  const beforeId = await requireTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "contentLayer"
    } ],
    using: {
      _obj: "contentLayer",
      type: {
        _obj: "hueSaturation",
        presetKind: {
          _enum: "presetKindType",
          _value: "presetKindDefault"
        },
        colorize: false
      }
    }
  } ]);
  const layerId = await verifyLayerCreated(beforeId, "色相・彩度レイヤーを作成できませんでした。もう一度お試しください");
  if (typeof track === "function") {
    track(layerId);
  }
  await setCurrentLayerProperties({
    name: name
  });
  return layerId;
}

async function deleteLayerById(layerId) {
  await batchPlay([ {
    _obj: "delete",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ]
  } ]);
}

async function createSaturationMask() {
  return runModalWithCleanup("彩度マスクを作成", async ({doc: doc, track: track, began: began}) => {
    began();
    await step("選択解除", () => deselect());
    await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
    const beforeStampId = await requireTargetLayerId();
    await step("統合コピーの作成", () => stampVisible(doc));
    const stampedId = await requireTargetLayerId();
    if (stampedId === beforeStampId) {
      throw new Error("作業用コピーを作成できなかったため中断しました（元画像は変更されていません）");
    }
    await step("作業レイヤー名の設定", () => setCurrentLayerProperties({
      name: WORK_NAME
    }));
    moveActiveLayerToTop(doc);
    const baseLayer = activeLayer(doc);
    if (!baseLayer || baseLayer.id !== stampedId || String(baseLayer.name).indexOf(WORK_NAME) !== 0) {
      throw new Error("作業用コピーを確認できなかったため中断しました（元画像は変更されていません）");
    }
    track(baseLayer.id);
    await step("比較用レイヤーの複製", () => duplicateActiveLayer(`${WORK_NAME}2`));
    await step("複製の彩度を除去", () => desaturateActiveLayer());
    await step("差の絶対値に設定", () => setActiveLayerBlend("difference"));
    if (baseLayer) {
      await step("作業レイヤーの複数選択", () => addLayerToSelection(baseLayer.id));
    }
    await step("作業レイヤーの結合", () => mergeSelectedLayers());
    await step("彩度差の白黒化", () => desaturateActiveLayer());
    await step("コントラスト強調（レベル補正 0〜160）", () => applyLevelsToActiveLayer(0, 160));
    const workLayer = activeLayer(doc);
    if (workLayer && workLayer.id !== beforeStampId && String(workLayer.name).indexOf(WORK_NAME) === 0) {
      track(workLayer.id);
    }
    await step("彩度の輝度を選択範囲に読み込み", () => loadCompositeLuminositySelection());
    await step("色相・彩度レイヤーの作成", () => makeHueSaturationLayer("Saturation Mask", track));
    if (workLayer && String(workLayer.name).indexOf(WORK_NAME) === 0) {
      await step("作業レイヤーの削除", () => deleteLayerById(workLayer.id));
    }
    await step("選択解除", () => deselect());
    moveActiveLayerToTop(doc);
  });
}

module.exports = {
  createSaturationMask: createSaturationMask
};
