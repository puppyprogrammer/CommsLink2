/**
 * Aura Shader for Hologram Avatars
 *
 * GLSL fragment shader that creates an emotion-modulated radial glow aura
 * around avatar skeleton points. Hue and intensity shift based on active emotion.
 */

// Emotion color palettes (RGB, normalized 0-1)
// Index: 0=happy, 1=sad, 2=angry, 3=neutral
export const AURA_COLORS = {
  happy:  [1.0, 0.85, 0.2],   // warm gold
  sad:    [0.3, 0.5, 0.9],    // cool blue
  angry:  [0.95, 0.2, 0.15],  // red-orange
  neutral: [0.39, 0.77, 0.75], // hologram teal (#63c5c0)
} as const;

export const auraVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uEmotionColor;
  uniform float uEmotionBlend; // 0 = neutral, 1 = full emotion

  varying vec2 vUv;
  varying float vIntensity;
  varying vec3 vEmotionColor;

  void main() {
    vUv = uv;
    vIntensity = uIntensity;
    vEmotionColor = uEmotionColor;

    // Pulsing scale based on emotion intensity
    float pulse = 1.0 + sin(uTime * 2.0) * 0.05 * uEmotionBlend;
    vec3 pos = position * pulse;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const auraFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uEmotionColor;
  uniform float uEmotionBlend;

  varying vec2 vUv;
  varying float vIntensity;
  varying vec3 vEmotionColor;

  void main() {
    // Radial gradient from center
    vec2 center = vUv - 0.5;
    float dist = length(center);

    // Soft radial falloff
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);

    // Base hologram teal
    vec3 baseColor = vec3(0.39, 0.77, 0.75);

    // Blend toward emotion color
    vec3 color = mix(baseColor, vEmotionColor, uEmotionBlend * 0.7);

    // Time-based shimmer
    float shimmer = sin(uTime * 3.0 + dist * 10.0) * 0.1 + 0.9;
    color *= shimmer;

    // Outer ring highlight
    float ring = smoothstep(0.35, 0.4, dist) * (1.0 - smoothstep(0.4, 0.5, dist));
    color += vEmotionColor * ring * 0.3 * uEmotionBlend;

    // Final alpha: glow intensity with emotion boost
    float alpha = glow * vIntensity * (0.3 + 0.4 * uEmotionBlend);

    // Discard fully transparent pixels
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

/** Create uniforms object for the aura shader material */
export const createAuraUniforms = (emotionIdx = 3, intensity = 0.6) => {
  const emotions = ['happy', 'sad', 'angry', 'neutral'] as const;
  const emotion = emotions[Math.min(emotionIdx, 3)];
  const rgb = AURA_COLORS[emotion];

  return {
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uEmotionColor: { value: rgb },
    uEmotionBlend: { value: emotionIdx === 3 ? 0 : 1 },
  };
};

export default { auraVertexShader, auraFragmentShader, createAuraUniforms, AURA_COLORS };
