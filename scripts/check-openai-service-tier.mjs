import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { applyTextServiceTier,isTextEndpoint,requestWithTextServiceTier,shouldRetryStandardTier,textServiceTier } from '../server/openai-service-tier.mjs';

const textBody={model:'gpt-6.1-sol',input:'fixture',reasoning:{effort:'high'},store:false};
const snapshot=structuredClone(textBody);
assert.equal(textServiceTier({}),'fast');assert.equal(textServiceTier({OPENAI_TEXT_SERVICE_TIER:'default'}),'default');
assert.equal(isTextEndpoint('/responses'),true);assert.equal(isTextEndpoint('/chat/completions'),true);assert.equal(isTextEndpoint('/images/generations'),false);
assert.deepEqual(applyTextServiceTier('/responses',textBody,{}),{...textBody,service_tier:'fast'});assert.deepEqual(textBody,snapshot);
assert.deepEqual(applyTextServiceTier('/responses',{...textBody,service_tier:'fast'},{OPENAI_TEXT_SERVICE_TIER:'default'}),{...textBody,service_tier:'default'});
const imageBody={model:'gpt-image-2.5-sunburst',prompt:'Synthetic fixture',n:1,size:'1536x1024',quality:'medium',output_format:'png'};assert.strictEqual(applyTextServiceTier('/images/generations',imageBody,{}),imageBody);
const rejected={error:{code:'unsupported_value',param:'service_tier',message:'Fast is not supported for this fixture.'}};
assert(shouldRetryStandardTier('/responses',{service_tier:'fast'},400,rejected));assert(shouldRetryStandardTier('/responses',{service_tier:'fast'},422,rejected));
for(const status of [401,403,404,408,429,500,503])assert.equal(shouldRetryStandardTier('/responses',{service_tier:'fast'},status,rejected),false);
assert.equal(shouldRetryStandardTier('/images/generations',{service_tier:'fast'},400,rejected),false);
assert.equal(shouldRetryStandardTier('/responses',{service_tier:'default'},400,rejected),false);
assert.equal(shouldRetryStandardTier('/responses',{service_tier:'fast'},400,{error:{code:'invalid_value',param:'input',message:'service_tier is unrelated'}}),false);
let networkAttempts=0;await assert.rejects(()=>requestWithTextServiceTier('/responses',textBody,async()=>{networkAttempts++;throw new Error('Fixture network failure');}),/Fixture network failure/);assert.equal(networkAttempts,1);

