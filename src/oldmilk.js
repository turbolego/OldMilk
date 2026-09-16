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
  // zoom/rot/warp/decay are applied to the previous frame every draw (rendered via an
  // offscreen framebuffer feedback loop), producing Milkdrop-style trails/tunnels on WebGL 1.
  var PRESETS = {
    'Geiss - Blue Fusion':    { hue: 0.62, wave: 0.35, bars: 0.5, speed: 0.9, zoom: 0.985, rot: 0.010, warp: 0.4, decay: 0.94 },
    'Geiss - Spiky':          { hue: 0.05, wave: 0.15, bars: 1.0, speed: 1.3, zoom: 0.970, rot: -0.020, warp: 0.6, decay: 0.90 },
    'Flexi - Hypno':          { hue: 0.85, wave: 0.6,  bars: 0.5, speed: 0.6, zoom: 1.015, rot: 0.030, warp: 0.5, decay: 0.95 },
    'Mercury - Wave':         { hue: 0.45, wave: 1.0,  bars: 0.1, speed: 0.7, zoom: 0.995, rot: 0.005, warp: 0.2, decay: 0.97 },
    'Euphoric - Lights':      { hue: 0.90, wave: 0.4,  bars: 0.9, speed: 1.1, zoom: 0.980, rot: -0.015, warp: 0.45, decay: 0.92 },
    'Martin - Tunnel Vision': { hue: 0.55, wave: 0.2,  bars: 0.3, speed: 0.8, zoom: 0.960, rot: 0.000, warp: 0.15, decay: 0.90 },
    'Aderrasi - Starfield':   { hue: 0.15, wave: 0.1,  bars: 0.2, speed: 1.0, zoom: 0.920, rot: 0.008, warp: 0.10, decay: 0.88 }
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

  // Warps + decays the previous frame (read from uPrevTex) then adds new audio-reactive
  // content on top. Rendering this to an offscreen texture every frame and feeding the
  // result back in as uPrevTex is what produces Milkdrop-style trails/zoom/rotation using
  // only core WebGL 1 features (render-to-texture, no extensions required).
  var MAIN_FRAG_SRC =
    'precision mediump float;\n' +
    'uniform float uTime;\n' +
    'uniform vec2 uRes;\n' +
    'uniform float uBands[' + GL_BINS + '];\n' +
    'uniform float uHue,uWave,uBars,uSpeed;\n' +
    'uniform float uZoom,uRot,uWarp,uDecay;\n' +
    'uniform sampler2D uPrevTex;\n' +
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
    '  vec2 c = uv-0.5; c.x *= uRes.x/uRes.y;\n' +
    '  float ang = atan(c.y,c.x)+t*0.3, rad = length(c)*4.0;\n' +
    '  float field = sin(rad*5.0-t*2.0)*cos(ang*3.0+t*1.4)+sin(rad*9.0-t*0.8+bass*6.0)*0.5;\n' +
    '  float waveBand = bandAt(uv.x);\n' +
    '  float wave = 0.0;\n' +
    '  if(uWave>0.0){float f=waveBand;float y=0.5+(f-0.5)*uWave*(0.5+bass);wave=1.0-smoothstep(0.0,0.012,abs(uv.y-y));}\n' +
    '  float bars = 0.0;\n' +
    '  if(uBars>0.0){float x = uv.x*16.0; float f=bandAt(x/16.0); bars=smoothstep(f*uBars,f*uBars+0.05,1.0-uv.y)*0.6;}\n' +
    '  float glow = clamp(field*0.5+0.5+m*0.4, 0.0, 1.0);\n' +
    '  vec3 newCol = hsv2rgb(vec3(uHue,0.8,glow));\n' +
    '  newCol += vec3(0.1,0.4,1.0)*(sqrt(bars)+wave*0.8);\n' +
    '  newCol = clamp(newCol, 0.0, 1.0);\n' +
    '  float zoom = uZoom - bass*0.02;\n' +
    '  float rot = uRot + treb*0.01;\n' +
    '  float ca = cos(rot), sa = sin(rot);\n' +
    '  vec2 pc = vec2(c.x*ca - c.y*sa, c.x*sa + c.y*ca) * zoom;\n' +
    '  pc += uWarp*0.03*vec2(sin(pc.y*6.0+t*0.9), cos(pc.x*6.0+t*1.1));\n' +
    '  pc.x /= uRes.x/uRes.y;\n' +
    '  vec2 srcUv = pc + 0.5;\n' +
    '  vec3 prevCol = texture2D(uPrevTex, srcUv).rgb * uDecay;\n' +
    '  vec3 addCol = newCol * (1.0-uDecay) * 1.4;\n' +
    '  gl_FragColor = vec4(clamp(prevCol + addCol, 0.0, 1.0), 1.0);\n' +
    '}\n';

  // Simple textured-quad blit to move the offscreen accumulated frame onto the visible canvas.
  var BLIT_FRAG_SRC =
    'precision mediump float;\n' +
    'uniform sampler2D uTex;\n' +
    'uniform vec2 uRes;\n' +
    'void main(){\n' +
    '  vec2 uv = gl_FragCoord.xy/uRes;\n' +
    '  gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0);\n' +
    '}\n';

  function createVisualizer(canvasOrId, opts) {
    opts = opts || {};
    var width = opts.width || 275, height = opts.height || 116;
    if (typeof canvasOrId === 'string') canvasOrId = findCanvas();
    var canvas = canvasOrId;
    // Prevent the standalone auto-init below from also attaching to this canvas and fighting over frames.
    canvas.setAttribute('data-oldmilk-inited', '1');
    var gl = null, mainProg = null, blitProg = null, useGL = false;
    var mUniforms = {}, bUniforms = {}, quadBuf = null;
    var fbos = [null, null], fboTex = [null, null], curFbo = 0;
    var bandArr = new Float32Array(BINS);
    var glBandArr = new Float32Array(GL_BINS);
    var params = PRESETS['Geiss - Blue Fusion'];
    var audio = null, g2d = null, t = 0;

    function compileProgram(fragSrc) {
      var vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VERT_SRC); gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return null;
      var fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fragSrc); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return null;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      return prog;
    }

    // Both programs share one full-screen-triangle buffer; the attrib pointer is rebound
    // per-program right before drawing since attribute locations aren't guaranteed to match.
    function bindQuad(prog) {
      if (!quadBuf) {
        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      }
      var aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }

    // Two ping-ponged render targets hold the accumulated trail frame; core WebGL 1
    // render-to-texture, no extensions needed (NPOT is fine without mipmaps/REPEAT).
    function initFBOs() {
      for (var i = 0; i < 2; i++) {
        if (fboTex[i]) gl.deleteTexture(fboTex[i]);
        if (fbos[i]) gl.deleteFramebuffer(fbos[i]);
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        fboTex[i] = tex; fbos[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      curFbo = 0;
    }

    // WebGL 1 init
    (function initGL() {
      try {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      } catch (e) { gl = null; }
      if (!gl) return;
      mainProg = compileProgram(MAIN_FRAG_SRC);
      blitProg = compileProgram(BLIT_FRAG_SRC);
      if (!mainProg || !blitProg) { gl = null; return; }

      gl.useProgram(mainProg);
      bindQuad(mainProg);
      mUniforms.uRes = gl.getUniformLocation(mainProg, 'uRes');
      mUniforms.uTime = gl.getUniformLocation(mainProg, 'uTime');
      mUniforms.uHue = gl.getUniformLocation(mainProg, 'uHue');
      mUniforms.uWave = gl.getUniformLocation(mainProg, 'uWave');
      mUniforms.uBars = gl.getUniformLocation(mainProg, 'uBars');
      mUniforms.uSpeed = gl.getUniformLocation(mainProg, 'uSpeed');
      mUniforms.uBands = gl.getUniformLocation(mainProg, 'uBands');
      mUniforms.uZoom = gl.getUniformLocation(mainProg, 'uZoom');
      mUniforms.uRot = gl.getUniformLocation(mainProg, 'uRot');
      mUniforms.uWarp = gl.getUniformLocation(mainProg, 'uWarp');
      mUniforms.uDecay = gl.getUniformLocation(mainProg, 'uDecay');
      mUniforms.uPrevTex = gl.getUniformLocation(mainProg, 'uPrevTex');

      gl.useProgram(blitProg);
      bindQuad(blitProg);
      bUniforms.uRes = gl.getUniformLocation(blitProg, 'uRes');
      bUniforms.uTex = gl.getUniformLocation(blitProg, 'uTex');

      initFBOs();
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
        var bin = 0;
        for (bin = 0; bin < GL_BINS; bin++) {
          glBandArr[bin] = (bandArr[bin * 3] + bandArr[bin * 3 + 1] + bandArr[bin * 3 + 2]) / 3;
        }

        var readIdx = curFbo, writeIdx = 1 - curFbo;

        // Pass 1: warp+decay the previous accumulated frame and add new content into the other FBO.
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[writeIdx]);
        gl.viewport(0, 0, width, height);
        gl.useProgram(mainProg);
        bindQuad(mainProg);
        gl.uniform2f(mUniforms.uRes, width, height);
        gl.uniform1f(mUniforms.uTime, t);
        gl.uniform1f(mUniforms.uHue, params.hue);
        gl.uniform1f(mUniforms.uWave, params.wave);
        gl.uniform1f(mUniforms.uBars, params.bars);
        gl.uniform1f(mUniforms.uSpeed, params.speed);
        gl.uniform1f(mUniforms.uZoom, params.zoom);
        gl.uniform1f(mUniforms.uRot, params.rot);
        gl.uniform1f(mUniforms.uWarp, params.warp);
        gl.uniform1f(mUniforms.uDecay, params.decay);
        gl.uniform1fv(mUniforms.uBands, glBandArr);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex[readIdx]);
        gl.uniform1i(mUniforms.uPrevTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        curFbo = writeIdx;

        // Pass 2: blit the freshly accumulated frame to the visible canvas.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(blitProg);
        bindQuad(blitProg);
        gl.uniform2f(bUniforms.uRes, width, height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex[curFbo]);
        gl.uniform1i(bUniforms.uTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }
      if (!g2d) { try { g2d = canvas.getContext('2d'); } catch (e) { g2d = null; } }
      if (!g2d) return;
      var W = canvas.width, H = canvas.height;
      // Trail fade (instead of a full clear) gives the Canvas 2D fallback a milder Milkdrop-like persistence.
      g2d.fillStyle = 'rgba(0,0,0,' + (1 - params.decay) + ')'; g2d.fillRect(0, 0, W, H);
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
      resize: function (w, h) {
        width = w; height = h; canvas.width = w; canvas.height = h;
        if (useGL) initFBOs();
      },
      isWebGL: function () { return useGL; },
      getBands: function () { return bandArr; }
    };
  }

  // Auto-init if script loaded standalone
  if (typeof window !== 'undefined') {
    function startVisualizer() {
      var canvas = findCanvas();
      if (canvas && !canvas.getAttribute('data-oldmilk-inited')) {
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
