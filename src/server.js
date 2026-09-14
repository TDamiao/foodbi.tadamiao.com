import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/api.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { updateStaleCities } from './services/collectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
const publicDir = path.join(root, 'public');
const appJsPath = path.join(publicDir, 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.get('/app.js', (req, res) => {
  if (!env.cartoApiKey) {
    logger.warn('CARTO_API_KEY nao configurada; o mapa podera exibir watermark da CARTO');
    res.type('application/javascript').send(appJsSource);
    return;
  }

  const cartoTileUrl = `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(env.cartoApiKey)}`;
  const configuredAppJs = appJsSource.replace(
    /https:\/\/\{s\}\.basemaps\.cartocdn\.com\/light_all\/\{z\}\/\{x\}\/\{y\}\{r\}\.png/,
    cartoTileUrl
  );

  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(configuredAppJs);
});

app.use(express.static(publicDir));
app.use('/api', apiRouter);
app.use(notFound);
app.use(errorHandler);

if (env.dailyJobCron) {
  cron.schedule(env.dailyJobCron, async () => {
    logger.info('Iniciando job diario de atualizacao leve');
    try {
      const results = await updateStaleCities(env.maxDailyCities);
      logger.info({ count: results.length }, 'Job diario finalizado');
    } catch (error) {
      logger.error({ error }, 'Falha no job diario');
    }
  });
}

app.listen(env.port, () => {
  logger.info({ port: env.port }, 'FoodBI iniciado');
});
