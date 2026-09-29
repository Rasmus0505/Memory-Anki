/* Instanced particle quads; every shape is an SDF so edges stay crisp at any DPR. */
export const PARTICLE_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_rect;
layout(location = 2) in vec4 a_meta;
layout(location = 3) in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec2 v_half;
flat out int v_shape;
out vec2 v_params;
out vec4 v_color;
void main() {
  float c = cos(a_meta.x);
  float s = sin(a_meta.x);
  vec2 local = a_corner * a_rect.zw;
  vec2 pos = a_rect.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 clip = pos / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_corner;
  v_half = a_rect.zw;
  v_shape = int(a_meta.y + 0.5);
  v_params = a_meta.zw;
  v_color = a_color;
}`

export const PARTICLE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec2 v_half;
flat in int v_shape;
in vec2 v_params;
in vec4 v_color;
out vec4 outColor;

float fill(float sd) {
  float w = max(fwidth(sd), 0.0001);
  return 1.0 - smoothstep(-w, w, sd);
}

void main() {
  vec2 px = v_uv * v_half;
  vec3 rgb = v_color.rgb;
  float a = 0.0;
  if (v_shape == 0) {
    a = fill(length(px) - v_params.x);
  } else if (v_shape == 1) {
    float d = length(v_uv);
    a = d < 0.22 ? mix(1.0, 0.85, d / 0.22) : 0.85 * pow(max(0.0, 1.0 - (d - 0.22) / 0.78), 1.7);
    rgb = mix(rgb, mix(rgb, vec3(1.0), 0.62), 1.0 - smoothstep(0.0, 0.3, d));
  } else if (v_shape == 2) {
    vec2 q = abs(px) - v_params;
    a = fill(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
    rgb *= 0.9 + 0.1 * clamp(px.y / max(v_params.y, 0.001), -1.0, 1.0);
  } else if (v_shape == 3) {
    vec2 p = px / v_params.x;
    float r = length(p);
    float ang = mod(atan(p.y, p.x), 1.5707963);
    ang = min(ang, 1.5707963 - ang);
    vec2 q = r * vec2(cos(ang), sin(ang));
    vec2 tip = vec2(1.0, 0.0);
    vec2 edge = vec2(0.2262742, 0.2262742) - tip;
    vec2 n = normalize(vec2(edge.y, -edge.x));
    a = fill(dot(q - tip, n) * v_params.x);
    rgb = mix(rgb, vec3(1.0), 0.4 * (1.0 - smoothstep(0.0, 0.4, r)));
  } else if (v_shape == 4) {
    a = fill(abs(length(px) - v_params.x) - v_params.y * 0.5);
  } else if (v_shape == 5) {
    float d = length(v_uv);
    a = d < 0.7 ? mix(0.34, 0.14, d / 0.7) : mix(0.14, 0.0, clamp((d - 0.7) / 0.3, 0.0, 1.0));
  } else {
    vec2 q = vec2(max(abs(px.x) - v_params.x, 0.0), px.y);
    a = fill(length(q) - v_params.y);
  }
  a *= v_color.a;
  outColor = vec4(rgb * a, a);
}`

export const FULLSCREEN_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`

/* 9-tap Gaussian using linear sampling; u_dir = 0 turns it into a plain copy. */
export const BLUR_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform float u_gain;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv) * 0.2270270;
  c += (texture(u_tex, v_uv + u_dir * 1.3846153) + texture(u_tex, v_uv - u_dir * 1.3846153)) * 0.3162162;
  c += (texture(u_tex, v_uv + u_dir * 3.2307692) + texture(u_tex, v_uv - u_dir * 3.2307692)) * 0.0702702;
  outColor = c * u_gain;
}`
