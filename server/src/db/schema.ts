import {
  mysqlTable,
  int,
  bigint,
  varchar,
  text,
  mediumtext,
  tinyint,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
  primaryKey
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

// ==========================================
// 1. CATEGORIES TABLE
// ==========================================
export const categories = mysqlTable('categories', {
  id: int('id').autoincrement().primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(), // 'christianity', 'islamic', 'testimonies', 'atheism', 'spiritual-teachings'
  nameEn: varchar('name_en', { length: 150 }).notNull(), // English
  nameAm: varchar('name_am', { length: 150 }), // Amharic
  nameOm: varchar('name_om', { length: 150 }), // Afan Oromo
  nameTi: varchar('name_ti', { length: 150 }), // Tigrigna
  descriptionEn: text('description_en'),
  descriptionAm: text('description_am'),
  descriptionOm: text('description_om'),
  descriptionTi: text('description_ti'),
  sortOrder: int('sort_order').default(0),
  isActive: tinyint('is_active').default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

// ==========================================
// 2. CORE CONTENT (CONTAINERS) TABLE
// ==========================================
export const content = mysqlTable('content', {
  id: int('id').autoincrement().primaryKey(),
  categoryId: int('category_id').notNull().references(() => categories.id),
  authorName: varchar('author_name', { length: 150 }),
  coverImage: varchar('cover_image', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_category').on(table.categoryId),
]);

// ==========================================
// 3. CONTENT TRANSLATIONS TABLE
// ==========================================
export const contentTranslations = mysqlTable('content_translations', {
  id: int('id').autoincrement().primaryKey(),
  contentId: int('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),
  langCode: varchar('lang_code', { length: 5 }).notNull(), // 'en', 'am', 'om', 'ti'
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  summary: text('summary'),
  body: mediumtext('body').notNull(), // Full Sanitized HTML (up to 16MB)
  bodySearchable: mediumtext('body_searchable').notNull(), // Stripped Plain Text (up to 16MB for full search indexing)
  
  // Per-Translation Lifecycle & Publishing State
  status: mysqlEnum('status', ['draft', 'published', 'archived']).default('draft').notNull(),
  pdfEnabled: tinyint('pdf_enabled').default(0).notNull(),
  viewCount: int('view_count').default(0).notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),

  // Multilingual PDF Export Path & Timestamp
  pdfFilePath: varchar('pdf_file_path', { length: 255 }),
  pdfGeneratedAt: timestamp('pdf_generated_at'),
}, (table) => [
  uniqueIndex('uniq_content_lang').on(table.contentId, table.langCode),
  uniqueIndex('uniq_slug_lang').on(table.slug, table.langCode),
  index('idx_search_title').on(table.title),
  index('idx_status_published').on(table.status, table.publishedAt),
]);

// ==========================================
// 4. SUPPLEMENTARY MEDIA TABLE
// ==========================================
export const contentMedia = mysqlTable('content_media', {
  id: int('id').autoincrement().primaryKey(),
  contentId: int('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),
  mediaKind: mysqlEnum('media_kind', ['video', 'audio']).notNull(),
  platform: varchar('platform', { length: 50 }).notNull(), // 'youtube', 'vimeo', 'soundcloud', 'self-hosted'
  embedId: varchar('embed_id', { length: 255 }).notNull(),
  caption: varchar('caption', { length: 255 }),
  sortOrder: int('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_content').on(table.contentId),
]);

// ==========================================
// 5. TAGS & CONTENT_TAGS TABLES
// ==========================================
export const tags = mysqlTable('tags', {
  id: int('id').autoincrement().primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
});

export const contentTags = mysqlTable('content_tags', {
  contentId: int('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),
  tagId: int('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.contentId, table.tagId] }),
]);

// ==========================================
// 6. ADMINS & SESSIONS TABLES (DB-Backed Auth)
// ==========================================
export const admins = mysqlTable('admins', {
  id: int('id').autoincrement().primaryKey(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 150 }),
  role: mysqlEnum('role', ['superadmin', 'editor', 'translator']).default('editor'),
  isActive: tinyint('is_active').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const adminSessions = mysqlTable('admin_sessions', {
  id: varchar('id', { length: 128 }).primaryKey(), // Cryptographically secure session token
  adminId: int('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  lastActiveAt: timestamp('last_active_at').defaultNow().onUpdateNow(),
}, (table) => [
  index('idx_session_admin').on(table.adminId),
  index('idx_session_expires').on(table.expiresAt),
]);

// ==========================================
// 7. RELATIONS
// ==========================================
export const categoriesRelations = relations(categories, ({ many }) => ({
  contents: many(content),
}));

export const contentRelations = relations(content, ({ one, many }) => ({
  category: one(categories, {
    fields: [content.categoryId],
    references: [categories.id],
  }),
  translations: many(contentTranslations),
  media: many(contentMedia),
  contentTags: many(contentTags),
}));

export const contentTranslationsRelations = relations(contentTranslations, ({ one }) => ({
  content: one(content, {
    fields: [contentTranslations.contentId],
    references: [content.id],
  }),
}));

export const contentMediaRelations = relations(contentMedia, ({ one }) => ({
  content: one(content, {
    fields: [contentMedia.contentId],
    references: [content.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contentTags: many(contentTags),
}));

export const contentTagsRelations = relations(contentTags, ({ one }) => ({
  content: one(content, {
    fields: [contentTags.contentId],
    references: [content.id],
  }),
  tag: one(tags, {
    fields: [contentTags.tagId],
    references: [tags.id],
  }),
}));

export const adminsRelations = relations(admins, ({ many }) => ({
  sessions: many(adminSessions),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  admin: one(admins, {
    fields: [adminSessions.adminId],
    references: [admins.id],
  }),
}));

// ==========================================
// 8. CONTACT MESSAGES TABLE
// ==========================================
export const contactMessages = mysqlTable(
  'contact_messages',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 200 }),
    message: text('message').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    status: mysqlEnum('status', ['new', 'read', 'replied', 'archived', 'spam']).default('new'),
    createdAt: timestamp('created_at').defaultNow(),
    readAt: timestamp('read_at'),
    repliedAt: timestamp('replied_at'),
  },
  (table) => [
    index('idx_contact_status_created').on(table.status, table.createdAt),
    index('idx_contact_email').on(table.email),
  ]
);

// ==========================================
// 9. PDF JOBS TABLE (Durable Queue)
// ==========================================
export const pdfJobs = mysqlTable(
  'pdf_jobs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    contentId: int('content_id').notNull(),
    langCode: varchar('lang_code', { length: 10 }).notNull(),
    status: mysqlEnum('status', ['queued', 'processing', 'completed', 'failed']).notNull().default('queued'),
    attempts: tinyint('attempts', { unsigned: true }).notNull().default(0),
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    leaseExpiresAt: timestamp('lease_expires_at'),
    lastError: text('last_error'),
    pdfFilePath: varchar('pdf_file_path', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_pdf_jobs_target').on(table.contentId, table.langCode),
    index('idx_pdf_jobs_status').on(table.status),
  ]
);


