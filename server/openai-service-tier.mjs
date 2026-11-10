import { setTimeout as sleep } from 'node:timers/promises';

// Fast is an API service tier; it does not select a different model or reasoning level.
const TEXT_ENDPOINTS=new Set(['/responses','/chat/completions']);
const PARAMETER_REJECTIONS=new Set(['unknown_parameter','unsupported_parameter','unrecognized_parameter']);
const VALUE_REJECTIONS=new Set(['unsupported_value','invalid_value','unsupported_service_tier']);
const QUOTA_ERRORS=new Set([
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'
]);
export function isTextEndpoint(endpoint) {
  return TEXT_ENDPOINTS.has(String(endpoint).split('?')[0].replace(/\/+$/,''));
}
export function textServiceTier(env=process.env) {
  return String(env.OPENAI_TEXT_SERVICE_TIER||'fast').trim().toLowerCase()==='default'?'default':'fast';
}
export function applyTextServiceTier(endpoint,body,env=process.env) {
  return isTextEndpoint(endpoint)?{...body,service_tier:textServiceTier(env)}:body;
}
function tierRejection(status,error={}) {
  if(![400,422].includes(status))return null;
  const param=String(error?.param||'').toLowerCase(),code=String(error?.code||'').toLowerCase();
  const message=String(error?.message||'').slice(0,1500).toLowerCase();
  const identifiesTier=param==='service_tier'||(!param&&/\bservice_tier\b/.test(message));
  if(!identifiesTier)return null;
  if(PARAMETER_REJECTIONS.has(code)||/(?:unknown|unrecognized|unsupported)\s+(?:request\s+)?(?:parameter|argument)|(?:parameter|argument).{0,80}(?:not supported|not recognized)/.test(message))return 'parameter';
  if(VALUE_REJECTIONS.has(code)||/(?:not supported|does not support|unsupported|not compatible|not available|unavailable|invalid value|not permitted|not allowed)/.test(message))return 'value';
  return null;
}
export function shouldRetryStandardTier(endpoint,requestBody,status,result) {
  return isTextEndpoint(endpoint)&&requestBody?.service_tier==='fast'&&Boolean(tierRejection(status,result?.error));
}
function isQuotaError(result) {
  return QUOTA_ERRORS.has(result?.error?.code) || QUOTA_ERRORS.has(result?.error?.type);
}
function isTemporaryCapacityError(status,result) {
  const { code, type } = result?.error || {};
  if (status === 429 && !isQuotaError(result)) {
    return ['rate_limit_exceeded', 'slow_down'].includes(code) || type === 'rate_limit_error';
  }
  return status === 503 && code === 'server_is_overloaded';
}
function providerFailure(status,result) {
  if (status === 429) {
    if (isQuotaError(result)) return new Error('OPENAI_INSUFFICIENT_QUOTA');
    return new Error(isTemporaryCapacityError(status,result) ? 'OPENAI_RATE_LIMIT_EXCEEDED' : 'OPENAI_HTTP_429');
  }
  if (status === 503 && isTemporaryCapacityError(status,result)) return new Error('OPENAI_SERVER_OVERLOADED');
  const code=String(result?.error?.code||'');
  return new Error(`OPENAI_${/^[a-zA-Z0-9_-]{1,80}$/.test(code)?code:`HTTP_${status}`}`);
}
function retryDelay(response) {
  if (response.ok || !isTemporaryCapacityError(response.status, response.result)) return null;
  const header = response.retryAfter?.trim();
  const advisedDelay = !header ? NaN
    : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - Date.now();
  const delay = Number.isNaN(advisedDelay) ? 750 + Math.random() * 250 : Math.max(0, advisedDelay);
  return delay <= 8_000 ? delay : null;
}
export async function requestWithTextServiceTier(endpoint,body,send,{env=process.env,signal,retryUntil=Infinity}={}) {
  const text=isTextEndpoint(endpoint),requested=text?textServiceTier(env):null;
  const requestedBody=applyTextServiceTier(endpoint,body,env);
  let retried = false;
  async function execute(payload) {
    const response = await send(payload);
    const delay = retried ? null : retryDelay(response);
    if (delay === null || Date.now() + delay >= retryUntil) return response;
    retried = true;
    await sleep(delay, undefined, { signal });
    return send(payload);
  }
  let response=await execute(requestedBody),fallback=false;
  if(!response.ok&&shouldRetryStandardTier(endpoint,requestedBody,response.status,response.result)) {
    // A provider that does not recognize the parameter must receive no such field.
    // Otherwise explicitly request Standard, even if the project defaults to Fast.
    const standard={...requestedBody};
    if(tierRejection(response.status,response.result?.error)==='parameter')delete standard.service_tier;
    else standard.service_tier='default';
    fallback=true;response=await execute(standard);
  }
  if(!response.ok)throw providerFailure(response.status,response.result);
  if(!text)return response.result;
  return {...response.result,serviceTier:{requested,served:typeof response.result?.service_tier==='string'?response.result.service_tier:null,fallback}};
}
