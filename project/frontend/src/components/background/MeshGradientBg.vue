<script setup lang="ts">
/**
 * Slow, organic animated gradient mesh — the "premium SaaS" ambient
 * background (Stripe/Linear/Vercel use the same family of effect), replacing
 * the blurred-blob approach with a real noise field so the motion reads as
 * alive instead of three circles sliding around. WebGL2 fragment shader,
 * ~nothing on the bundle (no deps), silently renders nothing if WebGL is
 * unavailable rather than erroring.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'

const canvas = ref<HTMLCanvasElement | null>(null)
const theme = useTheme()

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

// Ashima Arts simplex noise (MIT) — the standard, compact 3D implementation
// used across the WebGL ecosystem for exactly this kind of flowing field.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;
uniform vec3 u_bg;
uniform float u_opacity;

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float fbm(vec3 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=a*snoise(p); p*=2.0; a*=0.5; }
  return v;
}

void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy;
  vec2 aspect=vec2(u_res.x/u_res.y,1.0);
  vec2 p=(uv-0.5)*aspect;
  float t=u_time*0.035;

  float n1=fbm(vec3(p*1.1, t));
  float n2=fbm(vec3(p*1.3+17.0, t*0.8+11.0));
  float n3=fbm(vec3(p*0.9-9.0, t*0.6+31.0));

  float wA=smoothstep(-0.2,0.9,n1);
  float wB=smoothstep(-0.1,0.95,n2)*0.85;
  float wC=smoothstep(-0.15,0.9,n3)*0.75;

  vec3 col=u_bg;
  col=mix(col,u_colorA,wA*0.55);
  col=mix(col,u_colorB,wB*0.4);
  col=mix(col,u_colorC,wC*0.3);

  float vign=1.0-smoothstep(0.55,1.15,length(p));
  fragColor=vec4(mix(u_bg,col,u_opacity*vign),1.0);
}
`

let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let rafId = 0
let startTime = 0
let ro: ResizeObserver | null = null
const uniforms: Record<string, WebGLUniformLocation | null> = {}

function compile(type: number, src: string): WebGLShader | null {
  if (!gl) return null
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function hexToVec3(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

function setColors() {
  if (!gl || !program) return
  const c = theme.current.value.colors as Record<string, string>
  const dark = theme.current.value.dark
  gl.useProgram(program)
  gl.uniform3fv(uniforms.u_colorA, hexToVec3(c.primary))
  gl.uniform3fv(uniforms.u_colorB, hexToVec3(c.secondary))
  gl.uniform3fv(uniforms.u_colorC, hexToVec3(c.accent ?? c.primary))
  gl.uniform3fv(uniforms.u_bg, hexToVec3(c.background))
  // Dark ground reads light additively (like real glow); light ground needs
  // a much gentler wash or it looks like a stain instead of ambient colour.
  gl.uniform1f(uniforms.u_opacity, dark ? 0.5 : 0.22)
}

const reduceMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function frame(ts: number) {
  if (!gl || !canvas.value) return
  if (!startTime) startTime = ts
  const t = reduceMotion ? 0 : (ts - startTime) / 1000
  gl.uniform1f(uniforms.u_time, t)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (!reduceMotion) rafId = requestAnimationFrame(frame)
}

function resize() {
  if (!canvas.value || !gl) return
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
  const w = Math.round(canvas.value.clientWidth * dpr)
  const h = Math.round(canvas.value.clientHeight * dpr)
  if (canvas.value.width !== w || canvas.value.height !== h) {
    canvas.value.width = w
    canvas.value.height = h
    gl.viewport(0, 0, w, h)
    gl.uniform2f(uniforms.u_res, w, h)
  }
}

onMounted(() => {
  if (!canvas.value) return
  gl = canvas.value.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!gl) return // unsupported — render nothing rather than throw

  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return
  program = gl.createProgram()
  if (!program) return
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
  gl.useProgram(program)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  // One fullscreen triangle (covers the viewport, no overdraw seam like a quad).
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  for (const name of ['u_res', 'u_time', 'u_colorA', 'u_colorB', 'u_colorC', 'u_bg', 'u_opacity']) {
    uniforms[name] = gl.getUniformLocation(program, name)
  }

  resize()
  setColors()
  ro = new ResizeObserver(resize)
  ro.observe(canvas.value)
  if (reduceMotion) {
    frame(0) // paint exactly one static frame, no rAF loop
  } else {
    rafId = requestAnimationFrame(frame)
  }
})

watch(() => theme.global.name.value, setColors)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  ro?.disconnect()
  if (gl && program) gl.deleteProgram(program)
  gl = null
})
</script>

<template>
  <canvas ref="canvas" class="mesh-bg" aria-hidden="true" />
</template>

<style scoped>
.mesh-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
</style>
