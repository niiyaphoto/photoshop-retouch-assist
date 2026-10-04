"use strict";

function requireLocal(candidates) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const luminosity = requireLocal([ "./ps/luminosity.js", "./js/ps/luminosity.js" ]);

const dodgeBurn = requireLocal([ "./ps/dodgeburn.js", "./js/ps/dodgeburn.js" ]);

const highpass = requireLocal([ "./ps/highpass.js", "./js/ps/highpass.js" ]);

const orton = requireLocal([ "./ps/orton.js", "./js/ps/orton.js" ]);

const midtone = requireLocal([ "./ps/midtone.js", "./js/ps/midtone.js" ]);

const colorcast = requireLocal([ "./ps/colorcast.js", "./js/ps/colorcast.js" ]);

const saturation = requireLocal([ "./ps/saturation.js", "./js/ps/saturation.js" ]);

const colorgrade = requireLocal([ "./ps/colorgrade.js", "./js/ps/colorgrade.js" ]);

const helpers = requireLocal([ "./ps/helpers.js", "./js/ps/helpers.js" ]);

function byId(id) {
  return document.getElementById(id);
}

function valueOf(id, fallback) {
  const element = byId(id);
  const value = element && element.value;
  return value == null || value === "" ? fallback : value;
}

function setValue(id, value) {
  const element = byId(id);
  if (element) {
    element.value = value;
  }
}

function setStatus(message, tone = "info") {
  const status = byId("status");
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `status ${tone}`;
}

function errorMessage(error) {
  if (!error) {
    return "処理に失敗しました";
  }
  if (typeof error === "string") {
    return error.replace(/^(UserMessageError|Error):\s*/, "");
  }
  if (error.message) {
    return String(error.message).replace(/^(UserMessageError|Error):\s*/, "");
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") {
      return json;
    }
  } catch (_) {}
  const text = String(error);
  return text === "[object Object]" ? "処理に失敗しました" : text;
}

let actionRunning = false;

let panelChain = Promise.resolve();

function enqueuePanel(fn) {
  const next = panelChain.then(fn);
  panelChain = next.catch(() => {});
  return next;
}

async function runAction(button, action, successMessage, failurePrefix) {
  if (actionRunning) {
    setStatus("処理中です。完了までお待ちください", "info");
    return;
  }
  actionRunning = true;
  if (button) {
    button.disabled = true;
  }
  setStatus("処理中です...", "info");
  try {
    await enqueuePanel(action);
    if (successMessage) {
      setStatus(successMessage, "success");
    }
  } catch (error) {
    const reason = errorMessage(error);
    setStatus(failurePrefix ? `${failurePrefix}: ${reason}` : reason, "error");
  } finally {
    actionRunning = false;
    if (button) {
      button.disabled = false;
    }
  }
}

function throttleTrailing(fn, waitMs) {
  let timer = null;
  let pendingArgs = null;
  let running = false;
  async function flush() {
    timer = null;
    if (!pendingArgs || running) {
      return;
    }
    const args = pendingArgs;
    pendingArgs = null;
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
      if (pendingArgs && !timer) {
        timer = setTimeout(flush, waitMs);
      }
    }
  }
  const throttled = (...args) => {
    pendingArgs = args;
    if (!timer) {
      timer = setTimeout(flush, waitMs);
    }
  };
  throttled.cancel = () => {
    pendingArgs = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return throttled;
}

function selectedRadioValue(groupId, fallback) {
  const group = byId(groupId);
  if (!group) {
    return fallback;
  }
  if (group.selected) {
    return group.selected;
  }
  const radios = Array.from(group.querySelectorAll("sp-radio"));
  const checked = radios.find(radio => radio.checked);
  return checked && checked.value || fallback;
}

function bindAccordion() {
  const titles = Array.from(document.querySelectorAll(".section-title"));
  for (const title of titles) {
    title.addEventListener("click", () => {
      const body = byId(`section-${title.dataset.section}`);
      if (!body) {
        return;
      }
      const collapsed = body.classList.toggle("collapsed");
      title.textContent = `${collapsed ? "▸" : "▾"} ${title.textContent.slice(2)}`;
    });
  }
}

