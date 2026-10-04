"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {analyzeLevels: analyzeLevels} = require("../plugin/js/logic/histogram.js");

function filledHistogram(start, end, count = 1) {
  const hist = new Array(256).fill(0);
  for (let i = start; i <= end; i += 1) {
    hist[i] = count;
  }
  return hist;
}

test("analyzeLevels returns 2/2 for a narrow distribution centered near 128", () => {
  const hist = filledHistogram(120, 136, 10);
  assert.deepEqual(analyzeLevels(hist), {
    darks: 2,
    lights: 2
  });
});

test("analyzeLevels returns 4/4 for a uniform 0-255 distribution", () => {
  const hist = filledHistogram(0, 255, 1);
  assert.deepEqual(analyzeLevels(hist), {
    darks: 4,
    lights: 4
  });
});

test("analyzeLevels recommends more dark masks when dark spread is wider", () => {
  const hist = new Array(256).fill(0);
  for (let i = 0; i <= 140; i += 1) {
    hist[i] = 1;
  }
  for (let i = 141; i <= 155; i += 1) {
    hist[i] = 20;
  }
  const result = analyzeLevels(hist);
  assert.ok(result.darks > result.lights);
});

test("analyzeLevels handles a single-luminance image without throwing", () => {
  const hist = new Array(256).fill(0);
  hist[42] = 1e3;
  assert.deepEqual(analyzeLevels(hist), {
    darks: 2,
    lights: 2
  });
});
