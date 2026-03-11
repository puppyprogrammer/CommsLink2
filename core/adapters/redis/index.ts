import IORedis from 'ioredis';

let connection: IORedis | null = null;

const getConnection = (): IORedis => {
  if (!connection) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
};

export default { getConnection };