function createEditMode(ids, updateFn) {
  let target = null;
  const pendingCancels = [];
  function registerCancel(cancelFn) {
    if (typeof cancelFn === "function") {
      pendingCancels.push(cancelFn);
    }
  }
  function cancelPending() {
    for (const cancel of pendingCancels) {
      try {
        cancel();
      } catch (_) {}
    }
  }
  function activeDocId() {
    try {
      const doc = helpers.getActiveDocument();
      return doc && doc.id != null ? doc.id : null;
    } catch (_) {
      return null;
    }
  }
  function set(next) {
    cancelPending();
    target = next && next.layerId != null ? next : null;
    if (target) {
      target.docId = activeDocId();
    }
    const label = byId(ids.label);
    if (label) {
      label.textContent = target ? `調整中: ${target.layerName}` : "調整中: —";
    }
    const box = byId(ids.box);
    if (box) {
      box.classList.toggle("hidden", !target);
    }
  }
  const finishButton = byId(ids.finish);
  if (finishButton) {
    finishButton.addEventListener("click", () => {
      set(null);
      setStatus("調整を終了しました", "info");
    });
  }
  async function push(options) {
    if (!target) {
      return;
    }
    const pushTarget = target;
    try {
      await enqueuePanel(() => {
        if (target !== pushTarget) {
          return undefined;
        }
        const now = activeDocId();
        if (pushTarget.docId == null || now == null || now !== pushTarget.docId) {
          set(null);
          setStatus("別の写真に切り替わったため、調整を終了しました", "error");
          return undefined;
        }
        return updateFn(pushTarget, options);
      });
    } catch (error) {
      set(null);
      setStatus(`調整できませんでした: ${errorMessage(error)}`, "error");
    }
  }
  return {
    set: set,
    push: push,
    registerCancel: registerCancel
  };
}

function bindSliderPush(sliderId, pushFn, waitMs) {
  const slider = byId(sliderId);
  if (!slider) {
    return null;
  }
  const throttled = throttleTrailing(pushFn, waitMs);
  const handler = () => throttled(slider.value);
  slider.addEventListener("input", handler);
  slider.addEventListener("change", handler);
  return throttled;
}

function bindRadioPush(groupId, pushFn) {
  const group = byId(groupId);
  if (!group) {
    return;
  }
  let scheduled = false;
  const handler = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      pushFn();
    }, 0);
  };
  group.addEventListener("change", handler);
  group.addEventListener("click", handler);
}

function bindHintToggles() {
  const hints = Array.from(document.querySelectorAll("p.hint"));
  for (const hint of hints) {
    if (hint.id === "mgNoTarget") {
      continue;
    }
    if (hint.parentElement && hint.parentElement.id === "section-help") {
      continue;
    }
    let insideEditBox = false;
    let node = hint.parentElement;
    while (node) {
      if (node.classList && node.classList.contains("edit-box")) {
        insideEditBox = true;
        break;
      }
      node = node.parentElement;
    }
    if (insideEditBox) {
      continue;
    }
    const toggle = document.createElement("p");
    toggle.className = "hint-toggle";
    toggle.textContent = "▸ 説明";
    hint.classList.add("hidden");
    toggle.addEventListener("click", () => {
      const collapsed = hint.classList.toggle("hidden");
      toggle.textContent = (collapsed ? "▸" : "▾") + " 説明";
    });
    hint.parentNode.insertBefore(toggle, hint);
  }
}

