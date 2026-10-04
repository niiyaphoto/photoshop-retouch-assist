"use strict";

const {batchPlay: batchPlay, clampNumber: clampNumber, makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer} = require("./helpers.js");

const {analyzeColorCast: analyzeColorCast} = require("../logic/colorcast.js");

const CHANNEL_LABELS = {
  red: "レッド",
  green: "グリーン",
  blue: "ブルー"
};

const CHANNEL_ENUMS = {
  red: "red",
  green: "grain",
  blue: "blue"
};

async function getChannelHistogram(channelEnum) {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "histogram"
    }, {
      _ref: "channel",
      _enum: "channel",
      _value: channelEnum
    }, {
      _ref: "document",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const histogram = result && result[0] && result[0].histogram;
  if (!Array.isArray(histogram)) {
    throw new Error("チャンネルのヒストグラムを取得できませんでした");
  }
  return histogram;
}

function curveEntry(channelEnum, whiteInput) {
  return {
    _obj: "curvesAdjustment",
    channel: {
      _ref: "channel",
      _enum: "channel",
      _value: channelEnum
    },
    curve: [ {
      _obj: "point",
      horizontal: 0,
      vertical: 0
    }, {
      _obj: "point",
      horizontal: whiteInput,
      vertical: 255
    } ]
  };
}

async function setColorCastCurves(inputs) {
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
      adjustment: [ curveEntry(CHANNEL_ENUMS.red, inputs.red), curveEntry(CHANNEL_ENUMS.green, inputs.green), curveEntry(CHANNEL_ENUMS.blue, inputs.blue) ]
    }
  } ]);
}

async function applyColorCastFix(options = {}) {
  const clip = clampNumber(options.clip == null ? .1 : options.clip, .01, 1) / 100;
  const soften = clampNumber(options.soften == null ? 25 : options.soften, 0, 100) / 100;
  return runModalWithCleanup("色被り補正", async ({doc: doc, track: track, began: began}) => {
    const hists = {
      red: await getChannelHistogram(CHANNEL_ENUMS.red),
      green: await getChannelHistogram(CHANNEL_ENUMS.green),
      blue: await getChannelHistogram(CHANNEL_ENUMS.blue)
    };
    const plan = analyzeColorCast(hists, {
      clip: clip,
      soften: soften
    });
    began();
    await selectTopmostLayer(doc);
    await makeCurvesAdjustmentLayer("色被り補正", track);
    await setColorCastCurves(plan.inputs);
    moveActiveLayerToTop(doc);
    return {
      ...plan,
      baseLabel: CHANNEL_LABELS[plan.base] || plan.base
    };
  });
}

module.exports = {
  applyColorCastFix: applyColorCastFix
};
