DROP INDEX `idx_status_published` ON `content`;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `status` enum('draft','published','archived') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `pdf_enabled` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `view_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `published_at` timestamp;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `content_translations` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
CREATE INDEX `idx_status_published` ON `content_translations` (`status`,`published_at`);--> statement-breakpoint
UPDATE `content_translations` t
INNER JOIN `content` c ON c.id = t.content_id
SET t.status = c.status,
    t.pdf_enabled = c.pdf_enabled,
    t.view_count = c.view_count,
    t.published_at = c.published_at,
    t.created_at = c.created_at,
    t.updated_at = c.updated_at;--> statement-breakpoint
ALTER TABLE `content` DROP COLUMN `status`;--> statement-breakpoint
ALTER TABLE `content` DROP COLUMN `pdf_enabled`;--> statement-breakpoint
ALTER TABLE `content` DROP COLUMN `view_count`;--> statement-breakpoint
ALTER TABLE `content` DROP COLUMN `published_at`;--> statement-breakpoint
ALTER TABLE `content` DROP COLUMN `updated_at`;