export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ደቂቀ አትናቴዎስ (Sons of Athanasius) — REST API',
    version: '2.0.0',
    description:
      'Official API for the Ethiopian Orthodox Tewahedo Church (EOTC) Apologetics & Digital Library platform. Features high-performance in-memory caching (LRU), Amharic homophone full-text search, multi-language content delivery (Amharic, English, Afaan Oromoo, Tigrigna), dynamic PDF generation, and rich scripture citation support.',
    contact: {
      name: 'Sons of Athanasius Engineering Team',
      url: 'https://www.sonsofathanasius.com',
      email: 'info@sonsofathanasius.org',
    },
    license: {
      name: 'Proprietary / EOTC',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000/api/v1',
      description: 'Local Development Server',
    },
    {
      url: 'https://api.sonsofathanasius.com/api/v1',
      description: 'Production Server',
    },
  ],
  tags: [
    { name: 'System', description: 'API Health, Metrics, and System Status endpoints' },
    { name: 'Taxonomy', description: 'Multilingual theological categories and tag relations' },
    { name: 'Articles', description: 'Public apologetics articles, feeds, and single reader' },
    { name: 'Spiritual', description: 'Daily lectionary, saints commemoration, and patristic readings' },
    { name: 'Search', description: 'Amharic homophone normalized in-memory full-text search' },
    { name: 'PDF', description: 'Pure JavaScript dynamic PDF export with localized Ethiopic typography' },
    { name: 'Admin', description: 'Protected content management endpoints (Session cookie required)' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health Check & Service Status',
        description: 'Returns the current operating status, API version, environment, and cache metrics.',
        responses: {
          '200': {
            description: 'System is healthy and operational',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Cache & Performance Metrics',
        description: 'Returns live LRU cache statistics (hits, misses, evictions, coalesced count, byte size) and memory usage.',
        responses: {
          '200': {
            description: 'Live performance metrics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        cache: { type: 'object' },
                        memoryUsage: { type: 'object' },
                        uptimeSeconds: { type: 'integer', example: 3600 },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/categories': {
      get: {
        tags: ['Taxonomy'],
        summary: 'List Active Categories',
        description: 'Retrieve all active categories with localized names, descriptions, and published article counts.',
        parameters: [
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Language code for localization (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
        ],
        responses: {
          '200': {
            description: 'List of localized categories',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Category' },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tags': {
      get: {
        tags: ['Taxonomy'],
        summary: 'List Active Tags',
        description: 'Retrieve all tags with published article counts, sorted by popular usage.',
        responses: {
          '200': {
            description: 'List of tags with article usage count',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Tag' },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/articles': {
      get: {
        tags: ['Articles'],
        summary: 'List Published Articles',
        description: 'Retrieve paginated published articles with optional category/tag filtering and sorting.',
        parameters: [
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Language code (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
          {
            name: 'category',
            in: 'query',
            required: false,
            description: 'Category slug filter (e.g. "christianity")',
            schema: { type: 'string' },
          },
          {
            name: 'tag',
            in: 'query',
            required: false,
            description: 'Tag slug filter (e.g. "trinity")',
            schema: { type: 'string' },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number (default: 1)',
            schema: { type: 'integer', default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Items per page (default: 12, max: 50)',
            schema: { type: 'integer', default: 12 },
          },
          {
            name: 'sort',
            in: 'query',
            required: false,
            description: 'Sort order: latest (newest first) or popular (most views)',
            schema: { type: 'string', enum: ['latest', 'popular'], default: 'latest' },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated article list',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ArticleListItem' },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/articles/latest': {
      get: {
        tags: ['Articles'],
        summary: 'Latest Articles Feed',
        description: 'Retrieve latest published articles across all categories for homepage hero/grid.',
        parameters: [
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Language code (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Maximum items to return (default: 6, max: 20)',
            schema: { type: 'integer', default: 6 },
          },
        ],
        responses: {
          '200': {
            description: 'Latest articles feed',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ArticleListItem' },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/articles/{slug}': {
      get: {
        tags: ['Articles'],
        summary: 'Get Article Detail',
        description: 'Retrieve complete article by slug or numeric ID with smart multilingual fallback, citations, media, and tag relations.',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            description: 'Article slug (in any language) or numeric ID',
            schema: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
          },
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Desired language code (falls back to Amharic if missing)',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
        ],
        responses: {
          '200': {
            description: 'Full article detail with smart fallback',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/ArticleDetail' },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Article not found or not published',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/articles/{slug}/pdf': {
      get: {
        tags: ['Articles', 'PDF'],
        summary: 'Download Article PDF',
        description: 'Streams static pre-generated A4 PDF document with Unicode NFC normalization and localized typography. Generates on-the-fly if missing.',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            description: 'Article slug',
            schema: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
          },
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Language code (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
        ],
        responses: {
          '200': {
            description: 'Binary PDF Stream',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '404': {
            description: 'Article not found or PDF export disabled',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/daily': {
      get: {
        tags: ['Spiritual'],
        summary: 'Daily Orthodox Lectionary & Patristic Reading',
        description: 'Returns saint of the day, daily scripture verse, and patristic quote with Ethiopian calendar date computation.',
        parameters: [
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Language code (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
        ],
        responses: {
          '200': {
            description: 'Daily spiritual reading and quote',
            headers: {
              'X-Cache': {
                description: 'Cache resolution status',
                schema: { type: 'string', enum: ['HIT', 'MISS', 'COALESCED', 'STALE'] },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/DailyReading' },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Full-Text In-Memory Search (Amharic Normalized)',
        description: 'Searches through published articles using MiniSearch with Ethiopic phonetic homophone normalization (ሀ↔ሐ↔ኀ, ሠ↔ሰ, ዐ↔አ, ጸ↔ፀ), prefix matching, and relevance ranking.',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description: 'Search query string (e.g. "ሥላሴ", "ክርስቶስ", "Trinity")',
            schema: { type: 'string', example: 'ሥላሴ' },
          },
          {
            name: 'lang',
            in: 'query',
            required: false,
            description: 'Content language filter (default: "am")',
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'], default: 'am' },
          },
          {
            name: 'category',
            in: 'query',
            required: false,
            description: 'Optional category slug filter',
            schema: { type: 'string', example: 'christianity' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Maximum number of results to return (default: 20)',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        ],
        responses: {
          '200': {
            description: 'Matching search results ordered by relevance score',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SearchResultItem' },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/auth/login': {
      post: {
        tags: ['Admin'],
        summary: 'Admin Login',
        description: 'Authenticates administrator via username/email and password. Sets an httpOnly, host-only secure cookie (soa_admin_session) scoped to /api/v1/admin.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: {
                    type: 'string',
                    description: 'Admin username or registered email address',
                    example: 'admin',
                  },
                  password: {
                    type: 'string',
                    format: 'password',
                    description: 'Admin password',
                    example: 'AdminSecretPass123!',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful. Returns admin profile and issues soa_admin_session cookie.',
            headers: {
              'Set-Cookie': {
                schema: {
                  type: 'string',
                  example: 'soa_admin_session=abc123...; Path=/api/v1/admin; HttpOnly; SameSite=Strict',
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        admin: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer', example: 1 },
                            username: { type: 'string', example: 'admin' },
                            email: { type: 'string', example: 'admin@sonsofathanasius.com' },
                            fullName: { type: 'string', example: 'Admin User' },
                            role: { type: 'string', enum: ['superadmin', 'editor', 'translator'], example: 'superadmin' },
                          },
                        },
                      },
                    },
                    message: { type: 'string', example: 'Login successful' },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Invalid credentials or deactivated account',
          },
          '429': {
            description: 'Too many login attempts from this IP (rate limit: 5/15m)',
          },
        },
      },
    },
    '/admin/auth/logout': {
      post: {
        tags: ['Admin'],
        summary: 'Admin Logout',
        description: 'Terminates current session in MariaDB, evicts in-memory cache, and clears the session cookie.',
        security: [{ SessionAuth: [] }],
        responses: {
          '200': {
            description: 'Logged out successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'null', example: null },
                    message: { type: 'string', example: 'Logged out successfully' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/auth/me': {
      get: {
        tags: ['Admin'],
        summary: 'Get Authenticated Admin Profile',
        description: 'Returns the current authenticated admin user and permissions from the active session.',
        security: [{ SessionAuth: [] }],
        responses: {
          '200': {
            description: 'Current admin profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        admin: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer', example: 1 },
                            username: { type: 'string', example: 'admin' },
                            email: { type: 'string', example: 'admin@sonsofathanasius.com' },
                            fullName: { type: 'string', example: 'Admin User' },
                            role: { type: 'string', enum: ['superadmin', 'editor', 'translator'], example: 'superadmin' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized or expired session',
          },
        },
      },
    },
    '/admin/auth/logout-all': {
      post: {
        tags: ['Admin'],
        summary: 'Revoke All Admin Sessions',
        description: 'Remote kill-switch: Deletes all active sessions across all devices for the current admin.',
        security: [{ SessionAuth: [] }],
        responses: {
          '200': {
            description: 'All sessions terminated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'null', example: null },
                    message: { type: 'string', example: 'All sessions terminated successfully' },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
          },
        },
      },
    },
    '/admin/covers/upload': {
      post: {
        tags: ['Admin'],
        summary: 'Upload Article Cover Image',
        description: 'Uploads and stores a WebP or JPEG cover image with server-side magic byte validation (≤500KB).',
        security: [{ SessionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  cover: {
                    type: 'string',
                    format: 'binary',
                    description: 'WebP or JPEG image file (max 500KB)',
                  },
                },
                required: ['cover'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Cover image uploaded and verified successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        coverUrl: { type: 'string', example: '/uploads/covers/cover_1723901234_a1b2c3d4.webp' },
                        filename: { type: 'string', example: 'cover_1723901234_a1b2c3d4.webp' },
                        sizeBytes: { type: 'integer', example: 142050 },
                        format: { type: 'string', example: 'webp' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid image format or file size exceeded' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin or Editor role)' },
        },
      },
    },
    '/admin/articles': {
      post: {
        tags: ['Admin'],
        summary: 'Create Article (Atomic)',
        description: 'Atomically creates master article container, multilingual translations, media, and tag relationships in a single transaction with eager PDF pre-generation and cache invalidation.',
        security: [{ SessionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['categoryId', 'translations'],
                properties: {
                  categoryId: { type: 'integer', example: 1 },
                  authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
                  coverImage: { type: 'string', example: '/uploads/covers/cover_sample.webp' },
                  tagIds: { type: 'array', items: { type: 'integer' }, example: [1, 2] },
                  media: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['mediaKind', 'platform', 'embedId'],
                      properties: {
                        mediaKind: { type: 'string', enum: ['video', 'audio'] },
                        platform: { type: 'string', example: 'youtube' },
                        embedId: { type: 'string', example: 'dQw4w9WgXcQ' },
                        caption: { type: 'string', example: 'Theological discourse video' },
                        sortOrder: { type: 'integer', default: 0 },
                      },
                    },
                  },
                  translations: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['langCode', 'title', 'body'],
                      properties: {
                        langCode: { type: 'string', enum: ['am', 'en', 'om', 'ti'], example: 'am' },
                        title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት' },
                        slug: { type: 'string', example: 'deity-of-jesus-christ' },
                        summary: { type: 'string', example: 'ጥናታዊ የዕቅበተ እምነት ጽሑፍ።' },
                        body: { type: 'string', example: '<p>የጌታችን አምላክነት...</p>' },
                        status: { type: 'string', enum: ['draft', 'published', 'archived'], default: 'draft' },
                        pdfEnabled: { type: 'integer', enum: [0, 1], default: 0 },
                        publishedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Article created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer', example: 42 },
                        categoryId: { type: 'integer', example: 1 },
                        authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
                        coverImage: { type: 'string', example: '/uploads/covers/cover_sample.webp' },
                        translations: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'integer', example: 88 },
                              contentId: { type: 'integer', example: 42 },
                              langCode: { type: 'string', example: 'am' },
                              title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት' },
                              slug: { type: 'string', example: 'deity-of-jesus-christ' },
                              status: { type: 'string', example: 'published' },
                              pdfEnabled: { type: 'integer', example: 1 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid payload or schema validation error' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin or Editor role)' },
        },
      },
    },
    '/admin/articles/{id}': {
      put: {
        tags: ['Admin'],
        summary: 'Update Article',
        description: 'Updates article metadata, attached tags, media, and multilingual translations with full-replace semantics.',
        security: [{ SessionAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Parent article numeric ID',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  categoryId: { type: 'integer', example: 1 },
                  authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
                  coverImage: { type: 'string', example: '/uploads/covers/cover_sample.webp' },
                  tagIds: { type: 'array', items: { type: 'integer' } },
                  media: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['mediaKind', 'platform', 'embedId'],
                      properties: {
                        mediaKind: { type: 'string', enum: ['video', 'audio'] },
                        platform: { type: 'string', example: 'youtube' },
                        embedId: { type: 'string', example: 'dQw4w9WgXcQ' },
                        caption: { type: 'string' },
                        sortOrder: { type: 'integer' },
                      },
                    },
                  },
                  translations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['langCode', 'title', 'body'],
                      properties: {
                        langCode: { type: 'string', enum: ['am', 'en', 'om', 'ti'] },
                        title: { type: 'string' },
                        slug: { type: 'string' },
                        summary: { type: 'string' },
                        body: { type: 'string' },
                        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
                        pdfEnabled: { type: 'integer', enum: [0, 1] },
                        publishedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Article updated successfully' },
          '400': { description: 'Invalid payload' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin or Editor role)' },
          '404': { description: 'Article not found' },
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Delete Article Container',
        description: 'Permanently deletes article container and cascades all translations, media, tags, and static PDFs on disk.',
        security: [{ SessionAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Article numeric ID',
          },
        ],
        responses: {
          '200': { description: 'Article deleted successfully' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin role)' },
          '404': { description: 'Article not found' },
        },
      },
    },
    '/admin/articles/{id}/translations': {
      post: {
        tags: ['Admin'],
        summary: 'Upsert Article Translation',
        description: 'Adds or updates a translation for an existing article container. Automatically triggers cache eviction and eager PDF generation.',
        security: [{ SessionAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Parent article numeric ID',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['langCode', 'title', 'body'],
                properties: {
                  langCode: { type: 'string', enum: ['am', 'en', 'om', 'ti'], example: 'ti' },
                  title: { type: 'string', example: 'መለኮትነት ኢየሱስ ክርስቶስ' },
                  slug: { type: 'string', example: 'deity-of-christ-tigrigna' },
                  summary: { type: 'string', example: 'ትምህርቲ ተዋህዶ ብትግርኛ' },
                  body: { type: 'string', example: '<p>ትምህርቲ ብዛዕባ ጎይታና...</p>' },
                  status: { type: 'string', enum: ['draft', 'published', 'archived'], default: 'draft' },
                  pdfEnabled: { type: 'integer', enum: [0, 1], default: 0 },
                  publishedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Translation updated successfully' },
          '201': { description: 'Translation created successfully' },
          '400': { description: 'Invalid payload' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin, Editor, or Translator role)' },
          '404': { description: 'Parent article not found' },
        },
      },
    },
    '/admin/articles/{id}/translations/{langCode}': {
      delete: {
        tags: ['Admin'],
        summary: 'Delete Article Translation',
        description: 'Deletes a specific translation language row and cleans up its static PDFs on disk.',
        security: [{ SessionAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Parent article numeric ID',
          },
          {
            name: 'langCode',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['am', 'en', 'om', 'ti'] },
            description: 'Translation language code',
          },
        ],
        responses: {
          '200': { description: 'Translation deleted successfully' },
          '400': { description: 'Invalid article ID or language code' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (Requires Superadmin or Editor role)' },
          '404': { description: 'Translation not found' },
        },
      },
    },
    '/contact': {
      post: {
        tags: ['Contact'],
        summary: 'Submit Contact Message',
        description: 'Submits a contact or inquiry message from a user. Highly rate-limited.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ContactForm' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Message received successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        message: { type: 'string', example: 'Message received successfully.' },
                      },
                    },
                    meta: { $ref: '#/components/schemas/ResponseMeta' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid form payload (Zod validation error)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      SessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'soa_admin_session',
        description: 'Host-only, httpOnly secure session cookie scoped to /api/v1/admin.',
      },
    },
    schemas: {
      ResponseMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 12 },
          total: { type: 'integer', example: 45 },
          totalPages: { type: 'integer', example: 4 },
          hasNext: { type: 'boolean', example: true },
          hasPrev: { type: 'boolean', example: false },
          lang: { type: 'string', example: 'am' },
          timestamp: { type: 'string', format: 'date-time', example: '2026-08-18T06:30:00.000Z' },
        },
        required: ['timestamp'],
      },
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
        required: ['success'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Validation failed or resource not found.' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
        required: ['success', 'error'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              app: { type: 'string', example: 'Sons of Athanasius API' },
              version: { type: 'string', example: '2.0.0' },
              status: { type: 'string', example: 'healthy' },
              environment: { type: 'string', example: 'development' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      ContactForm: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', example: 'john.doe@example.com' },
          subject: { type: 'string', example: 'Question about theology' },
          message: { type: 'string', example: 'I would like to ask about the trinity.' },
          website: { type: 'string', example: '', description: 'Anti-spam honeypot field (must be left empty)' },
        },
        required: ['name', 'email', 'message'],
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          slug: { type: 'string', example: 'christianity' },
          name: { type: 'string', example: 'በእንተ ክርስትና' },
          description: { type: 'string', example: 'የኦርቶዶክሳዊት ተዋሕዶ እምነት አስተምህሮ።' },
          sortOrder: { type: 'integer', example: 1 },
          articleCount: { type: 'integer', example: 18 },
        },
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          slug: { type: 'string', example: 'trinity' },
          name: { type: 'string', example: 'ሥላሴ' },
          articleCount: { type: 'integer', example: 5 },
        },
      },
      ContentMedia: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          mediaKind: { type: 'string', enum: ['video', 'audio'], example: 'video' },
          platform: { type: 'string', enum: ['youtube', 'vimeo', 'soundcloud', 'self-hosted'], example: 'youtube' },
          embedId: { type: 'string', example: 'dQw4w9WgXcQ' },
          caption: { type: 'string', example: 'Theological video explanation' },
        },
      },
      ArticleListItem: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 88, description: 'Translation unique ID' },
          contentId: { type: 'integer', example: 1, description: 'Parent article container ID' },
          slug: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
          title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት በቅዱሳት መጻሕፍት ብርሃን' },
          summary: { type: 'string', example: 'ጥናታዊ የዕቅበተ እምነት ማብራሪያ።' },
          authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
          coverImage: { type: 'string', example: 'https://images.unsplash.com/photo-1548625361-195fe578ae5a' },
          pdfEnabled: { type: 'integer', example: 1 },
          viewCount: { type: 'integer', example: 342 },
          publishedAt: { type: 'string', format: 'date-time' },
          langCode: { type: 'string', example: 'am' },
          isFallback: { type: 'boolean', example: false },
          category: {
            type: 'object',
            properties: {
              id: { type: 'integer', example: 1 },
              slug: { type: 'string', example: 'christianity' },
              name: { type: 'string', example: 'በእንተ ክርስትና' },
            },
          },
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer', example: 1 },
                slug: { type: 'string', example: 'trinity' },
                name: { type: 'string', example: 'ሥላሴ' },
              },
            },
          },
        },
      },
      ArticleDetail: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 88, description: 'Translation unique ID' },
          contentId: { type: 'integer', example: 1, description: 'Parent article container ID' },
          categoryId: { type: 'integer', example: 1 },
          category: {
            type: 'object',
            properties: {
              id: { type: 'integer', example: 1 },
              slug: { type: 'string', example: 'christianity' },
              name: { type: 'string', example: 'በእንተ ክርስትና' },
            },
          },
          authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
          coverImage: { type: 'string', example: 'https://images.unsplash.com/photo-1548625361-195fe578ae5a' },
          pdfEnabled: { type: 'integer', example: 1 },
          viewCount: { type: 'integer', example: 342 },
          publishedAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት በቅዱሳት መጻሕፍት ብርሃን' },
          slug: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
          summary: { type: 'string', example: 'ጥናታዊ የዕቅበተ እምነት ማብራሪያ።' },
          body: { type: 'string', example: '<p>የጌታችንና የመድኃኒታችን የኢየሱስ ክርስቶስ ፍጹም አምላክነት... <span data-ref="ዮሐ 1:1" class="scripture-citation">[ዮሐ 1:1]</span></p>' },
          pdfFilePath: { type: 'string', example: '/uploads/pdf/article_1_1723901234_am.pdf' },
          langCode: { type: 'string', example: 'am' },
          isFallback: { type: 'boolean', example: false },
          fallbackFrom: { type: 'string', example: 'ti' },
          citations: {
            type: 'array',
            items: { type: 'string' },
            example: ['ዮሐ 1:1', 'ዮሐ 10:30'],
          },
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer', example: 1 },
                slug: { type: 'string', example: 'trinity' },
                name: { type: 'string', example: 'ሥላሴ' },
              },
            },
          },
          media: {
            type: 'array',
            items: { $ref: '#/components/schemas/ContentMedia' },
          },
          availableTranslations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer', example: 88 },
                langCode: { type: 'string', example: 'am' },
                slug: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
                title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት...' },
              },
            },
          },
        },
      },
      DailyReading: {
        type: 'object',
        properties: {
          date: { type: 'string', example: '2026-08-18' },
          dayOfYear: { type: 'integer', example: 230 },
          ethiopianDate: { type: 'string', example: 'ነሐሴ 12 2018' },
          langCode: { type: 'string', example: 'am' },
          saintOfTheDay: { type: 'string', example: 'ቅዱስ አትናቴዎስ ሐዋርያዊ' },
          scriptureReading: {
            type: 'object',
            properties: {
              reference: { type: 'string', example: 'ዮሐ 1:1-5' },
              text: { type: 'string', example: 'በመጀመሪያ ቃል ነበረ...' },
            },
          },
          patristicQuote: {
            type: 'object',
            properties: {
              author: { type: 'string', example: 'ቅዱስ አትናቴዎስ' },
              source: { type: 'string', example: 'ነገረ ሥጋዌ' },
              quote: { type: 'string', example: 'እኛ አማልክት እንሆን ዘንድ እርሱ ሰው ሆነ።' },
            },
          },
        },
      },
      SearchResultItem: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          contentId: { type: 'integer', example: 1 },
          title: { type: 'string', example: 'የኢየሱስ ክርስቶስ አምላክነት በቅዱሳት መጻሕፍት ብርሃን' },
          slug: { type: 'string', example: 'deity-of-jesus-christ-scripture' },
          summary: { type: 'string', example: 'ጥናታዊ የዕቅበተ እምነት ማብራሪያ።' },
          coverImage: { type: 'string', example: 'https://images.unsplash.com/photo-1548625361-195fe578ae5a' },
          authorName: { type: 'string', example: 'ዘአትናቴዎስ' },
          categorySlug: { type: 'string', example: 'christianity' },
          categoryName: { type: 'string', example: 'በእንተ ክርስትና' },
          langCode: { type: 'string', example: 'am' },
          publishedAt: { type: 'string', format: 'date-time' },
          score: { type: 'number', example: 12.45 },
          match: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
            example: { 'ስላሴ': ['title', 'bodySearchable'] },
          },
        },
      },
    },
  },
};
