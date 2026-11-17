/**
 * رسوم الحالة الفارغة لأدوات «أدوات أخرى» (docs/logs/tool-art-lama-spec.md): رسمٌ ثابت داخل الورقة يُظهر نتيجة الأداة.
 * نصوص ثابتة كأيقونات src/icons.ts، بإحداثيات A4 (210×297) فتبقى النِّسب بأي مقاس للورقة.
 * الألوان بأصناف `.art-*` في style.css من رموز الورقة وحدها (صفات SVG لا تقبل var())، فالرسم واحد نهاراً وليلاً.
 * الأدوات العشر (المواصفة الثانية للسبع: docs/logs/tool-art-lama-spec-2.md)، والدمج والمسح (docs/logs/merge-scan-art-lama-spec.md)،
 * وصفحات الشرح: التوقيع والتحرير والتقسيم (docs/logs/intro-art-lama-spec.md)، والرئيسية بلا رسم.
 */
import { DEFAULTS, numberLabel } from "./page-numbers-core";

const svg = (d: string) =>
  `<svg class="tool-art" viewBox="0 0 210 297" aria-hidden="true" focusable="false">${d}</svg>`;

const ART: Record<string, string> = {
  // عدسة searchCheck (inspect.ts) مكبَّرة 2.75 فوق صفحة، والصحّ داخلها صغيراً بلون الورقة وبلا حركة (لا كإشارة «حُفظ الملف»)
  inspect: svg(
    '<rect class="art-guide" x="81" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M128 162H90M128 171H98M128 180H106M128 189H94M128 198H102"/>' +
    '<circle class="art-cover" cx="95" cy="205" r="22"/>' +
    '<path class="art-act" d="M86.75 205L92.25 210.5L103.25 199.5"/>' +
    '<path class="art-act" d="M110.7 220.7L122.5 232.5"/>'),
  // صفحتان: الأمامية «١» يميناً و«٢» خلفها، والرقم وسط أسفل الصفحة (DEFAULTS.pos)، مكبَّراً عمداً (11pt يخرج 1.4px هنا)
  "page-numbers": svg(
    '<rect class="art-guide" x="58" y="147" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M105 159H67M105 168H75M105 177H83"/>' +
    `<text class="art-num-guide" x="86" y="217" font-size="9" text-anchor="middle" dominant-baseline="central">${numberLabel(2, DEFAULTS.digits)}</text>` +
    '<rect class="art-cover" x="96" y="157" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M143 169H105M143 178H113M143 187H121"/>' +
    `<text class="art-num" x="124" y="227" font-size="9" text-anchor="middle" dominant-baseline="central">${numberLabel(1, DEFAULTS.digits)}</text>`),
  // «مسودة» في وسط الصفحة مائلةً 45° صاعدةً كما تضعها الأداة (ANGLE)، وحجمها نسبة FONT_MAX_PT (72pt) إلى A4
  watermark: svg('<text class="art-wm" x="105" y="148.5" font-size="25.4" text-anchor="middle" dominant-baseline="central" transform="rotate(-45 105 148.5)">مسودة</text>'),
  // كأداة القصّ: ما خارج الإطار معتم (evenodd، حتى حافّة الورقة)، وإطار متّصل يحيط بالأسطر، ونقاط مستديرة في زواياه
  crop: svg(
    '<path class="art-dim" data-bleed="" d="M1.5 0H208.5A1.5 1.5 0 0 1 210 1.5V295.5A1.5 1.5 0 0 1 208.5 297H1.5A1.5 1.5 0 0 1 0 295.5V1.5A1.5 1.5 0 0 1 1.5 0ZM14 14V222H196V14Z"/>' +
    '<rect class="art-act" x="14" y="14" width="182" height="208"/>' +
    '<circle class="art-handle" cx="14" cy="14" r="3"/><circle class="art-handle" cx="196" cy="14" r="3"/>' +
    '<circle class="art-handle" cx="14" cy="222" r="3"/><circle class="art-handle" cx="196" cy="222" r="3"/>'),
  // صورة مربّعة على اليمين ← سهم ← صفحة A4 عمودية بلون الفعل، والصورة فيها بعرضها متوسّطةً (layoutFor في jpg-to-pdf-core.ts)
  "jpg-to-pdf": svg(
    '<rect class="art-img" x="128" y="167.5" width="44" height="44" rx="1.5"/>' +
    '<rect class="art-guide" x="128" y="167.5" width="44" height="44" rx="1.5"/>' +
    '<circle class="art-guide" cx="140" cy="179.5" r="4"/>' +
    '<path class="art-guide" d="M172 197.5L158 183.5L136 205.5"/>' +
    '<path class="art-guide" d="M114 181.5L106 189.5L114 197.5"/>' +
    '<rect class="art-img" x="38" y="161.5" width="56" height="56"/>' +
    '<circle class="art-guide" cx="53.3" cy="176.8" r="5.1"/>' +
    '<path class="art-guide" d="M94 199.7L76.2 181.9L48.2 209.9"/>' +
    '<rect class="art-act" x="38" y="150" width="56" height="79" rx="1.5"/>'),
  // صفحة على اليمين ← سهم ← صورة بمقاسها على اليسار
  "pdf-to-jpg": svg(
    '<rect class="art-guide" x="121" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M168 162H130M168 171H138M168 180H146"/>' +
    '<path class="art-guide" d="M109 181.5L101 189.5L109 197.5"/>' +
    '<rect class="art-act" x="33" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M80 162H42M80 171H50M80 180H58"/>' +
    '<circle class="art-act" cx="48" cy="198" r="4"/>' +
    '<path class="art-act" d="M89 212L75 198L51 222"/>'),
  // ICON.lock مكبَّراً 2.5 فوق أسفل صفحة
  protect: svg(
    '<rect class="art-guide" x="77" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M124 162H86M124 171H94M124 180H102"/>' +
    '<path class="art-act" d="M96.25 213.5V206a8.75 8.75 0 0 1 17.5 0v7.5"/>' +
    '<rect class="art-cover" x="87.5" y="213.5" width="35" height="22.5" rx="5"/>'),
  // مثل «حماية»، والحلقة وحدها من ICON.unlock: قفل مفتوح (ما تنتهي إليه الأداة)
  unlock: svg(
    '<rect class="art-guide" x="77" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M124 162H86M124 171H94M124 180H102"/>' +
    '<path class="art-act" d="M96.25 213.5V206a8.75 8.75 0 0 1 17 -3"/>' +
    '<rect class="art-cover" x="87.5" y="213.5" width="35" height="22.5" rx="5"/>'),
  // صفحة كبيرة على اليمين ← سهم ← صفحة صغيرة (37% من مساحتها) بلون الفعل، والمجموعة في وسط الفراغ تحت الأسطر
  compress: svg(
    '<rect class="art-guide" x="112" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M159 162H121M159 171H129M159 180H137"/>' +
    '<path class="art-guide" d="M98 197L90 205L98 213"/>' +
    '<rect class="art-act" x="42" y="181" width="34" height="48" rx="1.5"/>' +
    '<path class="art-line" stroke-width="1.8" d="M70.5 188.5H47.5M70.5 194H52.5M70.5 199.5H57.5"/>'),
  // PDF إلى Word (docs/logs/pdf-to-word-lama-spec.md §٢): أسطر الورقة الستّ متفاوتة كما في PDF، وتحتها فقرة مضبوطة من أربعة أسطر تامّة
  // وسطر قصير، الثاني مقطوع بمؤشّر كتابة، وآخرها T (lucide type ×0.75، tx 89 ty 196). وحدها بلا «صفحة ← سهم ← صفحة»
  "pdf-to-word": svg(
    '<path class="art-line" stroke-width="3" d="M172 169H38M172 178H143M137 178H38M172 187H38M172 196H38M172 205H110"/>' +
    '<path class="art-act" d="M137.5 171.5H142.5M140 171.5V184.5M137.5 184.5H142.5"/>' +
    '<path class="art-act" d="M98 199V211M92 201.25V199.75a.75 .75 0 0 1 .75-.75h10.5a.75 .75 0 0 1 .75.75v1.5M95.75 211H100.25"/>'),
  // ورقة Word بزاوية مطويّة وT بالرمادي (المصدر) يميناً ← سهم ← صفحة PDF بأسطرها بلون الفعل يساراً (word-to-pdf-lama-spec.md §٣)
  "word-to-pdf": svg(
    '<path class="art-guide" d="M122.5 150H163L177 164V227.5A1.5 1.5 0 0 1 175.5 229H122.5A1.5 1.5 0 0 1 121 227.5V151.5A1.5 1.5 0 0 1 122.5 150ZM163 150V162.5A1.5 1.5 0 0 0 164.5 164H177"/>' +
    '<path class="art-guide" d="M149 191V212M138.5 194.5V192.75A1.75 1.75 0 0 1 140.25 191H157.75A1.75 1.75 0 0 1 159.5 192.75V194.5M145.5 212H152.5"/>' +
    '<path class="art-guide" d="M109 181.5L101 189.5L109 197.5"/>' +
    '<rect class="art-act" x="33" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M80 164H42M80 173H42M80 182H42M80 191H42M80 200H60"/>'),
  // حقلان معبّآن بـ--ink-paper (لون الحقل، والافتراضي #000 في fill-form.ts)، واختيار دائرة لا خانة صحّ
  "fill-form": svg(
    '<path class="art-line" stroke-width="3" d="M187.5 147H155.5M187.5 185H163.5"/>' +
    '<rect class="art-guide" x="22.5" y="153" width="165" height="18" rx="1.5"/>' +
    '<path class="art-ink" stroke-width="3" d="M179.5 162H115.5"/>' +
    '<rect class="art-guide" x="82.5" y="191" width="105" height="18" rx="1.5"/>' +
    '<path class="art-ink" stroke-width="3" d="M179.5 200H131.5"/>' +
    '<circle class="art-guide" cx="182.5" cy="231" r="5"/>' +
    '<circle class="art-dot" cx="182.5" cy="231" r="2.5"/>' +
    '<path class="art-line" stroke-width="3" d="M172.5 231H140.5M117.5 231H93.5"/>' +
    '<circle class="art-guide" cx="127.5" cy="231" r="5"/>'),
  // دمج ملف: ملفّان صغيران يميناً ← سهم بذيلين يلتقيان ← ملفٌّ ناتج بمجموعتَي أسطرهما، وخلفه حافّة رزمة بإزاحة 4
  merge: svg(
    '<rect class="art-guide" x="140" y="141" width="34" height="48" rx="1.5"/>' +
    '<path class="art-line" stroke-width="1.8" d="M168.5 148.5H145.5M168.5 154H150.5M168.5 159.5H155.5"/>' +
    '<rect class="art-guide" x="140" y="197" width="34" height="48" rx="1.5"/>' +
    '<path class="art-line" stroke-width="1.8" d="M168.5 204.5H147.5M168.5 210H154.5"/>' +
    '<path class="art-guide" d="M134 165C118 165 120 193 100 193M134 221C118 221 120 193 100 193"/>' +
    '<path class="art-guide" d="M107 186L100 193L107 200"/>' +
    '<rect class="art-guide" x="32" y="149.5" width="56" height="79" rx="1.5"/>' +
    '<rect class="art-cover" x="36" y="153.5" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M83 165.5H45M83 174.5H53M83 183.5H61"/>' +
    '<path class="art-line" stroke-width="3" d="M83 201.5H48M83 210.5H60"/>'),
  // مسح ملف: صورةٌ فيها ورقة مائلة بمنظور (الفتحة بـevenodd) ← سهم ← صفحة مستقيمة بالأسطر نفسها. بلا نقاط زوايا (.scanic-handle بـ--stamp)
  scan: svg(
    '<path class="art-img" fill-rule="evenodd" d="M121.5 150H174.5A1.5 1.5 0 0 1 176 151.5V227.5A1.5 1.5 0 0 1 174.5 229H121.5A1.5 1.5 0 0 1 120 227.5V151.5A1.5 1.5 0 0 1 121.5 150ZM131 163L127 220L170 214L167 158Z"/>' +
    '<rect class="art-guide" x="120" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-guide" d="M131 163L167 158L170 214L127 220Z"/>' +
    '<path class="art-line" stroke-width="2.5" d="M161 167L135 170.6M161.7 176L141.7 178.8M162.4 185L148.4 186.9"/>' +
    '<path class="art-guide" d="M110 181.5L102 189.5L110 197.5"/>' +
    '<rect class="art-act" x="34" y="150" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M81 162H43M81 171H51M81 180H59"/>'),
  // صفحات الشرح (docs/logs/intro-art-lama-spec.md):
  // توقيع ملف: خانة الرئيسية (.slot.marks) في موضعها نفسه أسفل الطرف الأيسر، بعلاماتها الأربع art-act، وفيها توقيع بالحبر (art-ink)
  sign: svg(
    '<path class="art-act" d="M23.25 235.05V226.05H32.25M105.15 226.05H114.15V235.05M114.15 261.75V270.75H105.15M32.25 270.75H23.25V261.75"/>' +
    '<path class="art-ink" stroke-width="2.25" stroke-linejoin="round" d="M97.5 233C97.8 239 97.3 246 95.5 251C94 252.6 91.8 252.4 90.8 248.2C90.6 251.6 87.6 252.6 85.4 248.4C85.2 251.8 81.5 252.6 78.5 251.2C76.5 250 75.6 243 76 236C76.3 242 75.2 249 72 251.4C69.5 253 66.5 252.5 64 251.5C62 257 56 263.5 48 263.5C42 263.5 38.5 259 39.5 252.5M59 241.5L61.5 240.5"/>'),
  // تحرير ملف: أسطر الصفحة (art-line) وعلى الأول طمس (art-dot)، ثم ما يضيفه المستخدم بالحبر: سطر نص، وتاريخ يسبقه ICON.calendar ×1.75 بلون الفعل
  edit: svg(
    '<path class="art-line" stroke-width="3" d="M187.5 150H40.5M187.5 162H70.5M187.5 174H100.5"/>' +
    '<rect class="art-dot" x="84" y="145" width="64" height="10" rx="1.5"/>' +
    '<path class="art-ink" stroke-width="3" d="M187.5 190H112.5M148 214H104"/>' +
    '<rect class="art-act" x="157.75" y="202.625" width="29.75" height="26.25" rx="3.5"/>' +
    '<path class="art-act" d="M157.75 211.375H187.5M165.625 199.125V206.125M179.625 199.125V206.125"/>'),
  // تقسيم ملف: عكس «دمج ملف» — صفحة art-guide يميناً بمجموعتَي أسطر وبينهما خطّ قطع متقطّع بلون الفعل (كالخطّ المتقطّع في splitIcon)،
  // ← سهم يتفرّع إلى رأسين ← ملفّان صغيران art-act يساراً، بأسطر 3 ثم 2
  split: svg(
    '<rect class="art-guide" x="120" y="153.5" width="56" height="79" rx="1.5"/>' +
    '<path class="art-line" stroke-width="3" d="M167 165.5H129M167 174.5H137M167 183.5H145M167 201.5H132M167 210.5H144"/>' +
    '<path class="art-act" d="M176 193H173M169.375 193H166.375M162.75 193H159.75M156.125 193H153.125M149.5 193H146.5M142.875 193H139.875M136.25 193H133.25M129.625 193H126.625M123 193H120"/>' +
    '<path class="art-guide" d="M120 193H110C90 193 92 165 76 165M110 193C90 193 92 221 76 221"/>' +
    '<path class="art-guide" d="M83 158L76 165L83 172M83 214L76 221L83 228"/>' +
    '<rect class="art-act" x="36" y="141" width="34" height="48" rx="1.5"/>' +
    '<path class="art-line" stroke-width="1.8" d="M64.5 148.5H41.5M64.5 154H46.5M64.5 159.5H51.5"/>' +
    '<rect class="art-act" x="36" y="197" width="34" height="48" rx="1.5"/>' +
    '<path class="art-line" stroke-width="1.8" d="M64.5 204.5H43.5M64.5 210H50.5"/>'),
};

/** رسم الأداة داخل `.start-sheet`، أو null لأداة بلا رسم. */
export function toolArt(slug: string): SVGSVGElement | null {
  const d = ART[slug];
  if (!d) return null;
  const t = document.createElement("template");
  t.innerHTML = d;
  return t.content.firstElementChild as SVGSVGElement;
}
