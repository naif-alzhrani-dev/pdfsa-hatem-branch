/** كل نصّ ظاهر في الواجهة هنا وحده (للتدقيق). */
export const ar = (n: number) => n.toLocaleString("ar-u-nu-arab", { useGrouping: false });

/** عدد الصفحات بقاعدة الجمع العربية (CLDR، على n % 100) — docs/strings-v2.md. */
export function pagesCount(n: number): string {
  if (n === 1) return "صفحة واحدة";
  if (n === 2) return "صفحتان";
  const m = n % 100;
  if (n > 2 && m >= 3 && m <= 10) return `${ar(n)} صفحات`;
  return `${ar(n)} صفحة`;
}
/** رسالة المدى الواحدة للصفحات والملفات. */
export const rangeError = (total: number) => `اكتب رقماً من ١ إلى ${ar(total)}.`;

export const S = {
  appName: "PDFsa",
  opening: "جارٍ فتح الملف…",
  openingOf: (i: number, n: number) => `جارٍ فتح الملف ${ar(i)} من ${ar(n)}…`, // جديد لمراجعة 👩‍🏫 هدى: على زرّ الدمج حين تُختار عدّة ملفات
  badPdf: "ملف PDF غير صالح. اختر ملفاً آخر.",
  encrypted: "الملف مقفل بكلمة مرور. أزل قفله بأداة «فتح قفل الملف» ثم افتحه.",
  closeUnsaved: "إغلاق الملف دون حفظ؟",
  addSignature: "أضف التوقيع",
  addStamp: "أضف ختماً أو شعاراً", // تلميح الشعار (docs/logs/phase1/text-long.md §٢): عنوان ورقة الختم وaria-label زرّ الشريط
  page: (n: number, total: number) => `صفحة ${ar(n)} من ${ar(total)}`,

  save: "حفظ الملف",
  saving: "جارٍ الحفظ…",
  placeFirst: "أضف توقيعاً أو ختماً أو تاريخاً أو نصاً قبل الحفظ",
  saveFailed: "تعذّر حفظ الملف. حاول مرة أخرى.",
  saved: "تم حفظ الملف",
  ready: "الملف جاهز",
  share: "حفظ أو مشاركة",
  done: "تم",
  // (٢٤) «PDF إلى صور» على الجوال: نصوص 👩‍🏫 هدى في docs/logs/pdf-images-24-lama-spec.md
  shareImages: "حفظ كصور",
  shareImagesHint: "من القائمة التي تظهر، اختر حفظ الصور أو المعرض.",
  saveZip: "حفظ كملف مضغوط (ZIP)",
  shareImagesFailed: "تعذّرت مشاركة الصور منفصلة. احفظها ملفاً مضغوطاً.",
  shareImagesLimit: "مشاركة الصور منفصلة متاحة حتى ٢٠ صفحة. هذا الملف أكثر من ذلك، فاحفظه ملفاً مضغوطاً.",
  continueEdit: "متابعة التعديل",
  newFile: "العودة إلى الرئيسية",

  close: "إغلاق",
  back: "رجوع",
  savedLabel: "المحفوظ",
  edit: "تعديل",
  emptySignature: "لا توقيع محفوظ",
  emptyStamp: "لا ختم ولا شعار محفوظ",
  emptyHint: "اختر صورته من الصور أو الملفات.",
  fromPhotos: "من الصور",
  fromFiles: "من الملفات",
  savedSignature: "توقيع محفوظ",
  savedStamp: "ختم محفوظ",

  original: "الأصل",
  afterRemoval: "بعد التفريغ",
  strength: "قوة التفريغ",
  placeOnPage: "أضفه إلى الصفحة",
  otherImage: "اختر صورة أخرى",
  processing: "جارٍ تفريغ الخلفية…",
  badImage: "تعذّرت قراءة الصورة. اختر صورة بصيغة JPG أو PNG.",
  noInk: "لم يظهر حبر في الصورة. صوّره على ورقة بيضاء وإضاءة جيدة.",

  signature: "التوقيع",
  stamp: "الختم",
  enlarge: "تكبير",
  shrink: "تصغير",
  remove: "إزالة من الصفحة",
  undo: "تراجع", // التراجع عن حذف المحفوظ قبل إغلاق الورقة (قرار نايف ٢٠٢٦/١١/١٠)

  /* ─── الإصدار الثاني (docs/strings-v2.md بعد تدقيق هدى) ─── */
  signFile: "توقيع ملف",
  mergeFile: "دمج ملف",
  editFile: "تحرير ملف",
  scanFile: "مسح ملف", // طلب نايف ٢٠٢٦/١١/٠٨: «غير عبارة تصوير ملف إلى مسح ملف»
  backHome: "رجوع إلى الرئيسية",
  backFiles: "رجوع إلى الملفات",
  fold: "إخفاء أزرار التوقيع والختم",
  unfold: "إظهار أزرار التوقيع والختم",
  backFilesUnsaved: "العودة إلى الملفات دون حفظ؟",
  editFirst: "لم يتغيّر شيء في الملف بعد.", // هدى ٢٠٢٦/١١/١٥ (polish-before-publish-lama.md §١): وصف حال لا أمر

  before: "قبل",
  after: "بعد",
  position: "الموضع",
  moveBtn: "انقل",
  deletePage: "حذف الصفحة",
  // للشبكة المصغّرة ولشريط الصفحة معاً؛ لا يُولَّدان على الأولى والأخيرة (الزرّ معطّل)
  // و`t` الصفحة الهدف: في الشبكة ↑ و↓ صفّ كامل (ج-٣)، فـ«قبل الصفحة ٤» للصفحة ٧
  pageBeforeLabel: (n: number, t = n - 1) => `انقل الصفحة ${ar(n)} قبل الصفحة ${ar(t)}`,
  pageAfterLabel: (n: number, t = n + 1) => `انقل الصفحة ${ar(n)} بعد الصفحة ${ar(t)}`,
  pageOrderGroup: (n: number) => `ترتيب الصفحة ${ar(n)}`,
  thumbsToggle: "عرض مصغّر للصفحات",
  moveLabel: "انقل الصفحة إلى الموضع المكتوب",
  confirmDeletePage: (n: number) => `حذف الصفحة ${ar(n)}؟`,
  pageMoved: (p: number, total: number) => `تم نقل الصفحة إلى الموضع ${ar(p)} من ${ar(total)}.`,
  pageDeleted: (n: number, k: number) => `تم حذف الصفحة ${ar(n)}. بقيت ${pagesCount(k)}.`,

  chooseTwo: "اجمع ملفين أو أكثر في ملف واحد", // سطر وصف الدمج (هدى ٢٠٢٦/١١/١٢)
  chooseFiles: "اختر الملفات",
  addFile: "أضف ملفاً",
  editBtn: "تحرير",
  mergeBtn: "ادمج الملفات",
  addSecond: "أضف ملفاً ثانياً للدمج",
  merging: "جارٍ دمج الملفات…",
  orderLabel: (name: string) => `ترتيب «${name}»`,
  moveFileUp: (name: string) => `انقل «${name}» إلى الأعلى`,
  moveFileDown: (name: string) => `انقل «${name}» إلى الأسفل`,
  editLabel: (name: string) => `تحرير «${name}»`,
  // سطر الإشارة تحت عدد الصفحات في بطاقة الدمج (نصّا هدى، docs/logs/merge-expand-lama-spec.md): الثاني يحلّ محلّ الأول
  fileMarked: "عليه إضافات",
  fileRedacted: "فيه نصّ مطموس",
  removeFileLabel: (name: string) => `إزالة «${name}» من الدمج`,
  editTitle: (name: string) => `تحرير «${name}»`,
  fileMoved: (name: string, p: number, total: number) => `صار «${name}» في الموضع ${ar(p)} من ${ar(total)}.`,
  fileBad: (name: string) => `تعذّر فتح «${name}». أزله وأضف ملفاً آخر.`,
  suffixSigned: "موقّع",
  suffixEdited: "معدّل",
  suffixMerged: "مدموج",
  suffixUnlocked: "بلا-قفل", // فتح قفل الملف (تُحذف «-مقفل» من آخر الاسم قبلها)، هدى ٢٠٢٦/١١/١٤
  suffixNumbered: "مرقّم", // ترقيم الصفحات (قرار المدير، الدفعة ٣)
  suffixRedacted: "بطمس", // قلم الطمس: آخر الاسم دائماً (P1f؛ «بطمس» من هدى ٢٠٢٦/١١/١٤، قرار المدير)
  fileEncrypted: (name: string) => `«${name}» مقفل بكلمة مرور. أزل قفله بأداة «فتح قفل الملف» ثم أضفه من جديد.`,

  /* ─── تصوير ملف (docs/strings-v2.md، حرفاً) — و«من الصور» و«تم» و«حذف الصفحة» وتأكيده و`badImage` الموجودة ─── */
  scanCamera: "صوّر الورقة",
  scanLead: "حوّل أوراقك إلى ملف PDF مقصوص الحواف", // سطر وصف المسح (هدى ٢٠٢٦/١١/١٢)
  adjustTitle: "اضبط الزوايا",
  adjustHint: "اسحب الدوائر الأربع إلى زوايا الورقة.",
  retake: "أعد التصوير",
  rotate: "تدوير",
  next: "التالي",
  noEdges: "لم تُكتشف حواف الورقة. اسحب الدوائر إلى زواياها.",
  preparing: "جارٍ تجهيز الصفحة…",
  scanMore: "صوّر صفحة أخرى",
  readjust: "أعد ضبط الزوايا",
  scanLeave: "الخروج دون حفظ الصفحات المصوّرة؟",
  /* جديد لم يُذكر في strings-v2 — لمراجعة 👩‍🏫 هدى */
  scanName: "مستند-مصوّر", // أساس اسم الملف الناتج: «مستند-مصوّر.pdf»، و«مستند-مصوّر-موقّع.pdf» بتوقيع أو ختم (الشدّة إلزامية)
  scanPreparingFile: "جارٍ تجهيز الملف…", // على «تم» أثناء بناء ملف التصوير وحده؛ `opening` باقٍ لغيره
  // aria-label دوائر الزوايا في محرّر scanic (تحلّ محلّ «Top-left corner» وأخواتها). الاتجاه فعليّ على الصورة
  corner: {
    topLeft: "الزاوية العليا اليسرى",
    topRight: "الزاوية العليا اليمنى",
    bottomRight: "الزاوية السفلى اليمنى",
    bottomLeft: "الزاوية السفلى اليسرى",
  },
  /* خيارات المسح في النتيجة (src/scan/filter-panel.ts) — بطلب نايف، بلا تدقيق 👩‍🏫 هدى بطلبه */
  filterColor: "ملوّن",
  filterBw: "أبيض وأسود",
  whitening: "تبييض الخلفية",
  scanOptions: "خيارات المسح", // aria-label للوحة والمفتاح، لا يُعرض

  /* ─── المسح الحيّ (docs/design-spec-livescan.md §٤، كما هي، قبل تدقيق 👩‍🏫 هدى) — و«تم» و«من الصور» الموجودتان ─── */
  liveAuto: "تلقائي",
  liveManual: "يدوي",
  liveShoot: "صوّر",
  liveTorch: "الفلاش",
  liveClose: "إغلاق الكاميرا",
  liveAim: "وجّه الكاميرا إلى الورقة",
  liveHold: "ثبّت الجوال",
  liveNext: "حرّك الكاميرا إلى الصفحة التالية",
  liveDark: "الإضاءة ضعيفة. قرّب الورقة من الضوء.",
  liveAllow: "اسمح باستعمال الكاميرا لتصوير الورقة.",
  liveDenied: "لم يُسمح لهذا الموقع باستعمال الكاميرا.",
  liveSettings: "يمكنك السماح بها من إعدادات المتصفح.",
  liveDeviceCamera: "صوّر بكاميرا الجهاز",
  liveBusy: "الكاميرا مستعملة في تطبيق آخر. أغلقه ثم أعد المحاولة.",
  liveDiscardQ: "حذف الصفحات المصوّرة؟",
  liveDiscard: "حذف",
  liveContinue: "متابعة المسح",
  liveCaptured: (n: number) => `تم تصوير الصفحة ${ar(n)}.`,
  // نافذة «لم يُحفظ» قبل الخروج (قرار نايف «أ» ٢٠٢٦/١١/١٥)، حرفاً من docs/logs/leave-dialog-strings-huda.md، وتنفيذها src/leave-ask.ts
  leaveDialog: {
    stay: "البقاء",
    exit: "الخروج",
    toFiles: "العودة إلى الملفات",
    titleFile: "الملف لم يُحفظ",          // تحرير، توقيع، صور إلى PDF
    titleMergeList: "الملفات لم تُدمج",    // قائمة دمج ملف
    titleMerged: "الملف المدموج لم يُحفظ", // وضع merged
    titleScan: "الصفحات المصوّرة لم تُحفظ", // مسح ملف
    titleLetter: "الخطاب لم يُحفظ",        // إعداد خطاب (كائن SL)
  },
  // سؤال الحذف ورسائل الخطأ بالنافذة نفسها (قرار نايف ٢٠٢٦/١١/١٥)، حرفاً من الدفعة الثانية في docs/logs/leave-dialog-strings-huda.md
  dialogs: {
    ok: "حسناً",
    keep: "الإبقاء",
    remove: "الحذف",
    deletePageTitle: (n: number) => `حذف الصفحة ${ar(n)}؟`,
    saveFailedTitle: "تعذّر حفظ الملف",
    saveFailedLine: "حاول مرة أخرى.",
    penRefusedTitle: "الملف لم يُحفظ",
    penRefusedLine(ns: number[]) {
      const n = ns.length;
      if (n === 1) return `قد يبقى جزء من كلمة ظاهراً خارج الطمس في الصفحة ${ar(ns[0]!)}. اطمس الكلمة كاملةً ثم احفظ.`;
      const where = n === 2 ? `الصفحتين ${pageList(ns)}` : n <= 10 ? `الصفحات ${pageList(ns)}` : `${ar(n)} صفحة`;
      return `قد تبقى أجزاء من كلمات ظاهرة خارج الطمس في ${where}. اطمس الكلمات كاملةً ثم احفظ.`;
    },
    drawSavedTitle: "أُضيف التوقيع ولم يُحفظ",
    // مسار الصورة يخدم التوقيع والختم (Kind في place.ts): العنوان بالنوع، وسطره لا يَعِد برسمٍ لم يحدث (هدى، leave-dialog-strings-huda.md)
    placedSavedTitle: { signature: "أُضيف التوقيع ولم يُحفظ", stamp: "أُضيف الختم ولم يُحفظ" } as Record<"signature" | "stamp", string>,
    placedSavedLine: "لن تجدها في المحفوظ، فاخترها من الصور أو الملفات من جديد.",
    drawSavedLine: "سترسمه من جديد في المرة القادمة.",
  },
};