function bind() {
  bindAccordion();
  bindHintToggles();
  const analyzeButton = byId("analyzeLuminosity");
  analyzeButton.addEventListener("click", () => runAction(analyzeButton, async () => {
    const result = await luminosity.analyzeActiveDocument();
    setValue("darkLevels", result.levels.darks);
    setValue("lightLevels", result.levels.lights);
    byId("luminosityReason").textContent = result.reason;
  }, "画像解析が完了しました", "画像を解析できませんでした"));
  const createMasksButton = byId("createMasks");
  createMasksButton.addEventListener("click", () => runAction(createMasksButton, async () => {
    const result = await luminosity.createLuminosityMasks({
      darks: valueOf("darkLevels", 2),
      lights: valueOf("lightLevels", 2),
      output: selectedRadioValue("luminosityOutput", "channels")
    });
    const leftovers = result.cleanupLeftovers || [];
    if (result.output === "layers" && leftovers.length > 0) {
      setStatus("マスク付きカーブレイヤーを生成しましたが、作業チャンネル" + `${leftovers.map(n => `「${n}」`).join("・")}を自動削除` + "できませんでした。「マスクチャンネルを削除」を押してください", "error");
    } else {
      setStatus(result.output === "channels" ? "チャンネルパネルにマスクを生成しました（Ctrl+クリックで選択範囲に）" : "マスク付きカーブレイヤーを生成しました", "success");
    }
  }, null, "マスクを生成できませんでした"));
  const deleteChannelsButton = byId("deleteMaskChannels");
  deleteChannelsButton.addEventListener("click", () => runAction(deleteChannelsButton, async () => {
    await luminosity.deleteGeneratedChannels();
  }, "マスクチャンネルを削除しました", "チャンネルを削除できませんでした"));
  const applyMidtoneButton = byId("applyMidtone");
  applyMidtoneButton.addEventListener("click", () => runAction(applyMidtoneButton, async () => {
    await midtone.applyMidtoneContrast({
      narrow: valueOf("midtoneNarrow", 3)
    });
  }, "作成しました。レベル補正のスライダーでコントラストを調整してください", "中間調コントラストを作成できませんでした"));
  const applyColorCastButton = byId("applyColorCast");
  applyColorCastButton.addEventListener("click", () => runAction(applyColorCastButton, async () => {
    const plan = await colorcast.applyColorCastFix({
      clip: valueOf("colorCastClip", .1),
      soften: valueOf("colorCastSoften", 25)
    });
    setStatus(`色被り補正を作成しました（基準: ${plan.baseLabel} / 測定→適用 ` + `R:${plan.raw.red}→${plan.inputs.red} ` + `G:${plan.raw.green}→${plan.inputs.green} ` + `B:${plan.raw.blue}→${plan.inputs.blue}）`, "success");
  }, null, "色被り補正を作成できませんでした"));
  const createSaturationMaskButton = byId("createSaturationMask");
  createSaturationMaskButton.addEventListener("click", () => runAction(createSaturationMaskButton, async () => {
    await saturation.createSaturationMask();
  }, "作成しました。彩度スライダーを下げると鮮やかな部分だけ抑えられます", "彩度マスクを作成できませんでした"));
  const brushNote = result => result && result.manualGuidance && result.manualGuidance.length ? ` ※${result.manualGuidance.join("。")}` : "";
  const createDodgeBurnButton = byId("createDodgeBurn");
  createDodgeBurnButton.addEventListener("click", () => runAction(createDodgeBurnButton, async () => {
    const mode = selectedRadioValue("dodgeBurnMode", "curves");
    const result = await dodgeBurn.createDodgeBurnSet(mode);
    setStatus((mode === "colorDodge" ? "作成しました。光の当たる面をなぞってください（「影を塗る」で影側に切替）" : mode === "gray" ? "作成しました。白ブラシでグレーレイヤーを塗ると明るくなります" : "作成しました。白ブラシでドッジ（明）のマスクを塗ると明るくなります") + brushNote(result), "success");
  }, null, "ドッジ&バーンを作成できませんでした"));
  const paintDodgeButton = byId("dbPaintDodge");
  paintDodgeButton.addEventListener("click", () => runAction(paintDodgeButton, async () => {
    const result = await dodgeBurn.preparePaintDodge();
    setStatus("光を塗る準備ができました。柔らかいブラシで光の当たる面を少しずつなぞってください" + brushNote(result), "success");
  }, null, "光を塗る準備ができませんでした"));
  const paintBurnButton = byId("dbPaintBurn");
  paintBurnButton.addEventListener("click", () => runAction(paintBurnButton, async () => {
    const result = await dodgeBurn.preparePaintBurn();
    setStatus("影を塗る準備ができました。影の側（木々の隙間・稜線の陰）を少しずつなぞってください" + brushNote(result), "success");
  }, null, "影を塗る準備ができませんでした"));
  const loadMaskButton = byId("loadMaskSelection");
  loadMaskButton.addEventListener("click", () => runAction(loadMaskButton, async () => {
    const result = await dodgeBurn.loadSelectionFromActiveLayerMask();
    setStatus(`「${result.layerName}」のマスクを範囲に読み込みました。この範囲にだけブラシが効きます`, "success");
  }, null, "範囲を読み込めませんでした"));
  const clearSelectionButton = byId("clearSelectionButton");
  clearSelectionButton.addEventListener("click", () => runAction(clearSelectionButton, async () => {
    await dodgeBurn.clearSelection();
  }, "範囲を解除しました。画像全体にブラシが効きます", "範囲を解除できませんでした"));
  for (const [id, presetKey] of [ [ "cgCool", "cool" ], [ "cgWarm", "warm" ] ]) {
    const button = byId(id);
    if (button) {
      button.addEventListener("click", () => runAction(button, async () => {
        const result = await colorgrade.createSoftLightFill(presetKey);
        setStatus(result.withSelection ? `「${result.name}」を選択範囲に作成しました。色はサムネイルのダブルクリックで変更できます` : `「${result.name}」を画像全体に作成しました。マスクを黒ブラシで塗ると範囲を絞れます`, "success");
      }, null, "ベタ塗りを作成できませんでした"));
    }
  }
  const highPassEdit = createEditMode({
    box: "highPassEditBox",
    label: "highPassEditLabel",
    finish: "finishHighPassEdit"
  }, (target, options) => highpass.updateHighPassLayer(target.layerId, options));
  const applyHighPassButton = byId("applyHighPass");
  applyHighPassButton.addEventListener("click", () => runAction(applyHighPassButton, async () => {
    const result = await highpass.applyHighPassSharpen({
      radius: valueOf("highPassRadius", 3),
      opacity: valueOf("highPassOpacity", 100),
      blendMode: selectedRadioValue("highPassBlend", "overlay"),
      source: selectedRadioValue("highPassSource", "background")
    });
    highPassEdit.set(result);
  }, "適用しました。半径・適用量スライダーでそのまま微調整できます", "ハイパスを適用できませんでした"));
  highPassEdit.registerCancel((bindSliderPush("highPassRadius", value => highPassEdit.push({
    radius: value
  }), 300) || {}).cancel);
  highPassEdit.registerCancel((bindSliderPush("highPassOpacity", value => highPassEdit.push({
    opacity: value
  }), 150) || {}).cancel);
  bindRadioPush("highPassBlend", () => highPassEdit.push({
    blendMode: selectedRadioValue("highPassBlend", "overlay")
  }));
  if (typeof orton.suggestedBlurRadius === "function") {
    try {
      setValue("ortonBlur", orton.suggestedBlurRadius());
    } catch (_) {
      setValue("ortonBlur", 8);
    }
  }
  const ortonEdit = createEditMode({
    box: "ortonEditBox",
    label: "ortonEditLabel",
    finish: "finishOrtonEdit"
  }, orton.updateOrtonLayer);
  const applyOrtonColorButton = byId("applyOrtonColor");
  if (applyOrtonColorButton) {
    applyOrtonColorButton.addEventListener("click", () => runAction(applyOrtonColorButton, async () => {
      await orton.applyOrtonColorOnly({
        opacity: valueOf("ortonOpacity", 50)
      });
      setStatus("オートンカラー（ぼかしなし）を適用しました。強さはレイヤーの不透明度で調整できます", "success");
    }, null, "オートンカラーを適用できませんでした"));
  }
  const applyOrtonButton = byId("applyOrton");
  applyOrtonButton.addEventListener("click", () => runAction(applyOrtonButton, async () => {
    const result = await orton.applyOrtonEffect({
      scope: selectedRadioValue("ortonScope", "all"),
      blurRadius: valueOf("ortonBlur", 8),
      opacity: valueOf("ortonOpacity", 50)
    });
    ortonEdit.set(result);
  }, "適用しました。スライダーでそのまま微調整できます", "オートン効果を適用できませんでした"));
  ortonEdit.registerCancel((bindSliderPush("ortonOpacity", value => ortonEdit.push({
    opacity: value
  }), 150) || {}).cancel);
  ortonEdit.registerCancel((bindSliderPush("ortonBlur", value => ortonEdit.push({
    blurRadius: value
  }), 300) || {}).cancel);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
