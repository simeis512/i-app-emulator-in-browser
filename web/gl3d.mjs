// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental WebGL2 renderer for the OpenGL ES bridge. Java still fetches, transforms, lights and clips; it hands
// over clip-space triangles with one state record per draw call, a 3D section at a time. Colour is one texture per
// image, shared by the Graphics drawing on it; each Graphics draws through its own framebuffer and depth buffer.
const COMMAND=26, DRAW=1, CLEAR_DEPTH=2, FLOATS=4;
const VERTEX=`#version 300 es
layout(location=0) in vec4 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec4 color;
out vec4 vColor;
out vec2 vUv;
void main(){gl_Position=position;vColor=color.zyxw*255.0;vUv=uv;}`;
// Colours are interpolated on the 0..255 scale and rounded as the software rasteriser does.
const FRAGMENT=`#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUv;
out vec4 fragment;
void main(){fragment=clamp(floor(vColor+0.5),0.0,255.0)/255.0;}`;

export function createGl3d(documentRef=globalThis.document) {
  let gl=null,tried=false,program,vao,vertexBuffer,colorBuffer,scratch=new Uint8Array(0);
  const targets=[],surfaces=[];
  function context() {
    if(tried)return gl;
    tried=true;
    const canvas=documentRef?.createElement?.('canvas');
    gl=canvas?.getContext('webgl2',{alpha:true,antialias:false,depth:false,premultipliedAlpha:false,preserveDrawingBuffer:false})||null;
    if(!gl)return null;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('WebGL2 shader: '+gl.getShaderInfoLog(s));return s;};
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('WebGL2 program: '+gl.getProgramInfoLog(program));
    vao=gl.createVertexArray();gl.bindVertexArray(vao);
    vertexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,16);
    colorBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,colorBuffer);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,4,0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
    return gl;
  }
  // Java ARGB integers, top row first, become RGBA bytes with the bottom row first, and back.
  function swap(argb,width,height,toGpu) {
    const n=width*height;
    if(scratch.length<n*4)scratch=new Uint8Array(n*4);
    const rgba=new Uint32Array(scratch.buffer,0,n);
    for(let y=0;y<height;y++){
      const cpu=(height-1-y)*width,gpu=y*width;
      if(toGpu)for(let x=0;x<width;x++){const p=argb[cpu+x];rgba[gpu+x]=(p&0xff00ff00)|((p>>>16)&0xff)|((p&0xff)<<16);}
      else for(let x=0;x<width;x++){const p=rgba[gpu+x];argb[cpu+x]=(p&0xff00ff00)|((p>>>16)&0xff)|((p&0xff)<<16);}
    }
    return scratch.subarray(0,n*4);
  }
  function upload(target,argb,width,height) {
    const t=targets[target];
    gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,swap(argb,width,height,true));
  }
  function readback(surface,argb,width,height) {
    const s=surfaces[surface];
    gl.bindFramebuffer(gl.FRAMEBUFFER,s.framebuffer);
    const n=width*height;if(scratch.length<n*4)scratch=new Uint8Array(n*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,scratch.subarray(0,n*4));
    swap(argb,width,height,false);
  }
  function draw(surface,vertices,colors,vertexCount,commands,commandCount,floats) {
    const s=surfaces[surface];
    gl.bindFramebuffer(gl.FRAMEBUFFER,s.framebuffer);
    gl.useProgram(program);gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.subarray(0,vertexCount*6),gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(colors.buffer,colors.byteOffset,vertexCount*4),gl.STREAM_DRAW);
    gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
    for(let c=0;c<commandCount;c++){
      const o=c*COMMAND;
      if(commands[o]===DRAW){
        gl.viewport(commands[o+3],commands[o+4],commands[o+5],commands[o+6]);
        if(commands[o+7]){gl.enable(gl.SCISSOR_TEST);gl.scissor(commands[o+8],commands[o+9],commands[o+10],commands[o+11]);}
        else gl.disable(gl.SCISSOR_TEST);
        // Software compares reversed depth in the reversed direction, so GL's functions apply as they are.
        // Without the test GL writes no depth, as the software path does.
        if(commands[o+12]){gl.enable(gl.DEPTH_TEST);gl.depthFunc(commands[o+13]);gl.depthMask(commands[o+14]===1);}
        else gl.disable(gl.DEPTH_TEST);
        gl.depthRange(floats[c*FLOATS+1],floats[c*FLOATS+2]);
        gl.drawArrays(gl.TRIANGLES,commands[o+1],commands[o+2]);
      }else if(commands[o]===CLEAR_DEPTH){
        // As in software, a depth clear resets the whole buffer whatever the viewport or clip.
        gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
      }
    }
  }
  return {
    get active(){return gl!==null;},
    natives:{
      Java_p905i_web_WebGl_available(lib){try{return context()!==null;}catch(error){console.error(error);gl=null;return false;}},
      Java_p905i_web_WebGl_target(lib,width,height){
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        targets.push({texture,width,height});return targets.length-1;
      },
      Java_p905i_web_WebGl_surface(lib,target){
        const t=targets[target],framebuffer=gl.createFramebuffer(),depth=gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,t.width,t.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
        gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
        surfaces.push({framebuffer,depth,target});return surfaces.length-1;
      },
      Java_p905i_web_WebGl_upload(lib,target,argb,width,height){upload(target,argb,width,height);},
      Java_p905i_web_WebGl_readback(lib,surface,argb,width,height){readback(surface,argb,width,height);},
      Java_p905i_web_WebGl_draw(lib,surface,vertices,colors,vertexCount,commands,commandCount,floats){
        draw(surface,vertices,colors,vertexCount,commands,commandCount,floats);
      },
    },
  };
}