/* ─── الدفعة الرابعة: النصوص النهائية بعد تدقيق 👩‍🏫 هدى (docs/design-spec-batch4.md، حرفاً) ───
 * «أضفه إلى الصفحة» زرّ شاشة الرسم هو `S.placeOnPage` القائم، و«تم» ورقة التاريخ هو `S.done` القائم. */
export const S4 = {
  splitFile: "تقسيم ملف",
  drawSignature: "ارسم توقيعك",
  clearDrawing: "امسح الرسم",
  inkBlack: "أسود",
  inkBlue: "أزرق",
  inkBlackLabel: "حبر أسود",
  inkBlueLabel: "حبر أزرق",
  addDate: "أضف التاريخ",
  modeHijri: "هجري",
  modeGregorian: "ميلادي",
  // مفتاح الصيغة في ورقة التاريخ (طلب نايف ٢٠٢٦/١١/٠٨): «م» يميناً و«هـ» يساراً
  modeHijriShort: "هـ",
  modeGregorianShort: "م",
  changeDate: "تغيير التاريخ",
  unitDay: "اليوم",
  unitMonth: "الشهر",
  unitYear: "السنة",
  todayDate: "تاريخ اليوم",
  pagesLabel: "الصفحات",
  pagesExample: "١-٣ و٥، ٦-٨",
  extract: "قسّم الملف",
  everyPage: "كل صفحة في ملف",
  madeBy: "صنع بواسطة",
  privacyLink: "سياسة الخصوصية", // رابط /privacy بعد عبارة الخصوصية (public/privacy.html)
  privacyTitle: "ملفاتك لا تغادر جهازك:",
  privacyBody: "لا تُرفع إلى أي خادم ولا تصلنا، وتوقيعك وختمك محفوظان على جهازك وحده.",
  mhalahDomain: "mhalah.com",
  drawSaveFailed: "أُضيف التوقيع إلى الصفحة، لكن تعذّر حفظه. سترسمه من جديد في المرة القادمة.",
  dateLabel: (t: string) => `التاريخ: ${t}`,
  // عنصر النصّ (طلب نايف ٢٠٢٦/١١/٠٨: «اضافة نص… يضع اسمه… باللون الأزرق او الأسود»)
  addText: "أضف نصاً",
  textLabelField: "اكتب النص",
  textPlaceholder: "مثلاً: اسمك",
  editText: "تعديل النص",
  textLabel: (t: string) => `النص: ${t}`,
  // النصّ الطويل بأسطر ومحاذاة (طلب نايف ٢٠٢٦/١١/١٠، docs/logs/phase1/text-long.md بعد تدقيق 👩‍🏫 هدى)
  textAlignLabel: "محاذاة النص", // aria-label لمجموعة الخيارات، لا يُعرض
  alignRight: "يمين",
  alignCenter: "وسط",
  alignLeft: "يسار",
  // العدّاد حين يبقى 200 حرف أو أقل، بقاعدة n % 100 كما في pagesCount
  textRemaining: (n: number) => {
    if (n === 0) return "بلغ النص الحدّ الأقصى";
    if (n === 1) return "بقي حرف واحد";
    if (n === 2) return "بقي حرفان";
    if (n >= 100 && n % 100 === 0) return `بقي ${ar(n)} حرفٍ`; // المئة تُضاف إلى المعدود بالجرّ
    const m = n % 100;
    return m >= 3 && m <= 10 ? `بقيت ${ar(n)} حروف` : `بقي ${ar(n)} حرفاً`;
  },
  // النصوص الظاهرة في الحبّة حين لا تتّسع الأربعة بنصوصها الكاملة (والكاملة في aria-label)
  pillSignature: "توقيع",
  pillStamp: "ختم",
  pillDate: "تاريخ",
  pillText: "نص",
  stepLabel: (unit: "day" | "month" | "year", delta: number) =>
    ({ day: ["اليوم: أنقص يوماً", "اليوم: زد يوماً"], month: ["الشهر: أنقص شهراً", "الشهر: زد شهراً"], year: ["السنة: أنقص سنة", "السنة: زد سنة"] })[unit][delta < 0 ? 0 : 1],

  splitOut: (p: number, total: number) => `لا توجد صفحة ${ar(p)}. ${rangeError(total)}`,
  splitOverlap: (p: number) => `الصفحة ${ar(p)} مكتوبة في أكثر من ملف. اتركها في ملف واحد.`,
  splitSyntax: "اكتب أرقام الصفحات، مثل «١-٣، ٤-٦».",
  splitNone: "اختر صفحات أو اكتب أرقامها.",

  rotatePageLabel: (n: number) => `دوّر الصفحة ${ar(n)}`,
  rotateAllLabel: "دوّر صفحات الملف كلها",
  rotateFileLabel: (name: string) => `دوّر «${name}»`,
  rotateImageLabel: "دوّر الصورة",
  dateModeLabel: "صيغة التاريخ",
  drawPadLabel: "لوحة رسم التوقيع",
  mhalahLabel: "مَحالة، mhalah.com",
  pageRotated: (n: number) => `تم تدوير الصفحة ${ar(n)}.`,
  allRotated: "تم تدوير صفحات الملف كلها.",
  savedMany: "تم حفظ الملفات",
  readyMany: "الملفات جاهزة",
  // «الأدوات» بعد المسح والحفظ (طلب نايف ٢٠٢٦/١١/٠٨: «زر بعد السكانر مكتوب اسمه الأدوات»): الزرّ وعنوان الورقة
  tools: "الأدوات",
  // الإضافتان ١٠ و١١ (docs/logs/additions-10-11-lama-spec.md): نصوص 👩‍🏫 هدى المعتمدة
  inkMore: "ألوان أخرى",
  inkCustom: "حبر بلون مختار",
  inkLightNote: "هذا اللون فاتح، وقد لا يتضح على الصفحة البيضاء أو عند الطباعة.",
  calendarOpen: "افتح التقويم",
  calendarClose: "أغلق التقويم",
  prevMonth: "الشهر السابق",
  nextMonth: "الشهر التالي",
  /** من الأحد إلى السبت: الحرف في رأس العمود، والاسم لقارئ الشاشة */
  weekdays: ["ح", "ن", "ث", "ر", "خ", "ج", "س"],
  weekdayNames: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  /** «الأحد ٢٨ جمادى الأولى ١٤٤٨هـ» و«الأحد ٨ نوفمبر ٢٠٢٦م»: بأسماء الشهور في SL */
  calDay: (wd: string, d: number, m: number, y: number, hijri: boolean) =>
    `${wd} ${ar(d)} ${(hijri ? SL.hijriMonths : SL.gregorianMonths)[m - 1]} ${ar(y)}${hijri ? "هـ" : "م"}`,
  dayRange: (n: number) => `أدخل يوماً من ${ar(1)} إلى ${ar(n)} في هذا الشهر.`,
  monthRange: `أدخل شهراً من ${ar(1)} إلى ${ar(12)}.`,
  yearHijriRange: `أدخل سنة هجرية من ${ar(1420)} إلى ${ar(1500)}.`,
  yearGregRange: `أدخل سنة ميلادية من ${ar(1900)} إلى ${ar(2100)}.`,
  dateKept: "بقي التاريخ السابق.",
};

