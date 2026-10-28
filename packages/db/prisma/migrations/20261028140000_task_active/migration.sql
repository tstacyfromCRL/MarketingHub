-- Archive hides a task from the board without deleting it.
ALTER TABLE "Task" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
