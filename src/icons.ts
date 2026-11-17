/** أيقونات خطّية 24×24 تتبع لون النص (currentColor). */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M9 6l6 6-6 6"/>'), // في RTL الرجوع إلى اليمين
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  photo: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  // التراجع عن حذف المحفوظ: lucide «rotate-ccw» (رخصة ISC، lucide-static 1.48.0)، وفي RTL يُعكس أفقياً من CSS. THIRD_PARTY_NOTICES.md
  undo: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  // قلم الإخفاء (docs/logs/pens-fixes-before-merge.md §٤): مسار خاص، ويُعكس في RTL من CSS (.pen-tools، كـrotate-ccw) فيبدأ السطر من اليمين
  redact: svg('<path d="M4 5.5h16M4 18.5h11"/><rect x="4" y="9.5" width="12" height="5" rx="1" fill="currentColor"/><path d="M19 12h1"/>'),
  // قلم «تحديد»: lucide «highlighter» (ISC، lucide-static 1.48.0) حرفاً، بلا عكس. THIRD_PARTY_NOTICES.md
  highlight: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  // قلم «رسم»: مسار خاص (قلم فوق موجة)، بلا عكس. والموجة من 21 لا 20.5: طرف القلم كان يلتصق بها في لقطة 375
  draw: svg('<path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L10 16l-4 1 1-4z"/><path d="M4 21q2.25-3 4.5 0t4.5 0 4.5 0"/>'),
  // زرّ الوضع (src/theme.ts): lucide «sun» و«moon» (ISC، lucide-static 1.48.0)، بلا عكس في RTL. THIRD_PARTY_NOTICES.md
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  // زرّ «تنزيل PDFsa» (src/download-menu.ts): lucide «download» (ISC، lucide-static 1.48.0، طوبق حرفاً مع unpkg)، بلا عكس في RTL. THIRD_PARTY_NOTICES.md
  download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
  // «تلقائي» في قائمة المظهر (1.0.2، مواصفة لمى §٣): lucide «sun-moon» (ISC، lucide-static 1.48.0) حرفاً. THIRD_PARTY_NOTICES.md
  sunMoon: svg('<path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/>'),
  moon: svg('<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>'),
  // زرّ «الإعدادات» في الرئيسية (الإضافة ٢١): lucide «settings» (ISC، lucide-static 1.48.0) حرفاً، بلا عكس ولا دوران. THIRD_PARTY_NOTICES.md
  settings: svg('<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>'),
  // أسهم باتجاه فعليّ على الشاشة، لا تُعكس مع RTL
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  // سهم الأسماء الأربعة («صور ← PDF»، src/tool-name.ts): رأسه يساراً نحو الناتج، لا يُعكس (مواصفة لمى ١.٠.٢ §٢)
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  merge: svg('<rect x="3" y="3" width="10" height="13" rx="1.5"/><path d="M17 8h2.5A1.5 1.5 0 0 1 21 9.5v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 11 19.5V19"/><path d="M7 8h2M7 11h2"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  pages: svg('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 9l3-3 3 3M9 15l3 3 3-3"/>'),
  // ترقيم الصفحات: ورقة، وسطرا متن، ورقم صغير أسفلها في الوسط
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  pen: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  // تدوير مع عقارب الساعة (اتجاه فعليّ لا يُعكس)
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>'),
  // تدوير الصفحة والملف (docs/design-spec-batch4.md §١): نصف دائرة مركزها (12,13) ونصف قطرها 7 عبر الأعلى،
  // ورأس السهم عند (19,13) يشير إلى الأسفل، أي مع العقارب. لا يُعكس في RTL ولا يدور هو نفسه
  turn: svg('<path d="M5 13a7 7 0 0 1 14 0"/><path d="M16 10l3 3 3-3"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"/>'), // «فك الحماية»: القفل مفتوحاً (مرّ على لمى بلا تغيير، docs/logs/tool-art-lama-spec-2.md §٣)
  compress: svg('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M12 6v4M9.5 8l2.5 2.5L14.5 8M12 18v-4M9.5 16l2.5-2.5 2.5 2.5"/>'), // «ضغط ملف» (مرّ على لمى بلا تغيير، docs/logs/tool-art-lama-spec-2.md §٣)
  // زرّ «مشاركة» في Safari: صندوق مفتوح من الأعلى وسهم يخرج منه إلى الأعلى (اتجاه فعليّ لا يُعكس)
  // رمز واتساب الرسمي أحادي اللون، مصمت لا خطّي: Simple Icons 16.37.0 (icons/whatsapp.svg، رخصة CC0-1.0)،
  // ومصدره عندهم https://about.meta.com/brand/resources/whatsapp/whatsapp-brand. اللون من CSS (currentColor)
  whatsapp: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>`,
  share: svg('<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5"/>'),
  // الدفعة ٣ (لم تمرّ على لمى): ورقةٌ عليها خطّ مائل، وزاويتا قصّ متقابلتان
  // بلاطات «أدوات أخرى» (polish-lama.md البند 2): lucide (رخصة ISC، lucide-static 1.48.0) كما هي. THIRD_PARTY_NOTICES.md
  fileDigit: svg('<path d="M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 16h2v6"/><path d="M10 22h4"/><rect x="2" y="16" width="4" height="6" rx="2"/>'),
  droplet: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
  fileImage: svg('<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"/>'),
  // «حفظ كملف مضغوط (ZIP)» في «PDF إلى صور» (pdf-images-24-lama-spec.md): lucide `file-archive` (ISC، lucide-static 1.48.0) كما هي
  fileArchive: svg('<path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 12v-1"/><path d="M8 18v-2"/><path d="M8 7V6"/><circle cx="8" cy="20" r="2"/>'),
  images: svg('<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/>'),
  textCursorInput: svg('<path d="M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6"/><path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7"/><path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1"/><path d="M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1"/><path d="M9 6v12"/>'),
  crop: svg('<path d="M7 3v14h14"/><path d="M3 7h14v14"/>'),
  // «فحص ملف» (inspect-lama.md): lucide (رخصة ISC، lucide-static 1.48.0) كما هي. و`octagon-alert` و`triangle-alert` و`info`
  // من الأيقونات التي تأخذها lucide من Feather (رخصة MIT، نصّها في THIRD_PARTY_NOTICES.md)
  microscope: svg('<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>'),
  octagonAlert: svg('<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>'),
  triangleAlert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  searchCheck: svg('<path d="m8 11 2 2 4-4"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  fileX: svg('<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>'),
  // «PDF إلى Word»: lucide «type» (ISC، lucide-static 1.48.0، طوبق مع unpkg حرفاً: docs/logs/pdf-to-word-icon-lama.md)، متماثل فبلا عكس في RTL.
  // بدل ¶ بطلب نايف ٢٠٢٦/١١/١٣ («يظهر في الاخطاء وكانه خطأ»). THIRD_PARTY_NOTICES.md
  type: svg('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
  fileType: svg('<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M11 18h2"/><path d="M12 12v6"/><path d="M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  // مدخل «إعداد خطاب» في الرئيسية (letter-entry-lama-spec.md): lucide «file-text» (رخصة ISC، lucide-static 1.48.0) كما هي،
  // وليست من أيقونات Feather في LICENSE لوسيد. THIRD_PARTY_NOTICES.md
  fileText: svg('<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  /* ١٢ و١٨: سهما مقبض التمرير (docs/logs/additions-12-15-18-lama-spec.md §١٢)، مرسومان هنا بسماكة plus/minus، ولا يُعكسان */
  chevUp: svg('<path d="M7 14.5l5-5 5 5"/>'),
  chevDown: svg('<path d="M7 9.5l5 5 5-5"/>'),
  /* ١٣ — الممحاة (docs/logs/additions-13-16-lama-spec.md): lucide «undo-2» و«redo-2» و«maximize» (ISC، lucide-static 1.48.0،
     طوبقت مساراتها حرفاً مع unpkg ٢٠٢٦/١١/١٤). التراجع والإعادة يُعكسان في RTL من CSS، والملاءمة متماثلة. THIRD_PARTY_NOTICES.md */
  // (١٧) محاذاة النص في الشريط العائم: lucide «text-align-end/center/start» (ISC، lucide-static 1.48.0، طوبقت حرفاً)، لا تُعكس في RTL: «يمين» يمين الصفحة دائماً
  alignRight: svg('<path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/>'),
  alignCenter: svg('<path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/>'),
  alignLeft: svg('<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>'),
  // (١٧) «تعديل النص» أثناء التحرير: lucide «check» (ISC، lucide-static 1.48.0، طوبق حرفاً). غير `check` القائم (أيقونة المنصة)
  checkL: svg('<path d="M20 6 9 17l-5-5"/>'),
  undo2: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  redo2: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>'),
  // (٢٣) زرّ «الصفحة كاملة» في «قص الصفحات»: lucide «maximize» (ISC، lucide-static 1.48.0)، متماثل فلا يُعكس في RTL. THIRD_PARTY_NOTICES.md
  // شارة المصغّر في بطاقة «دمج ملف» (docs/logs/merge-expand-lama-spec.md §٢): lucide «maximize-2» (ISC، lucide-static 1.48.0) حرفاً، بلا عكس في RTL. THIRD_PARTY_NOTICES.md
  maximize2: svg('<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'),
  maximize: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
};

/* ١٥ و١٨ (docs/logs/additions-12-15-18-lama-spec.md §١٥): «الحجم الأصلي» في «إعداد خطاب» — ورقة عمودية 12×16 تحيط بها
   أربع زوايا إطار، تُرسم 20px وسماكتها كعدستَي «+» و«−» (2 على 22px ≈ 2.2 على 20px). متماثلة فلا تُعكس في RTL */
export const ICON_PAGE_FIT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="1.5"/><path d="M2 6V2h4M18 2h4v4M22 18v4h-4M6 22H2v-4"/></svg>`;
/* ١٦ إرساء عمود «إعداد خطاب» (docs/logs/letter-rail-dock-lama-spec.md §١ و§٥): مقبض النقاط الستّ (3 قطراً و3 بينها) رأسيّاً وأفقيّاً،
   وأسهم زرّ الإغلاق إلى حافّة الطيّ الفعلية (لا تُعكس في RTL)، ومعها toRight القائم في ui.ts */
const dots = (cols: number, rows: number) => {
  const w = cols * 3 + (cols - 1) * 3, hgt = rows * 3 + (rows - 1) * 3, x0 = 12 - w / 2 + 1.5, y0 = 12 - hgt / 2 + 1.5;
  let c = "";
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) c += `<circle cx="${x0 + i * 6}" cy="${y0 + j * 6}" r="1.5"/>`;
  return `<svg class="i-grip" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${c}</svg>`;
};
const arrow = (d: string) => `<svg class="i-hide" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
export const RAIL_ICON = {
  gripV: dots(3, 2), // 15×9 في الرأسيّ (عرضاً × ارتفاعاً)
  gripH: dots(2, 3), // 9×15 في الأفقيّ
  toLeft: arrow("M15 6l-6 6 6 6"),
  toUp: arrow("M6 15l6-6 6 6"),
  toDown: arrow("M6 9l6 6 6-6"),
};