const root=process.cwd(),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ej-fast-tier-check-')),requests=[];
const cases=new Map();
const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),name=body.input||'chat-or-image';requests.push({endpoint:req.url,body});cases.set(name,(cases.get(name)||0)+1);
  res.setHeader('content-type','application/json');
  if(name==='invalid-json')return res.end('fixture-private-provider-body');
  if(name==='timeout'){await new Promise(resolve=>setTimeout(resolve,1000));if(res.destroyed)return;}
  let status=200,result={id:'fixture-response',model:body.model,status:'completed',output:[],service_tier:body.service_tier||'default'};
  if(name==='missing-tier')delete result.service_tier;
  if(name==='downgrade')result.service_tier='default';
  if(name==='unsupported-param'&&body.service_tier){status=400;result={error:{code:'unknown_parameter',param:'service_tier',message:"Unknown parameter: 'service_tier'."}};}
  if(name==='unsupported-value'&&body.service_tier==='fast'){status=422;result=rejected;}
  if(name==='unsupported-twice'){status=400;result=rejected;}
  const failures={'other-400':[400,'context_length_exceeded'],'auth-401':[401,'invalid_api_key'],'busy-429':[429,'rate_limit_exceeded'],'server-503':[503,'server_error']};
  if(failures[name]){[status]=failures[name];result={error:{code:failures[name][1],param:name==='other-400'?'input':'service_tier',message:'Unsupported fixture value; provider body must remain private.'}};}
  if (name === 'busy-429') res.setHeader('retry-after', '0');
  if (name === 'recover-429' && cases.get(name) === 1) {
    res.setHeader('retry-after', '0');
    status = 429; result = { error: { code: 'rate_limit_exceeded' } };
  }
  if (name === 'later-429') {
    res.setHeader('retry-after', '60');
    status = 429; result = { error: { code: 'rate_limit_exceeded' } };
  }
  if (name === 'quota-429') {
    res.setHeader('retry-after', '0');
    status = 429; result = { error: { code: 'project_spend_limit_exceeded', type: 'insufficient_quota' } };
  }
  if(req.url==='/images/generations')result={data:[{b64_json:'Zml4dHVyZQ=='}]};
  res.statusCode=status;res.end(JSON.stringify(result));
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
try {
  // Empty isolated cwd keeps legacy migration away from the developer's real data.
  process.chdir(temporary);process.env.CMS_DATA_SCOPE='isolated-fast-tier-check';process.env.OPENAI_API_KEY='test-placeholder';process.env.OPENAI_BASE_URL=`http://127.0.0.1:${mock.address().port}`;delete process.env.OPENAI_TEXT_SERVICE_TIER;
  for(const name of ['REPL_ID','REPLIT_DEPLOYMENT_URL','REPLIT_DEV_DOMAIN','REPLIT_OBJECT_STORAGE_BUCKET_ID','DEFAULT_OBJECT_STORAGE_BUCKET_ID','OPENAI_IMAGE_MODEL'])delete process.env[name];
  const {openaiRequest,presentationModels}=await import(pathToFileURL(path.join(root,'server/presentation-generator.mjs')));assert.equal(presentationModels().textServiceTier,'fast');assert.equal(presentationModels().imageModel,'gpt-image-2.5-sunburst');
  process.env.OPENAI_IMAGE_MODEL='gpt-image-2.5-flare';assert.equal(presentationModels().imageModel,'gpt-image-2.5-flare');process.env.OPENAI_IMAGE_MODEL='gpt-image-2';assert.equal(presentationModels().imageModel,'gpt-image-2');delete process.env.OPENAI_IMAGE_MODEL;assert.equal(presentationModels().imageModel,'gpt-image-2.5-sunburst');
  const fast=await openaiRequest('/responses',{...textBody,input:'fast'});assert.deepEqual(fast.serviceTier,{requested:'fast',served:'fast',fallback:false});assert.equal(fast.service_tier,'fast');
  assert.deepEqual(requests.at(-1).body,{...textBody,input:'fast',service_tier:'fast'});assert.deepEqual(textBody,snapshot);
  const chat=await openaiRequest('/chat/completions',{model:'gpt-6.1-sol',messages:[{role:'user',content:'Fixture'}],reasoning_effort:'high'});assert.equal(chat.serviceTier.requested,'fast');assert.equal(requests.at(-1).body.reasoning_effort,'high');
  const downgraded=await openaiRequest('/responses',{...textBody,input:'downgrade'});assert.deepEqual(downgraded.serviceTier,{requested:'fast',served:'default',fallback:false});assert.equal(downgraded.service_tier,'default');
  const unreported=await openaiRequest('/responses',{...textBody,input:'missing-tier'});assert.deepEqual(unreported.serviceTier,{requested:'fast',served:null,fallback:false});assert(!Object.hasOwn(unreported,'service_tier'));
  process.env.OPENAI_TEXT_SERVICE_TIER='default';assert.equal(presentationModels().textServiceTier,'default');const standard=await openaiRequest('/responses',{...textBody,input:'default'});assert.deepEqual(standard.serviceTier,{requested:'default',served:'default',fallback:false});process.env.OPENAI_TEXT_SERVICE_TIER='fast';
  for(const name of ['unsupported-param','unsupported-value']) {
    const result=await openaiRequest('/responses',{...textBody,input:name});assert.equal(cases.get(name),2);assert.deepEqual(result.serviceTier,{requested:'fast',served:'default',fallback:true});
    const last=requests.at(-1).body;assert.equal(last.model,textBody.model);assert.deepEqual(last.reasoning,textBody.reasoning);
    if(name==='unsupported-param')assert(!Object.hasOwn(last,'service_tier'));else assert.equal(last.service_tier,'default');
  }
  for(const name of ['other-400','auth-401','server-503']){await assert.rejects(()=>openaiRequest('/responses',{...textBody,input:name}),/^Error: OPENAI_/);assert.equal(cases.get(name),1);}
  for (const [name, code, count] of [['busy-429', 'OPENAI_RATE_LIMIT_EXCEEDED', 2], ['later-429', 'OPENAI_RATE_LIMIT_EXCEEDED', 1], ['quota-429', 'OPENAI_INSUFFICIENT_QUOTA', 1]]) {
    await assert.rejects(() => openaiRequest('/responses', { ...textBody, input: name }), { message: code });
    assert.equal(cases.get(name), count);
  }
  const recovered = await openaiRequest('/responses', { ...textBody, input: 'recover-429' });
  assert.equal(cases.get('recover-429'), 2);
  assert.deepEqual(recovered.serviceTier, { requested: 'fast', served: 'fast', fallback: false });
  assert(requests.filter(item => ['busy-429', 'recover-429', 'later-429', 'quota-429'].includes(item.body.input)).every(item => item.body.service_tier === 'fast'));
  await assert.rejects(()=>openaiRequest('/responses',{...textBody,input:'unsupported-twice'}),/OPENAI_unsupported_value/);assert.equal(cases.get('unsupported-twice'),2);
  await assert.rejects(()=>openaiRequest('/responses',{...textBody,input:'invalid-json'}),/OPENAI_RESPONSE_INVALID/);assert.equal(cases.get('invalid-json'),1);
  await assert.rejects(()=>openaiRequest('/responses',{...textBody,input:'timeout'},200),/OPENAI_TIMEOUT/);assert.equal(cases.get('timeout'),1);
  const image=await openaiRequest('/images/generations',imageBody);assert.deepEqual(requests.at(-1).body,imageBody);assert(!Object.hasOwn(image,'serviceTier'));assert(!Object.hasOwn(image,'service_tier'));
  assert(requests.filter(item=>isTextEndpoint(item.endpoint)).every(item=>item.body.model==='gpt-6.1-sol'));
  const {normalizeSocialDesign,socialDesignSchema}=await import(pathToFileURL(path.join(root,'server/social-design.mjs')));
  assert.deepEqual(normalizeSocialDesign({},'editorial'),{palette:'editorial',spacing:'balanced',headlineScale:'balanced',background:'solid',imagePosition:'auto',imageShare:'balanced',align:'left',panel:'plain'});
  const designed={palette:'ivory',spacing:'generous',headlineScale:'expressive',background:'glow',imagePosition:'right',imageShare:'dominant',align:'center',panel:'curved'};assert.deepEqual(normalizeSocialDesign(designed,'editorial'),designed);
  assert.deepEqual([...socialDesignSchema.required].sort(),Object.keys(designed).sort());assert.deepEqual(normalizeSocialDesign({background:'invalid',imagePosition:'invalid',panel:'invalid'},'editorial'),normalizeSocialDesign({},'editorial'));
  assert.equal(normalizeSocialDesign({palette:'constructor'},'editorial').palette,'editorial');
  console.log(JSON.stringify({passed:true,realRequestWrapperMocked:true,textFastDefault:true,standardRollback:true,requestedAndActualTierSeparated:true,unsupportedTierRetryBounded:true,temporaryCapacityRetryBounded:true,quotaErrorsNotRetried:true,imagesUnchanged:true,modelAndReasoningPreserved:true,safeMalformedProviderError:true,designControls:8,legacyDesignDefaults:true,paidApiCalls:false}));
} finally {
  process.chdir(root);mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await fs.rm(temporary,{recursive:true,force:true});
}
