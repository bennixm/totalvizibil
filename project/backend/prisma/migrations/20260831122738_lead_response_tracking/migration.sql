-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "reply_text" TEXT,
ADD COLUMN     "responded_via" TEXT;
