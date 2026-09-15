/*!
 * OldMilk — ES5 + WebGL 1 Milkdrop-style visualizer.
 * Targets iPad 2 / iOS 9.3.5 Safari (WebGL 1, ES5). Dep-free.
 *
 * OldMilk.createVisualizer(canvas, {width,height})
 *   viz.setAudioSource(node)     // WebAudio node with getByteFrequencyData, or null -> synthetic
 *   viz.loadPreset(name)         // range of params
 *   viz.render()                 // draws one frame; call from rAF
 *   viz.resize(w,h)
 *   viz.isWebGL() -> bool
 *
 * - WebGL 1 fullscreen-triangle fragment shader, driven by FFT uniforms.
 * - Falls back to Canvas 2D if WebGL 1 unavailable (still ES5).
 * - Synthetic frequency animation when no audio source (remote-controller case).
 * Needs only: var, function, Array, Math, canvas.getContext('webgl'|'2d').
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.OldMilk = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BINS = 48;              // FFT bands we feed to shaders
  var PRESETS = {
    'Geiss - Blue Fusion': { hue: 0.62, wave: 0.35, bars: 0.5, speed: 0.9 },
    'Geiss - Spiky':        { hue: 0.05, wave: 0.15, bars: 1.0, speed: 1.3 },
    'Flexi - Hypno':        { hue: 0.85, wave: 0.6,  bars: 0.5, speed: 0.6 },
    'Mercury - Wave':       { hue: 0.45, wave: 1.0,  bars: 0.1, speed: 0.7 },
    'Euphoric - Lights':    { hue: 0.90, wave: 0.4,  bars: 0.9, speed: 1.1 }
  };

  var VERT_SRC =
    'attribute vec2 aPos;\n' +
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }\n';

  var FRAG_SRC =
    'precision mediump float;\n' +
    'uniform float uTime;\n' +
    'uniform vec2  uRes;\n' +
    'uniform float uBands[' + BINS + '];\n' +
    'uniform float uHue, uWave, uBars, uSpeed;\n' +
    'vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.wzw);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}\n' +
    'void main(){\n' +
    '  vec2 uv = gl_FragCoord.xy / uRes;\n' +
    '  float t = uTime * uSpeed;\n' +
    '  // frequency buckets\n' +
    '  float bass = uBands[1] + uBands[2];\n' +
    '  float mid  = uBands[14] + uBands[16];\n' +
    '  float treb = uBands[34] + uBands[40];\n' +
    '  float m = (bass + mid + treb) / 3.0;\n' +
    '  // fractal-ish field\n' +
    '  vec2 p = uv - 0.5;\n' +
    '  p.x *= uRes.x / uRes.y;\n' +
    '  float ang = atan(p.y, p.x) + t * 0.3;\n' +
    '  float rad = length(p) * 4.0;\n' +
    '  float field = sin(rad * 5.0 - t * 2.0) * cos(ang * 3.0 + t * 1.4);\n' +
    '  field += sin(rad * 9.0 - t * 0.8 + bass * 6.0) * 0.5;\n' +
    '  // waveform line\n' +
    '  float wave = 0.0;\n' +
    '  if (uWave > 0.0) {\n' +
    '    float x = uv.x * float(' + BINS + ');\n' +
    '    int ix = int(x);\n' +
    '    float f = uBands[clamp(ix, 0, ' + (BINS - 1) + ')];\n' +
    '    float y = 0.5 + (f - 0.5) * uWave * (0.5 + bass);\n' +
    '    wave = 1.0 - smoothstep(0.0, 0.012, abs(uv.y - y));\n' +
    '  }\n' +
    '  // bar glow (vertical spectrum)\n' +
    '  float bars = 0.0;\n' +
    '  if (uBars > 0.0) {\n' +
    '    float x = uv.x * 16.0; int bx = int(x);\n' +
    '    float f = uBands[clamp(bx * ' + Math.floor(BINS / 16) + ', 0, ' + (BINS - 1) + ')];\n' +
    '    bars = smoothstep(f * uBars, f * uBars + 0.05, 1.0 - uv.y) * 0.6;\n' +
    '  }\n' +
    '  float glow = field * 0.5 + 0.5 + m * 0.4;\n' +
    '  vec3 col = hsv2rgb(vec3(uHue, 0.8, glow));\n' +
    '  col += vec3(0.1, 0.4, 1.0) * (sqrt(bars) + wave * 0.8);\n' +
    '  gl_FragColor = vec4(col, 1.0);\n' +
    '}\n';

  // ---------------- init helpers ----------------
  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      if (root.console && console.warn) console.warn('OldMilk shader error: ' + (gl.getShaderInfoLog(sh) || ''));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function buildProgram(gl) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { if (root.console && console.warn) console.warn('OldMilk link error'); return null; }
    return p;
  }

  function createVisualizer(canvas, opts) {
    opts = opts || {};
    var width = opts.width || 275, height = opts.height || 116;
    var gl = null, prog = null, uRes, uTime, uHue, uWave, uBars, uSpeed, uBands;
    var bandArr = new Float32Array(BINS);
    var useGL = false;
    var audio = null;
    var g2d = null;
    var t = 0;
    var params = PRESETS['Geiss - Blue Fusion'];
    var allowed = {};
    Object.keys(PRESETS).forEach(function (k) { allowed[k] = 1; });

    // WebGL 1 init
    (function initGL() {
      try {
        gl = canvas.getContext('webgl', { antialias: false, alpha: false }) ||
             canvas.getContext('experimental-webgl', { antialias: false, alpha: false });
      } catch (e) { gl = null; }
      if (!gl) return;
      prog = buildProgram(gl);
      if (!prog) { gl = null; return; }
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      // fullscreen triangle
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      var aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      uRes  = gl.getUniformLocation(prog, 'uRes');
      uTime = gl.getUniformLocation(prog, 'uTime');
      uHue  = gl.getUniformLocation(prog, 'uHue');
      uWave = gl.getUniformLocation(prog, 'uWave');
      uBars = gl.getUniformLocation(prog, 'uBars');
      uSpeed= gl.getUniformLocation(prog, 'uSpeed');
      uBands= gl.getUniformLocation(prog, 'uBands');
      useGL = true;
    })();

    function updateBands() {
      if (audio && typeof audio.getByteFrequencyData === 'function') {
        var u8 = new Uint8Array(audio.frequencyBinCount || 256);
        audio.getByteFrequencyData(u8);
        for (var i = 0; i < BINS; i++) {
          var src = Math.floor((i / BINS) * u8.length);
          bandArr[i] = u8[src] / 255.0;
        }
      } else {
        // synthetic: animate a shaped spectrum
        var k = 0;
        for (var j = 0; j < BINS; j++) {
          var f = j / BINS;
          var v = 0.5 + 0.5 * Math.sin(t * (1.5 + f * 2.5) + j * 0.9);
          bandArr[j] = Math.max(0, Math.min(1, v * (0.4 + 0.6 * (1 - f))));
        }
      }
    }

    function render() {
      t += 0.016;
      updateBands();
      // normalize bass-ish pulse from band data
      if (useGL) {
        gl.viewport(0, 0, width, height);
        gl.useProgram(prog);
        gl.uniform2f(uRes, width, height);
        gl.uniform1f(uTime, t);
        gl.uniform1f(uHue, params.hue);
        gl.uniform1f(uWave, params.wave);
        gl.uniform1f(uBars, params.bars);
        gl.uniform1f(uSpeed, params.speed);
        gl.uniform1fv(uBands, bandArr);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }
      // 2D fallback
      if (!g2d) {
        try { g2d = canvas.getContext('2d'); } catch (e) { g2d = null; }
      }
      if (!g2d) return;
      var W = canvas.width, H = canvas.height;
      g2d.fillStyle = '#000'; g2d.fillRect(0, 0, W, H);
      var bass = bandArr[2], mid = bandArr[16], treb = bandArr[40];
      var hue = params.hue * 360;
      // field rings
      for (var i = 0; i < 14; i++) {
        var r = 20 + i * ((16 + mid * 24)) + Math.sin(t * params.speed + i) * (6 + bass * 14);
        g2d.strokeStyle = 'hsl(' + (hue + i * 14 + t * 30) + ',70%,' + (40 + i * 4) + '%)';
        g2d.beginPath(); g2d.arc(W / 2, H / 2, r, 0, Math.PI * 2); g2d.stroke();
      }
      if (params.wave > 0) {
        g2d.strokeStyle = 'rgba(120,255,200,' + (0.4 + mid * 0.5) + ')';
        g2d.beginPath();
        for (var x = 0; x <= W; x += 3) {
          var f = bandArr[Math.min(BINS - 1, Math.floor((x / W) * BINS))];
          var y = H * (0.5 + (f - 0.5) * params.wave * (0.6 + bass));
          if (x === 0) g2d.moveTo(x, y); else g2d.lineTo(x, y);
        }
        g2d.stroke();
      }
      if (params.bars > 0) {
        var nb = 12, bw = W / nb;
        for (var b = 0; b < nb; b++) {
          var v = bandArr[Math.floor((b / nb) * BINS)] * params.bars;
          g2d.fillStyle = 'hsl(' + (hue + treb * 60) + ',80%,' + (30 + v * 60) + '%)';
          g2d.fillRect(b * bw, H - v * H * 0.8, bw - 1, v * H * 0.8);
        }
      }
    }

    return {
      setAudioSource: function (src) { audio = src; },
      loadPreset: function (name) { if (allowed[name]) { params = PRESETS[name]; return true; } return false; },
      presetNames: function () { return Object.keys(PRESETS); },
      render: render,
      resize: function (w, h) { width = w; height = h; canvas.width = w; canvas.height = h; },
      isWebGL: function () { return useGL; },
      getBands: function () { return bandArr; }
    };
  }

  return { createVisualizer: createVisualizer, PRESETS: PRESETS };
});