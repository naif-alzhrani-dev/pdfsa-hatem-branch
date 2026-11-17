/** صورة RGBA بالشكل نفسه الذي لـ`ImageData` (فيُمرَّر `ImageData` كما هو، ويُختبر في Node بلا DOM). */
export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** نقطة بإحداثيات متصلة: (0,0) الحافة العليا اليسرى للبكسل الأول، و(width,height) الحافة السفلى اليمنى للأخير. */
export interface Pt {
  x: number;
  y: number;
}

/** الترتيب ثابت: أعلى-يسار، أعلى-يمين، أسفل-يمين، أسفل-يسار. */
export type Quad = [Pt, Pt, Pt, Pt];
