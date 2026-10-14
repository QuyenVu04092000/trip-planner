import type { Trip } from '../types';

// Biểu tượng chuyến đi: ảnh người dùng tải lên (nếu có), không thì emoji.
// `size` = cạnh px của ảnh; emoji dùng className cỡ chữ tương ứng do nơi gọi truyền.
export default function TripIcon({
  trip,
  size,
  className = '',
}: {
  trip: Pick<Trip, 'emoji' | 'iconImage'>;
  size: number;
  className?: string;
}) {
  if (trip.iconImage) {
    return (
      <img
        src={trip.iconImage}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
        className={`object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return <span className={`leading-none flex-shrink-0 ${className}`}>{trip.emoji}</span>;
}
