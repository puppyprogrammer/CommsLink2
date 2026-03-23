import createServer from './server';
import { init as initFFXIVoicesWs } from './ffxivWs';

const start = async (): Promise<void> => {
  const server = await createServer();

  await server.start();
  console.log(`Server running on ${server.info.uri}`);

  initFFXIVoicesWs();
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
