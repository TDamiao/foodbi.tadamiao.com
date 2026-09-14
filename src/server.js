import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import cron from 'node-cron';
import axios from 'axios';
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
  const configuredAppJs = appJsSource.replace(
    /https:\/\/\{s\}\.basemaps\.cartocdn\.com\/light_all\/\{z\}\/\{x\}\/\{y\}\{r\}\.png/,
    '/map-tiles/{z}/{x}/{y}.png'
  );

  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(configuredAppJs);
});

app.get('/map-tiles/:z/:x/:y.png', async (req, res, next) => {
  try {
    if (!env.cartoApiKey) {
      res.status(503).json({ error: 'CARTO_API_KEY nao configurada.' });
      return;
    }

    const { z, x, y } = req.params;
    if (![z, x, y].every((value) => /^\d+$/.test(value))) {
      res.status(400).json({ error: 'Coordenadas de tile invalidas.' });
      return;
    }

    const tileUrl = `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
    const response = await axios.get(tileUrl, {
      params: { key: env.cartoApiKey },
      responseType: 'arraybuffer',
      timeout: 12000,
      headers: {
        Referer: 'https://foodbi.tadamiao.com/',
        'User-Agent': 'FoodBI/1.0'
      },
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      logger.warn({ status: response.status, z, x, y }, 'CARTO recusou tile do mapa');
      res.status(response.status).send(Buffer.from(response.data));
      return;
    }

    res.set('Content-Type', response.headers['content-type'] || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.send(Buffer.from(response.data));
  } catch (error) {
    next(error);
  }
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
