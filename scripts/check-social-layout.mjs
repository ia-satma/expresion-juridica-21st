import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {load} from 'cheerio';

const root=process.cwd(),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ej-social-layout-'));
const outputBase=process.env.EJ_TEST_OUTPUT_DIR||path.join(root,'data/local-build-work');
await fs.mkdir(outputBase,{recursive:true});
const output=await fs.mkdtemp(path.join(outputBase,'social-layout-v2-'));
for(const folder of ['server','sitio'])await fs.symlink(path.join(root,folder),path.join(temporary,folder),'dir');
process.chdir(temporary);
const layouts=['split','typographic','editorial','quote','steps','photographic','frame','closing','photo-side','photo-editorial'];
let count=0;
try{
  const {composeSocialPiece,loadSocialTypography,svgSocialCanvas,htmlSocialCanvas,compactSocialScene}=await import(pathToFileURL(path.join(root,'server/social-compositor.mjs')));
  const {SOCIAL_FORMATS}=await import(pathToFileURL(path.join(root,'public/admin/social-formats.js')));
  const fonts=await loadSocialTypography();
  const artwork=await sharp({create:{width:900,height:650,channels:3,background:'#A4ABA4'}}).composite([{input:Buffer.from('<svg width="900" height="650"><rect x="450" width="450" height="650" fill="#8B9588"/><circle cx="450" cy="325" r="170" fill="#D9BC88"/></svg>')}]).png().toBuffer();
  const examples=[];
  for(const [size,format] of Object.entries(SOCIAL_FORMATS))for(const [index,layout] of layouts.entries()){
    const post={layout,eyebrow:'Una decisión informada',headline:'Una idea clara',body:'Escuchar y ordenar.',bullets:['Definir prioridades'],cta:'Conversemos',artwork:{aiGenerated:true},design:{palette:index%2?'navy-gold':'editorial',background:index%3===0?'tonal':index%3===1?'glow':'solid',panel:index%2?'plain':'curved',align:'left',spacing:'balanced',headlineScale:'balanced'}};
    const result=await composeSocialPiece({post,index:1,total:3,size,fonts,artwork:{buffer:artwork,aiGenerated:true}});
    assert.equal(result.layoutVersion,2);assert.deepEqual([result.canvas.w,result.canvas.h],format.dimensions);
    assert(result.validation.valid,`${size}/${layout}: ${JSON.stringify(result.validation.issues)}`);
    const scale=format.dimensions[0]/1080;
    for(const node of result.canvas.nodes.filter(node=>node.type==='text')){
      if(node.role==='body')assert(node.size/scale>=35.998,'Body must retain a width-based legibility floor');
      if(['caption','footer'].includes(node.role))assert(node.size/scale>=23.998);
      assert(node.lines.every(line=>Number.isFinite(line.baseline)&&line.bounds.w<=node.box.w+.6));
    }
    const svg=svgSocialCanvas(result.canvas,fonts);const png=await sharp(Buffer.from(svg)).png().toBuffer();
    const info=await sharp(png).metadata();assert.deepEqual([info.width,info.height],format.dimensions);
    const compact=compactSocialScene(result.canvas),serialized=JSON.stringify(compact);
    assert(!('assetMap' in compact));assert(!serialized.includes('base64'));assert(!serialized.includes('"type":"Buffer"'));
    assert(compact.nodes.filter(node=>node.type==='image').every(node=>typeof node.assetId==='string'));
    if((size==='square'&&['photo-editorial','photographic','typographic','split'].includes(layout))||(size==='landscape'&&layout==='photo-side')||(size==='story'&&layout==='photographic')){
      const stem=`${size}-${layout}`;
      await fs.writeFile(path.join(output,stem+'.png'),png);
      await fs.writeFile(path.join(output,stem+'.html'),htmlSocialCanvas(result.canvas,fonts,'Prueba técnica EJ','Diseño ficticio para comprobar composición.'));
      await fs.writeFile(path.join(output,stem+'.json'),JSON.stringify(compact,null,2));examples.push(path.join(output,stem+'.png'));
    }
    count++;
  }
  // Screenshot-shaped content: this is deliberately too dense at a readable size.
  // It must report the problem rather than overlap silently or silently delete copy.
  const longURL='https://www.gob.mx/presidencia/articulos/version-estenografica-derecho-de-replica-una-interpretacion-sobre-las-instituciones-publicas';
  const dense={layout:'photo-editorial',eyebrow:'El argumento jurídico',headline:'Alcalde invocó una dimensión colectiva',body:`La funcionaria atribuyó a la Suprema Corte una interpretación del derecho de réplica que abarca también a las instituciones. (${longURL})`,bullets:['El planteamiento se refiere al funcionamiento institucional.','No acredita por sí mismo cada desmentido.'],cta:'Consulta el contexto completo',artwork:{aiGenerated:true},design:{palette:'graphite',background:'tonal'}};
  const impossible=await composeSocialPiece({post:dense,index:3,total:5,size:'square',fonts,artwork:{buffer:artwork,aiGenerated:true}});
  assert.equal(impossible.validation.valid,false);
  assert(impossible.validation.issues.some(issue=>/OVERFLOW|COLLISION/.test(issue.code)));
  const denseBody=impossible.canvas.nodes.find(node=>node.field==='body');
  assert.equal(denseBody.rawText,dense.body);
  assert(denseBody.lines.length>3);assert(denseBody.lines.every(line=>line.bounds.w<=denseBody.box.w+.6),'A long URL must break horizontally');
  const synthesized={...dense,body:'El derecho de réplica también puede involucrar a las instituciones.',bullets:['Su alcance requiere contexto.'],design:{...dense.design,imageShare:'balanced'}};
  const fixed=await composeSocialPiece({post:synthesized,index:3,total:5,size:'square',fonts,artwork:{buffer:artwork,aiGenerated:true}});
  assert(fixed.validation.valid,JSON.stringify(fixed.validation.issues));
  await fs.writeFile(path.join(output,'screenshot-shaped-synthesized.png'),await sharp(Buffer.from(svgSocialCanvas(fixed.canvas,fonts))).png().toBuffer());
  await fs.writeFile(path.join(output,'screenshot-shaped-synthesized.html'),htmlSocialCanvas(fixed.canvas,fonts,'Prueba de composición editorial','Ejemplo técnico con texto sintetizado.'));
  const html=htmlSocialCanvas(fixed.canvas,fonts,'Título seguro <script>','Texto de ejemplo'),$=load(html);
  assert.equal($('script').length,0);assert($('g[data-field="headline"] text').length);
  assert.equal($('g[data-field="headline"]').attr('data-raw'),synthesized.headline);
  assert.match(html,/font-kerning:none/);assert.match(html,/font-variant-ligatures:none/);assert.match(html,/font\/ttf;base64/);
  assert(!html.includes('contenteditable="true"'),'Editing is controlled by the CMS overlay, never independent browser wrapping');
  const solo=await composeSocialPiece({post:{...synthesized,layout:'editorial',eyebrow:'',bullets:[]},total:1,size:'portrait',fonts});
  assert(!solo.canvas.nodes.some(node=>node.id.endsWith('-counter')||node.id.endsWith('-sequence')));
  const tooLong=await composeSocialPiece({post:{...synthesized,body:'Texto largo que debe conservarse. '.repeat(45),bullets:['Un punto importante. '.repeat(15)]},size:'landscape',fonts});
  assert(!tooLong.validation.valid);assert.equal(tooLong.canvas.nodes.find(node=>node.field==='body').rawText,'Texto largo que debe conservarse. '.repeat(45).trim());
  const footer=await composeSocialPiece({post:{...synthesized,layout:'typographic',headline:'Una idea clara',body:'Contexto breve.',bullets:[],cta:'Conoce los antecedentes de tu asunto y conversa con nuestro equipo para definir los siguientes pasos de tu consulta.'},size:'landscape',fonts});
  assert(footer.validation.valid,JSON.stringify(footer.validation.issues));
  const cta=footer.canvas.nodes.find(node=>node.field==='cta'),thread=footer.canvas.nodes.find(node=>node.id.endsWith('thread-a'));
  assert(cta.bounds.y+cta.bounds.h<thread.y-2,'A two-line CTA must stay clear of the gold thread');
  const naturalHeadline='La claridad empieza con una conversación';
  const natural=await composeSocialPiece({post:{...synthesized,layout:'split',headline:naturalHeadline,body:'Un siguiente paso con certidumbre.',bullets:[],design:{palette:'editorial',spacing:'generous',headlineScale:'expressive'}},size:'portrait',fonts});
  assert(natural.validation.valid,JSON.stringify(natural.validation.issues));
  const naturalTitle=natural.canvas.nodes.find(node=>node.field==='headline');
  assert(naturalTitle.lines.some(line=>line.text.split(/\s+/).includes('conversación')),'An ordinary word must not be broken into conversació / n');
  assert(naturalTitle.lines.length<=3,'Prefer a balanced three-line headline when the font range permits it');
  assert(naturalTitle.lines.every(line=>line.text.trim().length>1),'Do not leave one-letter headline fragments');
  await fs.writeFile(path.join(output,'portrait-split-natural-headline.png'),await sharp(Buffer.from(svgSocialCanvas(natural.canvas,fonts))).png().toBuffer());
  const empty=await composeSocialPiece({post:{layout:'typographic',headline:' ... ',body:'—',bullets:['•'],eyebrow:'Expresión Jurídica',cta:'Conversemos'},size:'portrait',fonts});
  assert(!empty.validation.valid);assert(empty.validation.issues.some(issue=>issue.code==='EMPTY_MESSAGE'));
  const fullBleed=await composeSocialPiece({post:{...synthesized,headline:'Una idea con contexto',body:'Información clara para decidir.',bullets:[],design:{palette:'graphite',imagePosition:'background',background:'tonal'}},size:'portrait',fonts,artwork:{buffer:artwork,aiGenerated:true}});
  assert(fullBleed.validation.valid,JSON.stringify(fullBleed.validation.issues));
  const backgroundPhoto=fullBleed.canvas.nodes.find(node=>node.role==='background-image');
  assert.deepEqual([backgroundPhoto.x,backgroundPhoto.y,backgroundPhoto.w,backgroundPhoto.h],[0,0,1080,1350]);
  assert(fullBleed.canvas.gradients.some(gradient=>gradient.id.endsWith('photo-scrim')&&gradient.stops.at(-1).opacity<.2));
  assert(!fullBleed.canvas.nodes.find(node=>node.field==='headline').lines.some(line=>line.text.trim()==='con'),'Prefer a balanced headline over a lonely connector at a large font size');
  await fs.writeFile(path.join(output,'portrait-full-bleed-editorial.png'),await sharp(Buffer.from(svgSocialCanvas(fullBleed.canvas,fonts))).png().toBuffer());
  let controlChecks=0;
  for(const imagePosition of ['left','right','top','background'])for(const background of ['solid','tonal','glow'])for(const align of ['left','center']){
    const design={palette:['navy-gold','editorial','ivory','graphite'][controlChecks%4],imagePosition,background,align,panel:controlChecks%2?'curved':'plain',imageShare:controlChecks%2?'dominant':'balanced'};
    const piece=await composeSocialPiece({post:{...synthesized,headline:'Información clara',body:'Una idea con contexto.',bullets:[],design},size:'portrait',fonts,artwork:{buffer:artwork,aiGenerated:true}});
    assert(piece.validation.valid,JSON.stringify({design,issues:piece.validation.issues}));
    assert(piece.canvas.nodes.some(node=>node.type==='image'&&node.role.startsWith('background')||node.role==='artwork'));
    controlChecks++;
  }
  const summary={passed:true,layoutVersion:2,matrix:count,controls:controlChecks,layouts:layouts.length,sizes:Object.keys(SOCIAL_FORMATS).length,actualPngDimensions:true,bodyMinimumLogical:36,captionMinimumLogical:24,exactLineRuns:true,longTokenWrapping:true,naturalWordHeadlines:true,balancedHeadlineConnectors:true,emptyMessageBlocked:true,fullBleedWithScrims:true,impossibleContentDiagnosed:true,rawTextPreserved:true,gradients:['solid','tonal','glow'],paidCalls:0,examples,output};
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
}finally{process.chdir(root);await fs.rm(temporary,{recursive:true,force:true});}
