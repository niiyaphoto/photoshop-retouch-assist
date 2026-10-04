"use strict";

const {UserMessageError: UserMessageError, batchPlay: batchPlay, clampNumber: clampNumber, ensureOpenDocument: ensureOpenDocument, ensureSupportedDocument: ensureSupportedDocument, makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer, moveLayerToTop: moveLayerToTop, runModal: runModal, runModalWithCleanup: runModalWithCleanup, selectTopmostLayer: selectTopmostLayer, requireTargetLayerId: requireTargetLayerId, setCurrentLayerProperties: setCurrentLayerProperties, verifyLayerCreated: verifyLayerCreated} = require("./helpers.js");

const {analyzeLevels: analyzeLevels, describeAnalysis: describeAnalysis} = require("../logic/histogram.js");

const MAX_STAGES = 5;

const MAX_MIDS = 3;

function lightName(k) {
  return `明部 ${k}`;
}

function darkName(k) {
  return `暗部 ${k}`;
}

function midName(k) {
  return `中間調 ${k}`;
}

function normalizeStage(value) {
  return Math.round(clampNumber(value, 1, MAX_STAGES));
}

function normalizeHistogram(hist) {
  if (!Array.isArray(hist)) {
    return new Array(256).fill(0);
  }
  const bins = new Array(256).fill(0);
  for (let i = 0; i < Math.min(hist.length, 256); i += 1) {
    const count = Number(hist[i]);
    bins[i] = Number.isFinite(count) && count > 0 ? count : 0;
  }
  return bins;
}

async function readHistogramFromDescriptor(docId) {
  const documentRef = docId != null ? {
    _ref: "document",
    _id: docId
  } : {
    _ref: "document",
    _enum: "ordinal",
    _value: "targetEnum"
  };
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "histogram"
    }, documentRef ]
  } ]);
  return normalizeHistogram(result && result[0] && result[0].histogram);
}

