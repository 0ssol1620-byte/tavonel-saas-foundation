import { buildMesh, cameraMatrix, VERTEX_FLOATS } from "@/lib/v34/world-geometry";
import type { Camera, WorldLayout, WorldMesh } from "@/lib/v34/world-geometry";
import type { RendererOptions, WorldRenderer } from "./renderer-types";

/*
  Dependency-free WebGL renderer for the world projection (ADR A6). One program, three buffers:
  layer planes (LINES), relationships (LINES), records (POINTS). Shaders and blend state are the
  target's World29, so the first frame matches the Canvas2D and static SVG frames.
*/

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const VERTEX = `attribute vec3 pos;attribute vec4 color;attribute float size;uniform mat4 mvp;uniform float dpr;varying vec4 col;void main(){gl_Position=mvp*vec4(pos,1.);gl_PointSize=clamp(size*dpr*8.3/max(2.,gl_Position.w),1.1,20.);col=color;}`;
const FRAGMENT = `precision mediump float;varying vec4 col;uniform float points;void main(){if(points>0.5){float dist=length(gl_PointCoord-vec2(.5));if(dist>.5)discard;float rim=1.-smoothstep(.39,.5,dist);float core=1.-smoothstep(.08,.43,dist);gl_FragColor=vec4(mix(col.rgb,vec3(.96,1.,.98),core*.35),col.a*rim);}else{gl_FragColor=col;}}`;

const DPR_CAP = 2;
/* WORLD_GROUND (#07100e) as floats, so the GL clear colour matches the Canvas2D and SVG grounds exactly. */
const GROUND_RGB = [7 / 255, 16 / 255, 14 / 255] as const;
const STRIDE = VERTEX_FLOATS * 4;

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL: could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL: shader failed to compile: ${log ?? "no log"}`);
  }
  return shader;
}

/** Throws when WebGL is unavailable or the program cannot be built; the island then tries Canvas2D on a new canvas. */
export function createWebglRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): WorldRenderer {
  const gl = (canvas.getContext("webgl2", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false }) ??
    canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false })) as GL | null;
  if (!gl) throw new Error("WebGL unavailable");

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL: could not create a program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL: program failed to link: ${log ?? "no log"}`);
  }

  const attributes = [
    { name: "pos", size: 3, offset: 0 },
    { name: "color", size: 4, offset: 12 },
    { name: "size", size: 1, offset: 28 },
  ].map((a) => ({ ...a, location: gl.getAttribLocation(program, a.name) }));
  const mvpLocation = gl.getUniformLocation(program, "mvp");
  const dprLocation = gl.getUniformLocation(program, "dpr");
  const pointsLocation = gl.getUniformLocation(program, "points");
  const buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
  let mesh: WorldMesh | null = null;
  let disposed = false;

  const lost = (event: Event) => {
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", lost);

  return {
    kind: "webgl",
    setScene(layout: WorldLayout, focus: string | null) {
      mesh = buildMesh(layout, focus);
      [mesh.planes, mesh.edges, mesh.nodes].forEach((data, i) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]!);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      });
    },
    draw(camera: Camera) {
      if (disposed || !mesh || gl.isContextLost()) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(...GROUND_RGB, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniformMatrix4fv(mvpLocation, false, cameraMatrix(camera, rect.width / rect.height));
      gl.uniform1f(dprLocation, dpr);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      [mesh.planes, mesh.edges, mesh.nodes].forEach((data, i) => {
        const count = data.length / VERTEX_FLOATS;
        if (!count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]!);
        for (const a of attributes) {
          gl.enableVertexAttribArray(a.location);
          gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, STRIDE, a.offset);
        }
        if (i === 2) {
          gl.enable(gl.DEPTH_TEST);
          gl.depthMask(true);
        }
        gl.uniform1f(pointsLocation, i === 2 ? 1 : 0);
        gl.drawArrays(i === 2 ? gl.POINTS : gl.LINES, 0, count);
      });
    },
    stats() {
      return { nodes: mesh ? mesh.nodes.length / VERTEX_FLOATS : 0, edges: mesh ? mesh.edges.length / (2 * VERTEX_FLOATS) : 0 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", lost);
      if (!gl.isContextLost()) {
        for (const b of buffers) if (b) gl.deleteBuffer(b);
        gl.deleteProgram(program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    },
  };
}
