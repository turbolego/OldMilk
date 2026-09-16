/*!
 * OldMilk — ES5 + WebGL 1 Milkdrop-style visualizer.
 * Targets iPad 2 / iOS 9.3.5 Safari (WebGL 1, ES5). Dep-free.
 *
 * Usage:
 *   1. Include <script src="src/oldmilk.js"></script>
 *   2. Either:
 *      a) OldMilk auto-detects <canvas id="milkdrop-canvas"> or <canvas id="viz">
 *      b) Call OldMilk.createVisualizer(canvas, {width, height}) manually
 *
 * API:
 *   viz.setAudioSource(node)     // WebAudio node with getByteFrequencyData, or null -> synthetic
 *   viz.loadPreset(name)
 *   viz.render()                 // draws one frame; call from rAF loop
 *   viz.resize(w, h)
 *   viz.isWebGL() -> bool
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.OldMilk = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BINS = 48;
  // Keep analyser data at 48 bins, but use a conservative 16-bin shader interface for older WebGL 1 GPUs.
  var GL_BINS = 16;
  var PRESETS = {
    'Geiss - Blue Fusion': { hue: 0.62, wave: 0.35, bars: 0.5, speed: 0.9 },
    'Geiss - Spiky':        { hue: 0.05, wave: 0.15, bars: 1.0, speed: 1.3 },
    'Flexi - Hypno':        { hue: 0.85, wave: 0.6,  bars: 0.5, speed: 0.6 },
    'Mercury - Wave':       { hue: 0.45, wave: 1.0,  bars: 0.1, speed: 0.7 },
    'Euphoric - Lights':    { hue: 0.90, wave: 0.4,  bars: 0.9, speed: 1.1 }
  };

  function findCanvas() {
    // Try common IDs first (for iPad2Spotify compatibility)
    var c = document.getElementById('milkdrop-canvas');
    if (!c) c = document.getElementById('viz');
    // Fallback: first canvas in document
    if (!c) c = document.createElement('canvas');
    return c;
  }

  var VERT_SRC =
    'attribute vec2 aPos;\n' +
    'void main(){ gl_Position=vec4(aPos,0.0,1.0); }\n';

  var FRAG_SRC =
    'precision mediump float;\n' +
    'uniform float uTime;\n' +
    'uniform vec2 uRes;\n' +
    'uniform float uBands[' + GL_BINS + '];\n' +
    'uniform float uHue,uWave,uBars,uSpeed;\n' +
    'vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.wzw);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}\n' +
    'float bandAt(float x){\n' +
    '  if(x < 0.062500) return uBands[0];\n' +
    '  if(x < 0.125000) return uBands[1];\n' +
    '  if(x < 0.187500) return uBands[2];\n' +
    '  if(x < 0.250000) return uBands[3];\n' +
    '  if(x < 0.312500) return uBands[4];\n' +
    '  if(x < 0.375000) return uBands[5];\n' +
    '  if(x < 0.437500) return uBands[6];\n' +
    '  if(x < 0.500000) return uBands[7];\n' +
    '  if(x < 0.562500) return uBands[8];\n' +
    '  if(x < 0.625000) return uBands[9];\n' +
    '  if(x < 0.687500) return uBands[10];\n' +
    '  if(x < 0.750000) return uBands[11];\n' +
    '  if(x < 0.812500) return uBands[12];\n' +
    '  if(x < 0.875000) return uBands[13];\n' +
    '  if(x < 0.937500) return uBands[14];\n' +
    '  if(x < 1.000000) return uBands[15];\n' +
    '  return uBands[15];\n' +
    '}\n' +
    'void main(){\n' +
    '  vec2 uv = gl_FragCoord.xy/uRes;\n' +
    '  float t = uTime*uSpeed;\n' +
    '  float bass = uBands[0]+uBands[1], mid=uBands[7]+uBands[8], treb=uBands[13]+uBands[15];\n' +
    '  float m = (bass+mid+treb)/3.0;\n' +
    '  vec2 p = uv-0.5;p.x*=uRes.x/uRes.y;\n' +
    '  float ang = atan(p.y,p.x)+t*0.3, rad = length(p)*4.0;\n' +
    '  float field = sin(rad*5.0-t*2.0)*cos(ang*3.0+t*1.4)+sin(rad*9.0-t*0.8+bass*6.0)*0.5;\n' +
    '  float waveBand = bandAt(uv.x);\n' +
    '  float wave = 0.0;\n' +
    '  if(uWave>0.0){float f=waveBand;float y=0.5+(f-0.5)*uWave*(0.5+bass);wave=1.0-smoothstep(0.0,0.012,abs(uv.y-y));}\n' +
    '  float bars = 0.0;\n' +
    '  if(uBars>0.0){float x = uv.x*16.0; float f=bandAt(x/16.0); bars=smoothstep(f*uBars,f*uBars+0.05,1.0-uv.y)*0.6;}\n' +
    '  float glow = field*0.5+0.5+m*0.4;\n' +
    '  vec3 col = hsv2rgb(vec3(uHue,0.8,glow));\n' +
    '  col += vec3(0.1,0.4,1.0)*(sqrt(bars)+wave*0.8);\n' +
    '  gl_FragColor = vec4(col,1.0);\n' +
    '}\n';

  function createVisualizer(canvasOrId, opts) {
    opts = opts || {};
    var width = opts.width || 275, height = opts.height || 116;
    if (typeof canvasOrId === 'string') canvasOrId = findCanvas();
    var canvas = canvasOrId;
    var gl = null, prog = null, uRes, uTime, uHue, uWave, uBars, uSpeed, uBands, useGL = false;
    var bandArr = new Float32Array(BINS);
    var glBandArr = new Float32Array(GL_BINS);
    var params = PRESETS['Geiss - Blue Fusion'];
    var audio = null, g2d = null, t = 0;

    // WebGL 1 init
    (function initGL() {
      try {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      } catch (e) { gl = null; }
      if (!gl) return;
      var vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VERT_SRC); gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { gl = null; return; }
      var fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, FRAG_SRC); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { gl = null; return; }
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return; }
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      var aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      uRes = gl.getUniformLocation(prog, 'uRes');
      uTime = gl.getUniformLocation(prog, 'uTime');
      uHue = gl.getUniformLocation(prog, 'uHue');
      uWave = gl.getUniformLocation(prog, 'uWave');
      uBars = gl.getUniformLocation(prog, 'uBars');
      uSpeed = gl.getUniformLocation(prog, 'uSpeed');
      uBands = gl.getUniformLocation(prog, 'uBands');
      useGL = true;
    })();

    function updateBands() {
      if (audio && typeof audio.getByteFrequencyData === 'function') {
        var u8 = new Uint8Array(audio.frequencyBinCount || 256);
        audio.getByteFrequencyData(u8);
        for (var i = 0; i < BINS; i++) {
          bandArr[i] = u8[Math.floor((i / BINS) * u8.length)] / 255.0;
        }
      } else {
        for (var j = 0; j < BINS; j++) {
          var f = j / BINS, v = 0.5 + 0.5 * Math.sin(t * (1.5 + f * 2.5) + j * 0.9);
          bandArr[j] = Math.max(0, Math.min(1, v * (0.4 + 0.6 * (1 - f))));
        }
      }
    }

    function render() {
      t += 0.016;
      updateBands();
      if (useGL) {
        gl.viewport(0, 0, width, height);
        gl.useProgram(prog);
        gl.uniform2f(uRes, width, height);
        gl.uniform1f(uTime, t);
        gl.uniform1f(uHue, params.hue);
        gl.uniform1f(uWave, params.wave);
        gl.uniform1f(uBars, params.bars);
        gl.uniform1f(uSpeed, params.speed);
        var bin = 0;
        for (bin = 0; bin < GL_BINS; bin++) {
          glBandArr[bin] = (bandArr[bin * 3] + bandArr[bin * 3 + 1] + bandArr[bin * 3 + 2]) / 3;
        }
        gl.uniform1fv(uBands, glBandArr);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }
      if (!g2d) { try { g2d = canvas.getContext('2d'); } catch (e) { g2d = null; } }
      if (!g2d) return;
      var W = canvas.width, H = canvas.height;
      g2d.fillStyle = '#000'; g2d.fillRect(0, 0, W, H);
      var bass = bandArr[2], mid = bandArr[16], treb = bandArr[40];
      var hue = params.hue * 360;
      for (var i = 0; i < 14; i++) {
        var r = 20 + i * ((16 + mid * 24)) + Math.sin(t * params.speed + i) * (6 + bass * 14);
        g2d.strokeStyle = 'hsl(' + (hue + i * 14 + t * 30) + ',70%,' + (40 + i * 4) + '%)';
        g2d.beginPath(); g2d.arc(W/2, H/2, r, 0, Math.PI*2); g2d.stroke();
      }
      if (params.wave > 0) {
        g2d.strokeStyle = 'rgba(120,255,200,' + (0.4 + mid * 0.5) + ')';
        g2d.beginPath();
        for (var x = 0; x <= W; x += 3) {
          var f = bandArr[Math.min(BINS-1, Math.floor((x/W)*BINS))];
          var y = H * (0.5 + (f-0.5) * params.wave * (0.6 + bass));
          if (x === 0) g2d.moveTo(x, y); else g2d.lineTo(x, y);
        }
        g2d.stroke();
      }
      if (params.bars > 0) {
        var nb = 12, bw = W/nb;
        for (var b = 0; b < nb; b++) {
          var v = bandArr[Math.floor((b/nb)*BINS)] * params.bars;
          g2d.fillStyle = 'hsl(' + (hue + treb * 60) + ',80%,' + (30 + v * 60) + '%)';
          g2d.fillRect(b * bw, H - v * H * 0.8, bw - 1, v * H * 0.8);
        }
      }
    }



    return {
      setAudioSource: function (src) { audio = src; },
      loadPreset: function (name) { if (PRESETS[name]) { params = PRESETS[name]; return true; } return false; },
      presetNames: function () { return Object.keys(PRESETS); },
      render: render,
      resize: function (w, h) { width = w; height = h; canvas.width = w; canvas.height = h; },
      isWebGL: function () { return useGL; },
      getBands: function () { return bandArr; }
    };
  }

  // Auto-init if script loaded standalone
  if (typeof window !== 'undefined') {
    function startVisualizer() {
      var canvas = findCanvas();
      if (canvas) {
        canvas.width = 275; canvas.height = 116;
        window.oldmilkViz = createVisualizer(canvas);
        (function loop() {
          window.oldmilkViz.render();
          requestAnimationFrame(loop);
        })();
      }
    }
    if (document.readyState === 'complete') {
      startVisualizer();
    } else {
      document.addEventListener('DOMContentLoaded', startVisualizer);
    }
  }

  return { createVisualizer: createVisualizer, PRESETS: PRESETS };
});
