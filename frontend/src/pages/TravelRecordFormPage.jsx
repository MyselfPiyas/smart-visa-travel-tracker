import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, ErrorState, FormField, LoadingIndicator, PageHeader } from '../components/ui/index.jsx';
import { createTravelRecord, getTravelRecord, updateTravelRecord } from '../services/travelHistory.js';
import { listDocuments } from '../services/documents.js';
import { emitTrackerDataChanged } from '../services/api.js';
import { documentTypeLabels } from '../utils/documentPresentation.js';
import { travelPurposeLabels } from '../utils/travelPresentation.js';

const purposes = ['tourism', 'business', 'education', 'employment', 'family_visit', 'medical', 'transit', 'other'];
const blank = { destinationCountry: '', purpose: 'tourism', departureDate: '', returnDate: '', actualEntryDate: '', actualExitDate: '', visaDocument: '', relatedDocuments: [], notes: '' };
function dateInput(value) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }

export default function TravelRecordFormPage() {
  const { recordId } = useParams();
  const editing = Boolean(recordId);
  const navigate = useNavigate();
  const [form, setForm] = useState(blank);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([listDocuments({ page: 1, limit: 50 }), editing ? getTravelRecord(recordId) : Promise.resolve(null)])
      .then(([result, record]) => {
        if (!active) return;
        setDocuments(result.items || []);
        if (record) setForm({ destinationCountry: record.destinationCountry || '', purpose: record.purpose, departureDate: dateInput(record.departureDate), returnDate: dateInput(record.returnDate), actualEntryDate: dateInput(record.actualEntryDate), actualExitDate: dateInput(record.actualExitDate), visaDocument: record.visaDocument?.id || '', relatedDocuments: (record.relatedDocuments || []).map((item) => item.id), notes: record.notes || '' });
      }).catch(() => { if (active) setError(editing ? 'We couldn’t load this travel record or its document references.' : 'We couldn’t load your document list. You can still record a trip without linking documents.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recordId, editing]);

  function setField(event) {
    const { name, value, selectedOptions } = event.target;
    setForm((current) => ({ ...current, [name]: event.target.multiple ? Array.from(selectedOptions, (option) => option.value) : value }));
  }

  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.returnDate && form.returnDate < form.departureDate) { setError('Return date must be on or after departure.'); return; }
    if (form.actualEntryDate && form.actualEntryDate < form.departureDate) { setError('Recorded entry date must be on or after departure.'); return; }
    if (form.actualExitDate && form.actualEntryDate && form.actualExitDate < form.actualEntryDate) { setError('Recorded exit date must be on or after entry.'); return; }
    setSaving(true);
    try {
      const values = { ...form, destinationCountry: form.destinationCountry.trim().toUpperCase(), returnDate: form.returnDate || null, actualEntryDate: form.actualEntryDate || null, actualExitDate: form.actualExitDate || null, visaDocument: form.visaDocument || null };
      const record = editing ? await updateTravelRecord(recordId, values) : await createTravelRecord(values);
      emitTrackerDataChanged(); navigate(`/app/travel-history/${record.id}`, { replace: true });
    } catch { setError('We couldn’t save this travel record. Check the dates and document choices, then try again.'); }
    finally { setSaving(false); }
  }

  if (loading) return <Card><LoadingIndicator label="Loading trip details…"/></Card>;
  return <>
    <PageHeader eyebrow="Your travel workspace" title={editing ? 'Edit travel record' : 'Add a travel record'} description="Record one country visit at a time. Add another record for each country in a multi-country itinerary." action={<Link to={editing ? `/app/travel-history/${recordId}` : '/app/travel-history'} className="text-sm font-semibold text-teal-800 hover:underline">← Back</Link>}/>
    {error && <div className="mb-5"><ErrorState title="Travel record needs attention" description={error}/></div>}
    <Card className="max-w-3xl"><form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Destination country code" id="destinationCountry" name="destinationCountry" value={form.destinationCountry} onChange={setField} required maxLength={2} minLength={2} pattern="[A-Za-z]{2}" placeholder="IN" hint="Use a two-letter country code, such as IN, GB, or JP."/>
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Travel purpose<select required name="purpose" value={form.purpose} onChange={setField} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3">{purposes.map((purpose) => <option key={purpose} value={purpose}>{travelPurposeLabels[purpose]}</option>)}</select></label>
        <FormField label="Departure date" id="departureDate" name="departureDate" type="date" value={form.departureDate} onChange={setField} required max={form.returnDate || undefined}/>
        <FormField label="Planned return date" id="returnDate" name="returnDate" type="date" value={form.returnDate} onChange={setField} min={form.departureDate || undefined} hint="Optional for trips without a planned return date."/>
      </div>
      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-5"><h2 className="font-semibold text-sky-950">User-confirmed entry and exit</h2><p className="mt-1 text-xs leading-5 text-sky-900">These dates are only recorded when you have verified them. Visa usage is not automatically deducted.</p><div className="mt-4 grid gap-5 sm:grid-cols-2"><FormField label="Recorded entry date" id="actualEntryDate" name="actualEntryDate" type="date" value={form.actualEntryDate} onChange={setField} min={form.departureDate || undefined} max={form.returnDate || undefined}/><FormField label="Recorded exit date" id="actualExitDate" name="actualExitDate" type="date" value={form.actualExitDate} onChange={setField} min={form.actualEntryDate || form.departureDate || undefined} max={form.returnDate || undefined}/></div></section>
      <div className="grid gap-5 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-semibold text-slate-800">Related visa<select name="visaDocument" value={form.visaDocument} onChange={setField} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">No visa linked</option>{documents.filter((item) => item.documentType === 'visa').map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.visaEntryType?.replaceAll('_', ' ') || 'entry type not recorded'}</option>)}</select><span className="block text-xs font-normal text-slate-500">A visa link records which document you used; it does not determine entry eligibility.</span></label>
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Other related documents<select multiple name="relatedDocuments" value={form.relatedDocuments} onChange={setField} className="min-h-28 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">{documents.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {documentTypeLabels[item.documentType]}</option>)}</select><span className="block text-xs font-normal text-slate-500">Hold Ctrl (Windows) or Command (Mac) to select more than one.</span></label></div>
      <label className="block space-y-1.5 text-sm font-semibold text-slate-800">Travel notes<textarea name="notes" rows="4" maxLength="2000" value={form.notes} onChange={setField} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" placeholder="Optional notes about this trip"/><span className="block text-xs font-normal text-slate-500">Avoid storing passport numbers or other sensitive identifiers here.</span></label>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add travel record'}</Button><Link to={editing ? `/app/travel-history/${recordId}` : '/app/travel-history'} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Cancel</Link></div>
    </form></Card>
  </>;
}
