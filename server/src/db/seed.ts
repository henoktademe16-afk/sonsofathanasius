import { db, poolConnection } from './index.js';
import { categories, tags, content, contentTranslations, admins } from './schema.js';
import { eq } from 'drizzle-orm';
import { processArticleContent } from '../services/sanitizerService.js';
import { hashPassword } from '../utils/crypto.js';

async function seed() {
  console.log('🌱 [Seed] Starting database seeding for Sons of Athanasius...');

  console.log('🌱 [Seed] Seeding 5 Core Categories...');
  const categoryData = [
    {
      slug: 'christianity',
      nameEn: 'Christianity',
      nameAm: 'በእንተ ክርስትና',
      nameOm: "Waa'ee Kiristaanummaa",
      nameTi: 'ብዛዕባ ክርስትና',
      descriptionEn: 'Orthodox Christian theology, Christology, Holy Trinity, biblical consistency, and Early Church patristics.',
      descriptionAm: 'የኦርቶዶክሳዊት ተዋሕዶ እምነት ክርስቶሎጂ፣ ምስጢረ ሥላሴ፣ የመጽሐፍ ቅዱስ አስተማማኝነት እና የጥንታዊት ቤተክርስቲያን አበው ትምህርት።',
      descriptionOm: "Waa'ee amantii Ortodoksii Tawaahidoo, Waaqummaa Kiristoos, Iccitii Sillaasee, amansiisummaa Kitaaba Qulqulluu fi barnoota abbootii durii.",
      descriptionTi: 'ናይ ኦርቶዶክሳዊት ተዋሕዶ እምነት ክርስቶሎጂ፣ ምስጢረ ሥላሴ፣ ናይ መጽሓፍ ቅዱስ ሓቅነትን ናይ ቀደምት ኣቦታት ትምህርትን።',
      sortOrder: 1,
      isActive: 1,
    },
    {
      slug: 'islamic',
      nameEn: 'Islamic Dialogue',
      nameAm: 'በእንተ እስልምና',
      nameOm: "Waa'ee Islaamummaa",
      nameTi: 'ብዛዕባ እስልምና',
      descriptionEn: 'Christian-Islamic interfaith dialogue, historical inquiries, theological discussions, and scriptural analysis.',
      descriptionAm: 'የክርስትና እና የእስልምና ሃይማኖታዊ ውይይቶች፣ የታሪክና የቅዱሳት መጻሕፍት ጥናታዊ ማብራሪያዎች።',
      descriptionOm: 'Marii amantii Kiristaanummaa fi Islaamummaa, qorannoo seenaa fi xiinxala barreeffamoota amantii.',
      descriptionTi: 'ናይ ክርስትናን እስልምናን ሃይማኖታዊ ክትዓት፣ ታሪኻውን ናይ ቅዱሳት መጻሕፍቲ መብርህታትን።',
      sortOrder: 2,
      isActive: 1,
    },
    {
      slug: 'testimonies',
      nameEn: 'Testimonies',
      nameAm: 'ምስክርነቶች',
      nameOm: "Dhugaa Ba'umsa",
      nameTi: 'ምስክርነታት',
      descriptionEn: 'Inspiring personal conversion journeys and spiritual transformation testimonies into the Orthodox faith.',
      descriptionAm: 'ወደ ኦርቶዶክስ ተዋሕዶ እምነት የመጡ ወገኖች እውነተኛ የሕይወት ለውጥና የልብ ምስክርነቶች።',
      descriptionOm: "Dhugaa ba'umsa jireenyaa fi seenaa namoota gara amantii Ortodoksii Tawaahidootti dhufanii.",
      descriptionTi: 'ናብ ኦርቶዶክስ ተዋሕዶ እምነት ዝመጹ ሰባት ናይ ህይወት ለውጥን ናይ ሓቂ ምስክርነታትን።',
      sortOrder: 3,
      isActive: 1,
    },
    {
      slug: 'atheism',
      nameEn: 'Atheism & Reason',
      nameAm: 'በእንተ ኢ-አማኒነት',
      nameOm: "Waa'ee Waaqayyo Maleeyyii",
      nameTi: 'ብዛዕባ ዘይኣማንነት',
      descriptionEn: 'Orthodox Christian philosophical, theological, and rational responses to secularism, materialism, and atheism.',
      descriptionAm: 'ለኢ-አማኒነት፣ ለማቴሪያሊዝምና ለዓለማዊ ፍልስፍናዎች በኦርቶዶክሳዊት ቤተክርስቲያን የተሰጡ ምክንያታዊና ሥነ-መለኮታዊ ምላሾች።',
      descriptionOm: 'Ilaalcha waaqa maleeyyummaa fi saayinsii sobaatiif deebii amantii Ortodoksii fi falaasamaa.',
      descriptionTi: 'ንዘይኣማንነትን ዓለማዊ ፍልስፍናታትን ዝወሃብ ኦርቶዶክሳዊ ስነ-መለኮታዊን ምክንያታዊን መልስታት።',
      sortOrder: 4,
      isActive: 1,
    },
    {
      slug: 'spiritual-teachings',
      nameEn: 'Spiritual Teachings',
      nameAm: 'መንፈሳዊ ትምህርቶች',
      nameOm: 'Barnoota Afuuraa',
      nameTi: 'መንፈሳዊ ትምህርትታት',
      descriptionEn: 'Orthodox spirituality, ascetic wisdom, prayers, church tradition, and daily Christian living.',
      descriptionAm: 'መንፈሳዊ ዕድገት፣ የአበው ምንኩስና ምክሮች፣ ጸሎት እና የዕለት ተዕለት ክርስቲያናዊ ሕይወት።',
      descriptionOm: 'Guddina afuuraa, gorsa abbootii, kadhannaalee fi jireenya Kiristaanummaa guyyaa guyyaa.',
      descriptionTi: 'መንፈሳዊ ዕቤት፣ ናይ ኣቦታት ምዕዳን፣ ጸሎትን መዓልታዊ ክርስትናዊ ህይወትን።',
      sortOrder: 5,
      isActive: 1,
    },
  ];

  for (const cat of categoryData) {
    const existing = await db.select().from(categories).where(eq(categories.slug, cat.slug)).limit(1);
    if (existing.length === 0) {
      const [insertResult] = await db.insert(categories).values(cat);
      console.log(`   ✓ Inserted category: ${cat.slug} (ID: ${insertResult.insertId})`);
    } else {
      await db
        .update(categories)
        .set({
          nameEn: cat.nameEn,
          nameAm: cat.nameAm,
          nameOm: cat.nameOm,
          nameTi: cat.nameTi,
          descriptionEn: cat.descriptionEn,
          descriptionAm: cat.descriptionAm,
          descriptionOm: cat.descriptionOm,
          descriptionTi: cat.descriptionTi,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        })
        .where(eq(categories.id, existing[0].id));
      console.log(`   ✓ Updated category with multilingual descriptions: ${cat.slug} (ID: ${existing[0].id})`);
    }
  }

  // 2. Seed Foundational Tags
  console.log('🌱 [Seed] Seeding Foundational Tags...');
  const tagData = [
    { slug: 'trinity', name: 'ሥላሴ | Trinity' },
    { slug: 'christology', name: 'ክርስቶሎጂ | Christology' },
    { slug: 'patristics', name: 'ትምህርተ አበው | Patristics' },
    { slug: 'scripture', name: 'ቅዱሳት መጻሕፍት | Scripture' },
    { slug: 'apologetics', name: 'ዕቅበተ እምነት | Apologetics' },
    { slug: 'church-history', name: 'ታሪከ ቤተክርስቲያን | Church History' },
    { slug: 'salvation', name: 'ደህንነት | Soteriology' },
  ];

  for (const tag of tagData) {
    const existing = await db.select().from(tags).where(eq(tags.slug, tag.slug)).limit(1);
    if (existing.length === 0) {
      await db.insert(tags).values(tag);
      console.log(`   ✓ Inserted tag: ${tag.slug}`);
    } else {
      await db.update(tags).set({ name: tag.name }).where(eq(tags.id, existing[0].id));
      console.log(`   ℹ Tag already exists: ${tag.slug}`);
    }
  }

  // 3. Seed Sample Theological Article with Multilingual Translations
  console.log('🌱 [Seed] Seeding Sample Published Article with Multilingual Translations...');
  const christianityCategory = await db.select().from(categories).where(eq(categories.slug, 'christianity')).limit(1);

  if (christianityCategory.length > 0) {
    const catId = christianityCategory[0].id;
    const existingArticle = await db.select().from(contentTranslations).where(eq(contentTranslations.slug, 'deity-of-jesus-christ-scripture')).limit(1);
    let articleId: number;

    if (existingArticle.length === 0) {
      const [contentInsert] = await db.insert(content).values({
        categoryId: catId,
        authorName: 'ዘአትናቴዎስ (Sons of Athanasius)',
        coverImage: 'https://images.unsplash.com/photo-1548625361-195fe578ae5a?q=80&w=1200&auto=format&fit=crop',
      });
      articleId = contentInsert.insertId;
    } else {
      articleId = existingArticle[0].contentId;
    }

    // Amharic Translation
    const amharicRaw = '<h2>የክርስቶስ የባሕርይ አምላክነት</h2><p>በመጀመሪያ ቃል ነበረ፤ ቃልም በእግዚአብሔር ዘንድ ነበረ፤ ቃልም እግዚአብሔር ነበረ። [ዮሐ 1:1]</p><blockquote>«እኔና አብ አንድ ነን።» (ዮሐ 10:30)</blockquote><p>ይህ ድንቅ ቃል የክርስቶስን የባሕርይ አንድነት ከአብና ከመንፈስ ቅዱስ ጋር በማያሻማ መልኩ ያስረዳል። ኦርቶዶክሳዊት ቤተክርስቲያናችን የምታስተምረው ክርስቶስ ከሁለት ባሕርይ አንድ ባሕርይ፣ ከሁለት አካል አንድ አካል የሆነ ፍጹም አምላክ ፍጹም ሰው መሆኑን ነው።</p>';
    const amharicProcessed = processArticleContent(amharicRaw);

    const existingAm = await db.select().from(contentTranslations).where(eq(contentTranslations.slug, 'deity-of-jesus-christ-scripture')).limit(1);
    if (existingAm.length === 0) {
      await db.insert(contentTranslations).values({
        contentId: articleId,
        langCode: 'am',
        title: 'የኢየሱስ ክርስቶስ አምላክነት በቅዱሳት መጻሕፍት ብርሃን',
        slug: 'deity-of-jesus-christ-scripture',
        summary: 'ስለ ጌታችን መድኃኒታችን ኢየሱስ ክርስቶስ ፍጹም አምላክነትና ፍጹም ሰውነት የተሰጠ ኦርቶዶክሳዊ ትምህርት።',
        body: amharicProcessed.sanitizedHtml,
        bodySearchable: amharicProcessed.bodySearchable,
        status: 'published',
        pdfEnabled: 1,
        viewCount: 154,
        publishedAt: new Date(),
      });
    } else {
      await db.update(contentTranslations).set({
        body: amharicProcessed.sanitizedHtml,
        bodySearchable: amharicProcessed.bodySearchable,
        status: 'published',
        pdfEnabled: 1,
        publishedAt: new Date(),
      }).where(eq(contentTranslations.id, existingAm[0].id));
    }

    // English Translation
    const englishRaw = '<h2>The True Divinity of Christ</h2><p>In the beginning was the Word, and the Word was with God, and the Word was God. [John 1:1]</p><blockquote>"I and My Father are one." (John 10:30)</blockquote><p>This profound proclamation clearly demonstrates the consubstantial unity of Christ with the Father and the Holy Spirit. The Orthodox Church upholds the Miaphysite Christology: one incarnate nature of God the Word.</p>';
    const englishProcessed = processArticleContent(englishRaw);

    const existingEn = await db.select().from(contentTranslations).where(eq(contentTranslations.slug, 'the-deity-of-jesus-christ-in-scripture')).limit(1);
    if (existingEn.length === 0) {
      await db.insert(contentTranslations).values({
        contentId: articleId,
        langCode: 'en',
        title: 'The Deity of Jesus Christ in the Light of Sacred Scripture',
        slug: 'the-deity-of-jesus-christ-in-scripture',
        summary: 'An Orthodox theological exposition on the true divinity and perfect humanity of our Lord Jesus Christ.',
        body: englishProcessed.sanitizedHtml,
        bodySearchable: englishProcessed.bodySearchable,
        status: 'published',
        pdfEnabled: 1,
        viewCount: 85,
        publishedAt: new Date(),
      });
    } else {
      await db.update(contentTranslations).set({
        body: englishProcessed.sanitizedHtml,
        bodySearchable: englishProcessed.bodySearchable,
        status: 'published',
        pdfEnabled: 1,
        publishedAt: new Date(),
      }).where(eq(contentTranslations.id, existingEn[0].id));
    }

    console.log(`   ✓ Seeded and converged sample article (ID: ${articleId}) 'am' and 'en' translations with unbracketed data-ref`);
  }

  // 4. Seed Default SuperAdmin
  console.log('🌱 [Seed] Seeding Default SuperAdmin User...');
  const existingAdmin = await db.select().from(admins).where(eq(admins.username, 'admin')).limit(1);
  if (existingAdmin.length === 0) {
    const passwordHash = await hashPassword('AdminSecretPass123!');
    await db.insert(admins).values({
      username: 'admin',
      email: 'admin@sonsofathanasius.com',
      passwordHash,
      fullName: 'ደቂቀ አትናቴዎስ Admin',
      role: 'superadmin',
      isActive: 1,
    });
    console.log('   ✓ Seeded initial superadmin (username: admin, email: admin@sonsofathanasius.com)');
  } else {
    console.log('   ✓ Superadmin already exists');
  }

  console.log('✅ [Seed] Database seeding completed successfully!');
}

seed()
  .catch((err) => {
    console.error('❌ [Seed] Error seeding database:', err);
    process.exit(1);
  })
  .finally(async () => {
    await poolConnection.end();
  });
