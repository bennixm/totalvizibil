-- Website Builder publish pipeline: a static bundle (built dist/ output) that
-- the public company page can serve directly, since Website Builder's real
-- Vue/Vite project only otherwise runs live inside the browser's WebContainer.

ALTER TABLE "websites" ADD COLUMN "published_at" TIMESTAMP(3);

CREATE TABLE "website_bundle_files" (
    "id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_bundle_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "website_bundle_files_website_id_path_key" ON "website_bundle_files"("website_id", "path");

ALTER TABLE "website_bundle_files" ADD CONSTRAINT "website_bundle_files_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
