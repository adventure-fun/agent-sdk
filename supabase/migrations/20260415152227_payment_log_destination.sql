-- Add destination column to payment_log so withdraw rows can record where
-- the funds went. Existing in-game payment rows leave this null.
ALTER TABLE payment_log ADD COLUMN destination TEXT;