/** أرضية الأدوات الإضافية (docs/logs/phase1/copy-huda.md «الأرضية»، حرفاً). */
export const SF = {
  moreTools: "أدوات أخرى", // الزرّ في الرئيسية وعنوان ورقته
  encryptedTool: "الملف مقفل بكلمة مرور. افتح قفله بأداة «فتح قفل الملف» ثم أعد المحاولة.",
};

/** ٢١ — زرّ «الإعدادات» وشاشته (src/settings-screen.ts): النصوص المعتمدة من docs/logs/settings-21-texts-huda.md حرفاً. X وY بالاسم المعروض. */
export const SG = {
  title: "الإعدادات", // اسم الزرّ وتلميحه، وعنوان الشاشة
  homeTools: "أدوات الرئيسية",
  ringTools: "أدوات دائرة الإفلات", // للبرنامج وحده، ولا يُعرض في الموقع
  ringKey: "مفتاح الفتح",
  preview: "معاينة الرئيسية",
  lead: "اختر أداة من الرئيسية، ثم بديلها من «أدوات أخرى».", // هدى ٢٠٢٦/١١/١٤ بعد المراجعة
  picked: (x: string) => `تم تحديد «${x}». اختر أداة من «أدوات أخرى» لتحلّ مكانها.`,
  unpicked: (x: string) => `تم إلغاء تحديد «${x}».`,
  swapped: (x: string, y: string) => `حلّت «${x}» مكان «${y}» في الرئيسية، وانتقلت «${y}» إلى أدوات أخرى.`,
  restore: "استعادة الأصل",
  restored: "عادت الأدوات إلى ترتيبها الأصلي.", // هدى ٢٠٢٦/١١/١٤ مع الترتيب بالسحب (settings-21-reorder-lama-spec.md)
  restoreHint: "يعيد أدوات الرئيسية و«أدوات أخرى» إلى ترتيبها الأصلي.",
  // الترتيب داخل القسم (settings-21-reorder-lama-spec.md، نصوص هدى حرفاً). N وM بالأرقام العربية الهندية، وN من ١ (الأول في DOM)
  leadSortTouch: "لترتيب الأدوات، اضغط الأداة مطوّلاً ثم اسحبها.",
  leadSortMouse: "لترتيب الأدوات، اسحب الأداة إلى مكانها.",
  moveBefore: (x: string) => `قدّم «${x}» خطوة`,
  moveAfter: (x: string) => `أخّر «${x}» خطوة`,
  lifted: (x: string) => `رُفعت «${x}». حرّكها بالأسهم، ثم Enter للإفلات أو Esc للإلغاء.`,
  liftedPointer: (x: string) => `رُفعت «${x}».`,
  moved: (x: string, n: number, m: number) => `نُقلت «${x}» إلى الموضع ${ar(n)} من ${ar(m)}.`,
  dropped: (x: string, n: number, m: number) => `أُفلتت «${x}» في الموضع ${ar(n)} من ${ar(m)}.`,
  cancelled: (x: string, n: number, m: number) => `تم إلغاء النقل. عادت «${x}» إلى الموضع ${ar(n)} من ${ar(m)}.`,
  sortRole: "أداة قابلة للترتيب", // aria-roledescription
  sortDesc: "اضغط Enter لرفعها وترتيبها.", // aria-description
  saveFailed: "تعذّر حفظ الترتيب على هذا الجهاز. سيبقى حتى تغلق الصفحة.",
} as const;

