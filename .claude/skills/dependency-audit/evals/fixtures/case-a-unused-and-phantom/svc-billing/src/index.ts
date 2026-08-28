import Fastify from 'fastify';
import dayjs from 'dayjs';
// `nanoid` is used here but never declared in package.json.
import { nanoid } from 'nanoid';
import { buildLogger } from './logger.js';

const app = Fastify({ logger: false });
const log = buildLogger();

app.post('/invoices', async (req) => {
  const id = nanoid();
  log.info({ id }, 'invoice created');
  return { id, issued_at: dayjs().toISOString() };
});

export default app;
