import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// === DARK MODE: original fragment shader (unchanged) ===
const FRAG_DARK = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop { vec3 color; float position; };

#define COLOR_RAMP(colors, factor, finalColor) { \
  int index = 0; \
  for (int i = 0; i < 2; i++) { \
    ColorStop currentColor = colors[i]; \
    bool isInBetween = currentColor.position <= factor; \
    index = int(mix(float(index), float(i), float(isInBetween))); \
  } \
  ColorStop currentColor = colors[index]; \
  ColorStop nextColor = colors[index + 1]; \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

// === LIGHT MODE: edge-lift fragment shader ===
const FRAG_LIGHT = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform vec3 uBgColor;
uniform float uEdgeLift;

out vec4 fragColor;

vec3 permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop { vec3 color; float position; };

#define COLOR_RAMP(colors, factor, finalColor) { \
  int index = 0; \
  for (int i = 0; i < 2; i++) { \
    ColorStop currentColor = colors[i]; \
    bool isInBetween = currentColor.position <= factor; \
    index = int(mix(float(index), float(i), float(isInBetween))); \
  } \
  ColorStop currentColor = colors[index]; \
  ColorStop nextColor = colors[index + 1]; \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float h = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  h = exp(h);
  float field = (uv.y * 2.0 - h + 0.2);

  // Non-negative driver
  float base = clamp(0.6 * field, 0.0, 1.0);

  // Feather / visibility
  float midPoint = 0.20;
  float mask = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, base);

  // Edge-lift toward background to avoid grey on light UIs
  float w = pow(mask, max(uEdgeLift, 0.001));
  vec3 lifted = mix(uBgColor, rampColor, w);

  // Premultiply safely
  vec3 pm = clamp(lifted * mask, 0.0, 1.0);
  fragColor = vec4(pm, mask);
}
`;

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  time?: number;
  speed?: number;
  // theme control
  dark?: boolean;              // <— NEW: choose shader
  // light-mode only knobs
  bgColor?: [number, number, number];
  edgeLift?: number;
  // responsive control
  minWidth?: number;           // minimum width for aurora calculations
  minHeight?: number;          // minimum height for aurora calculations
}

export default function Aurora(props: AuroraProps) {
  const {
    colorStops = ['#5227FF', '#7cff67', '#5227FF'],
    amplitude = 1.0,
    blend = 0.5,
    time,
    speed = 1.0,
    dark = false,
    bgColor,
    edgeLift = 1.0,
    minWidth = 800,   // default minimum width for aurora calculations
    minHeight = 600,  // default minimum height for aurora calculations
  } = props;

  const propsRef = useRef(props);
  propsRef.current = props;

  const ctnDom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = 'transparent';

    let program: Program | undefined;

    const resize = () => {
      if (!ctn) return;
      const actualWidth = ctn.offsetWidth;
      const actualHeight = ctn.offsetHeight;

      // Use minimum dimensions for aurora calculations to prevent squishing
      const auroraWidth = Math.max(actualWidth, minWidth);
      const auroraHeight = Math.max(actualHeight, minHeight);

      // Set canvas to actual container size
      renderer.setSize(actualWidth, actualHeight);

      if (program) {
        // Use aurora dimensions for effect calculations
        program.uniforms.uResolution.value = [auroraWidth, auroraHeight];
      }
    };

    setTimeout(resize, 0);
    window.addEventListener('resize', resize);

    const geometry = new Triangle(gl);
    if ((geometry as any).attributes?.uv) {
      delete (geometry as any).attributes.uv;
    }

    const colorStopsArray = colorStops.map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    // Pick fragment shader based on prop
    const fragment = dark ? FRAG_DARK : FRAG_LIGHT;

    // Light-mode default bg if none provided
    const defaultBg: [number, number, number] = [1, 1, 1];

    // Base uniforms (common)
    const uniforms: any = {
      uTime: { value: 0 },
      uAmplitude: { value: amplitude },
      uColorStops: { value: colorStopsArray },
      uResolution: { value: [Math.max(ctn.offsetWidth, minWidth), Math.max(ctn.offsetHeight, minHeight)] },
      uBlend: { value: blend },
    };

    // Extra uniforms only for LIGHT shader
    if (!dark) {
      uniforms.uBgColor = { value: bgColor ?? defaultBg };
      uniforms.uEdgeLift = { value: edgeLift };
    }

    program = new Program(gl, {
      vertex: VERT,
      fragment,
      uniforms,
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(gl.canvas);

    let animateId = 0;
    const update = (t: number) => {
      animateId = requestAnimationFrame(update);
      const p = propsRef.current;
      const tt = (p.time ?? t * 0.01) * (p.speed ?? 1.0) * 0.1;

      if (program) {
        program.uniforms.uTime.value = tt;
        program.uniforms.uAmplitude.value = p.amplitude ?? amplitude;
        program.uniforms.uBlend.value = p.blend ?? blend;

        // update color stops
        const stops = (p.colorStops ?? colorStops).map((hex: string) => {
          const c = new Color(hex);
          return [c.r, c.g, c.b];
        });
        program.uniforms.uColorStops.value = stops;

        // update light-only uniforms safely if present
        if ((program.uniforms as any).uBgColor) {
          program.uniforms.uBgColor.value = p.bgColor ?? defaultBg;
        }
        if ((program.uniforms as any).uEdgeLift) {
          program.uniforms.uEdgeLift.value = p.edgeLift ?? edgeLift;
        }

        renderer.render({ scene: mesh });
      }
    };
    animateId = requestAnimationFrame(update);

    resize();

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener('resize', resize);
      if (ctn && gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Recreate pipeline when shader choice flips
  }, [dark, amplitude, blend, edgeLift]); // colorStops/time/speed are dynamic uniforms; no reinit needed

  return <div ref={ctnDom} className="w-full h-full" />;
}
