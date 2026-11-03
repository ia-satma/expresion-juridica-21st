import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'AggregateError', 'SqliteError']);
const codes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENOENT', 'EACCES', 'EPERM', 'SQLITE_BUSY', 'SQLITE_ERROR',
  'AUTH_REQUIRED', 'CSRF_INVALID', 'ORIGIN_NOT_ALLOWED', 'ROLE_REQUIRED', 'OWNER_REQUIRED', 'PASSWORD_CHANGE_REQUIRED',
  'MEDIA_TYPE_NOT_ALLOWED', 'LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'INVALID_REQUEST', 'CONTACT_FIELDS_INVALID',
  'PRESENTATION_INPUT_INVALID', 'PRESENTATION_FILES_TOO_LARGE', 'PRESENTATION_GENERATION_FAILED', 'PRESENTATION_FILE_NOT_FOUND',
  'OPENAI_TIMEOUT', 'OPENAI_OUTPUT_INCOMPLETE', 'OPENAI_SLIDE_COUNT_INVALID', 'OPENAI_INVALID_API_KEY', 'OPENAI_INSUFFICIENT_QUOTA',
  'OPENAI_RATE_LIMIT_EXCEEDED', 'OPENAI_MODEL_NOT_FOUND', 'OPENAI_HTTP_400', 'OPENAI_HTTP_401', 'OPENAI_HTTP_403', 'OPENAI_HTTP_429', 'OPENAI_HTTP_500', 'OPENAI_HTTP_502', 'OPENAI_HTTP_503',
  'POST_GENERATION_FAILED', 'POST_JOB_ACTIVE', 'POST_JOB_INTERRUPTED', 'POST_JOB_NOT_FOUND', 'POST_NOT_FOUND', 'POST_VERSION_CHANGED', 'POST_COUNT_INVALID', 'POST_SIZE_INVALID',
  'POST_TEXT_LIMIT', 'POST_PIECE_INVALID', 'POST_RENDER_PENDING', 'OPENAI_REVIEW_INVALID',
  'DOCUMENT_GENERATION_FAILED', 'DOCUMENT_JOB_NOT_FOUND', 'DOCUMENT_INPUT_INVALID', 'DOCUMENT_VERSION_CHANGED', 'DOCUMENT_NOT_FOUND', 'DOCUMENT_FILE_NOT_FOUND',
  'STUDIO_JOB_ACTIVE', 'STUDIO_JOB_INTERRUPTED', 'STUDIO_STORAGE_UNAVAILABLE', 'STUDIO_STATE_KEY_INVALID',
  'APP_STORAGE_ERROR', 'APP_STORAGE_UNAVAILABLE', 'APP_STORAGE_NOT_CONFIGURED', 'APP_STORAGE_NOT_FOUND', 'INTERNAL_ERROR'
]);
const writers = Object.fromEntries(['error', 'warn', 'info', 'log', 'debug'].map(level => [level, console[level].bind(console)]));
let installed = false;

export function safeErrorCode(error, fallback = 'INTERNAL_ERROR') {
  const candidate = typeof error === 'string' ? error : error?.code || error?.message;
  if (codes.has(candidate)) return candidate;
  if (typeof candidate === 'string') {
    const provider = candidate.toUpperCase();
    if (codes.has(provider)) return provider;
  }
  return codes.has(fallback) ? fallback : 'INTERNAL_ERROR';
}

export function withLogContext(requestId, action) { return context.run({ requestId }, action); }
export function requestReference() { return context.getStore()?.requestId; }

