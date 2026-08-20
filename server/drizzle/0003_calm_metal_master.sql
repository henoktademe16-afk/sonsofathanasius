CREATE TABLE `pdf_jobs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`content_id` int NOT NULL,
	`lang_code` varchar(10) NOT NULL,
	`status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
	`attempts` tinyint unsigned NOT NULL DEFAULT 0,
	`version` bigint NOT NULL DEFAULT 0,
	`lease_expires_at` timestamp,
	`last_error` text,
	`pdf_file_path` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdf_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pdf_jobs_target` UNIQUE(`content_id`,`lang_code`)
);
--> statement-breakpoint
CREATE INDEX `idx_pdf_jobs_status` ON `pdf_jobs` (`status`);