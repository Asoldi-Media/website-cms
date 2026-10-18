/**
 * Bookable services: slots from opening hours (shop or per staff), duration + buffer,
 * capacity for staff-less sessions, min notice, max days ahead, closed dates, holds.
 */
import { WEEKDAYS } from './settings.js';

const DAY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/** Local wall time in `tz` → UTC ms (DST-safe). */
export function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

/** Calendar parts of a UTC time in a time zone. */
export function localParts(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [y, m, d] = date.split('-').map(Number);
  return { date, time: `${get('hour')}:${get('minute')}`, weekday: DAY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** Date and time as shown to customers in the shop's time zone. */
export function formatLocal(iso, tz = 'Europe/Oslo') {
  return new Date(iso).toLocaleString('nb-NO', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Open booking slots for a date, and a check that a chosen slot is still free. */
export function createBookings({ db, getSettings, heldSlots = () => [] }) {
  function busyRows(exceptRef = '') {
    const rows = db.list('bookings').filter((b) => b.status !== 'cancelled' && (!exceptRef || b.ref !== exceptRef));
    return [...rows, ...heldSlots(exceptRef).map((s) => ({ ...s, status: 'held' }))];
  }

  function staffFor(product, settings) {
    const all = settings.bookings.staff.filter((s) => s.active);
    const wanted = product.booking.staffIds;
    const list = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;
    return list.length ? list : [{ id: '', name: '', hours: null }];
  }

  /** Free slots on a local date: [{ start, end, time, staff:[{id,name}], remaining }]. */
  /** anyTime: staff booking — skip the customer notice/horizon window. */
  function slotsFor(product, date, { now = Date.now(), exceptRef = '', anyTime = false } = {}) {
    if (!product || product.kind !== 'booking' || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return [];
    const settings = getSettings();
    const cfg = settings.bookings;
    const tz = cfg.timezone;
    if (cfg.closedDates.includes(date)) return [];
    const [y, m, d] = date.split('-').map(Number);
    const weekday = DAY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    if (!WEEKDAYS.includes(weekday)) return [];
    const duration = product.booking.durationMinutes * 60_000;
    const buffer = product.booking.bufferMinutes * 60_000;
    const step = cfg.slotStepMinutes * 60_000;
    const earliest = now + cfg.minNoticeMinutes * 60_000;
    const latest = now + cfg.maxDaysAhead * 86_400_000;
    const busy = busyRows(exceptRef).map((b) => ({ ...b, s: Date.parse(b.start), e: Date.parse(b.end) }));
    const bySlot = new Map();
    for (const staff of staffFor(product, settings)) {
      const ranges = (staff.hours || cfg.hours)[weekday] || [];
      for (const [from, to] of ranges) {
        const open = zonedToUtc(date, from, tz);
        const close = zonedToUtc(date, to, tz);
        for (let t = open; t + duration <= close; t += step) {
          if (!anyTime && (t < earliest || t > latest)) continue;
          const end = t + duration;
          let remaining;
          if (staff.id) {
            const clash = busy.some((b) => b.staffId === staff.id && overlaps(t - buffer, end + buffer, b.s, b.e));
            if (clash) continue;
            remaining = 1;
          } else {
            const used = busy.filter((b) => b.productId === product.id && overlaps(t - buffer, end + buffer, b.s, b.e)).reduce((s, b) => s + (Number(b.quantity) || 1), 0);
            remaining = product.booking.capacity - used;
            if (remaining <= 0) continue;
          }
          const key = new Date(t).toISOString();
          const slot = bySlot.get(key) || { start: key, end: new Date(end).toISOString(), time: localParts(t, tz).time, staff: [], remaining: 0 };
          if (staff.id) slot.staff.push({ id: staff.id, name: staff.name });
          slot.remaining += remaining;
          bySlot.set(key, slot);
        }
      }
    }
    return [...bySlot.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Pricing hook: '' when the slot is free; assigns a staff member when "any" was chosen. */
  function check(product, booking, quantity, { exceptRef = '', now = Date.now(), anyTime = false } = {}) {
    const tz = getSettings().bookings.timezone;
    const { date } = localParts(Date.parse(booking.start), tz);
    const slot = slotsFor(product, date, { now, exceptRef, anyTime }).find((s) => s.start === booking.start);
    if (!slot) return 'Tidspunktet er ikke ledig lenger. Velg et annet.';
    if (slot.staff.length) {
      if (booking.staffId && !slot.staff.some((s) => s.id === booking.staffId)) return 'Den valgte behandleren er ikke ledig på dette tidspunktet.';
      if (!booking.staffId) booking.staffId = slot.staff[0].id;
      if (quantity > 1) return 'Velg én plass per time.';
    } else if (quantity > slot.remaining) {
      return `Bare ${slot.remaining} ledige plasser på dette tidspunktet.`;
    }
    return '';
  }

  return { slotsFor, check };
}

function icsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(value) {
  return String(value || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

/** ICS calendar file for one booking. */
export function bookingIcs({ id, start, end, title, location = '', description = '', host = 'asoldi' }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Asoldi//CMS//NO',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@${host}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    location ? `LOCATION:${icsText(location)}` : '',
    description ? `DESCRIPTION:${icsText(description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
