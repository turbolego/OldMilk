/**
 * tests/validate.js — lightweight syntax & export check for src/oldmilk.js.
 * Runs without any deps; works on Node 8+ / iOS 9.3.5 can't run Node.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var file = path.join(__dirname, '..', 'src', 'oldmilk.js');
var src = fs.readFileSync(file, 'utf8');
var ok = true;
var errors = [];

// 1. no ES6 features
if (/\b(let |const |=>|`.*`)/.test(src.replace(/['"][^'"]*['"]/g, '').replace(/\/\/.*$/gm, ''))) {
  errors.push('FAIL: ES6 syntax detected (let/const/template literals/arrow)');
}

// 2. no WebGL2 references
if (/webgl2|getContext\(['"]webgl2['"]\)/.test(src)) {
  errors.push('FAIL: WebGL2 references found');
}

// 3. module.exports present
if (src.indexOf('module.exports') === -1 && src.indexOf('OldMilk') === -1) {
  errors.push('FAIL: No export for OldMilk');
}

// 4. parse in Node to confirm JS is valid (basic)
try {
  // stub minimal browser globals for static parse
  var vm = require('vm');
  var ctx = { self: {}, console: console, setTimeout: setTimeout, module: module, require: require };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  var om = ctx.OldMilk || ctx.module.exports;
  if (!om || typeof om.createVisualizer !== 'function') {
    errors.push('FAIL: OldMilk.createVisualizer not exported');
  } else {
    console.log('  ✓ OldMilk.createVisualizer() found');
  }
  // check presets exist
  var pres = om && om.PRESETS;
  if (!pres || Object.keys(pres).length < 3) {
    errors.push('FAIL: Less than 3 presets in OldMilk.PRESETS');
  } else {
    console.log('  ✓ ' + Object.keys(pres).length + ' presets registered');
  }
} catch (e) {
  errors.push('FAIL: JS parse/runtime error: ' + e.message);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}