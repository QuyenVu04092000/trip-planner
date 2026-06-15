// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — xlsx-js-style không có type declarations
import XLSXStyle from 'xlsx-js-style';
import type { TripExpense, TripMember } from '../types';

// ── Style helpers ─────────────────────────────────────────────────────────────

const BLUE   = '2563EB';
const GREEN  = '16A34A';
const RED    = 'DC2626';
const LIGHT_BLUE = 'DBEAFE';
const LIGHT_GREEN = 'DCFCE7';
const LIGHT_RED   = 'FEE2E2';
const GRAY   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';

function border() {
  const b = { style: 'thin', color: { rgb: BORDER_COLOR } };
  return { top: b, bottom: b, left: b, right: b };
}

function headerCell(value: string, bgColor = BLUE): object {
  return {
    v: value, t: 's',
    s: {
      font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill:      { fgColor: { rgb: bgColor } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border:    border(),
    },
  };
}

function dataCell(value: string | number, opts: {
  bold?: boolean;
  color?: string;
  bg?: string;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;
} = {}): object {
  const isNum = typeof value === 'number';
  return {
    v: value,
    t: isNum ? 'n' : 's',
    z: opts.numFmt ?? (isNum ? '#,##0' : undefined),
    s: {
      font:      { bold: opts.bold ?? false, color: { rgb: opts.color ?? '1E293B' }, sz: 10 },
      fill:      opts.bg ? { fgColor: { rgb: opts.bg } } : undefined,
      alignment: { horizontal: opts.align ?? (isNum ? 'right' : 'left'), vertical: 'center' },
      border:    border(),
    },
  };
}

function emptyCell(): object {
  return { v: '', t: 's', s: { border: border() } };
}

// ── Balance calc ──────────────────────────────────────────────────────────────

function calcBalances(expenses: TripExpense[], members: TripMember[]) {
  const map: Record<string, { email: string; net: number }> = {};
  for (const m of members) map[m.userId] = { email: m.userEmail, net: 0 };
  for (const exp of expenses) {
    if (map[exp.paidBy]) map[exp.paidBy].net += exp.amount;
    for (const s of exp.splits) {
      if (map[s.userId]) map[s.userId].net -= s.amount;
    }
  }
  return members.map(m => ({ userId: m.userId, email: m.userEmail, net: map[m.userId]?.net ?? 0 }));
}

// ── Sheet 1: Chi tiêu ─────────────────────────────────────────────────────────

function buildSheet1(expenses: TripExpense[]) {
  const ws: Record<string, object> = {};
  let r = 0; // row index

  // Title
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = headerCell('STT',          BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = headerCell('Ngày',         BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 2 })] = headerCell('Mô tả',        BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 3 })] = headerCell('Người trả',    BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 4 })] = headerCell('Số tiền (đ)',   BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 5 })] = headerCell('Số người chia', BLUE);
  ws[XLSXStyle.utils.encode_cell({ r, c: 6 })] = headerCell('Mỗi người (đ)', BLUE);
  r++;

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  for (let i = 0; i < expenses.length; i++) {
    const exp = expenses[i];
    const bg = i % 2 === 0 ? 'FFFFFF' : GRAY;
    const perPerson = exp.splits.length > 0 ? Math.round(exp.amount / exp.splits.length) : 0;
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = dataCell(i + 1,                { bg, align: 'center' });
    ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = dataCell(exp.date || '',        { bg, align: 'center' });
    ws[XLSXStyle.utils.encode_cell({ r, c: 2 })] = dataCell(exp.description,       { bg });
    ws[XLSXStyle.utils.encode_cell({ r, c: 3 })] = dataCell(exp.paidByEmail,       { bg });
    ws[XLSXStyle.utils.encode_cell({ r, c: 4 })] = dataCell(exp.amount,            { bg });
    ws[XLSXStyle.utils.encode_cell({ r, c: 5 })] = dataCell(exp.splits.length,     { bg, align: 'center' });
    ws[XLSXStyle.utils.encode_cell({ r, c: 6 })] = dataCell(perPerson,             { bg });
    r++;
  }

  // Total row
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = emptyCell();
  ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = emptyCell();
  ws[XLSXStyle.utils.encode_cell({ r, c: 2 })] = dataCell('TỔNG CỘNG', { bold: true, bg: LIGHT_BLUE, color: BLUE });
  ws[XLSXStyle.utils.encode_cell({ r, c: 3 })] = emptyCell();
  ws[XLSXStyle.utils.encode_cell({ r, c: 4 })] = dataCell(total, { bold: true, bg: LIGHT_BLUE, color: BLUE });
  ws[XLSXStyle.utils.encode_cell({ r, c: 5 })] = emptyCell();
  ws[XLSXStyle.utils.encode_cell({ r, c: 6 })] = emptyCell();

  ws['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: 6 } });
  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 32 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
  ];
  ws['!rows'] = Array.from({ length: r + 1 }, (_, i) => ({ hpt: i === 0 ? 22 : 18 }));

  return ws;
}

