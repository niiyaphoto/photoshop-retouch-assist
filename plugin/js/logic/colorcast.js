"use strict";

const BIN_COUNT = 256;

function normalizeHistogram(hist) {
  if (!Array.isArray(hist)) {
    return new Array(BIN_COUNT).fill(0);
  }
  const bins = new Array(BIN_COUNT).fill(0);
  for (let i = 0; i < Math.min(hist.length, BIN_COUNT); i += 1) {
    const count = Number(hist[i]);
    bins[i] = Number.isFinite(count) && count > 0 ? count : 0;
  }
  return bins;
}

function whitePointInput(hist, clipRatio = .001) {
  const bins = normalizeHistogram(hist);
  const total = bins.reduce((sum, count) => sum + count, 0);
  if (total <= 0) {
    return 255;
  }
  const threshold = total * clipRatio;
  let cumulative = 0;
  for (let i = BIN_COUNT - 1; i >= 0; i -= 1) {
    cumulative += bins[i];
    if (cumulative >= threshold) {
      return i < 8 ? 255 : i;
    }
  }
  return 255;
}

function softenInput(input, ratio = .25, output = 255) {
  const adjusted = Math.round(input + (output - input) * ratio);
  return Math.min(output, Math.max(0, adjusted));
}

function analyzeColorCast(hists, options = {}) {
  const ratio = options.soften == null ? .25 : options.soften;
  const clip = options.clip == null ? .001 : options.clip;
  const raw = {
    red: whitePointInput(hists.red, clip),
    green: whitePointInput(hists.green, clip),
    blue: whitePointInput(hists.blue, clip)
  };
  let base = "red";
  for (const key of [ "green", "blue" ]) {
    if (raw[key] > raw[base]) {
      base = key;
    }
  }
  const inputs = {};
  for (const key of [ "red", "green", "blue" ]) {
    inputs[key] = key === base ? raw[key] : softenInput(raw[key], ratio);
  }
  return {
    base: base,
    raw: raw,
    inputs: inputs
  };
}

module.exports = {
  analyzeColorCast: analyzeColorCast,
  softenInput: softenInput,
  whitePointInput: whitePointInput
};