/** زرّ التدوير على الصفحة الكبيرة في نتيجة الإسكانر (batch4 ١. التدوير، النصّ النهائي بعد تدقيق هدى). */
export const scanRotatePage = (n: number) => `دوّر الصفحة ${ar(n)}`;

/** بطاقة «أضف إلى الشاشة الرئيسية» في الرئيسية على الجوال (src/install-card.ts). النصّ النهائي بعد تدقيق 👩‍🏫 هدى ٢٠٢٦/١١/٠٩. */
export const SI = {
  title: "أضف PDFsa إلى شاشتك الرئيسية",
  line: "ليفتح من الشاشة الرئيسية كأي تطبيق، بلا تنزيل من المتجر.",
  // آيفون: قائمة مرقّمة، والأرقام ١ ٢ ٣ تُرسم في الواجهة. وأيقونة «مشاركة» تُلحق بعد «مشاركة» في الخطوة الأولى
  iosSteps: [
    "اضغط زر «مشاركة» (في Safari قد يكون داخل قائمة ⋯).",
    "اختر «إضافة إلى الشاشة الرئيسية».",
    "اضغط «إضافة».",
  ],
  installBtn: "أضف PDFsa إلى الشاشة الرئيسية", // أندرويد حين يصل beforeinstallprompt
  androidMenu: "افتح قائمة المتصفح (⋮) واختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».",
  inApp: "افتح هذه الصفحة في Safari أو Chrome أولاً، ثم أضفها إلى الشاشة الرئيسية.",
  never: "لا تُظهر هذا مرة أخرى",
  close: "إغلاق",
};

/** زرّ «تنزيل PDFsa» في الرئيسية وحبّات المتاجر (src/download-menu.ts). النصوص النهائية من 👩‍🏫 هدى، الجولة الثانية ٢٠٢٦/١١/١١
 * (docs/logs/download-buttons-lama-spec.md). الاسم اللاتيني يأخذ lang="en"، وفي سطر الحالة يُلفّ بـ<bdi>، ولا نقطة في آخره. */
export const SD = {
  label: "تنزيل PDFsa", // aria-label وtitle في الحالتين، وaria-expanded يحمل الحال
  soon: "قريباً",
  soonOn: "قريباً على", // سطر الحالة: «قريباً على» ثم اسم المتجر
  get: "حمّله", // السطر الثاني في حبّة المتجر الحيّ (مواصفة لمى 1.0.2، تنتظر إقرار 👩‍🏫 هدى)
  getSr: (store: string) => `حمّل PDFsa من ${store}`, // الاسم المسموع للحبّة الحيّة (هدى ٢٠٢٦/١١/١٤: «حمّل PDFsa من متجر مايكروسوفت»)
  // plat: اسم المنصّة المرئي في الحبّة تحت 1024 (S2، ملاحظة نايف ٢٠٢٦/١١/١١)، من وصف هدى المعتمد («برنامج لويندوز» وأخواتها). والاسم لقارئ الشاشة name كما هو
  stores: {
    windows: { name: "متجر مايكروسوفت", plat: "ويندوز", latin: false, hint: "، برنامج لويندوز" },
    ios: { name: "App Store", plat: "آيفون", latin: true, hint: "، تطبيق لآيفون" },
    android: { name: "Google Play", plat: "أندرويد", latin: true, hint: "، تطبيق لأندرويد" },
  },
} as const;

