import React, { useRef, useEffect, useState } from "react"
import * as THREE from "three"

interface LightPillarProps {
  topColor?: string
  bottomColor?: string
  intensity?: number
  rotationSpeed?: number
  interactive?: boolean
  className?: string
  glowAmount?: number
  pillarWidth?: number
  pillarHeight?: number
  noiseIntensity?: number
  mixBlendMode?: React.CSSProperties["mixBlendMode"]
  pillarRotation?: number
  /** A paused pillar renders nothing at all: the last frame just stays. */
  paused?: boolean
}

const LightPillar: React.FC<LightPillarProps> = ({
  topColor = "#5227FF",
  bottomColor = "#FF9FFC",
  intensity = 1.0,
  rotationSpeed = 0.3,
  interactive = false,
  className = "",
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  mixBlendMode = "screen",
  pillarRotation = 0,
  paused = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const geometryRef = useRef<THREE.PlaneGeometry | null>(null)
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0))
  const timeRef = useRef<number>(0)
  // A ref rather than an effect dependency: toggling pause must not tear the
  // whole WebGL scene down and rebuild it.
  const pausedRef = useRef(paused)
  const syncRunningRef = useRef<(() => void) | null>(null)
  const [webGLSupported, setWebGLSupported] = useState<boolean>(true)

  useEffect(() => {
    pausedRef.current = paused
    syncRunningRef.current?.()
  }, [paused])

  useEffect(() => {
    if (!containerRef.current || !webGLSupported) return

    const container = containerRef.current
    // Ambilight renders a blurred duplicate of the whole story. Recreating the
    // ray-marched WebGL scene there doubles the hottest slide's GPU cost; a
    // static color field is indistinguishable after the clone's 100px blur.
    if (container.closest("[data-ambilight-clone]")) {
      container.style.background = `radial-gradient(ellipse at center, ${topColor}88 0%, ${bottomColor}66 38%, transparent 72%)`
      return () => {
        container.style.background = ""
      }
    }

    const width = container.clientWidth
    const height = container.clientHeight

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        precision: "lowp",
        stencil: false,
        depth: false,
      })
    } catch (error) {
      console.error("Failed to create WebGL renderer:", error)
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setWebGLSupported(false)
      })
      return () => {
        cancelled = true
      }
    }

    // Scene setup starts only after a real WebGL renderer exists. The
    // constructor is the authoritative support check and is caught above.
    const scene = new THREE.Scene()
    sceneRef.current = scene
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    cameraRef.current = camera

    renderer.setSize(width, height)
    // The recap is always rendered at 390x693 then composited as one scaled
    // layer. DPR 1 halves the fragment work of the old 1.25 cap, and a
    // blurred glow field has no edges for the lost samples to sharpen.
    // Phones go further: at DPR 0.75 with a 48-step march the same pillar
    // costs roughly a quarter of the desktop budget, and a soft glow
    // upscaled by the compositor is indistinguishable on a small screen.
    const lowPower = window.matchMedia?.("(pointer: coarse)").matches ?? false
    renderer.setPixelRatio(lowPower ? 0.75 : 1)
    const marchSteps = lowPower ? 48 : 80
    renderer.domElement.style.willChange = "transform"
    renderer.domElement.style.transform = "translateZ(0)"
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Convert hex colors to RGB
    const parseColor = (hex: string): THREE.Vector3 => {
      const color = new THREE.Color(hex)
      return new THREE.Vector3(color.r, color.g, color.b)
    }

    // Shader material
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uMouse;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      uniform float uIntensity;
      uniform bool uInteractive;
      uniform float uGlowAmount;
      uniform float uPillarWidth;
      uniform float uPillarHeight;
      uniform float uNoiseIntensity;
      uniform float uPillarRotation;
      uniform float uSteps;
      varying vec2 vUv;

      const float PI = 3.141592653589793;
      const float EPSILON = 0.001;
      const float E = 2.71828182845904523536;
      const float HALF = 0.5;

      mat2 rot(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      // Procedural noise function
      float noise(vec2 coord) {
        float G = E;
        vec2 r = (G * sin(G * coord));
        return fract(r.x * r.y * (1.0 + coord.x));
      }

      // Apply layered wave deformation to position. Three octaves: the
      // fourth added frequency-8 ripple at 1/8 amplitude, detail the glow
      // accumulation and noise dithering wash out anyway, for a quarter of
      // the march's total cost.
      vec3 applyWaveDeformation(vec3 pos, float timeOffset) {
        float frequency = 1.0;
        float amplitude = 1.0;
        vec3 deformed = pos;

        for(float i = 0.0; i < 3.0; i++) {
          deformed.xz *= rot(0.4);
          float phase = timeOffset * i * 2.0;
          vec3 oscillation = cos(deformed.zxy * frequency - phase);
          deformed += oscillation * amplitude;
          frequency *= 2.0;
          amplitude *= HALF;
        }
        return deformed;
      }

      // Polynomial smooth blending between two values
      float blendMin(float a, float b, float k) {
        float scaledK = k * 4.0;
        float h = max(scaledK - abs(a - b), 0.0);
        return min(a, b) - h * h * 0.25 / scaledK;
      }

      float blendMax(float a, float b, float k) {
        return -blendMin(-a, -b, k);
      }

      void main() {
        vec2 fragCoord = vUv * uResolution;
        vec2 uv = (fragCoord * 2.0 - uResolution) / uResolution.y;
        
        // Apply 2D rotation to UV coordinates
        float rotAngle = uPillarRotation * PI / 180.0;
        uv *= rot(rotAngle);

        vec3 origin = vec3(0.0, 0.0, -10.0);
        vec3 direction = normalize(vec3(uv, 1.0));

        float maxDepth = 50.0;
        float depth = 0.1;

        mat2 rotX = rot(uTime * 0.3);
        if(uInteractive && length(uMouse) > 0.0) {
          rotX = rot(uMouse.x * PI * 2.0);
        }

        vec3 color = vec3(0.0);

        // Normalize by pillar width to maintain consistent glow regardless
        // of size. Known before the march so it can bound it too.
        float widthNormalization = uPillarWidth / 3.0;
        float glowScale = uGlowAmount / widthNormalization;

        for(float i = 0.0; i < 80.0; i++) {
          // GLSL ES needs the constant bound; the device budget is the
          // uniform. Phones march 48 steps, desktops the full 80.
          if(i >= uSteps) break;
          vec3 pos = origin + direction * depth;
          pos.xz *= rotX;

          // Apply vertical scaling and wave deformation
          vec3 deformed = pos;
          deformed.y *= uPillarHeight;
          deformed = applyWaveDeformation(deformed + vec3(0.0, uTime, 0.0), uTime);

          // Calculate distance field using cosine pattern
          vec2 cosinePair = cos(deformed.xz);
          float fieldDistance = length(cosinePair) - 0.2;

          // Radial boundary constraint
          float radialBound = length(pos.xz) - uPillarWidth;
          fieldDistance = blendMax(radialBound, fieldDistance, 1.0);
          fieldDistance = abs(fieldDistance) * 0.15 + 0.01;

          vec3 gradient = mix(uBottomColor, uTopColor, smoothstep(15.0, -15.0, pos.y));
          color += gradient / fieldDistance;

          // Stop once the brightest channel is deep into tanh saturation:
          // the glow cores take the smallest steps, so they were also the
          // fragments marching longest for light the tone-map discards.
          if(fieldDistance < EPSILON || depth > maxDepth
            || max(color.r, max(color.g, color.b)) * glowScale > 3.0) break;
          depth += fieldDistance;
        }

        color = tanh(color * glowScale);
        
        // Add noise postprocessing
        float rnd = noise(gl_FragCoord.xy);
        color -= rnd / 15.0 * uNoiseIntensity;
        
        gl_FragColor = vec4(color * uIntensity, 1.0);
      }
    `

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(width, height) },
        uMouse: { value: mouseRef.current },
        uTopColor: { value: parseColor(topColor) },
        uBottomColor: { value: parseColor(bottomColor) },
        uIntensity: { value: intensity },
        uInteractive: { value: interactive },
        uGlowAmount: { value: glowAmount },
        uPillarWidth: { value: pillarWidth },
        uPillarHeight: { value: pillarHeight },
        uNoiseIntensity: { value: noiseIntensity },
        uPillarRotation: { value: pillarRotation },
        uSteps: { value: marchSteps },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    materialRef.current = material

    const geometry = new THREE.PlaneGeometry(2, 2)
    geometryRef.current = geometry
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    // Mouse interaction - throttled for performance
    let mouseMoveTimeout: number | null = null
    const handleMouseMove = (event: MouseEvent) => {
      if (!interactive) return

      if (mouseMoveTimeout) return

      mouseMoveTimeout = window.setTimeout(() => {
        mouseMoveTimeout = null
      }, 16) // ~60fps throttle

      const rect = container.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      mouseRef.current.set(x, y)
    }

    if (interactive) {
      container.addEventListener("mousemove", handleMouseMove, {
        passive: true,
      })
    }

    // Animation loop with capped rendering cadence. Hidden, off-screen and
    // paused all stop the loop outright — a paused pillar costs nothing, the
    // last frame simply stays on the canvas. Restarting from the same
    // accumulated time avoids both wasted work and a visual jump on resume.
    let lastTime = performance.now()
    let lastRenderTime = lastTime
    const targetFPS = 30
    const frameTime = 1000 / targetFPS
    const canonicalFrameTime = 1000 / 60
    let isIntersecting = true

    const shouldRun = () =>
      !document.hidden && isIntersecting && !pausedRef.current

    const animate = (currentTime: number) => {
      if (
        !materialRef.current ||
        !rendererRef.current ||
        !sceneRef.current ||
        !cameraRef.current
      )
        return

      if (!shouldRun()) return

      const deltaTime = currentTime - lastTime

      if (deltaTime >= frameTime) {
        const elapsedSinceRender = currentTime - lastRenderTime
        timeRef.current +=
          (elapsedSinceRender / canonicalFrameTime) * 0.016 * rotationSpeed
        materialRef.current.uniforms.uTime.value = timeRef.current
        rendererRef.current.render(sceneRef.current, cameraRef.current)
        lastRenderTime = currentTime
        lastTime = currentTime - (deltaTime % frameTime)
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    // One switch for the three reasons to stop: tab hidden, scrolled away,
    // story paused. Everything that changes one of them calls this.
    const syncRunning = () => {
      if (!shouldRun()) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        return
      }
      if (rafRef.current) return
      lastTime = performance.now()
      lastRenderTime = lastTime
      rafRef.current = requestAnimationFrame(animate)
    }
    syncRunningRef.current = syncRunning
    syncRunning()

    document.addEventListener("visibilitychange", syncRunning)

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = entry?.isIntersecting ?? true
      syncRunning()
    })
    intersectionObserver.observe(container)

    // Handle resize with debouncing
    let resizeTimeout: number | null = null
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }

      resizeTimeout = window.setTimeout(() => {
        if (
          !rendererRef.current ||
          !materialRef.current ||
          !containerRef.current
        )
          return
        const newWidth = containerRef.current.clientWidth
        const newHeight = containerRef.current.clientHeight
        rendererRef.current.setSize(newWidth, newHeight)
        materialRef.current.uniforms.uResolution.value.set(newWidth, newHeight)
      }, 150)
    }

    window.addEventListener("resize", handleResize, { passive: true })

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize)
      document.removeEventListener("visibilitychange", syncRunning)
      syncRunningRef.current = null
      intersectionObserver.disconnect()
      if (mouseMoveTimeout) clearTimeout(mouseMoveTimeout)
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (interactive) {
        container.removeEventListener("mousemove", handleMouseMove)
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      if (rendererRef.current) {
        rendererRef.current.dispose()
        rendererRef.current.forceContextLoss()
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement)
        }
      }
      if (materialRef.current) {
        materialRef.current.dispose()
      }
      if (geometryRef.current) {
        geometryRef.current.dispose()
      }

      rendererRef.current = null
      materialRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      geometryRef.current = null
      rafRef.current = null
    }
  }, [
    topColor,
    bottomColor,
    intensity,
    rotationSpeed,
    interactive,
    glowAmount,
    pillarWidth,
    pillarHeight,
    noiseIntensity,
    pillarRotation,
    webGLSupported,
  ])

  if (!webGLSupported) {
    return (
      <div
        aria-hidden="true"
        className={`absolute top-0 left-0 h-full w-full ${className}`}
        style={{
          mixBlendMode,
          background: `radial-gradient(ellipse at center, ${topColor}88 0%, ${bottomColor}66 38%, transparent 72%)`,
        }}
      />
    )
  }

  return (
    <div
      ref={containerRef}
      className={`absolute top-0 left-0 h-full w-full ${className}`}
      style={{ mixBlendMode }}
    />
  )
}

export default LightPillar
