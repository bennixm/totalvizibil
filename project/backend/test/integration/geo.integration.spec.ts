import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => resetDb(prisma, app));

afterAll(async () => app.close());

describe('Geo', () => {
  describe('GET /geo/counties', () => {
    it('returns 200 with data array of counties', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/geo/counties').expect(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /geo/cities', () => {
    it('returns 200 with data array', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/geo/cities').expect(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('filters by query string', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/geo/cities?q=Buc').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('name');
    });
  });

  describe('GET /geo/nearest', () => {
    it('returns nearest city for valid coordinates', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/geo/nearest?lat=44.43&lng=26.1')
        .expect(200);
      expect(res.body).toHaveProperty('name');
    });
  });

  describe('GET /geo/county-center', () => {
    it('returns county center for known county name', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/geo/county-center?name=Ilfov')
        .expect(200);
      expect(res.body).toHaveProperty('lat');
      expect(res.body).toHaveProperty('lng');
    });
  });
});
