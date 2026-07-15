/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  future: {
    // hover: chỉ áp dụng trên thiết bị có chuột thật (không bị kẹt trên mobile)
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'], // tên chuyến đi, số tiền lớn — "chữ ký" nhật ký
      },
      colors: {
        // ── Journal palette: giấy kem + mực + đất nung ──────────────────────
        paper:       '#FAF6EF', // nền trang
        parchment:   '#F3EDE2', // nền phụ / hover
        sand:        '#EAE3D6', // viền
        'sand-dark': '#D8CFBE', // viền đậm
        dune:        '#B5AC9E', // chữ gợi ý / disabled
        stone:       '#8A8378', // chữ phụ
        ink:         '#1E2A36', // chữ chính + nền đậm
        'ink-light': '#2C3B4A', // chip trên nền ink / hover ink
        terra:       '#C4622D', // accent hành động duy nhất
        'terra-dark':'#A34E20',
        'terra-pale':'#F1DDCF',
        sage:        '#9DAF9A', // thiên nhiên / tiền dương
        'sage-pale': '#E7EDE4',
        'sage-dark': '#3D5C3A',
        moss:        '#6E8767',
        gold:        '#C08A2E', // kỷ niệm / nhấn ấm
        'gold-pale': '#F4E3C8',
        'gold-dark': '#8A5A19',
        clay:        '#B07C6F',
        'clay-pale': '#F0E2DE',
        'clay-dark': '#7C4A3E',
        slateblue:   '#4A6274',
        plum:        '#8A6A7B',
        wine:        '#9B4444', // cảnh báo / xoá
        'wine-dark': '#7E3535',
        'wine-pale': '#F5E0DC',
      },
    },
  },
  plugins: [],
}