/** زرّ «؟» في رئيسية برنامج ويندوز (الإضافة ١٩، نصوص هدى ٢٠٢٦/١١/١٤، src/drop-help.ts): aria-label والتلميح */
export const SDH = {
  label: "شرح أداة الإفلات",
} as const;

/** قائمة المظهر (1.0.2، نصوص هدى ٢٠٢٦/١١/١٤، src/theme.ts). بلا aria-pressed: الحال في اسم الزرّ. */
export const ST = {
  auto: "تلقائي",
  light: "نهاري",
  dark: "ليلي",
  group: "المظهر", // اسم مجموعة الراديو: أول كلمة في اسم الزرّ
  labelAuto: (now: "light" | "dark") => `المظهر: تلقائي، ${now === "dark" ? "ليلي" : "نهاري"} الآن`,
  label: (m: "light" | "dark") => `المظهر: ${m === "dark" ? "ليلي" : "نهاري"}`,
};

/** زرّ واتساب مَحالة في تذييل الرئيسية، والرابط نفسه في /privacy (نصّ 👩‍🏫 هدى النهائي ٢٠٢٦/١١/٠٩). */
export const SW = {
  label: "راسل مَحالة على واتساب", // النصّ المرئي وaria-label معاً
  message: "السلام عليكم، أكتب إليكم من موقع PDFsa.",
  phone: "966592653513",
};
/** privacy.html يكتب هذا الرابط نفسه نصّاً، وtests/whatsapp.test.ts يطابقهما. */
export const WA_URL = `https://wa.me/${SW.phone}?text=${encodeURIComponent(SW.message)}`;

