export interface LocalizedPdfLabels {
  headerTitle: string;
  headerSubtitle: string;
  authorLabel: string;
  dateLabel: string;
  defaultAuthor: string;
  footerQuote: string;
  pageLabel: (current: number, total: number) => string;
}

export const LOCALIZED_LABELS: Record<string, LocalizedPdfLabels> = {
  am: {
    headerTitle: 'ደቂቀ አትናቴዎስ  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  ክርስቲያናዊ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሐፊ',
    dateLabel: 'ቀን',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትላንትናም ዛሬም ለዘላለምም ያው ነው» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  ti: {
    headerTitle: 'ደቂቀ አትናቴዎስ  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  ክርስቲያናዊ ናይ ዕቅበተ እምነት ማሕበር',
    authorLabel: 'ጸሓፊ',
    dateLabel: 'ዕለት',
    defaultAuthor: 'ዘአትናቴዎስ',
    footerQuote: '«ኢየሱስ ክርስቶስ ትማልን ሎምን ንዘለኣለምን ንሱ እዩ» (ዕብራውያን ፲፫:፰)  •  ደቂቀ አትናቴዎስ  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `ገጽ ${current} / ${total}`,
  },
  en: {
    headerTitle: 'SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  Christian Apologetics',
    authorLabel: 'Author',
    dateLabel: 'Date',
    defaultAuthor: 'Ze-Athanasius',
    footerQuote: '“Jesus Christ is the same yesterday and today and forever.” (Hebrews 13:8)  •  Sons of Athanasius  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `Page ${current} of ${total}`,
  },
  om: {
    headerTitle: 'ILMAAN ATNAATEWOOS  |  SONS OF ATHANASIUS',
    headerSubtitle: 'www.sonsofathanasius.com  •  Waldaa Ittisa Amantii Kiristaanaa',
    authorLabel: 'Barreessaa',
    dateLabel: 'Guyyaa',
    defaultAuthor: 'Ze-Atnaatewoos',
    footerQuote: '«Yesuus Kiristoos kaleessas, har\'as, bara baraanis akkuma jirutti jiraata.» (Ibroota 13:8)  •  Ilmaan Atnaatewoos  •  www.sonsofathanasius.com',
    pageLabel: (current, total) => `Fuula ${current} / ${total}`,
  },
};
