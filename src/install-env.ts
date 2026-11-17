/**
 * قرار بطاقة «أضف إلى الشاشة الرئيسية»: أيّ جهاز هذا، وهل تظهر البطاقة. دوالّ نقية بلا DOM (tests/install-env.test.ts).
 * - "ios": آيفون وآيباد (ومنه iPadOS الذي يعلن نفسه Mac، فيُعرف بنقاط اللمس).
 * - "android": أندرويد وأي جوال أو لوحيّ آخر، والإضافة من قائمة المتصفح أو من نافذة التثبيت.
 * - "inapp": متصفح داخل تطبيق آخر (Instagram وFacebook وSnapchat وTikTok…)، ولا إضافة منه.
 * - null: كمبيوتر، فلا بطاقة.
 */
export type InstallEnv = "ios" | "android" | "inapp" | null;

const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Snapchat|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Twitter|\bLine\/|; wv\)/i;
const IOS = /iPhone|iPad|iPod/;
const MOBILE = /Android|Mobile|Tablet|Silk|KAIOS/i;

export function installEnv(ua: string, maxTouchPoints = 0): InstallEnv {
  const ipadAsMac = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const ios = IOS.test(ua) || ipadAsMac;
  if (!ios && !MOBILE.test(ua)) return null;
  if (IN_APP.test(ua)) return "inapp";
  return ios ? "ios" : "android";
}

/**
 * الصفحة داخل تطبيق PDFsa (Tauri)، فلا معنى لإضافتها إلى الشاشة الرئيسية: `tauri://localhost` على iOS (MAIN_ORIGIN في ios.rs)،
 * و`http://tauri.localhost` على ويندوز (MAIN_ORIGIN في win.rs) وأندرويد. وWKWebView لا يجيب `display-mode: standalone` ولا `navigator.standalone`.
 */
export function inAppShell(protocol: string, hostname: string): boolean {
  return (protocol === "tauri:" && hostname === "localhost") || (protocol === "http:" && hostname === "tauri.localhost");
}

export interface CardState {
  env: InstallEnv;
  standalone: boolean; // مفتوح من الشاشة الرئيسية أصلاً
  installed: boolean; // وصل appinstalled في هذه الزيارة
  never: boolean; // «لا تُظهر هذا مرة أخرى» محفوظ
  closedThisVisit: boolean; // أُغلقت بلا تحديد في هذه الزيارة
}

export function shouldShowCard(s: CardState): boolean {
  return s.env !== null && !s.standalone && !s.installed && !s.never && !s.closedThisVisit;
}

/**
 * برنامج ويندوز وحده (لـ«خطوط الجهاز» في الخطاب، W14): `http://tauri.localhost` كأندرويد، فيفرّقه أن المتصفح ليس جوالاً
 * ولا لوحياً (`installEnv` = null)، فلا يُطلب بروتوكول الخطوط في أندرويد ولا iOS ولا الموقع.
 */
export function inWindowsApp(protocol: string, hostname: string, ua: string, maxTouchPoints = 0): boolean {
  return protocol === "http:" && hostname === "tauri.localhost" && installEnv(ua, maxTouchPoints) === null;
}
