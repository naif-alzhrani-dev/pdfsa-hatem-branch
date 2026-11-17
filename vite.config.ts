import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ترويسات vercel.json نفسها على `vite preview`، فيُختبر الموقع تحت سياسة الأمان المنشورة.
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const headers = Object.fromEntries(vercel.headers[0]!.headers.map((h) => [h.key, h.value]));

/**
 * قواعد vercel.json الخاصة بمسار بعينه (`/letter`: سياسة الأمان مع 'wasm-unsafe-eval') على `vite preview` أيضاً، والقاعدة
 * اللاحقة تغلب السابقة في المفتاح نفسه كما في Vercel. والمسار يُطابَق بلا امتداد (cleanUrls) وبه.
 */
const pathRules: Plugin = {
  name: "vercel-path-headers",
  configurePreviewServer(server) {
    // الأنماط (`/assets/(.*)`، وعامل «Word إلى PDF») تُطابَق تعبيراً نمطياً كاملاً، كما تُطابَق في Vercel، والحرفية بمساواتها
    const rules = vercel.headers.slice(1).map((r) => ({ ...r, re: new RegExp(`^${r.source}$`) }));
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "/").split("?")[0]!.replace(/\.html$/, "");
      const own = new Map<string, string>();
      for (const r of rules) if (r.re.test(path)) for (const h of r.headers) own.set(h.key.toLowerCase(), h.value);
      if (own.size) {
        // ترويسات `preview.headers` (القاعدة العامة) تُكتب بعد هذا الوسيط، فلا تغلب قاعدة المسار
        const set = res.setHeader.bind(res);
        res.setHeader = (k: string, v: number | string | readonly string[]) => set(k, own.get(k.toLowerCase()) ?? v);
        for (const [k, v] of own) set(k, v);
      }
      next();
    });
  },
};

/**
 * يُخرج كاشف ML في scanic من الحزمة: الاستيراد الديناميكي `./scanic-mlDetector.js` داخل scanic يحلّ إلى وحدة فارغة
 * (`src/scan/no-ml.ts`)، فلا يدخل `dist/` رابط jsDelivr ولا مشغّل ONNX. والطبقة الثانية `scripts/check-dist.mjs`.
 */
const scanicNoMl: Plugin = {
  name: "scanic-no-ml",
  enforce: "pre",
  resolveId(id, importer) {
    if (importer && /[\\/]node_modules[\\/]scanic[\\/]/.test(importer) && /scanic-mlDetector/.test(id)) return resolve("src/scan/no-ml.ts");
    return null;
  },
};

/**
 * إشعارات الترخيص في CSS الناتج (ترخيص MIT يطلب بقاءها في النسخ): مُصغِّر CSS في Vite 8 (Lightning CSS) لا يُبقي من تعليقات
 * `/*! … *\/` إلا ما في أول الملف. فتُقرأ من ملفات CSS المصدر التي دخلت كل حزمة، وتوضع بترتيبها في أول ملف CSS الناتج.
 * والحارس `scripts/check-dist.mjs`: عددها في الناتج لا يقلّ عن عددها في `src/style.css`.
 */
const LEGAL = /\/\*![\s\S]*?\*\//g;
const legalComments: Plugin = {
  name: "legal-comments",
  apply: "build",
  enforce: "post",
  generateBundle(_, bundle) {
    const perAsset = new Map<string, Set<string>>(); // ملف CSS الناتج ← ملفات CSS المصدر التي دخلته
    for (const c of Object.values(bundle)) {
      if (c.type !== "chunk") continue;
      const css = [...((c as unknown as { viteMetadata?: { importedCss: Set<string> } }).viteMetadata?.importedCss ?? [])];
      const srcs = c.moduleIds.filter((id) => /\.css$/.test(id));
      for (const f of css) for (const id of srcs) (perAsset.get(f) ?? perAsset.set(f, new Set()).get(f)!).add(id);
    }
    for (const [f, ids] of perAsset) {
      const a = bundle[f];
      if (a?.type !== "asset") continue;
      const notes = [...ids].flatMap((id) => readFileSync(id, "utf8").match(LEGAL) ?? []);
      if (!notes.length) continue;
      a.source = `${notes.join("\n")}\n${String(a.source).replace(LEGAL, "").replace(/^\n+/, "")}`;
    }
  },
};

const toolPages =Object.fromEntries(Object.keys(JSON.parse(readFileSync("src/tools/pages.json", "utf8")) as object).map((slug) => [slug, resolve(`${slug}.html`)]));

export default defineConfig({
  plugins: [scanicNoMl, legalComments, pathRules],
  // التطبيق، وسياسة الخصوصية (/privacy، بلا سكربت)، وصفحة «إعداد خطاب» (/letter، src/letter/page.ts)، وصفحة بحث لكل أداة (`/<slug>`، يولّدها scripts/gen-tool-pages.mjs من src/tools/pages.json)
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: resolve("index.html"), privacy: resolve("privacy.html"), letter: resolve("letter.html"), ...toolPages } } },
  // pdf.js يُنشئ العامل بـ{ type: "module" }، وعامله فيه import() فلا يصلح iife. وعامل المسح الحيّ يستورد scanic، فيُخرج منه كاشف ML كذلك
  worker: { format: "es", plugins: () => [scanicNoMl] },
  preview: { headers, port: 4173, strictPort: true },
  test: { include: ["tests/**/*.test.ts"] },
} as never);
