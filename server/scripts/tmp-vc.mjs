import { db } from '../src/db/index.js';
import { contentTranslations } from '../src/db/schema.js';
import { inArray } from 'drizzle-orm';
const rows = await db.select({id:contentTranslations.id,lang:contentTranslations.langCode,viewCount:contentTranslations.viewCount}).from(contentTranslations).where(inArray(contentTranslations.id,[66,67]));
console.log('view counts:', JSON.stringify(rows));
process.exit(0);
