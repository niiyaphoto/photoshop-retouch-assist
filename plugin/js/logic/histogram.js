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

function totalPixels(bins) {
  return bins.reduce((sum, count) => sum + count, 0);
}

function percentileBin(bins, total, ratio) {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const threshold = total * ratio;
  let cumulative = 0;
  for (let i = 0; i < bins.length; i += 1) {
    cumulative += bins[i];
    if (cumulative >= threshold) {
      return i;
    }
  }
  return bins.length - 1;
}

function spreadToLevel(spread) {
  if (spread <= 48) {
    return 2;
  }
  if (spread <= 96) {
    return 3;
  }
  return 4;
}

function analyzeLevelsDetails(hist) {
  const bins = normalizeHistogram(hist);
  const total = totalPixels(bins);
  const p2 = percentileBin(bins, total, .02);
  const p50 = percentileBin(bins, total, .5);
  const p98 = percentileBin(bins, total, .98);
  const darkSpread = Math.max(0, p50 - p2);
  const lightSpread = Math.max(0, p98 - p50);
  return {
    darks: spreadToLevel(darkSpread),
    lights: spreadToLevel(lightSpread),
    p2: p2,
    p50: p50,
    p98: p98,
    darkSpread: darkSpread,
    lightSpread: lightSpread,
    total: total
  };
}

function analyzeLevels(hist) {
  const details = analyzeLevelsDetails(hist);
  return {
    darks: details.darks,
    lights: details.lights
  };
}

function spreadLabel(spread) {
  if (spread <= 48) {
    return "狭い";
  }
  if (spread <= 96) {
    return "中程度";
  }
  return "広い";
}

function describeAnalysis(hist) {
  const details = analyzeLevelsDetails(hist);
  return {
    details: details,
    darks: `暗部の階調が${spreadLabel(details.darkSpread)}ため ${details.darks} 段階を提案`,
    lights: `明部の階調が${spreadLabel(details.lightSpread)}ため ${details.lights} 段階を提案`
  };
}

module.exports = {
  analyzeLevels: analyzeLevels,
  analyzeLevelsDetails: analyzeLevelsDetails,
  describeAnalysis: describeAnalysis
};
