import { installPrivateConsole, safeLog } from './security-logging.mjs';

installPrivateConsole();
// Preserve the runtime's fail-fast behavior without printing raw fatal payloads.
process.once('uncaughtException', error => { safeLog('error', 'process.uncaught', error); process.exit(1); });
process.once('unhandledRejection', error => { safeLog('error', 'process.rejection', error); process.exit(1); });
