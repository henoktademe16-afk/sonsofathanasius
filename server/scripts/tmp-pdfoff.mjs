import { db } from '../src/db/index.js';
import { contentTranslations } from '../src/db/schema.js';
const before = await db.select({id:contentTranslations.id,contentId:contentTranslations.contentId,langCode:contentTranslations.langCode,pdfEnabled:contentTranslations.pdfEnabled}).from(contentTranslations);
console.log('BEFORE:', JSON.stringify(before));
await db.update(contentTranslations).set({pdfEnabled: 0});
console.log('ALL SET TO 0');
process.exit(0);
