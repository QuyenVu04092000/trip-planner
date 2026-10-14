import type { CSSProperties } from 'react';

// Màu bìa trip: hoặc class gradient Tailwind có sẵn ("from-terra to-terra-dark"),
// hoặc màu người dùng tự chọn dạng hex ("#3A7BD5") → gradient tự sinh bằng inline style.

export const isHexColor = (c: string | undefined | null): c is string =>
  !!c && /^#[0-9a-f]{6}$/i.test(c);

// Trộn màu với đen theo tỉ lệ amount (0–1) → tông đậm hơn cho đuôi gradient.
export function darken(hex: string, amount = 0.4): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

// className + style để gắn lên phần tử làm nền bìa.
export function coverProps(coverColor: string): { className: string; style?: CSSProperties } {
  if (isHexColor(coverColor)) {
    return {
      className: '',
      style: { backgroundImage: `linear-gradient(135deg, ${coverColor}, ${darken(coverColor)})` },
    };
  }
  return { className: `bg-gradient-to-br ${coverColor}` };
}

// Ảnh người dùng tải lên làm biểu tượng → cắt vuông giữa ảnh, thu về size×size,
// trả data URL (lưu thẳng vào cột trips.icon_image, ~20–40KB). WebP nếu trình duyệt
// mã hoá được, không thì PNG (giữ nền trong suốt của logo).
export function imageToIcon(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      const webp = canvas.toDataURL('image/webp', 0.85);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh'));
    };
    img.src = url;
  });
}

// Lấy đúng 1 emoji (1 grapheme) từ chuỗi người dùng gõ/dán — "👨‍👩‍👧" vẫn là 1.
export function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return '';
  // Intl.Segmenter chưa có trong lib TS của project → khai báo kiểu tối thiểu.
  const Seg = (Intl as unknown as {
    Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => {
      segment(s: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  if (Seg) {
    for (const { segment } of new Seg(undefined, { granularity: 'grapheme' }).segment(t)) return segment;
  }
  return Array.from(t)[0] ?? '';
}
