"use strict";

const {UserMessageError: UserMessageError, addRevealAllMask: addRevealAllMask, batchPlay: batchPlay, clampNumber: clampNumber, constants: constants, getActiveDocument: getActiveDocument, makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectLayerById: selectLayerById, selectTopmostLayer: selectTopmostLayer, setActiveCurvesAdjustment: setActiveCurvesAdjustment, setCurrentLayerProperties: setCurrentLayerProperties, setLayerPropsById: setLayerPropsById, setSmartFilterById: setSmartFilterById, stampVisible: stampVisible} = require("./helpers.js");

const {defaultBlurRadius: defaultBlurRadius, ortonColorCurvePoints: ortonColorCurvePoints} = require("../logic/orton.js");

function dimensionToPixels(value) {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "object") {
    if (typeof value.value === "number") {
      return value.value;
    }
    if (typeof value.as === "function") {
      try {
        return value.as("px");
      } catch (_) {
        return 0;
      }
    }
  }
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeLayer(doc) {
  return Array.from(doc && doc.activeLayers || [])[0] || null;
}

function ortonTargetProblem(doc) {
  const layer = activeLayer(doc);
  if (!layer) {
    return null;
  }
  const kinds = constants && constants.LayerKind;
  if (kinds) {
    if (layer.kind === kinds.NORMAL || layer.kind === kinds.SMARTOBJECT) {
      return null;
    }
  } else {
    const kind = String(layer.kind || "").toLowerCase();
    if (!kind || kind === "pixel" || kind === "normal" || kind === "smartobject") {
      return null;
    }
  }
  return `選択中のレイヤー「${layer.name}」は種別「${String(layer.kind)}」のため対象外です。` + "写真そのもの（ピクセルレイヤー）またはスマートオブジェクトを選択してください。" + "調整レイヤー・グループには適用できません";
}

