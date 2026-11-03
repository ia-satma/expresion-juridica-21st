import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import opentype from 'opentype.js';
import { EJ_BRAND as B, presentationBrandAssets } from './presentation-brand.mjs';
import { SOCIAL_PALETTES, normalizeSocialDesign } from './social-design.mjs';
import { SOCIAL_FORMATS } from '../public/admin/social-formats.js';

export const SOCIAL_LAYOUT_VERSION = 2;
const glyphOptions = { kerning:false, features:{liga:false,rlig:false} };
const clean=value=>String(value??'').replace(/\u0000/g,'').normalize('NFC').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round=n=>Math.round(n*1000)/1000;
let typographyPromise;

export async function loadSocialTypography() {
  if(!typographyPromise)typographyPromise=(async()=>{
    const root=path.join(process.cwd(),'server/assets/ej-brand'),faces={},data={},cssMetrics={};
    const metrics=JSON.parse(await fs.readFile(path.join(root,'font-metrics.json'),'utf8'));
    for(const [role,name] of [['heading','libre-caslon-italic'],['body','bahnschrift-light']]){
      const buffer=await fs.readFile(path.join(root,`${name}.ttf`));
      const face=opentype.parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
      faces[role]=face;data[role]=buffer.toString('base64');
      cssMetrics[role]={ascent:face.ascender/face.unitsPerEm,descent:-face.descender/face.unitsPerEm};
    }
    return {faces,data,metrics,cssMetrics};
  })();
  return typographyPromise;
}

