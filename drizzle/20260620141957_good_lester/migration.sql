CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
