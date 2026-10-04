"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {analyzeColorCast: analyzeColorCast, softenInput: softenInput, whitePointInput: whitePointInput} = require("../plugin/js/logic/colorcast.js");

function histogramWithTopAt(value) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i <= value; i += 1) {
    hist[i] = 100;
  }
  return hist;
}

test("whitePointInput returns the highest populated level", () => {
  assert.equal(whitePointInput(histogramWithTopAt(200)), 200);
  assert.equal(whitePointInput(histogramWithTopAt(254)), 254);
});

test("whitePointInput returns 255 for an empty histogram", () => {
  assert.equal(whitePointInput(new Array(256).fill(0)), 255);
});

test("whitePointInput treats a nearly dead channel as no-correction (255)", () => {
  const dead = new Array(256).fill(0);
  dead[0] = 1e5;
  dead[3] = 50;
  assert.equal(whitePointInput(dead), 255);
});

test("analyzeColorCast leaves dead channels uncorrected", () => {
  const dead = new Array(256).fill(0);
  dead[2] = 1e3;
  const plan = analyzeColorCast({
    red: histogramWithTopAt(250),
    green: histogramWithTopAt(200),
    blue: dead
  });
  assert.equal(plan.inputs.blue, 255);
  assert.ok(plan.inputs.red >= 250 && plan.inputs.red <= 255);
  assert.ok(plan.inputs.green >= 200 && plan.inputs.green <= 255);
});

test("softenInput follows newIn = in + (out - in) / 4 and never exceeds out", () => {
  assert.equal(softenInput(197), 212);
  assert.equal(softenInput(153), 179);
  assert.equal(softenInput(255), 255);
  assert.ok(softenInput(0) <= 255);
});

test("analyzeColorCast keeps the widest channel and softens the others", () => {
  const plan = analyzeColorCast({
    red: histogramWithTopAt(254),
    green: histogramWithTopAt(197),
    blue: histogramWithTopAt(153)
  });
  assert.equal(plan.base, "red");
  assert.equal(plan.inputs.red, 254);
  assert.equal(plan.inputs.green, 212);
  assert.equal(plan.inputs.blue, 179);
});

test("analyzeColorCast picks the widest channel as base regardless of color", () => {
  const plan = analyzeColorCast({
    red: histogramWithTopAt(150),
    green: histogramWithTopAt(250),
    blue: histogramWithTopAt(200)
  });
  assert.equal(plan.base, "green");
  assert.equal(plan.inputs.green, 250);
  assert.ok(plan.inputs.red > 150);
  assert.ok(plan.inputs.blue > 200);
});
