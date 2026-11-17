// مدخل عدّاد الزوار للصفحتين: الرئيسية (src/main.ts) وصفحة الخصوصية (privacy.html)
import { loadAnalytics, trackWhatsappClicks } from "./analytics";

loadAnalytics();
trackWhatsappClicks();