// Logs deliberately exclude free-form messages, stacks, requests, credentials,
// user identifiers, filenames and payloads, including those produced by SDKs.
export function safeLog(level, event, error) {
  const severity = ['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
  const identifier = /^[a-z][a-z0-9.-]{1,70}$/.test(event) ? event : 'application.event';
  const record = { at: new Date().toISOString(), level: severity, event: identifier };
  if (requestReference()) record.requestId = requestReference();
  if (error !== undefined) {
    record.code = safeErrorCode(error);
    record.errorType = errorNames.has(error?.name) ? error.name : 'ApplicationError';
  }
  writers[severity](JSON.stringify(record));
}

export function installPrivateConsole() {
  if (installed) return;
  installed = true;
  const groups = new Map([['cms', 'cms'], ['cms-auth', 'auth'], ['cms-storage', 'storage'], ['social-agent', 'social'], ['social-job-state', 'social'], ['social-heartbeat', 'social'], ['presentation-agent', 'presentation'], ['documents-agent', 'document'], ['studio-job-state', 'studio'], ['studio-heartbeat', 'studio']]);
  for (const level of ['error', 'warn', 'info', 'log', 'debug', 'trace', 'dir', 'table']) {
    console[level] = (...args) => {
      const label = typeof args[0] === 'string' ? args[0].match(/^\[([a-z-]+)\]/)?.[1] : '';
      const error = args.find(value => value instanceof Error);
      safeLog(['error', 'warn', 'debug'].includes(level) ? level : 'info', `legacy.${groups.get(label) || 'application'}`, error);
    };
  }
  console.assert = (condition) => { if (!condition) safeLog('error', 'legacy.assertion'); };
}

export function publicFailure(error, fallback = 'INTERNAL_ERROR') {
  const code = safeErrorCode(error, fallback);
  let detail = 'No se pudo completar la operación. Inténtalo de nuevo.';
  if (code === 'AUTH_REQUIRED') detail = 'Inicia sesión para continuar.';
  else if (['ROLE_REQUIRED','OWNER_REQUIRED'].includes(code)) detail = 'Tu cuenta no tiene permiso para realizar esta acción.';
  else if (code === 'CSRF_INVALID') detail = 'Actualiza el apartado y vuelve a guardar.';
  else if (code === 'ORIGIN_NOT_ALLOWED') detail = 'Abre el CMS desde la dirección oficial del sitio.';
  else if (/VERSION_CHANGED$/.test(code)) detail = 'El contenido cambió en otra edición. Abre la versión más reciente.';
  else if (/JOB_ACTIVE$/.test(code)) detail = 'Ya hay una generación en curso. Espera a que termine.';
  else if (/JOB_INTERRUPTED$/.test(code)) detail = 'La generación se interrumpió. Puedes volver a intentarlo.';
  else if (code === 'MEDIA_TYPE_NOT_ALLOWED') detail = 'Elige una imagen, video, audio, PDF o fuente con un formato permitido.';
  else if (code === 'LIMIT_FILE_SIZE' || code === 'PRESENTATION_FILES_TOO_LARGE') detail = 'Los archivos superan el tamaño permitido. Reduce la selección.';
  else if (/INPUT_INVALID$|COUNT_INVALID$|SIZE_INVALID$|UNEXPECTED_FILE$|FILE_COUNT$/.test(code)) detail = 'Revisa el texto y los formatos y tamaños de los archivos seleccionados.';
  else if (code === 'POST_TEXT_LIMIT') detail = 'El texto supera la capacidad del campo. Conserva el detalle en el copy; tu edición anterior sigue guardada.';
  else if (code === 'POST_PIECE_INVALID') detail = 'Selecciona una pieza disponible del diseño.';
  else if (code === 'POST_RENDER_PENDING') detail = 'El texto está guardado. Ajusta o revisa el diseño antes de descargar esta revisión.';
  else if (/OPENAI_(INVALID_API_KEY|HTTP_401|HTTP_403)$/.test(code)) detail = 'El proveedor de IA rechazó las credenciales configuradas en el servidor.';
  else if (/OPENAI_(INSUFFICIENT_QUOTA|RATE_LIMIT_EXCEEDED|HTTP_429)$/.test(code)) detail = 'El proveedor de IA alcanzó su límite de uso o saldo disponible.';
  else if (code === 'OPENAI_TIMEOUT') detail = 'La generación tardó más de lo previsto. Vuelve a intentarlo.';
  else if (code.startsWith('APP_STORAGE_') || code === 'STUDIO_STORAGE_UNAVAILABLE') detail = 'El almacenamiento no está disponible. Vuelve a intentarlo en unos momentos.';
  return { error: code, detail, ...(requestReference() ? { requestId: requestReference() } : {}) };
}

export const privateAuthLogger = {
  level: 'warn', disableColors: true,
  log(level, _message, ...args) { safeLog(level, 'auth.provider', args.find(value => value instanceof Error)); }
};