// ── Sheet 2: Chia đầu người ───────────────────────────────────────────────────

function buildSheet2(expenses: TripExpense[], members: TripMember[]) {
  const ws: Record<string, object> = {};
  const balances = calcBalances(expenses, members);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  let r = 0;

  // Header
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = headerCell('Mô tả');
  ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = headerCell('Tổng (đ)');
  members.forEach((m, ci) => {
    ws[XLSXStyle.utils.encode_cell({ r, c: ci + 2 })] = headerCell(m.userEmail.split('@')[0]);
  });
  r++;

  // Expense rows
  for (let i = 0; i < expenses.length; i++) {
    const exp = expenses[i];
    const bg = i % 2 === 0 ? 'FFFFFF' : GRAY;
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = dataCell(exp.description, { bg });
    ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = dataCell(exp.amount,      { bg, bold: true });
    members.forEach((m, ci) => {
      const split = exp.splits.find(s => s.userId === m.userId);
      ws[XLSXStyle.utils.encode_cell({ r, c: ci + 2 })] = dataCell(split ? split.amount : 0, { bg });
    });
    r++;
  }

  // Empty row
  for (let c = 0; c < members.length + 2; c++) {
    ws[XLSXStyle.utils.encode_cell({ r, c })] = emptyCell();
  }
  r++;

  // Total owed row
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = dataCell('TỔNG CHI PHÍ', { bold: true, bg: LIGHT_BLUE, color: BLUE });
  ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = dataCell(total,           { bold: true, bg: LIGHT_BLUE, color: BLUE });
  members.forEach((m, ci) => {
    const owed = expenses.reduce((s, e) => {
      const sp = e.splits.find(x => x.userId === m.userId);
      return s + (sp ? sp.amount : 0);
    }, 0);
    ws[XLSXStyle.utils.encode_cell({ r, c: ci + 2 })] = dataCell(owed, { bold: true, bg: LIGHT_BLUE });
  });
  r++;

  // Chốt row
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = dataCell('CHỐT (+ được nhận / - còn nợ)', { bold: true, bg: 'FFF7ED', color: 'EA580C' });
  ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = emptyCell();
  members.forEach((m, ci) => {
    const b = balances.find(x => x.userId === m.userId);
    const net = b?.net ?? 0;
    const bg  = net > 0 ? LIGHT_GREEN : net < 0 ? LIGHT_RED : 'FFFFFF';
    const col = net > 0 ? GREEN       : net < 0 ? RED        : '64748B';
    ws[XLSXStyle.utils.encode_cell({ r, c: ci + 2 })] = dataCell(net, { bold: true, bg, color: col });
  });

  ws['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: members.length + 1 } });
  ws['!cols'] = [
    { wch: 32 }, { wch: 14 },
    ...members.map(() => ({ wch: 18 })),
  ];
  ws['!rows'] = Array.from({ length: r + 1 }, (_, i) => ({ hpt: i === 0 ? 22 : 18 }));

  return ws;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportExpensesToExcel(
  tripName: string,
  expenses: TripExpense[],
  members: TripMember[],
) {
  const wb = XLSXStyle.utils.book_new();

  XLSXStyle.utils.book_append_sheet(wb, buildSheet1(expenses), 'Chi tiêu');
  XLSXStyle.utils.book_append_sheet(wb, buildSheet2(expenses, members), 'Chia đầu người');

  XLSXStyle.writeFile(wb, `${tripName} - Chi tiêu.xlsx`);
}
