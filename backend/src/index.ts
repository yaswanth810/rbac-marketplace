import { buildApp } from './app.js';

const start = async (): Promise<void> => {
  const app = await buildApp();

  const port = Number(process.env['PORT'] ?? 3001);
  const host = process.env['HOST'] ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
