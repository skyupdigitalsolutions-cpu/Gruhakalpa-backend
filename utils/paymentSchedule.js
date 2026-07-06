/**
 * paymentSchedule.js
 *
 * Pure, side-effect-free logic for the payment-reminder automation.
 * No database or network calls here — just date/amount math — so it is easy to test.
 *
 * Plans:
 *   - "installments": Down Payment + 14 installments. Each installment has a
 *      SEQUENTIAL 3-month (90-day) window. Installment N's window starts
 *      (N-1) * 90 days after the booking date.
 *   - "full": the whole amount is due within a single 90-day window from booking.
 *
 * Reminder schedule inside each window (days measured from the window start):
 *   - Days 0..59  -> silent (first 2 months)
 *   - Day 60      -> reminder 1  (month 3, day 1)
 *   - Day 75      -> reminder 2  (+15 days)
 *   - Day 83      -> reminder 3  (7 days before due date)
 *   - Day 89      -> reminder 4  (1 day before due date)
 *   - Day 90      -> reminder 5  (due date)
 *   - After day 90, every 7 days -> overdue reminders until the amount is paid
 */

const WINDOW_DAYS = 90; // 3 months per installment window
const PRE_DUE_OFFSETS = [60, 75, 83, 89, 90]; // reminder days from window start
const OVERDUE_INTERVAL_DAYS = 7; // after due date, remind weekly
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Add whole days to a date, returning a new Date. */
function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days between two dates (b - a), floored. */
function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Format a date as DD-MM-YYYY for messages. */
function formatDate(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Build the ordered list of obligations for a booking.
 * Down payment (if any) comes first, then each installment in order.
 * For a "full" plan there is a single obligation for the total amount.
 *
 * Each obligation: { label, amount, windowStart, dueDate }
 */
function buildObligations(booking) {
  const bookingDate = new Date(booking.date);
  const plan = booking.paymentplan === "full" ? "full" : "installments";

  if (plan === "full") {
    return [
      {
        label: "Full Payment",
        amount: Number(booking.totalamount) || 0,
        windowStart: bookingDate,
        dueDate: addDays(bookingDate, WINDOW_DAYS),
      },
    ];
  }

  const obligations = [];

  // Down payment is treated as due at booking (window 0). It is included so the
  // paid-amount allocation is correct, but it does not drive the 3-month timeline.
  const downpayment = Number(booking.downpayment) || 0;
  if (downpayment > 0) {
    obligations.push({
      label: "Down Payment",
      amount: downpayment,
      windowStart: bookingDate,
      dueDate: bookingDate,
      isDownPayment: true,
    });
  }

  // Installments: sequential 90-day windows.
  const installments = Array.isArray(booking.installments)
    ? booking.installments
    : [];
  installments.forEach((inst, i) => {
    const windowStart = addDays(bookingDate, i * WINDOW_DAYS);
    obligations.push({
      label: inst.label || `Installment ${i + 1}`,
      amount: Number(inst.amount) || 0,
      windowStart,
      dueDate: addDays(windowStart, WINDOW_DAYS),
    });
  });

  return obligations;
}

/**
 * Given the obligations (in order) and the total amount paid so far,
 * find the earliest obligation that is not yet fully covered.
 * Payments are applied to obligations in order (down payment first, then
 * installment 1, 2, ...).
 *
 * Returns null if everything is fully paid, otherwise:
 *   { index, obligation, pendingAmount, totalOutstanding }
 */
function findCurrentObligation(obligations, totalPaid) {
  let remainingPaid = totalPaid;
  let totalOutstanding = 0;
  let current = null;

  for (let i = 0; i < obligations.length; i++) {
    const ob = obligations[i];
    const coveredByPaid = Math.min(remainingPaid, ob.amount);
    const pending = ob.amount - coveredByPaid;
    remainingPaid -= coveredByPaid;

    if (pending > 0) {
      totalOutstanding += pending;
      if (current === null) {
        current = { index: i, obligation: ob, pendingAmount: pending };
      }
    }
  }

  if (current === null) return null; // fully paid
  current.totalOutstanding = totalOutstanding;
  return current;
}

/**
 * Decide which reminder (if any) is due for the current obligation as of `today`.
 * Skips down-payment obligations (they have no 3-month timeline of their own).
 *
 * `alreadySent` is a Set of reminder keys already sent for this booking, used to
 * avoid duplicates and to prevent sending several catch-up reminders at once.
 *
 * Returns null if nothing is due, otherwise:
 *   { key, type: "reminder" | "overdue", dueDate }
 */
function getDueReminder(current, today, alreadySent) {
  if (!current || current.obligation.isDownPayment) return null;

  const { index, obligation } = current;
  const windowStart = new Date(obligation.windowStart);
  const dueDate = new Date(obligation.dueDate);
  const dayNo = daysBetween(windowStart, today);

  if (dayNo < PRE_DUE_OFFSETS[0]) return null; // still in the silent period

  // Collect every milestone whose scheduled day is on or before today.
  const dueMilestones = [];

  // Pre-due / due-date milestones
  PRE_DUE_OFFSETS.forEach((offset) => {
    if (dayNo >= offset) {
      dueMilestones.push({
        key: `inst-${index}-d${offset}`,
        type: offset === WINDOW_DAYS ? "overdue" : "reminder",
        dueDate,
      });
    }
  });

  // Overdue weekly milestones after the due date
  if (dayNo > WINDOW_DAYS) {
    const weeksOverdue = Math.floor((dayNo - WINDOW_DAYS) / OVERDUE_INTERVAL_DAYS);
    for (let w = 1; w <= weeksOverdue; w++) {
      dueMilestones.push({
        key: `inst-${index}-overdue-w${w}`,
        type: "overdue",
        dueDate,
      });
    }
  }

  // Pick the latest milestone that has NOT already been sent. Sending only the
  // most recent one prevents a burst of catch-up messages if the job missed days.
  for (let i = dueMilestones.length - 1; i >= 0; i--) {
    if (!alreadySent.has(dueMilestones[i].key)) {
      return dueMilestones[i];
    }
  }

  return null;
}

/**
 * Top-level helper: given a booking, the total paid, the set of already-sent
 * reminder keys, and today's date, return the reminder to send (or null) plus
 * the data needed to fill the message templates.
 */
function evaluateBooking(booking, totalPaid, alreadySentKeys, today = new Date()) {
  const obligations = buildObligations(booking);
  const current = findCurrentObligation(obligations, totalPaid);
  if (!current) return null; // fully paid — nothing to do

  const alreadySent = new Set(alreadySentKeys || []);
  const due = getDueReminder(current, today, alreadySent);
  if (!due) return null;

  return {
    reminderKey: due.key,
    type: due.type, // "reminder" or "overdue"
    name: booking.name,
    membershipId: booking.membership_id,
    projectName: booking.projectname || "your site booking",
    installmentLabel: current.obligation.label,
    pendingAmount: Math.round(current.pendingAmount),
    totalOutstanding: Math.round(current.totalOutstanding),
    dueDate: due.dueDate,
    dueDateFormatted: formatDate(due.dueDate),
  };
}

module.exports = {
  WINDOW_DAYS,
  PRE_DUE_OFFSETS,
  OVERDUE_INTERVAL_DAYS,
  addDays,
  daysBetween,
  formatDate,
  buildObligations,
  findCurrentObligation,
  getDueReminder,
  evaluateBooking,
};