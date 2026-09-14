/* eslint-disable */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProAgentService } from '../src/website/builder/pro-agent.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const pro = app.get(ProAgentService);
  const userId = process.argv[2];
  const companyId = process.argv[3];
  try {
    const res = await pro.getConversation(userId, companyId);
    console.log('OK', JSON.stringify(res).slice(0, 500));
  } catch (e) {
    console.error('ERROR:', e);
  }
  await app.close();
}
main();
