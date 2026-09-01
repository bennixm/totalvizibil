-- Delete requests are deferred: pause now, purge after a grace window, cancellable until then.
ALTER TABLE "campaigns" ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);