function measureLine(text,font,size) {
  const ink=font.getPath(text,0,0,size,glyphOptions).getBoundingBox();
  const advance=font.getAdvanceWidth(text,size,glyphOptions);
  const left=Number.isFinite(ink.x1)?Math.min(0,ink.x1):0;
  const right=Number.isFinite(ink.x2)?Math.max(advance,ink.x2):advance;
  return {advance,left,right,width:right-left,ink};
}
function wrapText(value,font,size,width) {
  const lines=[];
  const fits=text=>measureLine(text,font,size).width<=width-.5;
  for(const paragraph of clean(value).split('\n')){
    if(!paragraph.trim()){lines.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/\s+/)){
      if(line&&fits(`${line} ${word}`)){line+=` ${word}`;continue;}
      if(line){lines.push(line);line='';}
      if(fits(word)){line=word;continue;}
      // A URL or long token is never treated as one unbounded line.
      const graphemes=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('es',{granularity:'grapheme'}).segment(word)].map(item=>item.segment):[...word];
      for(const char of graphemes){
        if(line&&!fits(line+char)){lines.push(line);line='';}
        line+=char;
      }
    }
    if(line)lines.push(line);
  }
  return lines;
}
function textMetrics(value,font,size,width) {
  const text=clean(value),lines=text?wrapText(text,font,size,Math.max(1,width)):[];
  const ordinaryWordTooWide=text.split(/\s+/).some(token=>{
    const word=token.replace(/^["“”'«»()[\]¡¿]+|["“”'«»()[\].,;:!?…]+$/g,'');
    return [...word].length<=32&&/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(word)&&measureLine(word,font,size).width>width-.5;
  });
  const ascent=font.ascender/font.unitsPerEm*size,descent=-font.descender/font.unitsPerEm*size;
  const lineHeight=Math.max(size*1.28,ascent+descent+size*.035);
  return {texts:lines,size,ascent,descent,lineHeight,ordinaryWordTooWide,height:lines.length?ascent+descent+(lines.length-1)*lineHeight:0};
}
function balancedHeading(metrics,maximum=3) {
  return metrics.texts.length<=maximum&&!metrics.texts.some(line=>{
    const words=line.trim().split(/\s+/).filter(Boolean),letters=line.match(/[\p{L}\p{N}]/gu)||[];
    return metrics.texts.length>1&&words.length===1&&letters.length>0&&letters.length<4;
  });
}
function fitText(value,box,font,target,minimum,preferLines=Infinity) {
  let result=textMetrics(value,font,target,box.w),firstFit;
  for(let size=target;size>=minimum;size-=2){
    result=textMetrics(value,font,size,box.w);
    if(result.height<=box.h+.05&&!result.ordinaryWordTooWide){
      if(!firstFit)firstFit=result;
      if(preferLines===Infinity||balancedHeading(result,preferLines))break;
    }
  }
  if(firstFit&&(result.height>box.h+.05||result.ordinaryWordTooWide||preferLines!==Infinity&&!balancedHeading(result,preferLines)))result=firstFit;
  if(result.size<minimum)result=textMetrics(value,font,minimum,box.w);
  return {...result,fits:result.height<=box.h+.05&&!result.ordinaryWordTooWide};
}
function flowMetrics(post,width,fonts,size=40) {
  const blocks=[];
  if(clean(post.body))blocks.push({field:'body',text:clean(post.body),indent:0});
  (post.bullets||[]).filter(value=>clean(value)).forEach((value,index)=>blocks.push({field:`bullet-${index}`,text:clean(value),indent:30,bullet:index}));
  let height=0;
  return {blocks:blocks.map((block,index)=>{
    const item={...block,metrics:textMetrics(block.text,fonts.faces.body,size,width-block.indent),offset:height};
    height+=item.metrics.height+(index<blocks.length-1?18:0);return item;
  }),height:()=>height,size};
}
function colorRgb(hex){const value=String(hex).replace('#','');return [0,2,4].map(i=>Number.parseInt(value.slice(i,i+2),16));}
function blend(color,background,opacity){return colorRgb(color).map((v,i)=>Math.round(v*opacity+colorRgb(background)[i]*(1-opacity)));}
function luminance(rgb){return rgb.map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const values=[luminance(colorRgb(a)),luminance(Array.isArray(b)?b:colorRgb(b))].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);}
function intersect(a,b,gap=0){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;}
function union(boxes){if(!boxes.length)return {x:0,y:0,w:0,h:0};const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
function scaleBox(box,scale){return Object.fromEntries(Object.entries(box).map(([key,value])=>[key,round(value*scale)]));}

/** No storage writes or provider calls. Raw content is never clipped to make it fit. */
export async function composeSocialPiece({post={},index=0,total=1,size='portrait',fonts,typography,assets,artwork}={}) {
  fonts=fonts||typography||await loadSocialTypography();assets=assets||await presentationBrandAssets();
  const format=Object.hasOwn(SOCIAL_FORMATS,size)?SOCIAL_FORMATS[size]:SOCIAL_FORMATS.portrait;
  const [outputW,outputH]=format.dimensions,scale=outputW/1080,w=1080,h=outputH/scale;
  const safeTop=format.safeArea?.top||0,safeBottom=format.safeArea?.bottom||0;
  const normalized=normalizeSocialDesign(post.design,post.layout,index),design={...normalized,...post.design,palette:normalized.palette};
  const palette=SOCIAL_PALETTES[design.palette]||SOCIAL_PALETTES.editorial;
  const m=design.spacing==='generous'?78:64,short=h-safeTop-safeBottom<760;
  const nodes=[],gradients=[],assetMap={},issues=[],adjustments=[];
  const issue=(code,field,message)=>issues.push({code,field,message});
  if(![post.headline,post.body,...(Array.isArray(post.bullets)?post.bullets:[])].some(value=>/[\p{L}\p{N}]/u.test(clean(value))))issue('EMPTY_MESSAGE','headline','Añade una idea, un título o un texto principal. La marca y la llamada a la acción no sustituyen el mensaje de la pieza.');
  const id=role=>`piece-${index}-${role}`;
  const rect=(role,x,y,width,height,fill,extra={})=>nodes.push({id:id(role),type:'rect',x,y,w:width,h:height,fill,decorative:true,...extra});
  const line=(role,x,y,x2,y2,color=B.gold)=>nodes.push({id:id(role),type:'line',x,y,x2,y2,color,strokeWidth:1.6,decorative:true});
  const image=(role,buffer,x,y,width,height,extra={})=>{
    if(!buffer||width<=0||height<=0)return;
    const key=`${role}-${crypto.createHash('sha256').update(buffer).digest('hex').slice(0,16)}`;
    assetMap[key]=buffer;nodes.push({id:id(role),type:'image',assetId:key,x,y,w:width,h:height,fit:'cover',...extra});
  };
  const addText=(role,value,box,font,target,minimum,color,field='',extra={})=>{
    const face=fonts.faces[font],metrics=fitText(value,box,face,target,minimum,font==='heading'?3:Infinity),alignment=extra.align||design.align||'left';
    const lines=metrics.texts.map((text,row)=>{
      const measured=measureLine(text,face,metrics.size);
      const x=alignment==='center'?box.x+(box.w-measured.width)/2-measured.left:box.x-measured.left;
      const baseline=box.y+metrics.ascent+row*metrics.lineHeight;
      const b=measured.ink;
      const bounds=text?{x:x+b.x1,y:baseline+b.y1,w:b.x2-b.x1,h:b.y2-b.y1}:{x,y:baseline,w:0,h:0};
      return {text,x,baseline,top:baseline-metrics.ascent,width:measured.advance,bounds};
    });
    const bounds=union(lines.filter(item=>item.text).map(item=>item.bounds));
    const node={id:id(role),type:'text',field,rawText:clean(value),font,size:metrics.size,color,align:alignment,box:{...box},bounds,lines,lineHeight:metrics.lineHeight,surface:palette.background,...extra};
    nodes.push(node);
    if(metrics.ordinaryWordTooWide)issue('WORD_TOO_WIDE',field||role,'Una palabra necesita una columna más amplia para conservarse completa y legible.');
    if(!metrics.fits&&!metrics.ordinaryWordTooWide)issue('TEXT_OVERFLOW',field||role,'El texto necesita más espacio. Conserva el detalle en el copy o elige una composición más amplia.');
    return {node,height:metrics.height,fits:metrics.fits};
  };
  const contentTop=safeTop+(short?128:176),contentBottom=h-safeBottom-(short?162:180);
  const region={x:m,y:contentTop,w:w-2*m,h:Math.max(40,contentBottom-contentTop)};
  const headingTarget={compact:94,balanced:112,expressive:130}[design.headlineScale]||112;
  const artBuffer=Buffer.isBuffer(artwork)?artwork:artwork?.buffer;
  const aiGenerated=Boolean((!Buffer.isBuffer(artwork)&&artwork?.aiGenerated)||post.artwork?.aiGenerated);
  const hasPhoto=Boolean(artBuffer);
  const layout=['split','typographic','editorial','quote','steps','photographic','frame','closing','photo-side','photo-editorial'].includes(post.layout)?post.layout:'editorial';
  const background=['solid','tonal','glow'].includes(design.background)?design.background:'solid';
  rect('background',0,0,w,h,palette.background,{role:'background'});
  if(background==='tonal'){
    const end=palette.dark?B.night:design.palette==='ivory'?B.white:B.gray;
    const gradientId=id('tonal');gradients.push({id:gradientId,type:'linear',x1:0,y1:0,x2:w,y2:h,stops:[{offset:0,color:palette.background,opacity:1},{offset:1,color:end,opacity:1}]});
    nodes[0].fill=`url(#${gradientId})`;
  }else if(background==='glow'){
    const gradientId=id('glow');gradients.push({id:gradientId,type:'radial',cx:w*.8,cy:h*.22,r:w*.92,stops:[{offset:0,color:B.gold,opacity:palette.dark?.2:.18},{offset:1,color:B.gold,opacity:0}]});
    rect('glow',0,0,w,h,`url(#${gradientId})`);
  }
  const photoCaption=(x,y,width)=>{if(aiGenerated)addText('ai-caption','Imagen generada con IA',{x,y,w:width,h:32},'body',24,24,palette.ink,'',{role:'caption',align:'left'});};
  const photo=(x,y,width,height,role='artwork')=>{image(role,artBuffer,x,y,width,height,{role:'artwork',blocking:true});photoCaption(x,y+height+8,width);};
  const textFlow=(box,target=40)=>{
    let flow=flowMetrics(post,box.w,fonts,target);
    if((flow.height()>box.h||flow.blocks.some(block=>block.metrics.ordinaryWordTooWide))&&target>36)flow=flowMetrics(post,box.w,fonts,36);
    for(const block of flow.blocks){
      const textBox={x:box.x+block.indent,y:box.y+block.offset,w:box.w-block.indent,h:block.metrics.height};
      addText(block.field,block.text,textBox,'body',flow.size,flow.size,palette.ink,block.field,{role:'body',align:block.indent?'left':design.align||'left'});
      if(block.bullet!==undefined){
        if(layout==='steps'){
          const cy=textBox.y+20;nodes.push({id:id(`step-dot-${block.bullet}`),type:'circle',cx:box.x+9,cy,r:15,fill:B.gold,decorative:true});
          addText(`step-number-${block.bullet}`,String(block.bullet+1),{x:box.x-1,y:cy-17,w:20,h:32},'body',24,24,B.navy,'',{role:'decorative-text',align:'center',surface:B.gold});
        }else nodes.push({id:id(`bullet-dot-${block.bullet}`),type:'circle',cx:box.x+8,cy:textBox.y+20,r:3.7,fill:palette.accent,decorative:true});
      }
    }
    if(flow.height()>box.h+.05)issue('FLOW_OVERFLOW','body','El cuerpo y las viñetas superan el espacio disponible; el texto se conserva para ajustarlo.');
    return flow.height();
  };
  const article=(box,target=headingTarget,centerVertically=false)=>{
    let chosen,flow,firstFit;
    for(let fontSize=target;fontSize>=52;fontSize-=2){
      const heading=textMetrics(post.headline,fonts.faces.heading,fontSize,box.w);
      for(const bodySize of [40,36]){
        const candidate=flowMetrics(post,box.w,fonts,bodySize),gap=candidate.blocks.length?28:0;
        if(heading.height+gap+candidate.height()<=box.h+.05&&!heading.ordinaryWordTooWide&&!candidate.blocks.some(block=>block.metrics.ordinaryWordTooWide)){
          if(!firstFit)firstFit={heading,flow:candidate};
          if(balancedHeading(heading)){chosen=heading;flow=candidate;break;}
        }
      }
      if(chosen)break;
    }
    if(!chosen&&firstFit){chosen=firstFit.heading;flow=firstFit.flow;}
    if(!chosen){chosen=textMetrics(post.headline,fonts.faces.heading,52,box.w);flow=flowMetrics(post,box.w,fonts,36);}
    const gap=flow.blocks.length?28:0,totalHeight=chosen.height+gap+flow.height();
    const y=box.y+(centerVertically&&totalHeight<box.h?(box.h-totalHeight)/2:0);
    addText('headline',post.headline,{x:box.x,y,w:box.w,h:chosen.height},'heading',chosen.size,chosen.size,palette.title,'headline',{role:'headline'});
    if(flow.blocks.length)textFlow({x:box.x,y:y+chosen.height+gap,w:box.w,h:Math.max(0,box.h-chosen.height-gap)},flow.size);
    if(totalHeight>box.h+.05)issue('COMPOSITION_OVERFLOW','headline','Esta cantidad de texto no cabe con una tipografía legible en la composición elegida.');
    return totalHeight;
  };
  const panel=(box)=>{
    if(design.panel!=='curved')return;
    const padding=24,x=box.x-padding,y=Math.max(box.y-padding,safeTop+120),width=box.w+padding*2,height=box.h+(box.y-y)+padding,r=Math.min(76,height*.24);
    const d=`M${x},${y}H${x+width}V${y+height-r}Q${x+width},${y+height} ${x+width-r},${y+height}H${x}Z`;
    nodes.push({id:id('curved-panel'),type:'path',d,fill:palette.background,opacity:.96,decorative:true,bounds:{x,y,w:width,h:height}});
  };
  // Header and footer are reserved regions, independent of content density.
  let headerX=m,footerX=m;
  if(layout==='split'){
    const rail=282;rect('brand-rail',0,0,rail,h,B.navy);
    image('logo',assets.logo,rail/2-71,safeTop+38,142,142*442/480,{role:'logo',blocking:true});
    headerX=rail+44;footerX=headerX;
    const box={x:headerX,y:region.y,w:w-headerX-m,h:region.h};panel(box);article(box,headingTarget,true);
    if(hasPhoto){const y=Math.max(region.y+20,safeTop+198),height=Math.max(45,Math.min(220,contentBottom-y-(aiGenerated?44:0)));image('artwork',artBuffer,30,y,rail-60,height,{role:'artwork',blocking:true});if(aiGenerated)addText('ai-caption','Imagen generada con IA',{x:30,y:y+height+8,w:rail-60,h:64},'body',24,24,B.paper,'',{role:'caption',surface:B.navy});}
  }else{
    const badgeW=90,badgeX=w-m-badgeW,badgeY=safeTop+27;
    if(!palette.dark)rect('logo-badge',badgeX-12,badgeY-10,badgeW+24,badgeW*442/480+20,B.navy);
    image('logo',assets.logo,badgeX,badgeY,badgeW,badgeW*442/480,{role:'logo',blocking:true});
    const defaultPosition=layout==='photographic'?'top':['photo-side','closing'].includes(layout)?'right':layout==='photo-editorial'?'left':'auto';
    const position=['left','right','top','background'].includes(design.imagePosition)?design.imagePosition:defaultPosition;
    const usePhoto=hasPhoto&&(position!=='auto'||['editorial','steps'].includes(layout));
    if(usePhoto&&position==='background'){
      // A full-bleed editorial photograph remains visible on the right. Native
      // directional/top/bottom scrims protect text without a uniform matte veil.
      const backgroundNodes=nodes.splice(1);image('background-artwork',artBuffer,0,0,w,h,{role:'background-image',decorative:true});
      const horizontal=id('photo-scrim'),topFade=id('photo-header'),bottomFade=id('photo-footer');
      gradients.push({id:horizontal,type:'linear',x1:0,y1:0,x2:w,y2:0,stops:[{offset:0,color:palette.background,opacity:.97},{offset:.66,color:palette.background,opacity:.9},{offset:1,color:palette.background,opacity:.14}]});
      gradients.push({id:topFade,type:'linear',x1:0,y1:0,x2:0,y2:safeTop+150,stops:[{offset:0,color:palette.background,opacity:.96},{offset:.8,color:palette.background,opacity:.88},{offset:1,color:palette.background,opacity:0}]});
      gradients.push({id:bottomFade,type:'linear',x1:0,y1:Math.max(0,contentBottom-40),x2:0,y2:h-safeBottom,stops:[{offset:0,color:palette.background,opacity:0},{offset:.38,color:palette.background,opacity:.9},{offset:1,color:palette.background,opacity:.98}]});
      rect('background-scrim',0,0,w,h,`url(#${horizontal})`);rect('header-scrim',0,0,w,h,`url(#${topFade})`);rect('footer-scrim',0,0,w,h,`url(#${bottomFade})`);nodes.push(...backgroundNodes);
      const box={...region,w:region.w*(short?.62:.66),h:region.h-(aiGenerated?48:0)};panel(box);article(box,headingTarget,true);
      if(aiGenerated)addText('ai-caption','Imagen generada con IA',{x:m,y:contentBottom-34,w:region.w,h:32},'body',24,24,palette.ink,'',{role:'caption'});
    }else if(usePhoto&&position==='top'&&(!short||design.imagePosition==='top')){
      const titleSpace=Math.min(region.h*.31,280),head=fitText(post.headline,{...region,h:titleSpace},fonts.faces.heading,headingTarget,56,3);
      addText('headline',post.headline,{x:region.x,y:region.y,w:region.w,h:head.height},'heading',head.size,head.size,palette.title,'headline',{role:'headline'});
      let flow=flowMetrics(post,region.w,fonts,40);if(flow.height()>region.h*.32)flow=flowMetrics(post,region.w,fonts,36);
      const cap=aiGenerated?42:0,remaining=region.h-head.height-flow.height()-64-cap;
      const desired=Math.max(design.imageShare==='dominant'?430:330,remaining*(design.imageShare==='dominant'?.95:.78));
      const photoH=Math.max(90,Math.min(desired,remaining));
      const photoY=region.y+head.height+28;photo(region.x,photoY,region.w,photoH);
      textFlow({x:region.x,y:photoY+photoH+cap+32,w:region.w,h:contentBottom-photoY-photoH-cap-32},flow.size);
    }else if(usePhoto&&layout==='photo-editorial'&&!short&&position!=='top'){
      const head=fitText(post.headline,{...region,h:region.h*.37},fonts.faces.heading,headingTarget,56,3);
      addText('headline',post.headline,{x:region.x,y:region.y,w:region.w,h:head.height},'heading',head.size,head.size,palette.title,'headline',{role:'headline'});
      const rowY=region.y+head.height+32,rowH=contentBottom-rowY,gap=40,photoW=region.w*(design.imageShare==='dominant'?.53:.46),textW=region.w-photoW-gap,left=position==='right'?region.x+textW+gap:region.x;
      photo(left,rowY,photoW,Math.max(45,Math.min(rowH-(aiGenerated?42:0),photoW*.86)));
      const textX=position==='right'?region.x:region.x+photoW+gap;const box={x:textX,y:rowY,w:textW,h:rowH};panel(box);textFlow(box);
    }else if(usePhoto){
      const gap=40,photoW=region.w*(short?.36:design.imageShare==='dominant'?.51:.4),textW=region.w-photoW-gap;
      const left=position==='left',photoX=left?region.x:region.x+textW+gap,textX=left?region.x+photoW+gap:region.x;
      const photoH=Math.min(region.h-(aiGenerated?42:0),short?region.h:photoW*1.38);
      photo(photoX,region.y,photoW,Math.max(45,photoH));const box={x:textX,y:region.y,w:textW,h:region.h};panel(box);article(box,Math.min(headingTarget,100),!short);
    }else{
      const box={...region};
      if(layout==='editorial'&&total>1&&!short){
        addText('sequence',String(index+1).padStart(2,'0'),{x:box.x,y:box.y,w:170,h:110},'heading',82,82,palette.accent,'',{role:'decorative-text'});box.y+=138;box.h-=138;
      }
      if(layout==='quote'){line('quote-bar',box.x,box.y+4,box.x,box.y+box.h-4);box.x+=34;box.w-=34;}
      if(layout==='frame'){line('frame-top',box.x,box.y-17,box.x+box.w,box.y-17);box.y+=20;box.h-=20;}
      if(layout==='typographic'&&assets.watermark)image('watermark',assets.watermark,w*.51,region.y+region.h*.2,w*.56,w*.56*442/480,{role:'watermark',decorative:true});
      panel(box);article(box,layout==='typographic'?Math.min(138,headingTarget+8):headingTarget,true);
    }
  }
  if(clean(post.eyebrow))addText('eyebrow',post.eyebrow,{x:headerX,y:safeTop+35,w:Math.max(150,w-headerX-m-144),h:70},'body',26,24,palette.dark?palette.accent:palette.ink,'eyebrow',{role:'eyebrow',align:'left'});
  const footerRight=w-m,footerWidth=footerRight-footerX;
  if(clean(post.cta))addText('cta',post.cta,{x:footerX,y:h-safeBottom-156,w:footerWidth,h:68},'body',30,26,palette.dark?palette.accent:palette.ink,'cta',{role:'cta',align:'left'});
  const lineY=h-safeBottom-68;
  line('thread-a',40,lineY-18,w*.29,lineY-18);line('thread-b',w*.29,lineY-18,w*.35,lineY);line('thread-c',w*.35,lineY,w-42,lineY);
  nodes.push({id:id('thread-end'),type:'circle',cx:w-42,cy:lineY,r:3.7,fill:B.gold,decorative:true});
  addText('firm-name','Expresión Jurídica Consultores',{x:footerX,y:h-safeBottom-47,w:footerWidth-(total>1?128:0),h:34},'body',24,24,palette.ink,'',{role:'footer',align:'left'});
  if(total>1)addText('counter',`${String(index+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`,{x:w-m-110,y:h-safeBottom-47,w:110,h:34},'body',24,24,palette.dark?palette.accent:palette.ink,'',{role:'footer',align:'left'});

  const blocking=nodes.filter(node=>node.type==='text'&&node.rawText&&node.role!=='decorative-text'||node.blocking);
  for(const node of blocking){
    const b=node.type==='text'?node.bounds:{x:node.x,y:node.y,w:node.w,h:node.h};
    if(b.x<-.1||b.y<safeTop-.1||b.x+b.w>w+.1||b.y+b.h>h-safeBottom+.1)issue('OUTSIDE_SAFE_AREA',node.field||node.role,'Un elemento supera el área segura de la pieza.');
    if(node.type==='text'){
      if(node.bounds.x<node.box.x-.5||node.bounds.y<node.box.y-.5||node.bounds.x+node.bounds.w>node.box.x+node.box.w+.5||node.bounds.y+node.bounds.h>node.box.y+node.box.h+.5)issue('INK_OUTSIDE_BOX',node.field||node.role,'Los límites reales de las letras superan su caja.');
      const surfaces=[node.surface||palette.background];
      if(background==='tonal'&&node.surface===palette.background)surfaces.push(palette.dark?B.night:design.palette==='ivory'?B.white:B.gray);
      if(background==='glow'&&node.surface===palette.background)surfaces.push(blend(B.gold,palette.background,palette.dark?.2:.18));
      const minimum=node.font==='heading'&&node.size>=48?3:4.5;
      if(Math.min(...surfaces.map(surface=>contrast(node.color,surface)))<minimum)issue('LOW_CONTRAST',node.field||node.role,'El texto necesita más contraste con su fondo.');
    }
  }
  for(let a=0;a<blocking.length;a++)for(let b=a+1;b<blocking.length;b++){
    const first=blocking[a],second=blocking[b],boxA=first.type==='text'?first.bounds:first,boxB=second.type==='text'?second.bounds:second;
    if(intersect(boxA,boxB,2))issue('ELEMENT_COLLISION',first.field||first.role,`Hay una superposición entre ${first.field||first.role} y ${second.field||second.role}.`);
  }
  const scaleNode=node=>{
    const result={...node};
    for(const key of ['x','y','w','h','x2','y2','cx','cy','r','size','lineHeight','strokeWidth'])if(typeof result[key]==='number')result[key]=round(result[key]*scale);
    if(result.box)result.box=scaleBox(result.box,scale);if(result.bounds)result.bounds=scaleBox(result.bounds,scale);
    if(result.lines)result.lines=result.lines.map(item=>({...item,x:round(item.x*scale),baseline:round(item.baseline*scale),top:round(item.top*scale),width:round(item.width*scale),bounds:scaleBox(item.bounds,scale)}));
    if(result.d&&scale!==1)result.transform=`scale(${scale})`;
    return result;
  };
  const scaledGradients=gradients.map(gradient=>{const item={...gradient};for(const key of ['x1','y1','x2','y2','cx','cy','r'])if(typeof item[key]==='number')item[key]=round(item[key]*scale);return item;});
  const uniqueIssues=[...new Map(issues.map(item=>[`${item.code}:${item.field}:${item.message}`,item])).values()];
  const canvas={w:outputW,h:outputH,layoutVersion:2,nodes:nodes.map(scaleNode),gradients:scaledGradients,assetMap,safeArea:{top:safeTop*scale,bottom:safeBottom*scale},resolvedLayout:layout,adjustments};
  return {canvas,validation:{valid:uniqueIssues.length===0,issues:uniqueIssues},layoutVersion:2,fonts};
}

export function compactSocialScene(canvas) {
  const {assetMap,...scene}=canvas;
  return JSON.parse(JSON.stringify(scene,(_key,value)=>Buffer.isBuffer(value)?undefined:value));
}
function gradientSvg(gradients=[]) {
  return gradients.map(gradient=>{
    const stops=gradient.stops.map(stop=>`<stop offset="${stop.offset}" stop-color="${esc(stop.color)}" stop-opacity="${stop.opacity??1}"/>`).join('');
    return gradient.type==='radial'?`<radialGradient id="${esc(gradient.id)}" gradientUnits="userSpaceOnUse" cx="${gradient.cx}" cy="${gradient.cy}" r="${gradient.r}">${stops}</radialGradient>`:`<linearGradient id="${esc(gradient.id)}" gradientUnits="userSpaceOnUse" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">${stops}</linearGradient>`;
  }).join('');
}
function imageData(canvas,assetId){const buffer=canvas.assetMap?.[assetId];return Buffer.isBuffer(buffer)?`data:image/png;base64,${buffer.toString('base64')}`:'';}
function svgNodes(canvas,fonts,editable=false) {
  return canvas.nodes.map(node=>{
    const meta=`id="${esc(node.id)}"${node.opacity===undefined?'':` opacity="${node.opacity}"`}`;
    if(node.type==='rect')return `<rect ${meta} x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" fill="${esc(node.fill)}"${node.rx?` rx="${node.rx}"`:''}/>`;
    if(node.type==='path')return `<path ${meta} d="${esc(node.d)}" fill="${esc(node.fill)}"${node.transform?` transform="${esc(node.transform)}"`:''}/>`;
    if(node.type==='circle')return `<circle ${meta} cx="${node.cx}" cy="${node.cy}" r="${node.r}" fill="${esc(node.fill)}"/>`;
    if(node.type==='line')return `<path ${meta} d="M${node.x},${node.y}L${node.x2},${node.y2}" stroke="${esc(node.color)}" stroke-width="${node.strokeWidth||1.6}" fill="none"/>`;
    if(node.type==='image')return `<image ${meta} data-asset-id="${esc(node.assetId)}" href="${imageData(canvas,node.assetId)}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" preserveAspectRatio="xMidYMid slice"/>`;
    if(node.type!=='text')return '';
    if(!editable)return node.lines.map((line,row)=>`<path id="${esc(node.id)}-${row}" fill="${esc(node.color)}" d="${fonts.faces[node.font].getPath(line.text,line.x,line.baseline,node.size,glyphOptions).toPathData(3)}"/>`).join('');
    const field=node.field?` data-field="${esc(node.field)}" data-raw="${esc(node.rawText)}" role="textbox" aria-label="${esc(node.field)}" tabindex="0"`:'';
    return `<g ${meta}${field} data-node="${esc(node.id)}" data-box="${esc(JSON.stringify(node.box))}" font-family="${node.font==='heading'?'EJCaslon':'EJBahnschrift'}" font-size="${node.size}" font-style="${node.font==='heading'?'italic':'normal'}" font-weight="${node.font==='heading'?400:300}" fill="${esc(node.color)}">${node.lines.map(line=>`<text x="${line.x}" y="${line.baseline}" xml:space="preserve">${esc(line.text)}</text>`).join('')}</g>`;
  }).join('');
}
export function svgSocialCanvas(canvas,fonts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.w}" height="${canvas.h}" viewBox="0 0 ${canvas.w} ${canvas.h}"><defs>${gradientSvg(canvas.gradients)}</defs>${svgNodes(canvas,fonts)}</svg>`;
}
export function htmlSocialCanvas(canvas,fonts,title='',altText='') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@font-face{font-family:EJCaslon;src:url(data:font/ttf;base64,${fonts.data.heading}) format('truetype');font-style:italic;font-weight:400}@font-face{font-family:EJBahnschrift;src:url(data:font/ttf;base64,${fonts.data.body}) format('truetype');font-weight:300}*{box-sizing:border-box}html,body{margin:0;width:100%;background:${B.paper}}.artboard{display:block;width:100%;height:auto}text{font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"clig" 0,"rlig" 0;white-space:pre}[data-field]{cursor:text}[data-field]:focus{outline:1px dashed ${B.gold};outline-offset:4px}</style></head><body><main aria-label="${esc(altText)}"><svg class="artboard" xmlns="http://www.w3.org/2000/svg" width="${canvas.w}" height="${canvas.h}" viewBox="0 0 ${canvas.w} ${canvas.h}"><defs>${gradientSvg(canvas.gradients)}</defs>${svgNodes(canvas,fonts,true)}</svg></main></body></html>`;
}
