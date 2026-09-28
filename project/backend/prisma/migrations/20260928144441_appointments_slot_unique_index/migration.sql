-- A canceled appointment must free its slot for someone else to book, but a
-- pending/confirmed/completed one must not double-book — a plain @@unique in
-- the Prisma schema can't express "unique only among non-canceled rows", so
-- this partial index is hand-written. Two concurrent booking requests for the
-- same (company, starts_at) now serialize on this index at the database level
-- (whichever commits second gets a real constraint-violation error, caught
-- and turned into a clean "slot_taken" response by AppointmentsService) —
-- not a read-then-write race.
CREATE UNIQUE INDEX "appointments_company_id_starts_at_active_key"
  ON "appointments" ("company_id", "starts_at")
  WHERE "status" != 'canceled';
