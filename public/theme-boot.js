// المظهر (1.0.2): يُطبَّق قبل الرسم الأول، فلا وميض. «light» و«dark» كما حُفظا، وغيرهما (ومنه «auto» وبلا اختيار) بساعة الجهاز:
// ليلي من 18:00 إلى 06:00. ملف من الأصل نفسه لا سكربت مضمَّن (سياسة الأمان script-src 'self')، ويُحمَّل متزامناً في <head> قبل CSS.
// المفتاح والألوان والساعتان نفسها في src/theme.ts، ويحرس تطابقها tests/theme.test.ts. والتبديل والصفحة مفتوحة في src/theme.ts.
(function () {
  var t = null;
  try { t = localStorage.getItem("pdfsa.theme"); } catch (e) { /* التخزين ممنوع: التلقائي */ }
  if (t !== "light" && t !== "dark") {
    var hr = new Date().getHours();
    t = hr >= 18 || hr < 6 ? "dark" : "light";
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", t);
  var c = t === "dark" ? "#000E1F" : "#F8F8FB";
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", c);
})();