/* ─── «إعداد خطاب» (docs/logs/letter-strings-huda.md بعد تدقيق 👩‍🏫 هدى وقرارات المدير، حرفاً) ─── */
export const SL = {
  title: "إعداد خطاب", // ت١: المدخل في الرئيسية وعنوان الصفحة
  view: "العرض",
  write: "الكتابة",
  preview: "معاينة الصفحة",
  // درجة «الكتابة» على الصفحة (v2 الدفعة د): ن٣ ون٤ بعمود «المعتمد» في docs/logs/letter-editor-v2-strings-huda.md
  zoomIn: "تكبير الصفحة", // ن٣
  zoomOut: "تصغير الصفحة",
  zoomPct: (p: number) => `${ar(p)}٪`,
  zoomLabel: (p: number) => `تكبير الصفحة: ${ar(p)}٪`, // ن٤
  zoomPage: "الصفحة كاملة",
  zoomLine: "عرض السطر",
  zoomReset: "إعادة الحجم الأصلي للصفحة", // ١٥ (additions-12-18-texts-huda.md): aria-label والتلميح، و«الأصلي» درجة الفتح لا ١٠٠٪
  // العمود الجانبي والتلميح (v2 الدفعة هـ): ن١ ون٢ ون٧ ون٨ ون٩ بعمود «المعتمد» في docs/logs/letter-editor-v2-strings-huda.md، حرفاً
  railShow: "إظهار أدوات التنسيق", // ن١
  railHide: "إخفاء أدوات التنسيق", // ن٢
  railTools: "أدوات التنسيق", // اسم زرّ الإغلاق داخل العمود، ومعه aria-expanded="true" (مواصفة لمى (ب))
  // ١٦ إرساء العمود: «المعتمد» في docs/logs/letter-rail-dock-strings-huda.md، و`title` المقبض في additions-12-18-texts-huda.md §١٦، حرفاً
  railMove: "نقل أدوات التنسيق",
  railMoveTo: "نقل أدوات التنسيق إلى",
  railMoveTitle: "اسحب لنقل الأدوات، أو اضغط لاختيار موضعها",
  railDocks: { top: "أعلى الشاشة", "right-top": "أعلى يمين الشاشة", "left-top": "أعلى يسار الشاشة", "right-bottom": "أسفل يمين الشاشة", "left-bottom": "أسفل يسار الشاشة", bottom: "أسفل الشاشة" },
  railMoved: (where: string) => `أدوات التنسيق الآن في ${where}`,
  // ١٤: التراجع والإعادة (نصوص هدى، docs/logs/additions-12-18-texts-huda.md «١٤ و١٧»). الزرّان أيقونتان، وهذا اسمهما المسموع والتلميح
  undo: "تراجع",
  redo: "إعادة",
  undoKeys: { win: "Ctrl+Z", mac: "⌘Z" },
  redoKeys: { win: "Ctrl+Y", mac: "⇧⌘Z" },
  undone: (act: string) => `تم التراجع عن ${act}`,
  redone: (act: string) => `تمت إعادة ${act}`,
  /** أفعال الخطاب خارج النصّ، بمفاتيح سماتها (letter/history.ts) */
  histActs: { ltFont: "تغيير الخط", ltFrame: "تغيير الإطار", ltBg: "تغيير الخلفية", ltMargins: "تغيير الهوامش", ltHeader: "تغيير الترويسة", ltDate: "تغيير التاريخ", ltPos: "نقل المربّع" },
  /** أفعال إضافة عناصر الخطاب وحذفها، بمفاتيح kind في letter/ui.ts. التاريخ له ltDate فلا يدخل هنا */
  histItemAdd: { signature: "إضافة توقيع", stamp: "إضافة ختم", image: "إضافة صورة", logo: "إضافة شعار", text: "إضافة مربّع نص" },
  histItemDel: { signature: "حذف التوقيع", stamp: "حذف الختم", image: "حذف الصورة", logo: "حذف الشعار", text: "حذف مربّع النص" },
  dragHint: "اسحب أي عنصر لتحريكه. النص يُعدَّل من «الكتابة».", // ن٧ب (الدفعة و: مربّع النصّ والتاريخ يُسحبان)
  dragHintEmpty: "لا عناصر للتحريك بعد. أضف توقيعاً أو ختماً من «إدراج» في «الكتابة».", // ن٨
  hideHint: "إخفاء التلميح", // ن٩
  setup: "شكل الصفحة",
  change: "تغيير",
  // «هوامش الصفحة» بدل «النمط» (v2 الدفعة ج): ن١٦–ن٢٠ بعمود «المعتمد» في docs/logs/letter-editor-v2-strings-huda.md
  margins: "هوامش الصفحة", // ن١٦
  marginNames: { normal: "عادية", narrow: "ضيّقة", wide: "واسعة" },
  marginTop: "الأعلى",
  marginBottom: "الأسفل",
  mm: (v: number) => `${ar(v)} مم`,
  marginsRestore: (name: string) => `استعادة هوامش «${name}»`, // ن١٦: الاسم يتبع الدرجة المحدّدة
  marginLess: (edge: string) => `${edge}: أنقص مليمتراً`, // ن١٧
  marginMore: (edge: string) => `${edge}: زد مليمتراً`,
  narrowWhy: "مع الإطار لا تقلّ الهوامش عن ٢٥ مم", // ن١٨
  marginsCard: (name: string) => `هوامش ${name}`, // ن١٩
  background: "الخلفية", // ن٢٠
  pickBackground: "اختر صورة الخلفية",
  removeBackground: "إزالة الخلفية",
  withBackground: "بخلفية",
  backgroundBad: "تعذّر فتح الصورة. جرّب ملفاً بصيغة JPG أو PNG.",
  header: "الترويسة",
  none: "بلا",
  pickHeader: "اختر صورة الترويسة", // م٣
  savedHeader: "الترويسة المحفوظة", // ل٦
  changeImage: "تغيير الصورة",
  showOn: "تظهر على",
  firstPage: "الصفحة الأولى",
  allPages: "كل الصفحات",
  frame: "الإطار",
  noFrame: "بلا إطار",
  thin: "خط رفيع",
  double: "خط مزدوج",
  noHeader: "بلا ترويسة",
  headerFirst: "ترويسة على الصفحة الأولى",
  headerAll: "ترويسة على كل الصفحات",
  headerAria: (v: string) => `الترويسة: ${v}`, // م٨: «الترويسة: على الصفحة الأولى» أو «الترويسة: بلا»
  onFirst: "على الصفحة الأولى",
  onAll: "على كل الصفحات",
  dateHijri: (t: string) => `التاريخ: ${t}`, // ل١
  dateGregorian: (t: string) => `الموافق: ${t}`,
  // التاريخ عنصر اختياري (v2 الدفعة ب): ن١٠–ن١٥ بعمود «المعتمد» في docs/logs/letter-editor-v2-strings-huda.md
  dateRow: "تاريخ", // ن١٠: صفّ «+»
  // مربّع النصّ (v2 الدفعة و): صفّ «+» واسمه المسموع على الصفحة، واعتمدته 👩‍🏫 هدى (الشدّة على «مربّع» وحدها)
  textBox: "مربّع نص",
  /** وحده «مربّع نص»، ومع غيره «مربّع نص ١»… بترتيب الإضافة */
  textBoxName: (n: number, of: number) => (of > 1 ? `مربّع نص ${ar(n)}` : "مربّع نص"),
  addDateTitle: "إضافة تاريخ", // ن١١
  editDateTitle: "تعديل التاريخ",
  calendar: "التقويم", // ن١٢
  calGregorian: "ميلادي",
  calHijri: "هجري",
  calBoth: "كلاهما",
  dateForm: "الشكل",
  formLine: "سطر واحد",
  formRight2: "سطران يميناً",
  formLeft2: "سطران يساراً",
  formRight: "يميناً", // مع تقويم واحد (قرار المدير، يُعرض على هدى في النظرة الأخيرة)
  formLeft: "يساراً",
  pickDay: "اختيار يوم آخر", // ن١٣
  deleteDate: "حذف التاريخ", // ن١٤، و«أضف التاريخ» S4.addDate، و«تم» S.done، و«تاريخ اليوم» S4.todayDate
  dateAria: (t: string) => `التاريخ: ${t}. اضغط للتعديل`, // ن١٥: المسموع، والظاهر «التاريخ: …»
  body: "نص الخطاب",
  empty: "اكتب الخطاب هنا",
  writeFirst: "اكتب نص الخطاب أولاً",
  template: "قالب الخطاب", // م٦
  replaceAsk: "استبدال نص الخطاب بالقالب؟", // ن١٢
  replace: "استبدال",
  keepMine: "إبقاء نصي",
  format: "تنسيق النص",
  bold: "عريض",
  align: (name: string) => `المحاذاة: ${name}`,
  alignRight: "محاذاة لليمين",
  alignCenterLong: "توسيط",
  alignLeftLong: "محاذاة لليسار", // ن٥ (letter-editor-v2-strings-huda.md)، والقصير S4.alignLeft
  split: "يمين ويسار", // ن٦
  splitLong: "سطر من جزأين: الأول عند اليمين والثاني عند اليسار",
  justify: "ضبط",
  justifyLong: "محاذاة من الجهتين (ضبط)", // م٢
  ordered: "قائمة مرقّمة",
  bullet: "قائمة نقطية",
  fontAndSize: (font: string, size: number) => `الخط والمقاس: ${font}، ${ar(size)} نقطة`, // م٥
  size: "مقاس النص", // م٤
  fontAll: "خط الخطاب كله",
  // خط النص المحدَّد في «إعداد خطاب» (هدى ٢٠٢٦/١١/١٣، docs/logs/fonts-texts-huda.md)
  fontSelection: "خط النص المحدَّد",
  fontLetterRow: (name: string) => `خط الخطاب (${name})`,
  fontMixed: "عدّة خطوط",
  font: "خط الخطاب",
  // أسماء الخطوط مصدرٌ واحد لـ«إعداد خطاب» وأدوات الكتابة، والمسيري والرقعة لهما منذ الدفعة ٣ (هدى ٢٠٢٦/١١/١٣، docs/logs/fonts-names-huda.md)
  fonts: { naskh: "نوتو نسخ", amiri: "أميري", markazi: "مركزي", plex: "بلكس", almarai: "المراعي", kufi: "نوتو كوفي", messiri: "المسيري", ruqaa: "رقعة" },
  /** عنوان شبكة الخط في أدوات الكتابة (هدى) */
  fontPick: "الخط",
  // «خطوط الجهاز» في برنامج ويندوز (هدى ٢٠٢٦/١١/١٢، docs/logs/system-fonts-strings-huda.md)
  sysFonts: "خطوط الجهاز",
  appFonts: "خطوط PDFsa",
  sysFontsFailed: "تعذّرت قراءة خطوط الجهاز",
  sysSearch: "ابحث بالاسم",
  sysNone: "لا خط بهذا الاسم",
  // فشل تنزيل خط، مشتركة بين «إعداد خطاب» وأدوات الكتابة (هدى ٢٠٢٦/١١/١٣، docs/logs/fonts-texts-huda.md)
  fontLoadFailed: "تعذّر تحميل الخط، وبقي الخط السابق",
  insert: "إدراج",
  signature: "توقيع",
  stamp: "ختم",
  image: "صورة",
  logo: "شعار",
  newPage: "صفحة جديدة",
  newPageWhy: "ضع مؤشّر الكتابة بعد بعض النص", // ن١٠
  logoWhy: "غير متاح مع الترويسة", // ن١١
  headerWhy: "غير متاحة مع الشعار", // سطر سبب تعطّل الترويسة مع الشعار (نصّ 👩‍🏫 هدى، دفعة L3)
  logoItem: "الشعار",
  imageLoading: "جارٍ إدراج الصورة…", // م١٠، ن١
  imagePreparing: "جارٍ تجهيز الصورة…", // ن٢
  notImage: "هذا الملف ليس صورة. اختر صورة بصيغة JPG أو PNG.", // ل٥
  count: (n: number, max: number) => `${ar(n)} من ${ar(max)} حرف`, // ل٧: بلا فاصل آلاف
  pasteCut: "تم اقتطاع النص عند الحدّ الأقصى.", // ن١٥
  /** مسودّة سامي، تنتظر 👩‍🏫 هدى (docs/logs/edit-file-build-2.md) */
  // هدى (٢٠٢٦/١١/١٤): «أو» لأن أحد الحدّين يكفي، والحروف بفاصلة الآلاف «١٢٬٠٠٠»
  overLimit: (pages: number, chars: number) => `تجاوز الخطاب الحدّ المسموح (${ar(pages)} صفحة أو ${chars.toLocaleString("ar-u-nu-arab")} حرف)، فتوقّف تحديث المعاينة. احذف بعض النص لتعود.`,
  /** فشل التخطيط لغير الحدّ (فهد ١، نصّ 👩‍🏫 هدى docs/logs/edit-file-word-strings-huda.md) */
  layoutFailed: "تعذّر رسم الصفحات فلم تظهر المعاينة، ولا يمكن حفظ الخطاب الآن. أغلقه ثم افتح الملف من جديد.",
  closeAsk: "إغلاق الخطاب دون حفظ؟", // ن١٣
  fileName: "خطاب.pdf", // ن١٤
  fileNameSigned: "خطاب-موقّع.pdf",
  hijriMonths: ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"],
  gregorianMonths: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};
