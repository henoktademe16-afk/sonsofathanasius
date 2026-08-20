import { db } from '../src/db/index.js';
import { contentTranslations } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
const rows = await db.select().from(contentTranslations).where(eq(contentTranslations.status,'draft'));
console.log('DRAFT:', JSON.stringify(rows.map(r=>({id:r.id,contentId:r.contentId,lang:r.langCode,slug:r.slug,title:r.title}))));
const pub = await db.select({contentId:contentTranslations.contentId,lang:contentTranslations.langCode,slug:contentTranslations.slug}).from(contentTranslations).where(eq(contentTranslations.status,'published'));
console.log('PUBLISHED:', JSON.stringify(pub));
process.exit(0);
