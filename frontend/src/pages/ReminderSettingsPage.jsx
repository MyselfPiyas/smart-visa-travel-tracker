import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorState, LoadingIndicator, PageHeader, StatusBadge } from '../components/ui/index.jsx';
import { getReminderPreferences, getUpcomingNotifications, updateReminderPreferences } from '../services/notifications.js';
import { emitTrackerDataChanged } from '../services/api.js';
import { documentTypeLabels, formatDocumentDate } from '../utils/documentPresentation.js';

const intervals = [{ value: 90, label: '90 days before expiry' }, { value: 60, label: '60 days before expiry' }, { value: 30, label: '30 days before expiry' }, { value: 0, label: 'On the expiry date' }];
const timeZones = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];

function localDateTime(value, timeZone) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export default function ReminderSettingsPage() {
  const [preferences, setPreferences] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([getReminderPreferences(), getUpcomingNotifications({ limit: 20 })])
      .then(([prefs, reminders]) => { if (active) { setPreferences(prefs); setUpcoming(reminders); } })
      .catch(() => { if (active) setError('We couldn’t load your reminder settings. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function change(field, value) { setPreferences((current) => ({ ...current, [field]: value })); setNotice(''); }

  async function save(event) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await updateReminderPreferences(preferences);
      setPreferences(updated); setNotice('Reminder preferences saved.'); emitTrackerDataChanged();
    } catch { setError('We couldn’t save these settings. Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  if (loading) return <Card><LoadingIndicator label="Loading reminder settings…"/></Card>;
  return <>
    <PageHeader eyebrow="Your travel workspace" title="Reminder settings" description="Choose which email reminders you receive and the local time zone used to schedule them." action={<Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/notifications">Notification history →</Link>}/>
    {error && <div className="mb-4"><ErrorState title="Reminder settings unavailable" description={error}/></div>}
    {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {preferences && <form onSubmit={save} className="space-y-5">
      <Card><h2 className="font-bold text-slate-950">Email reminders</h2><p className="mt-1 text-sm text-slate-600">Email delivery is handled by the secure backend worker. The browser does not need to stay open.</p><div className="mt-5 space-y-4">
        <label className="flex items-start gap-3"><input type="checkbox" checked={preferences.enabled} onChange={(event) => change('enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-teal-800"/><span><span className="block text-sm font-semibold text-slate-900">Enable reminder system</span><span className="text-xs text-slate-500">Turn off to pause all automated reminder emails.</span></span></label>
        <label className="flex items-start gap-3"><input type="checkbox" checked={preferences.emailEnabled} onChange={(event) => change('emailEnabled', event.target.checked)} disabled={!preferences.enabled} className="mt-1 h-4 w-4 accent-teal-800"/><span><span className="block text-sm font-semibold text-slate-900">Send email reminders</span><span className="text-xs text-slate-500">When paused, queued email reminders are held and rechecked before delivery.</span></span></label>
      </div></Card>
      <Card><h2 className="font-bold text-slate-950">Document expiry intervals</h2><p className="mt-1 text-sm text-slate-600">Select the reminders you want before the recorded expiry date.</p><fieldset disabled={!preferences.enabled || !preferences.emailEnabled} className="mt-4 grid gap-3 sm:grid-cols-2">{intervals.map((item) => <label key={item.value} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={preferences.expiryIntervals.includes(item.value)} onChange={(event) => change('expiryIntervals', event.target.checked ? [...preferences.expiryIntervals, item.value].sort((a, b) => b - a) : preferences.expiryIntervals.filter((value) => value !== item.value))} className="h-4 w-4 accent-teal-800"/><span className="text-sm font-medium text-slate-800">{item.label}</span></label>)}</fieldset></Card>
      <Card><h2 className="font-bold text-slate-950">Other important alerts</h2><div className="mt-4 space-y-4">{[['expiredDocumentWarnings','Warn me about expired documents'],['potentialOverstayWarnings','Send travel record review alerts'],['importantDocumentInformation','Tell me when document dates are incomplete']].map(([field,label]) => <label key={field} className="flex items-center gap-3"><input type="checkbox" checked={preferences[field]} onChange={(event) => change(field,event.target.checked)} disabled={!preferences.enabled || !preferences.emailEnabled} className="h-4 w-4 accent-teal-800"/><span className="text-sm font-medium text-slate-800">{label}</span></label>)}</div><label className="mt-6 block max-w-md space-y-1.5 text-sm font-semibold text-slate-800">Time zone for reminder scheduling<select value={preferences.timeZone} onChange={(event) => change('timeZone', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal">{!timeZones.includes(preferences.timeZone) && <option value={preferences.timeZone}>{preferences.timeZone}</option>}{timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><span className="block text-xs font-normal text-slate-500">Upcoming reminder times are shown in this time zone.</span></label><p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Travel warnings are informational and based on the data recorded in your account. Immigration rules differ by country; verify them with official sources.</p></Card>
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save reminder settings'}</Button>
    </form>}

    <Card className="mt-6"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-950">Upcoming reminders</h2><p className="mt-1 text-sm text-slate-600">Scheduled delivery times use {preferences?.timeZone || 'UTC'}.</p></div><Link className="text-sm font-semibold text-teal-800 hover:underline" to="/app/notifications">History →</Link></div>{upcoming.length ? <ul className="mt-4 divide-y divide-slate-100">{upcoming.map((item) => <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-600">{item.document ? `${documentTypeLabels[item.document.documentType] || 'Travel document'} · ${item.document.displayName} · ${formatDocumentDate(item.document.expiryDate)}` : 'Travel workspace alert'}</p><p className="mt-1 text-xs text-slate-500">{localDateTime(item.scheduledAt, preferences.timeZone)}</p></div><StatusBadge>{item.deliveryStatus}</StatusBadge></li>)}</ul> : <div className="mt-4"><EmptyState title="No reminders scheduled" description="Upcoming reminders will appear here after the reminder worker processes your preferences and document dates."/></div>}</Card>
  </>;
}
