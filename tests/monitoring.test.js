// Sentry recibe solo los errores inesperados (500) de producción, sin datos personales.
// Sin SENTRY_DSN (local, tests) no se inicia nada.
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
const Sentry = require('@sentry/node');
const { initMonitoring, reportError } = require('../services/monitoring');
const errorHandler = require('../middleware/errorHandler');

const fakeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('monitoring', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not start Sentry without a DSN', () => {
    expect(initMonitoring({ NODE_ENV: 'production' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('starts Sentry with the DSN, the environment and no personal data', () => {
    expect(initMonitoring({ SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1', NODE_ENV: 'production' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'production',
        sendDefaultPii: false,
      }),
    );
  });

  it('reportError sends the error to Sentry', () => {
    const err = new Error('boom');
    reportError(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('the error handler reports unexpected 500s', () => {
    const err = new Error('db exploded');
    errorHandler(err, {}, fakeRes(), jest.fn());
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('the error handler does not report client errors (4xx)', () => {
    const err = Object.assign(new Error('nope'), { statusCode: 404, code: 'NOT_FOUND' });
    errorHandler(err, {}, fakeRes(), jest.fn());
    const invalid = Object.assign(new Error('bad'), { name: 'CastError', value: 'x' });
    errorHandler(invalid, {}, fakeRes(), jest.fn());
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
