const Sentry = require('@sentry/node');

// Sentry guarda los errores inesperados de producción para verlos con su stack.
// Sin SENTRY_DSN (local, tests) queda apagado. No mandamos datos personales
// (IP, cookies, headers) ni trazas de rendimiento: solo errores.
const initMonitoring = (env) => {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  return true;
};

const reportError = (err) => {
  Sentry.captureException(err);
};

module.exports = { initMonitoring, reportError };
