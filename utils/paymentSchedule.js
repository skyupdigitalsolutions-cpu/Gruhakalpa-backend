// ─────────────────────────────────────────────────────────────────────────
// Payment schedule engine
//
// A client's payment PLAN lives on their SiteBooking (downpayment + an
// installments[] array of { label, amount, dueDate? }).
//
// Due dates: if the booking stores an explicit dueDate (down payment ->
// downPaymentDate, installment -> installments[i].dueDate) we USE it. When it
// is absent (legacy bookings created before dates were captured) we DERIVE it:
//   - Down Payment  -> due on the booking date
//   - Installment N  -> due = bookingDate + (N * intervalMonths) months
//   - "full" plan    -> single "Full Payment" bucket due on the booking date
//
// What a client has PAID lives across their Receipts. We waterfall the total
// paid across the ordered buckets (down payment first, then each installment)
// — the same mental model as the receipt allocator — so partial payments fill
// earlier buckets first. This is robust even if a receipt's stored allocations
// don't label-match the schedule exactly. 
// ─────────────────────────────────────────────────────────────────────────

// Add N calendar months to a date, clamping the day (e.g. Jan 31 + 1mo = Feb 28/29)
const addMonths = (date, months) => {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Build the ordered list of buckets (label, amount, dueDate) for one booking.
const buildBuckets = (booking, intervalMonths) => {
  const buckets = [];
  const bookingDate = booking.date ? new Date(booking.date) : new Date();
  const interval = Number(intervalMonths) > 0 ? Number(intervalMonths) : 1;

  const isFull = booking.paymentplan === "full";
  const installments = Array.isArray(booking.installments)
    ? booking.installments
    : [];

  if (isFull && installments.length === 0) {
    buckets.push({
      label: "Full Payment",
      amount: Number(booking.totalamount || 0),
      dueDate: booking.downPaymentDate
        ? new Date(booking.downPaymentDate)
        : bookingDate,
    });
    return buckets;
  }

  const downpayment = Number(booking.downpayment || 0);
  if (downpayment > 0) {
    buckets.push({
      label: "Down Payment",
      amount: downpayment,
      // Use the stored down-payment date when present, else the booking date.
      dueDate: booking.downPaymentDate
        ? new Date(booking.downPaymentDate)
        : bookingDate,
    });
  }

  installments.forEach((it, i) => {
    const amount = Number(it.amount || 0);
    if (amount <= 0) return;
    buckets.push({
      label: it.label || `Installment ${i + 1}`,
      amount,
      // Use the stored installment due date when present, else derive monthly.
      dueDate: it.dueDate
        ? new Date(it.dueDate)
        : addMonths(bookingDate, (i + 1) * interval),
    });
  });

  return buckets;
};

// Sum of non-cancelled receipt payments for a member.
const totalPaidForMember = (receipts) =>
  (receipts || [])
    .filter((r) => !r.cancelled)
    .reduce((sum, r) => sum + Number(r.amountpaid || 0), 0);

const classify = (bucket, today, windowDays) => {
  const outstanding = bucket.outstanding;
  if (outstanding <= 0) return "paid";
  const due = startOfDay(bucket.dueDate);
  if (due < today) return "overdue";
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + Number(windowDays || 0));
  if (due <= windowEnd) return "due_soon";
  return "upcoming";
};

// Build the full schedule + summary for a single booking.
const buildScheduleForBooking = (booking, receipts, settings) => {
  const intervalMonths = settings?.intervalMonths || 1;
  const windowDays = settings?.reminderWindowDays ?? 7;
  const today = startOfDay(new Date());

  const buckets = buildBuckets(booking, intervalMonths);
  let paidPool = totalPaidForMember(receipts);
  const totalPaid = paidPool;

  // Waterfall the paid pool across buckets in order.
  for (const b of buckets) {
    const applied = Math.min(paidPool, b.amount);
    b.paid = applied;
    b.outstanding = Math.max(b.amount - applied, 0);
    paidPool -= applied;
    b.status = classify(b, today, windowDays);
    // Whole days from today to due date (negative = overdue).
    b.daysUntilDue = Math.round(
      (startOfDay(b.dueDate) - today) / (24 * 60 * 60 * 1000),
    );
  }

  const totalDue = buckets.reduce((s, b) => s + b.amount, 0);
  const totalOutstanding = buckets.reduce((s, b) => s + b.outstanding, 0);
  const overdueAmount = buckets
    .filter((b) => b.status === "overdue")
    .reduce((s, b) => s + b.outstanding, 0);

  // Next actionable bucket: earliest unpaid one (overdue counts first).
  const unpaid = buckets.filter((b) => b.outstanding > 0);
  unpaid.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const nextDue = unpaid[0] || null;

  // A client is "overdue" if any bucket is overdue; else "due_soon" if any is.
  let overallStatus = "paid";
  if (buckets.some((b) => b.status === "overdue")) overallStatus = "overdue";
  else if (buckets.some((b) => b.status === "due_soon"))
    overallStatus = "due_soon";
  else if (buckets.some((b) => b.status === "upcoming"))
    overallStatus = "upcoming";

  return {
    buckets,
    totalDue,
    totalPaid,
    totalOutstanding,
    overdueAmount,
    nextDue,
    overallStatus,
  };
};

// Build one summary row per client across all bookings.
// members: array of Member docs (for email/mobile lookup)
// bookings: array of SiteBooking docs
// receiptsByMember: Map<membership_id, Receipt[]>
const computeClientRows = (bookings, receiptsByMember, membersById, settings) => {
  const rows = [];

  for (const booking of bookings || []) {
    if (booking.cancelled) continue;
    const mid = booking.membership_id;
    if (!mid) continue;

    const receipts = receiptsByMember.get(mid) || [];
    const member = membersById.get(mid) || {};
    const schedule = buildScheduleForBooking(booking, receipts, settings);

    rows.push({
      membership_id: mid,
      name: booking.name || member.name || "",
      mobile: member.mobile || booking.mobilenumber || null,
      email: member.email || "",
      projectname: booking.projectname || "",
      sitedimension: booking.sitedimension || "",
      bookingDate: booking.date,
      totalDue: schedule.totalDue,
      totalPaid: schedule.totalPaid,
      totalOutstanding: schedule.totalOutstanding,
      overdueAmount: schedule.overdueAmount,
      overallStatus: schedule.overallStatus,
      nextDue: schedule.nextDue
        ? {
            label: schedule.nextDue.label,
            amount: schedule.nextDue.amount,
            outstanding: schedule.nextDue.outstanding,
            dueDate: schedule.nextDue.dueDate,
            status: schedule.nextDue.status,
            daysUntilDue: schedule.nextDue.daysUntilDue,
          }
        : null,
    });
  }

  return rows;
};

module.exports = {
  addMonths,
  buildBuckets,
  buildScheduleForBooking,
  computeClientRows,
};