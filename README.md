# OldMilk

ES5 + WebGL 1 Milkdrop-style music visualizer. Targets **iPad 2 / iOS 9.3.5 Safari** — no WebGL 2, no WASM, no ES6 required.

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

| Name | Hue | Wave | Bars | Speed |
|---|---|---|---|---|
| `Geiss - Blue Fusion` | 0.62 | 0.35 | 0.5 | 0.9 |
| `Geiss - Spiky` | 0.05 | 0.15 | 1.0 | 1.3 |
| `Flexi - Hypno` | 0.85 | 0.6 | 0.5 | 0.6 |
| `Mercury - Wave` | 0.45 | 1.0 | 0.1 | 0.7 |
| `Euphoric - Lights` | 0.90 | 0.4 | 0.9 | 1.1 |

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