/** قلم «تحرير ملف»: الطمس والتحديد والرسم. النصوص حرفاً من docs/logs/pen-strings-huda.md ثم docs/logs/pens-lama-spec.md («نصوص الأقلام»، هدى ٢٠٢٦/١١/١٤). */
export const pageList = (ns: number[]) => ns.map(ar).join(" و");
export const SP = {
  pen: "اختر القلم",
  penLabel: "اختر القلم",
  redact: "طمس نص",
  highlight: "تحديد",
  draw: "رسم",
  inkWidthLabel: "سماكة الخط",
  widthThin: "رفيع",
  widthMid: "متوسط",
  widthWide: "عريض",
  undoLabel: "تراجع", // اسم زرّ التراجع واحد في كل الشاشات (قرار المدير على ملاحظات هدى، additions-12-18-texts-huda.md)
  removeCover: (i: number, n: number) => (n > 1 ? `أزل الطمس ${ar(i)} من ${ar(n)}` : "أزل الطمس"),
  removeHighlight: (i: number, n: number) => (n > 1 ? `أزل التحديد ${ar(i)} من ${ar(n)}` : "أزل التحديد"),
  redactNote: "عند الحفظ تصير الصفحة المطموسة صورة، فلا يُنسخ نصها ولا يُبحث فيه.",
  /** منع الحفظ بفحص القلم وحده (حبرٌ أو نقطة حرفٍ خارج الغطاء بعد الحرق)، بمواضع الصفحات. ولغيره من الفشل `S.saveFailed`. */
  penRefused(ns: number[]) {
    const n = ns.length;
    if (n === 1) return `لم يُحفظ الملف: قد يبقى جزء من كلمة ظاهراً خارج الطمس في الصفحة ${ar(ns[0]!)}. اطمس الكلمة كاملةً ثم احفظ.`;
    const where = n === 2 ? `الصفحتين ${pageList(ns)}` : n <= 10 ? `الصفحات ${pageList(ns)}` : `${ar(n)} صفحة`;
    return `لم يُحفظ الملف: قد تبقى أجزاء من كلمات ظاهرة خارج الطمس في ${where}. اطمس الكلمات كاملةً ثم احفظ.`;
  },
  hint: "اسحب بإصبع واحد، وبإصبعين حرّك الصفحة",
  /** السطر الأول من إشعار الحفظ: الصفحات (بمواضعها) التي تصير صوراً، و`total` عدد صفحات الملف. */
  burnPages(ns: number[], total: number) {
    const n = ns.length;
    if (n >= 2 && n === total) return "ستصير كل صفحات الملف صوراً، فلا تُنسخ نصوصها ولا يُبحث فيها.";
    if (n === 1) return `ستصير الصفحة ${ar(ns[0]!)} صورةً، فلا يُنسخ نصها ولا يُبحث فيه.`;
    if (n === 2) return `ستصير الصفحتان ${pageList(ns)} صورتين، فلا يُنسخ نصّاهما ولا يُبحث فيهما.`;
    if (n <= 10) return `ستصير الصفحات ${pageList(ns)} صوراً، فلا تُنسخ نصوصها ولا يُبحث فيها.`;
    return `ستصير ${ar(n)} صفحة صوراً، فلا تُنسخ نصوصها ولا يُبحث فيها.`;
  },
  forms: "وتُحذف حقول النموذج والتعليقات في هذه الصفحات.",
  lowered(ns: number[]) {
    const n = ns.length;
    if (n === 1) return `خُفّضت دقة الصفحة ${ar(ns[0]!)} لكبر مقاسها.`;
    if (n === 2) return `خُفّضت دقة الصفحتين ${pageList(ns)} لكبر مقاسهما.`;
    if (n <= 10) return `خُفّضت دقة الصفحات ${pageList(ns)} لكبر مقاساتها.`;
    return `خُفّضت دقة ${ar(n)} صفحة لكبر مقاساتها.`;
  },
  /** ما يُحذف من الملف، بالترتيب نفسه وما وُجد وحده (قرار المدير ٤). */
  removed(found: { attachments: boolean; outlines: boolean; metadata: boolean }) {
    const names = [found.attachments && "المرفقات", found.outlines && "الإشارات المرجعية", found.metadata && "البيانات الوصفية"].filter(Boolean) as string[];
    return names.length ? `ويُحذف من الملف: ${names.join("، و")}.` : "";
  },
  keepTitle: "أبقِ عنوان الملف",
  noRestore: "ولا يُستعاد المطموس من الملف الجديد، ويبقى ملفك الأصلي كما هو.",
} as const;

/** صفحات الشرح قبل اختيار الملف (الملاحظة ٩ من تحديث 1.0.2): النصوص من docs/logs/update-1.0.2-texts-huda.md §٩،
 * وبند القلم ووصف «تحرير ملف» بعد الأقلام الثلاثة (docs/logs/pens-lama-spec.md، «صفحة شرح تحرير ملف»). */
export const SX = {
  signLead: "ضع توقيعك وختمك والتاريخ ونصاً على صفحات الملف",
  signPoints: ["توقيع: ترسمه أو ترفع صورته", "ختم", "تاريخ: هجري أو ميلادي", "نص: تكتبه بنفسك"],
  editLead: "عدّل الملف: اطمس نصاً أو حدّده أو ارسم عليه، وأضف توقيعاً وختماً وتاريخاً ونصاً، ورتّب الصفحات",
  editPoints: ["قلم: طمس نص أو تحديد أو رسم", "توقيع", "ختم", "تاريخ", "نص", "ترتيب الصفحات نقلاً وحذفاً", "تدوير الصفحات كلها"],
  editNote: "الصفحات التي تطمس فيها تصير صوراً، فلا يُنسخ نصها.",
  splitLead: "أخرج صفحات من الملف، أو قسّمه إلى عدة ملفات",
  splitPoints: ["اختر الصفحات بلمسها في الصور المصغّرة", "أو اكتب أرقامها، مثل «١-٣ و٥، ٦-٨»", "كل نطاق يصير ملفاً مستقلاً", "كل صفحة في ملف"],
} as const;

