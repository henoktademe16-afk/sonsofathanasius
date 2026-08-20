export interface LocalizedPdfLabels {
  headerBrandLeft: string;
  headerBrandRight: string;
  headerSubtitle: string;
  authorLabel: string;
  dateLabel: string;
  defaultAuthor: string;
  footerQuote: string;
  runningHeaderBrand: string;
  pageLabel: (current: number, total: number) => string;
}

export const LOCALIZED_LABELS: Record<string, LocalizedPdfLabels> = {
  am: {
    headerBrandLeft: 'ደቂቀ አትናቴዎስ',
    headerBrandRight: '  |  SONS OF ATHANASIUS',
    headerSubtitle: 'ክርስቲያናዊ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሐፊ',
    dateLabel: 'ቀን',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትላንትናም ዛሬም ለዘላለምም ያው ነው» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    runningHeaderBrand: 'ደቂቀ አትናቴዎስ',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  ti: {
    headerBrandLeft: 'ደቂቀ አትናቴዎስ',
    headerBrandRight: '  |  SONS OF ATHANASIUS',
    headerSubtitle: 'ክርስቲያናዊ ናይ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሓፊ',
    dateLabel: 'ዕለት',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትማልን ሎምን ንዘለኣለምን ንሱ እዩ» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    runningHeaderBrand: 'ደቂቀ አትናቴዎስ',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  en: {
    headerBrandLeft: 'SONS OF ATHANASIUS',
    headerBrandRight: '',
    headerSubtitle: 'Christian Apologetics',
    authorLabel: 'Author',
    dateLabel: 'Date',
    defaultAuthor: 'Ze-Athanasius',
    footerQuote: '“Jesus Christ is the same yesterday and today and forever.” (Hebrews 13:8)  •  Sons of Athanasius  •  www.sonsofathanasius.com',
    runningHeaderBrand: 'SONS OF ATHANASIUS',
    pageLabel: (current, total) => `Page ${current} of ${total}`,
  },
  om: {
    headerBrandLeft: 'ILMAAN ATNAATEWOOS',
    headerBrandRight: '  |  SONS OF ATHANASIUS',
    headerSubtitle: 'Waldaa Ittisa Amantii Kiristaanaa',
    authorLabel: 'Barreessaa',
    dateLabel: 'Guyyaa',
    defaultAuthor: 'Ze-Atnaatewoos',
    footerQuote: '«Yesuus Kiristoos kaleessas, har\'as, bara baraanis akkuma jirutti jiraata.» (Ibroota 13:8)  •  Ilmaan Atnaatewoos  •  www.sonsofathanasius.com',
    runningHeaderBrand: 'ILMAAN ATNAATEWOOS',
    pageLabel: (current, total) => `Fuula ${current} / ${total}`,
  },
};
