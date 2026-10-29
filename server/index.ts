/**
 * Only Ads API server entry point.
 *   npm run server          (development: seeds demo data on first run)
 * Environment variables: see server/README.md.
 */
import { createServer } from 'node:http';

import { createHandler, loadServerConfig, purgeExpiredData } from './app';
import { migrate, openDb } from './db';
import { ingestAll } from './ingest';
import { log } from './log';
import { seedDemo } from './seed';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? 'server/onlyads.dev.db';
const INGEST_INTERVAL_MIN = Number(process.env.INGEST_INTERVAL_MIN ?? 60);

const cfg = loadServerConfig();
if (cfg.env === 'production' && DB_PATH.includes('.dev.')) {
  log('error', 'refusing to use a development database in production; set DB_PATH');
  process.exit(1);
}
const db = openDb(DB_PATH);
const applied = migrate(db);
if (applied.length) log('info', 'migrations applied', { applied });

if (cfg.env === 'development' && process.env.SEED_DEMO !== '0') seedDemo(db);

const server = createServer(createHandler(db, cfg));
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

let ingesting = false;
async function runIngestion() {
  if (ingesting) return; // never overlap runs
  ingesting = true;
  try {
    await ingestAll(db);
    const purged = purgeExpiredData(db);
    if (purged.clickEvents || purged.aggregates) log('info', 'retention purge', purged);
  } catch (e) {
    log('error', 'ingestion crashed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    ingesting = false;
  }
}

server.listen(PORT, () => {
  log('info', 'listening', { port: PORT, env: cfg.env, includeDemo: cfg.includeDemo });
  runIngestion();
});
const timer = setInterval(runIngestion, INGEST_INTERVAL_MIN * 60_000);

function shutdown(signal: string) {
  log('info', 'shutting down', { signal });
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