/** «تحرير الملف» (الدفعة ٣، مواصفة لمى §١–٢): مسوّدات سامي، تنتظر 👩‍🏫 هدى (docs/logs/edit-file-build-3.md، «نصّ ينتظر هدى») */
const grouped = (n: number) => n.toLocaleString("ar-u-nu-arab");
export const SE = {
  share: "مشاركة",
  edit: "تحرير الملف",
  preparing: "جارٍ تجهيز المحرّر…",
  shareFailed: "تعذّرت المشاركة. احفظ الملف، ثم شاركه من مكان حفظه.",
  overEdit: (chars: number, max: number) => `الملف أطول مما يحتمله المحرّر: ${grouped(chars)} حرف، والحدّ ${grouped(max)} حرف. يمكنك حفظه كما هو.`,
  editFailed: "تعذّر فتح الملف في المحرّر، والملف المحوَّل سليم.",
  /** سطر شاشة النتيجة تحت الأزرار: ما لا ينتقل إلى المحرّر */
  // هدى (docs/logs/edit-file-word-strings-huda.md): «تختلف» لأن الجدولة والرموز والخطوط والتنسيق ليست سقوطاً
  notMovedLine: (items: string[]) => `تختلف في المحرّر: ${items.join("، ")}`,
  nmImages: (n: number) => `الصور (${ar(n)})`,
  nmTextBoxes: (n: number) => `مربّعات النص (${ar(n)})`,
  nmObjects: (n: number) => `الكائنات المضمّنة والمعادلات (${ar(n)})`,
  nmTables: (n: number) => `الجداول ذات الخلايا المدمجة رأسياً أو المتداخلة (${ar(n)})، ونصّها يتحوّل إلى فقرات`,
  /** «PDF إلى Word» (هدى ٢٠٢٦/١١/١٥): الجداول المدمجة رأسياً تبقى جداول في ملف Word وتظهر فقرات في المحرّر */
  nmTablesFlat: (n: number) => `الجداول ذات الخلايا المدمجة رأسياً أو المتداخلة (${ar(n)}) تظهر فقرات`,
  /** سطر «PDF إلى Word» ملاصق لزرّ «تحرير الملف»، مكان `notMovedLine` */
  editorOnlyLine: (items: string[]) => `في المحرّر فقط: ${items.join("، ")}، وتبقى في ملف Word كما هي.`,
  nmHeaderFooter: "الترويسة والتذييل",
  nmNotes: (n: number) => `الحواشي السفلية (${ar(n)})`,
  nmTabs: (n: number) => `علامات الجدولة (${ar(n)})، وتصير مسافات`,
  nmSymbols: (n: number) => `الرموز الخاصة، مثل مربّعات الاختيار (${ar(n)})`,
  nmFonts: (n: number) => `خطوط غير متاحة (${ar(n)})، وحلّ محلّها خطّ المحرّر`,
  nmFormat: "بعض التنسيق (الإزاحة وتباعد الأسطر والمائل والتسطير واللون وتظليل الخلايا)",
  /** صفحة /letter */
  title: "تحرير الملف",
  fromWord: "من ملف Word: ",
  hideFrom: "إخفاء شريط الملف",
  notMovedHead: "ما يختلف في المحرّر:",
  stayInWord: "تبقى في ملف Word.",
  expired: "انتهت جلسة تحرير الملف. حوّل الملف مرة أخرى ثم اضغط «تحرير الملف».",
};

/* ١٢ و١٨: مقبض التمرير في «تحرير ملف» (docs/logs/additions-12-18-texts-huda.md، معتمدة). والفقاعة بـS.page */
export const SH = {
  group: "التنقل بين الصفحات",
  prev: "الصفحة السابقة",
  next: "الصفحة التالية",
} as const;

/* ١٣ — الممحاة في معاينة التوقيع والختم: النصوص المعتمدة من docs/logs/additions-12-18-texts-huda.md §١٣ */
export const SR = {
  enter: "امسح أجزاء",
  enterLabel: { signature: "امسح أجزاء من التوقيع", stamp: "امسح أجزاء من الختم أو الشعار" },
  stageLabel: { signature: "منطقة مسح التوقيع", stamp: "منطقة مسح الختم أو الشعار" },
  modeErase: "ممحاة",
  modeEraseLabel: "الممحاة",
  modeMove: "تحريك",
  modeMoveLabel: "تحريك الصورة",
  size: "حجم الممحاة",
  sizeText: (n: number) => `${ar(n)} بكسل`,
  undo: "تراجع",
  redo: "إعادة",
  restore: "استعادة",
  restoreLabel: "استعادة كل ما مُسح",
  zoomIn: "تكبير المعاينة",
  zoomOut: "تصغير المعاينة",
  fit: "المعاينة كاملة",
  allErased: {
    signature: "لم يبقَ من التوقيع شيء. تراجع عن آخر مسح أو اضغط استعادة.",
    stamp: "لم يبقَ من الختم أو الشعار شيء. تراجع عن آخر مسح أو اضغط استعادة.",
  },
} as const;

/* ١٤ — التراجع والإعادة في «تحرير ملف»: النصوص المعتمدة من docs/logs/additions-12-18-texts-huda.md §«١٤ و١٧» */
type ItemKind = "signature" | "stamp" | "date" | "text";
const itemNoun: Record<ItemKind, string> = { signature: "التوقيع", stamp: "الختم", date: "التاريخ", text: "النص" };
export const SU = {
  undo: "تراجع",
  redo: "إعادة",
  /** التلميح: اختصار المنصّة وحدها */
  keysUndo: { win: "Ctrl+Z", mac: "⌘Z" },
  keysRedo: { win: "Ctrl+Y", mac: "⇧⌘Z" },
  undone: (a: string) => `تم التراجع عن ${a}`,
  redone: (a: string) => `تمت إعادة ${a}`,
  add: { signature: "إضافة توقيع", stamp: "إضافة ختم", date: "إضافة تاريخ", text: "إضافة نص" } as Record<ItemKind, string>,
  del: (k: ItemKind) => `حذف ${itemNoun[k]}`,
  move: (k: ItemKind) => `نقل ${itemNoun[k]}`,
  grow: (k: ItemKind) => `تكبير ${itemNoun[k]}`,
  shrink: (k: ItemKind) => `تصغير ${itemNoun[k]}`,
  changeDate: "تغيير التاريخ",
  editText: "تعديل النص",
  alignText: "محاذاة النص",
  inkText: "تغيير لون النص",
  fontText: "تغيير خط النص",
  redact: "طمس نص",
  highlight: "تحديد نص",
  draw: "رسم",
  turnPage: "تدوير الصفحة",
  turnFile: "تدوير الملف",
  movePage: "نقل الصفحة",
  deletePage: "حذف الصفحة",
  /* ١٧: زرّا الحبر والخط في الشريط العائم («تنسيق النص» = SL.format، والمحاذاة SL.alignRight…، و✎ S4.editText) */
  inkBtn: "لون النص",
  fontBtn: "خط النص",
  /** «أب» بالخط المختار نفسه على زرّ الخط (لا يُقرأ: الاسم في aria-label) */
  fontSample: "أب",
} as const;
