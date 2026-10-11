// Loads .env.test before the NestJS app module is imported in each test worker.
require('dotenv').config({
  path: require('path').resolve(__dirname, '../../../.env.test'),
  override: true,
});
