// Worker logs: one JSON line per record on stdout, and (when OTEL_EXPORTER_OTLP_ENDPOINT is set) batched to the
// OpenTelemetry collector over OTLP/HTTP JSON, which stores them in ClickHouse next to the gateway's
// (docs/architecture/architecture-v2.md section 10). No SDK: the log record shape is all the workers need.

export type Level = 'info' | 'warn' | 'error';

const SEVERITY: Record<Level, number> = { info: 9, warn: 13, error: 17 };

interface Rec {
  t: number;
  level: Level;
  msg: string;
  attrs: Record<string, unknown>;
}

function attr(key: string, v: unknown) {
  const value =
    typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: typeof v === 'string' ? v : JSON.stringify(v) };
  return { key, value };
}

export function createLogger(service: string, build: string) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '');
  const queue: Rec[] = [];
  let dropped = 0;

  const flush = async (): Promise<void> => {
    if (!endpoint || !queue.length) return;
    const batch = queue.splice(0, 500);
    const body = {
      resourceLogs: [
        {
          resource: { attributes: [attr('service.name', service), attr('service.version', build)] },
          scopeLogs: [
            {
              scope: { name: service },
              logRecords: batch.map((r) => ({
                timeUnixNano: String(BigInt(r.t) * 1_000_000n),
                severityNumber: SEVERITY[r.level],
                severityText: r.level.toUpperCase(),
                body: { stringValue: r.msg },
                attributes: Object.entries(r.attrs).map(([k, v]) => attr(k, v)),
              })),
            },
          ],
        },
      ],
    };
    try {
      await fetch(`${endpoint}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    } catch {
      dropped += batch.length; // the collector is down: stdout still has them
    }
  };

  const timer = endpoint ? setInterval(() => void flush(), 2000) : null;
  timer?.unref();

  const log = (msg: string, extra: Record<string, unknown> = {}, level: Level = 'info'): void => {
    console.log(JSON.stringify({ t: new Date().toISOString(), level, service, msg, ...extra }));
    if (!endpoint) return;
    if (queue.length >= 5000) {
      queue.shift();
      dropped++;
    }
    queue.push({ t: Date.now(), level, msg, attrs: extra });
  };
  return { log, flush, dropped: () => dropped };
}