async function analyzeActiveDocument() {
  const doc = ensureOpenDocument();
  ensureSupportedDocument(doc);
  const docHistogram = Array.isArray(doc.histogram) ? doc.histogram : null;
  const histogram = docHistogram ? normalizeHistogram(docHistogram) : await readHistogramFromDescriptor(doc.id);
  const levels = analyzeLevels(histogram);
  const description = describeAnalysis(histogram);
  return {
    histogram: histogram,
    levels: levels,
    reason: `${description.darks}。${description.lights}。`
  };
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

async function selectAll() {
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

async function step(label, fn) {
  try {
    return await fn();
  } catch (error) {
    const reason = error && error.message || String(error);
    throw new Error(`ステップ「${label}」で失敗: ${reason}`);
  }
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

function reservedChannelNames() {
  const names = [];
  for (let k = 1; k <= MAX_STAGES; k += 1) {
    names.push(lightName(k), darkName(k));
  }
  for (let k = 1; k <= MAX_MIDS; k += 1) {
    names.push(midName(k));
  }
  return names;
}

function tempChannelName(name) {
  return `作業用 ${name}（自動生成）`;
}

function listDomChannelNames(doc) {
  try {
    const channels = doc && doc.channels;
    if (!channels) {
      return null;
    }
    return Array.from(channels).map(channel => String(channel && channel.name || ""));
  } catch (_) {
    return null;
  }
}

async function deleteChannelSilently(doc, name) {
  if (listDomChannelNames(doc) === null) {
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
    const channels = Array.from(doc && doc.channels || []);
    for (const channel of channels) {
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

async function deleteChannelsByName(doc, names) {
  for (const name of names) {
    await deleteChannelSilently(doc, name);
  }
}

async function makeLayerGroup(name, track) {
  const beforeId = await requireTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layerSection"
    } ]
  } ]);
  const layerId = await verifyLayerCreated(beforeId, "グループを作成できませんでした。もう一度お試しください");
  if (typeof track === "function") {
    track(layerId);
  }
  await setCurrentLayerProperties({
    name: name
  });
  return layerId;
}

async function buildChannels(lightCount, darkCount, toChannel) {
  await step("輝度選択の読み込み", () => loadCompositeLuminositySelection());
  await step("明部 1 の保存", () => duplicateSelectionToChannel(toChannel(lightName(1))));
  for (let k = 2; k <= lightCount; k += 1) {
    await step(`明部 ${k} の交差`, () => intersectSelectionWithChannel(toChannel(lightName(k - 1))));
    await step(`明部 ${k} の保存`, () => duplicateSelectionToChannel(toChannel(lightName(k))));
  }
  await step("輝度選択の再読み込み", () => loadCompositeLuminositySelection());
  await step("選択範囲の反転", () => invertSelection());
  await step("暗部 1 の保存", () => duplicateSelectionToChannel(toChannel(darkName(1))));
  for (let k = 2; k <= darkCount; k += 1) {
    await step(`暗部 ${k} の交差`, () => intersectSelectionWithChannel(toChannel(darkName(k - 1))));
    await step(`暗部 ${k} の保存`, () => duplicateSelectionToChannel(toChannel(darkName(k))));
  }
  const midCount = Math.min(MAX_MIDS, lightCount, darkCount);
  for (let k = 1; k <= midCount; k += 1) {
    await step(`中間調 ${k}: 全選択`, () => selectAll());
    await step(`中間調 ${k}: 明部を減算`, () => subtractChannelFromSelection(toChannel(lightName(k))));
    await step(`中間調 ${k}: 暗部を減算`, () => subtractChannelFromSelection(toChannel(darkName(k))));
    await step(`中間調 ${k} の保存`, () => duplicateSelectionToChannel(toChannel(midName(k))));
  }
  await step("選択解除", () => deselect());
  return midCount;
}

async function channelExists(doc, name) {
  const domNames = listDomChannelNames(doc);
  if (domNames) {
    return domNames.includes(name);
  }
  try {
    await batchPlay([ {
      _obj: "get",
      _target: [ {
        _ref: "channel",
        _name: name
      } ]
    } ]);
    return true;
  } catch (_) {
    return false;
  }
}

async function createLuminosityMasks(options = {}) {
  const lightCount = normalizeStage(options.lights);
  const darkCount = normalizeStage(options.darks);
  const output = options.output === "layers" ? "layers" : "channels";
  const toChannel = output === "layers" ? tempChannelName : name => name;
  return runModalWithCleanup("ルミノシティマスクを生成", async ({doc: doc, track: track, began: began}) => {
    const workNames = reservedChannelNames().map(toChannel);
    const existing = [];
    for (const name of workNames) {
      if (await channelExists(doc, name)) {
        existing.push(name);
      }
    }
    if (existing.length > 0) {
      const domNames = listDomChannelNames(doc);
      const detail = domNames ? `（現在のチャンネル: ${domNames.join(" / ")}）` : "（チャンネル一覧はDOMから読めませんでした）";
      throw new UserMessageError(`チャンネル${existing.map(n => `「${n}」`).join("・")}が` + "残っています。上書きを避けるため「マスクチャンネルを削除」を" + `押してから再生成してください${detail}`);
    }
    try {
      began();
      const midCount = await buildChannels(lightCount, darkCount, toChannel);
      const cleanupLeftovers = [];
      if (output === "layers") {
        await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
        await step("グループ作成", () => makeLayerGroup("ルミノシティマスク", track));
        const groupLayer = Array.from(doc && doc.activeLayers || [])[0] || null;
        const names = [];
        for (let k = 1; k <= lightCount; k += 1) {
          names.push(lightName(k));
        }
        for (let k = 1; k <= darkCount; k += 1) {
          names.push(darkName(k));
        }
        for (let k = 1; k <= midCount; k += 1) {
          names.push(midName(k));
        }
        for (const name of names) {
          await step(`${name}: 選択範囲の読み込み`, () => loadChannelSelection(toChannel(name)));
          await step(`${name}: カーブレイヤー作成`, () => makeCurvesAdjustmentLayer(name, track));
        }
        await step("選択解除", () => deselect());
        await step("最上位へ移動", async () => moveLayerToTop(doc, groupLayer));
        await deleteChannelsByName(doc, workNames);
        for (const name of workNames) {
          if (await channelExists(doc, name)) {
            cleanupLeftovers.push(name);
          }
        }
      }
      return {
        output: output,
        lightCount: lightCount,
        darkCount: darkCount,
        midCount: midCount,
        cleanupLeftovers: cleanupLeftovers
      };
    } catch (error) {
      await deleteChannelsByName(doc, workNames);
      try {
        await deselect();
      } catch (_) {}
      throw error;
    }
  });
}

async function deleteGeneratedChannels() {
  return runModal("マスクチャンネルを削除", async ({doc: doc}) => {
    const targetNames = [ ...reservedChannelNames(), ...reservedChannelNames().map(tempChannelName) ];
    await deleteChannelsByName(doc, targetNames);
    const leftovers = [];
    for (const name of targetNames) {
      if (await channelExists(doc, name)) {
        leftovers.push(name);
      }
    }
    if (leftovers.length > 0) {
      throw new UserMessageError(`チャンネル${leftovers.map(n => `「${n}」`).join("・")}を` + "削除できませんでした。チャンネルパネルで対象を選び、" + "ゴミ箱アイコンで手動削除してください");
    }
  });
}

module.exports = {
  analyzeActiveDocument: analyzeActiveDocument,
  createLuminosityMasks: createLuminosityMasks,
  deleteGeneratedChannels: deleteGeneratedChannels,
  deleteChannelSilently: deleteChannelSilently
};
