"use strict";

const {batchPlay: batchPlay, clampNumber: clampNumber, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer, requireTargetLayerId: requireTargetLayerId, setCurrentLayerProperties: setCurrentLayerProperties, verifyLayerCreated: verifyLayerCreated} = require("./helpers.js");

const {deleteChannelSilently: deleteChannelSilently} = require("./luminosity.js");

const WORK1 = "中間調 作業1（自動生成）";

const WORK2 = "中間調 作業2（自動生成）";

async function step(label, fn) {
  try {
    return await fn();
  } catch (error) {
    const reason = error && error.message || String(error);
    throw new Error(`ステップ「${label}」で失敗: ${reason}`);
  }
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
    }
  } ]);
}

async function invertSelection() {
  await batchPlay([ {
    _obj: "inverse"
  } ]);
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

async function duplicateSelectionToChannel(name) {
  try {
    await batchPlay([ {
      _obj: "duplicate",
      _target: [ {
        _ref: "channel",
        _property: "selection"
      } ],
      name: name
    } ]);
    return;
  } catch (_) {}
  await batchPlay([ {
    _obj: "make",
    new: {
      _class: "channel"
    },
    using: {
      _ref: "channel",
      _property: "selection"
    }
  }, {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    to: {
      _obj: "channel",
      name: name
    }
  } ]);
}

async function intersectSelectionWithChannel(name) {
  await batchPlay([ {
    _obj: "interfaceIconFrameDimmed",
    _target: [ {
      _ref: "channel",
      _name: name
    } ],
    with: {
      _ref: "channel",
      _property: "selection"
    }
  } ]);
}

async function loadChannelSelection(name) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _name: name
    }
  } ]);
}

async function makeLevelsAdjustmentLayer(name, track) {
  const beforeId = await requireTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "contentLayer"
    } ],
    using: {
      _obj: "contentLayer",
      type: {
        _obj: "levels",
        presetKind: {
          _enum: "presetKindType",
          _value: "presetKindDefault"
        }
      }
    }
  } ]);
  const layerId = await verifyLayerCreated(beforeId, "レベル補正レイヤーを作成できませんでした。もう一度お試しください");
  if (typeof track === "function") {
    track(layerId);
  }
  await setCurrentLayerProperties({
    name: name
  });
  return layerId;
}

async function groupActiveLayer(track) {
  const beforeId = await requireTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layerSection"
    } ],
    from: {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    }
  } ]);
  const groupId = await verifyLayerCreated(beforeId, "グループ化できませんでした。もう一度お試しください");
  if (typeof track === "function") {
    track(groupId);
  }
  return groupId;
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

async function applyMidtoneContrast(options = {}) {
  const narrow = Math.round(clampNumber(options.narrow, 1, 5));
  return runModalWithCleanup("中間調コントラスト", async ({doc: doc, track: track, began: began}) => {
    began();
    await deleteChannelSilently(doc, WORK1);
    await deleteChannelSilently(doc, WORK2);
    try {
      await step("輝度選択の読み込み", () => loadCompositeLuminositySelection());
      await step("選択範囲の反転", () => invertSelection());
      await step("作業チャンネルの保存", () => duplicateSelectionToChannel(WORK1));
      for (let i = 1; i <= narrow; i += 1) {
        await step(`範囲を狭める(${i}回目)`, () => intersectSelectionWithChannel(WORK1));
      }
      await step("マスク範囲の保存", () => duplicateSelectionToChannel(WORK2));
      await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
      await step("レベル補正レイヤーの作成", () => makeLevelsAdjustmentLayer("中間調コントラスト", track));
      await step("保護範囲の読み込み", () => loadChannelSelection(WORK2));
      for (let i = 1; i <= narrow; i += 1) {
        await step(`保護範囲を狭める(${i}回目)`, () => intersectSelectionWithChannel(WORK2));
      }
      await step("保護範囲の反転", () => invertSelection());
      await step("グループ化", () => groupActiveLayer(track));
      await step("グループ名の設定", () => setCurrentLayerProperties({
        name: "中間調コントラスト"
      }));
      await step("保護マスクの適用", () => addMaskFromSelection());
      await step("最上位へ移動", async () => moveActiveLayerToTop(doc));
      await step("選択解除", () => deselect());
    } finally {
      await deleteChannelSilently(doc, WORK1);
      await deleteChannelSilently(doc, WORK2);
    }
  });
}

module.exports = {
  applyMidtoneContrast: applyMidtoneContrast
};
