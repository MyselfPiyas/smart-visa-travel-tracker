import { Card, EmptyState, StatusBadge } from '../ui/index.jsx';
import { formatRemainingDays, getStatusLabel, getStatusTone } from '../../utils/documentPresentation.js';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export function formatDashboardDate(value) {
  if (!value) return 'Date not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : dateFormatter.format(date);
}

export function DashboardStat({ label, value, detail, tone = 'teal', icon }) {
  const tones = { teal: 'bg-teal-50 text-teal-900', green: 'bg-emerald-50 text-emerald-900', amber: 'bg-amber-50 text-amber-950', rose: 'bg-rose-50 text-rose-900', slate: 'bg-slate-100 text-slate-700' };
  return <Card className="flex items-start justify-between gap-3 p-4 sm:p-5"><div><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[tone]}`} aria-hidden="true">{icon}</span></Card>;
}

export function DashboardPanel({ title, action, children, className = '' }) {
  return <Card className={className}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-bold text-slate-900">{title}</h2>{action}</div>{children}</Card>;
}

export function ExpiryList({ records }) {
  if (!records.length) return <EmptyState title="No upcoming expiries" description="Documents expiring in the next 90 days will appear here."/>;
  return <ul className="divide-y divide-slate-100">{records.map((item, index) => <li key={`${item.displayName}-${item.expiryDate}-${index}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item.displayName}</p><p className="mt-1 text-xs capitalize text-slate-500">{item.documentType.replaceAll('_', ' ')} · {item.documentType === 'visa' ? 'Valid until' : 'Expires'} {formatDashboardDate(item.expiryDate)} · {formatRemainingDays(item.remainingDays, item.status)}</p>{item.documentType === 'visa' && item.validFrom && <p className="mt-1 text-xs text-slate-500">Valid from {formatDashboardDate(item.validFrom)}{item.visaEntryType ? ` · ${item.visaEntryType.replaceAll('_', ' ')}` : ''}</p>}</div><StatusBadge tone={getStatusTone(item.status)}>{getStatusLabel(item.status)}</StatusBadge></li>)}</ul>;
}

export function PotentialOverstayList({ records }) {
  if (!records?.length) return <EmptyState title="No travel review warnings" description="Travel records with a passed planned return date or a recorded stay limit will be listed here for review."/>;
  return <div><ul className="space-y-3">{records.map((trip, index) => <li key={`${trip.destinationCountry}-${trip.expectedReturnDate || trip.recordedEntryDate}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-950">{trip.destinationCountry} · Please verify this trip</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-950">{trip.warnings.map((warning) => <li key={warning.type}>{warning.message}</li>)}</ul></li>)}</ul><p className="mt-3 text-xs leading-5 text-slate-600">These are informational alerts based on user-entered records, not legal conclusions. Immigration rules differ by country; confirm details with official sources.</p></div>;
}

export function ReminderList({ records }) {
  if (!records.length) return <EmptyState title="No reminders scheduled" description="Upcoming notification reminders will appear here when they have been set."/>;
  return <ul className="space-y-3">{records.map((item, index) => <li key={`${item.type}-${item.scheduledAt}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><p className="text-sm font-semibold capitalize text-slate-800">{item.type.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-slate-500">{formatDashboardDate(item.scheduledAt)}</p></div><StatusBadge>{item.deliveryStatus}</StatusBadge></li>)}</ul>;
}

export function NotificationList({ records }) {
  if (!records.length) return <EmptyState title="No notifications yet" description="Recent notification activity will be shown here."/>;
  return <ul className="divide-y divide-slate-100">{records.map((item, index) => <li key={`${item.type}-${item.createdAt}-${index}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-semibold capitalize text-slate-800">{item.type.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-slate-500">{formatDashboardDate(item.createdAt)}</p></div><StatusBadge tone={item.deliveryStatus === 'sent' ? 'success' : item.deliveryStatus === 'failed' ? 'danger' : 'neutral'}>{item.deliveryStatus}</StatusBadge></li>)}</ul>;
}

export function TravelHistoryList({ records }) {
  if (!records.length) return <EmptyState title="No travel history yet" description="Your recent trips will be listed here once you add a travel record."/>;
  return <ul className="divide-y divide-slate-100">{records.map((item, index) => <li key={`${item.destinationCountry}-${item.departureDate}-${index}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-semibold text-slate-800">{item.destinationCountry}</p><p className="mt-1 text-xs capitalize text-slate-500">{item.purpose.replaceAll('_', ' ')} · {formatDashboardDate(item.departureDate)}</p></div><p className="text-right text-xs text-slate-500">Return<br/>{formatDashboardDate(item.returnDate)}</p></li>)}</ul>;
}
