"use strict";

const {UserMessageError: UserMessageError, addRevealAllMask: addRevealAllMask, batchPlay: batchPlay, clampNumber: clampNumber, getTargetLayerId: getTargetLayerId, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer, setCurrentLayerProperties: setCurrentLayerProperties, setLayerPropsById: setLayerPropsById, setSmartFilterById: setSmartFilterById, stampVisible: stampVisible} = require("./helpers.js");

function layerNameFor(radius) {
  return `ハイパス r=${clampNumber(radius, .5, 30).toFixed(1)}px`;
}

function activeLayer(doc) {
  return Array.from(doc && doc.activeLayers || [])[0] || null;
}

async function selectBackgroundLayer() {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "layer",
      _property: "background"
    } ],
    makeVisible: false
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

async function convertToSmartObject() {
  await batchPlay([ {
    _obj: "newPlacedLayer"
  } ]);
}

function highPassFilterDescriptor(radius) {
  return {
    _obj: "highPass",
    radius: {
      _unit: "pixelsUnit",
      _value: clampNumber(radius, .5, 30)
    }
  };
}

async function applyHighPass(radius) {
  await batchPlay([ highPassFilterDescriptor(radius) ]);
}

async function applyHighPassSharpen(options = {}) {
  const radius = clampNumber(options.radius, .5, 30);
  const blendMode = options.blendMode || "overlay";
  const opacity = clampNumber(options.opacity == null ? 100 : options.opacity, 0, 100);
  const source = options.source === "merged" ? "merged" : "background";
  const name = layerNameFor(radius);
  return runModalWithCleanup("ハイパスを適用", async ({doc: doc, track: track, began: began}) => {
    began();
    let workId = null;
    if (source === "background") {
      try {
        await selectBackgroundLayer();
        const backgroundId = await getTargetLayerId();
        await duplicateActiveLayer(name);
        moveActiveLayerToTop(doc);
        const dupId = await getTargetLayerId();
        if (backgroundId == null || dupId == null || dupId === backgroundId) {
          throw new Error("背景の複製を確認できませんでした");
        }
        workId = dupId;
      } catch (_) {
        await selectTopmostLayer(doc);
        const beforeStampId = await getTargetLayerId();
        await stampVisible(doc);
        const stampedId = await getTargetLayerId();
        if (beforeStampId == null || stampedId == null || stampedId === beforeStampId) {
          throw new UserMessageError("作業用レイヤーを作成できませんでした。もう一度お試しください");
        }
        workId = stampedId;
      }
    } else {
      await selectTopmostLayer(doc);
      const beforeStampId = await getTargetLayerId();
      await stampVisible(doc);
      moveActiveLayerToTop(doc);
      const stampedId = await getTargetLayerId();
      if (beforeStampId == null || stampedId == null || stampedId === beforeStampId) {
        throw new UserMessageError("作業用レイヤーを作成できませんでした。もう一度お試しください");
      }
      workId = stampedId;
    }
    track(workId);
    await convertToSmartObject();
    await applyHighPass(radius);
    await setCurrentLayerProperties({
      name: name,
      blendMode: blendMode,
      opacity: opacity
    });
    await addRevealAllMask();
    const created = activeLayer(doc);
    return {
      layerId: created ? created.id : null,
      layerName: name
    };
  });
}

async function updateHighPassLayer(layerId, options = {}) {
  if (layerId == null) {
    throw new UserMessageError("調整対象のハイパスレイヤーが見つかりません。もう一度「適用」してください");
  }
  return runModal("ハイパスを調整", async () => {
    if (options.blendMode) {
      await setLayerPropsById(layerId, {
        blendMode: options.blendMode
      });
    }
    if (options.opacity != null) {
      await setLayerPropsById(layerId, {
        opacity: options.opacity
      });
    }
    if (options.radius != null) {
      const radius = clampNumber(options.radius, .5, 30);
      await setSmartFilterById(layerId, highPassFilterDescriptor(radius));
      await setLayerPropsById(layerId, {
        name: layerNameFor(radius)
      });
    }
  });
}

module.exports = {
  applyHighPassSharpen: applyHighPassSharpen,
  updateHighPassLayer: updateHighPassLayer
};
