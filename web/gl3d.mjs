// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental WebGL2 renderer for the OpenGL ES bridge. Java still fetches, transforms, lights and clips; it hands
// over clip-space triangles with one state record per draw call, a 3D section at a time. Colour is one texture per
// image, shared by the Graphics drawing on it; each Graphics draws through its own framebuffer and depth buffer.
// Texture unit 1 is a cube map addressed by coordinates Java generates per vertex (reflection or normal).
const COMMAND=43, DRAW=1, CLEAR_DEPTH=2, FLOATS=10;
const VERTEX=`#version 300 es
layout(location=0) in vec4 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec4 color;
layout(location=3) in vec3 reflection;
out vec4 vColor;
out vec2 vUv;
out vec3 vReflection;
void main(){gl_Position=position;vColor=color.zyxw*255.0;vUv=uv;vReflection=reflection;}`;
// Colours are interpolated on the 0..255 scale and rounded as the software rasteriser does. Textures are read with
// texelFetch to reproduce its sampler: wrap, then scale by size - 1, round to the nearest texel or weigh four texels in
// 256ths. MODULATE is integer arithmetic as in software; the other functions follow its float formulas. Unit 1 has no
// software counterpart, so its cube map is filtered by the GPU and then combined by the same texture functions.
const FRAGMENT=`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tex;
uniform samplerCube cube;
uniform int textured, texKey, texFlags, envMode, baseFormat, envColor, alphaTest;
uniform int reflecting, cubeEnvMode, cubeFormat, cubeEnvColor;
// The software alpha test as 256 pass bits, one per alpha byte, so no GPU division decides a boundary.
uniform int alphaBits[8];
// Fog after the texture function and before the alpha test, at the eye distance 1/w, as FogState applies it.
uniform int fogMode;
uniform vec3 fogParams, fogColor;
uniform ivec2 texSize;
in vec4 vColor;
in vec2 vUv;
in vec3 vReflection;
out vec4 fragment;
const int ALPHA=6406,RGB=6407,LUMINANCE=6409,MODULATE=8448,REPLACE=7681,DECAL=8449,BLEND=3042,ADD=260;
float wrap(float v,bool edge){if(edge)return clamp(v,0.0,1.0);float f=v-floor(v);return f<0.0?f+1.0:f;}
int near(float v){return int(floor(v+0.5));}
ivec4 texel(int x,int y){return ivec4(floor(texelFetch(tex,ivec2(x,y),0)*255.0+0.5));}
ivec4 sampleTexture(vec2 uv){
  if(texKey<0)return ivec4(255);
  float su=wrap(uv.x,(texFlags&2)!=0),sv=wrap(uv.y,(texFlags&4)!=0);
  int w=texSize.x,h=texSize.y;
  if((texFlags&1)==0)return texel(clamp(near(su*float(w-1)),0,w-1),clamp(near(sv*float(h-1)),0,h-1));
  float bx=su*float(w-1),by=sv*float(h-1);
  int x0=clamp(int(bx),0,w-1),y0=clamp(int(by),0,h-1),x1=x0+1<w?x0+1:x0,y1=y0+1<h?y0+1:y0;
  int tx=clamp(near((bx-float(x0))*256.0),0,256),ty=clamp(near((by-float(y0))*256.0),0,256);
  return ((texel(x0,y0)*((256-tx)*(256-ty))+texel(x1,y0)*(tx*(256-ty))+texel(x0,y1)*((256-tx)*ty)+texel(x1,y1)*(tx*ty))+32768)>>16;
}
ivec4 pack(vec4 c){return ivec4(floor(clamp(c,0.0,1.0)*255.0+0.5));}
// One texture function: the incoming colour p, the texel s, the function, the texture's base format and GL's colour.
ivec4 environment(ivec4 p,ivec4 s,int mode,int format,int color){
  if(mode==MODULATE){
    if(format!=LUMINANCE&&format!=RGB)p.a=(p.a*s.a+127)/255;
    if(format!=ALPHA)p.rgb=(p.rgb*s.rgb+127)/255;
    return p;
  }
  vec4 pf=vec4(p)/255.0,sf=vec4(s)/255.0,t=sf;
  if(format==ALPHA)t.rgb=vec3(0.0);
  else if(format==LUMINANCE||format==6410)t.rgb=vec3(sf.r);
  if(format==LUMINANCE||format==RGB)t.a=1.0;
  vec3 e=vec3((color>>16)&255,(color>>8)&255,color&255)/255.0;
  bool rgbOnly=format==LUMINANCE||format==RGB;
  vec4 c=pf;
  if(mode==REPLACE){c=vec4(format==ALPHA?pf.rgb:t.rgb,rgbOnly?pf.a:t.a);}
  else if(mode==DECAL){if(format==RGB)c=vec4(t.rgb,pf.a);else if(format==6408)c=vec4(pf.rgb*(1.0-t.a)+t.rgb*t.a,pf.a);}
  else if(mode==BLEND){c=vec4(format==ALPHA?pf.rgb:pf.rgb*(1.0-t.rgb)+e*t.rgb,rgbOnly?pf.a:pf.a*t.a);}
  else if(mode==ADD){c=vec4(format==ALPHA?pf.rgb:pf.rgb+t.rgb,rgbOnly?pf.a:pf.a*t.a);}
  else{if(format!=LUMINANCE&&format!=RGB)p.a=(p.a*s.a+127)/255;if(format!=ALPHA)p.rgb=(p.rgb*s.rgb+127)/255;c=vec4(p)/255.0;}
  return pack(c);
}
void main(){
  ivec4 p=clamp(ivec4(floor(vColor+0.5)),0,255);
  if(textured!=0)p=environment(p,sampleTexture(vUv),envMode,baseFormat,envColor);
  if(reflecting!=0)p=environment(p,ivec4(floor(texture(cube,vReflection)*255.0+0.5)),cubeEnvMode,cubeFormat,cubeEnvColor);
  if(fogMode!=0){
    float d=1.0/gl_FragCoord.w,f;
    if(fogMode==9729)f=fogParams.z==fogParams.y?(d<=fogParams.y?1.0:0.0):(fogParams.z-d)/(fogParams.z-fogParams.y);
    else if(fogMode==2049)f=exp(-fogParams.x*fogParams.x*d*d);
    else f=exp(-fogParams.x*d);
    f=clamp(f,0.0,1.0);
    p.rgb=ivec3(floor(vec3(p.rgb)*f+clamp(fogColor,0.0,1.0)*255.0*(1.0-f)+0.5));
  }
  if(alphaTest!=0&&((alphaBits[p.a>>5]>>(p.a&31))&1)==0)discard;
  fragment=vec4(p)/255.0;
}`;

