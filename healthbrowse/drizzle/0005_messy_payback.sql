CREATE TABLE `hb_support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`message` text NOT NULL,
	`category` text NOT NULL,
	`sentiment` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`payload_digest` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hb_support_owner_time` ON `hb_support_requests` (`user_id`,`created_at`);