function suggestedBlurRadius() {
  const doc = getActiveDocument();
  if (!doc) {
    return 8;
  }
  return defaultBlurRadius(dimensionToPixels(doc.width), dimensionToPixels(doc.height));
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

async function applyGaussianBlur(radius) {
  await batchPlay([ {
    _obj: "gaussianBlur",
    radius: {
      _unit: "pixelsUnit",
      _value: Number(radius)
    }
  } ]);
}

async function createClippingMask() {
  await batchPlay([ {
    _obj: "groupEvent"
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

async function groupSelectedLayers() {
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
}

async function applyOrtonEffectAll(doc, radius, opacity, track, began) {
  began();
  await selectTopmostLayer(doc);
  const startLayer = activeLayer(doc);
  const startId = startLayer ? startLayer.id : null;
  await stampVisible(doc);
  await setCurrentLayerProperties({
    name: "オートン スクリーン",
    blendMode: "screen"
  });
  const screenLayer = activeLayer(doc);
  if (screenLayer && screenLayer.id !== startId) {
    track(screenLayer.id);
  }
  await duplicateActiveLayer("オートン 乗算");
  await setCurrentLayerProperties({
    name: "オートン 乗算",
    blendMode: "multiply"
  });
  await convertToSmartObject();
  await applyGaussianBlur(radius);
  const multiplyLayer = activeLayer(doc);
  if (multiplyLayer && (!screenLayer || multiplyLayer.id !== screenLayer.id)) {
    track(multiplyLayer.id);
  }
  await makeCurvesAdjustmentLayer("オートン 明るさ", track);
  await setActiveCurvesAdjustment([ [ 0, 0 ], [ 128, 150 ], [ 255, 255 ] ]);
  const curvesLayer = activeLayer(doc);
  if (screenLayer) {
    await selectLayerById(screenLayer.id);
  }
  if (multiplyLayer) {
    await addLayerToSelection(multiplyLayer.id);
  }
  if (curvesLayer) {
    await addLayerToSelection(curvesLayer.id);
  }
  await groupSelectedLayers();
  await setCurrentLayerProperties({
    name: "オートン効果",
    opacity: opacity
  });
  await addRevealAllMask();
  moveActiveLayerToTop(doc);
  const group = activeLayer(doc);
  if (group && group.id !== startId && (!curvesLayer || group.id !== curvesLayer.id)) {
    track(group.id);
  }
  return {
    layerId: group ? group.id : null,
    layerName: "オートン効果",
    blurLayerId: multiplyLayer ? multiplyLayer.id : null
  };
}

async function applyOrtonEffectSelected(doc, radius, opacity, track, began) {
  const problem = ortonTargetProblem(doc);
  if (problem) {
    throw new UserMessageError(problem);
  }
  const source = activeLayer(doc);
  const layerName = `オートン（${source && source.name || "選択レイヤー"}）`;
  began();
  await duplicateActiveLayer(layerName);
  const duplicated = activeLayer(doc);
  if (!source || !duplicated || duplicated.id == null || duplicated.id === source.id) {
    throw new UserMessageError("選択レイヤーを複製できなかったため、元のレイヤーを変更せず中止しました");
  }
  if (duplicated && (!source || duplicated.id !== source.id)) {
    track(duplicated.id);
  }
  await convertToSmartObject();
  await applyGaussianBlur(radius);
  await createClippingMask();
  await setCurrentLayerProperties({
    name: layerName,
    blendMode: "softLight",
    opacity: opacity
  });
  const created = activeLayer(doc);
  return {
    layerId: created ? created.id : null,
    layerName: layerName,
    blurLayerId: created ? created.id : null
  };
}

async function applyOrtonColorOnly(options = {}) {
  const opacity = clampNumber(options.opacity == null ? 100 : options.opacity, 0, 100);
  return runModalWithCleanup("オートンカラーを適用", async ({doc: doc, track: track, began: began}) => {
    began();
    await selectTopmostLayer(doc);
    await makeCurvesAdjustmentLayer("オートンカラー（ぼかしなし）", track);
    await setActiveCurvesAdjustment(ortonColorCurvePoints());
    await setCurrentLayerProperties({
      name: "オートンカラー（ぼかしなし）",
      opacity: opacity
    });
    moveActiveLayerToTop(doc);
    const layer = activeLayer(doc);
    return {
      layerId: layer ? layer.id : null
    };
  });
}

async function applyOrtonEffect(options = {}) {
  const scope = options.scope === "selected" ? "selected" : "all";
  const radius = clampNumber(options.blurRadius, 1, 50);
  const opacity = clampNumber(options.opacity, 0, 100);
  return runModalWithCleanup("オートン効果を適用", async ({doc: doc, track: track, began: began}) => scope === "selected" ? applyOrtonEffectSelected(doc, radius, opacity, track, began) : applyOrtonEffectAll(doc, radius, opacity, track, began));
}

async function updateOrtonLayer(target, options = {}) {
  if (!target || target.layerId == null) {
    throw new UserMessageError("調整対象のオートンレイヤーが見つかりません。もう一度「適用」してください");
  }
  return runModal("オートンを調整", async () => {
    if (options.opacity != null) {
      await setLayerPropsById(target.layerId, {
        opacity: options.opacity
      });
    }
    if (options.blurRadius != null) {
      if (target.blurLayerId == null) {
        throw new UserMessageError("ぼかしレイヤーが見つかりません");
      }
      await setSmartFilterById(target.blurLayerId, {
        _obj: "gaussianBlur",
        radius: {
          _unit: "pixelsUnit",
          _value: clampNumber(options.blurRadius, 1, 50)
        }
      });
    }
  });
}

module.exports = {
  applyOrtonColorOnly: applyOrtonColorOnly,
  applyOrtonEffect: applyOrtonEffect,
  suggestedBlurRadius: suggestedBlurRadius,
  updateOrtonLayer: updateOrtonLayer
};