export function createGl3d(documentRef=globalThis.document) {
  let gl=null,tried=false,lost=false,program,vao,vertexBuffer,colorBuffer,reflectionBuffer,scratch=new Uint8Array(0),uniforms,blank,blankCube;
  const targets=[],surfaces=[],textures=new Map();
  // Call counts, so tests can tell that frames really go through the GPU and how often data crosses over.
  const stats={uploads:0,batches:0,draws:0,clears:0,readbacks:0,textures:0,cubeFaces:0};
  function context() {
    if(tried)return gl;
    tried=true;
    const canvas=documentRef?.createElement?.('canvas');
    gl=canvas?.getContext('webgl2',{alpha:true,antialias:false,depth:false,premultipliedAlpha:false,preserveDrawingBuffer:false})||null;
    if(!gl)return null;
    // A lost context takes every texture, framebuffer and depth buffer with it; the page reports it rather than
    // letting frames silently stop changing.
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;console.error('WebGL2 context lost');});
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
    reflectionBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,reflectionBuffer);gl.vertexAttribPointer(3,3,gl.FLOAT,false,12,0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
    uniforms=Object.fromEntries(['tex','textured','texKey','texFlags','envMode','baseFormat','envColor','texSize','alphaTest','alphaBits','fogMode','fogParams','fogColor',
      'cube','reflecting','cubeEnvMode','cubeFormat','cubeEnvColor']
      .map(name=>[name,gl.getUniformLocation(program,name==='alphaBits'?'alphaBits[0]':name)]));
    gl.useProgram(program);gl.uniform1i(uniforms.tex,0);gl.uniform1i(uniforms.cube,1);
    // Unit 1 always holds a complete cube map, so a draw without a reflection samples nothing missing.
    blankCube=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_CUBE_MAP,blankCube);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP,1,gl.RGBA8,1,1);
    for(let face=0;face<6;face++)gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    // Unit 0 must never be left holding a picture texture: sampling the texture being drawn into is refused.
    blank=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,blank);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
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
    stats.uploads++;
    const t=targets[target];
    gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,swap(argb,width,height,true));
    gl.bindTexture(gl.TEXTURE_2D,blank);
  }
  // Texture rows go up with t, as the software sampler indexes them, so they are stored unflipped.
  function texture(key,argb,width,height) {
    stats.textures++;
    const n=width*height;if(scratch.length<n*4)scratch=new Uint8Array(n*4);
    const rgba=new Uint32Array(scratch.buffer,0,n);
    for(let i=0;i<n;i++){const p=argb[i];rgba[i]=(p&0xff00ff00)|((p>>>16)&0xff)|((p&0xff)<<16);}
    let t=textures.get(key);
    if(!t||t.width!==width||t.height!==height){if(t)gl.deleteTexture(t.texture);
      t={texture:gl.createTexture(),width,height};textures.set(key,t);gl.bindTexture(gl.TEXTURE_2D,t.texture);
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);}
    gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,scratch.subarray(0,n*4));
  }
  // A cube face keeps GL's row order too; faces arrive one at a time in GL order (+X, -X, +Y, -Y, +Z, -Z).
  function cube(key,face,argb,size) {
    stats.cubeFaces++;
    const n=size*size;if(scratch.length<n*4)scratch=new Uint8Array(n*4);
    const rgba=new Uint32Array(scratch.buffer,0,n);
    for(let i=0;i<n;i++){const p=argb[i];rgba[i]=(p&0xff00ff00)|((p>>>16)&0xff)|((p&0xff)<<16);}
    let t=textures.get(key);
    if(!t||!t.cube||t.width!==size){if(t)gl.deleteTexture(t.texture);
      t={texture:gl.createTexture(),width:size,height:size,cube:true,linear:false};textures.set(key,t);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,t.texture);gl.texStorage2D(gl.TEXTURE_CUBE_MAP,1,gl.RGBA8,size,size);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
    gl.bindTexture(gl.TEXTURE_CUBE_MAP,t.texture);
    gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,scratch.subarray(0,n*4));
  }
  function readback(surface,argb,width,height) {
    stats.readbacks++;
    const s=surfaces[surface];
    gl.bindFramebuffer(gl.FRAMEBUFFER,s.framebuffer);
    const n=width*height;if(scratch.length<n*4)scratch=new Uint8Array(n*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,scratch.subarray(0,n*4));
    swap(argb,width,height,false);
  }
  function draw(surface,vertices,colors,vertexCount,commands,commandCount,floats,reflections) {
    stats.batches++;
    const s=surfaces[surface];
    gl.bindFramebuffer(gl.FRAMEBUFFER,s.framebuffer);
    gl.useProgram(program);gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.subarray(0,vertexCount*6),gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(colors.buffer,colors.byteOffset,vertexCount*4),gl.STREAM_DRAW);
    // Cube map coordinates cross over only for a batch that draws a reflection.
    if(reflections){gl.bindBuffer(gl.ARRAY_BUFFER,reflectionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,reflections.subarray(0,vertexCount*3),gl.STREAM_DRAW);gl.enableVertexAttribArray(3);}
    else{gl.disableVertexAttribArray(3);gl.vertexAttrib3f(3,0,0,1);}
    gl.disable(gl.CULL_FACE);
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
        // GPU blending rounds its own way; the software path rounds integer sums, so results may differ by a level.
        if(commands[o+15]){gl.enable(gl.BLEND);gl.blendFunc(commands[o+16],commands[o+17]);}else gl.disable(gl.BLEND);
        const mask=commands[o+27];gl.colorMask((mask&1)!==0,(mask&2)!==0,(mask&4)!==0,(mask&8)!==0);
        gl.uniform1i(uniforms.fogMode,commands[o+36]);
        if(commands[o+36]){const f=c*FLOATS;gl.uniform3f(uniforms.fogParams,floats[f+3],floats[f+4],floats[f+5]);
          gl.uniform3f(uniforms.fogColor,floats[f+6],floats[f+7],floats[f+8]);}
        gl.uniform1i(uniforms.alphaTest,commands[o+26]);
        if(commands[o+26])gl.uniform1iv(uniforms.alphaBits,commands.subarray(o+28,o+36));
        const reflecting=commands[o+37];
        gl.uniform1i(uniforms.reflecting,reflecting);gl.activeTexture(gl.TEXTURE1);
        if(reflecting){
          const t=textures.get(commands[o+38]),linear=commands[o+39]===1;gl.bindTexture(gl.TEXTURE_CUBE_MAP,t.texture);
          if(t.linear!==linear){const filter=linear?gl.LINEAR:gl.NEAREST;t.linear=linear;
            gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,filter);}
          gl.uniform1i(uniforms.cubeEnvMode,commands[o+40]);gl.uniform1i(uniforms.cubeFormat,commands[o+41]);
          gl.uniform1i(uniforms.cubeEnvColor,commands[o+42]);
        }else gl.bindTexture(gl.TEXTURE_CUBE_MAP,blankCube);
        const textured=commands[o+18],key=commands[o+19];
        gl.uniform1i(uniforms.textured,textured);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textured&&key>=0?textures.get(key).texture:blank);
        if(textured){
          gl.uniform1i(uniforms.texKey,key);gl.uniform2i(uniforms.texSize,commands[o+20],commands[o+21]);
          gl.uniform1i(uniforms.texFlags,commands[o+22]);gl.uniform1i(uniforms.envMode,commands[o+23]);
          gl.uniform1i(uniforms.baseFormat,commands[o+24]);gl.uniform1i(uniforms.envColor,commands[o+25]);
        }
        gl.drawArrays(gl.TRIANGLES,commands[o+1],commands[o+2]);stats.draws++;
      }else if(commands[o]===CLEAR_DEPTH){
        // As in software, a depth clear resets the whole buffer whatever the viewport or clip.
        gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);stats.clears++;
      }
    }
    gl.colorMask(true,true,true,true);
  }
  return {
    get active(){return gl!==null;},
    get lost(){return lost;},
    stats:()=>({...stats}),
    natives:{
      Java_p905i_web_WebGl_available(lib){try{return context()!==null;}catch(error){console.error(error);gl=null;return false;}},
      Java_p905i_web_WebGl_target(lib,width,height){
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D,blank);
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
      Java_p905i_web_WebGl_texture(lib,key,argb,width,height){texture(key,argb,width,height);},
      Java_p905i_web_WebGl_cube(lib,key,face,argb,size){cube(key,face,argb,size);},
      Java_p905i_web_WebGl_deleteTexture(lib,key){const t=textures.get(key);if(t){gl.deleteTexture(t.texture);textures.delete(key);}},
      Java_p905i_web_WebGl_draw(lib,surface,vertices,colors,vertexCount,commands,commandCount,floats,reflections){
        draw(surface,vertices,colors,vertexCount,commands,commandCount,floats,reflections);
      },
    },
  };
}
