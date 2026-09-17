# OldMilk

ES5 + WebGL 1 Milkdrop-style music visualizer. Targets **iPad 2 / iOS 9.3.5 Safari** — no WebGL 2, no WASM, no ES6 required.

Rendering uses a WebGL 1 render-to-texture feedback loop (two ping-ponged framebuffers): each frame warps, rotates, zooms and decays the previous frame before compositing new audio-reactive content on top, producing Milkdrop-style trails/tunnels without needing WebGL 2, an `eel` expression interpreter, or the full `.milk` preset format. Preset names are inspired by (but do not reproduce) the classic author styles cataloged in [projectM-visualizer/presets-milkdrop-original](https://github.com/projectM-visualizer/presets-milkdrop-original).

## Requirements

- WebGL 1 (`canvas.getContext('webgl')`) — or falls back to Canvas 2D
- ES5 only (`var`, `function` — no `let`/`const`/arrow/template literals)
- No npm dependencies

## Install

```html
<script src="src/oldmilk.js"></script>
```

## Quick start

```js
var canvas = document.getElementById('viz');
var viz = OldMilk.createVisualizer(canvas, { width: 640, height: 280 });

// optional: connect real Web Audio (AnalyserNode)
viz.setAudioSource(analyser);  // or null for synthetic mode

viz.loadPreset('Geiss - Blue Fusion');
function loop() { viz.render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
```

## Presets

`zoom`/`rot`/`warp`/`decay` drive the per-frame feedback warp (zoom < 1 zooms in, `rot` is radians of rotation applied every frame, `decay` is trail persistence).

| Name | Hue | Wave | Bars | Speed | Zoom | Rot | Warp | Decay |
|---|---|---|---|---|---|---|---|---|
| `Geiss - Blue Fusion` | 0.62 | 0.35 | 0.5 | 0.9 | 0.985 | 0.010 | 0.4 | 0.94 |
| `Geiss - Spiky` | 0.05 | 0.15 | 1.0 | 1.3 | 0.970 | -0.020 | 0.6 | 0.90 |
| `Flexi - Hypno` | 0.85 | 0.6 | 0.5 | 0.6 | 1.015 | 0.030 | 0.5 | 0.95 |
| `Mercury - Wave` | 0.45 | 1.0 | 0.1 | 0.7 | 0.995 | 0.005 | 0.2 | 0.97 |
| `Euphoric - Lights` | 0.90 | 0.4 | 0.9 | 1.1 | 0.980 | -0.015 | 0.45 | 0.92 |
| `Martin - Tunnel Vision` | 0.55 | 0.2 | 0.3 | 0.8 | 0.960 | 0.000 | 0.15 | 0.90 |
| `Aderrasi - Starfield` | 0.15 | 0.1 | 0.2 | 1.0 | 0.920 | 0.008 | 0.10 | 0.88 |

## Demo audio

`index.html` includes a "Play Song" button that feeds `audio/Grieg - Peer Gynt Suite No. 1 - In the Hall of the Mountain King.mp3` through a Web Audio `AnalyserNode` into the visualizer, as an alternative to the synthesized "Test Tone".

- **Track:** Edvard Grieg — *Peer Gynt Suite No. 1, Op. 46*: In the Hall of the Mountain King
- **Source:** [musopen.org/music/777-peer-gynt-suite-no-1-op-46](https://musopen.org/music/777-peer-gynt-suite-no-1-op-46/)
- **License:** Public domain (credited here for attribution purposes even though not legally required)

## API

`OldMilk.createVisualizer(canvas, opts)` → `viz`

| Method | Description |
|---|---|
| `viz.setAudioSource(node)` | Set Web Audio `AnalyserNode` (or `null` for synthetic) |
| `viz.loadPreset(name)` | Activate a preset by name; returns `true` if found |
| `viz.render()` | Draw one frame to the canvas |
| `viz.resize(w, h)` | Update canvas dimensions |
| `viz.isWebGL()` | `true` if running on WebGL 1; `false` if Canvas 2D fallback |

## License

MIT