/**
 * Lightweight tracer shim. In production, replace with dd-trace.
 * Provides the same trace() API signature.
 */
const tracer = {
  trace: <T>(name: string, fn: () => T): T => {
    return fn();
  },
};

export default tracer;
