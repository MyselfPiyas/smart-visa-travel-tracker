import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, ErrorState, FormField, LoadingIndicator, PageHeader } from '../components/ui/index.jsx';
import { createDocument, getDocument, updateDocument, uploadDocumentFiles } from '../services/documents.js';
import { emitTrackerDataChanged } from '../services/api.js';
import { documentTypeLabels } from '../utils/documentPresentation.js';

const emptyForm = { documentType: 'passport', displayName: '', issuingCountry: '', issueDate: '', expiryDate: '', validFrom: '', visaEntryType: '', allowedStayDays: '' };
const allowedAccept = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
const maxFileSizeMb = Math.min(50, Math.max(1, Number(import.meta.env.VITE_DOCUMENT_MAX_FILE_SIZE_MB) || 10));
const maxFiles = Math.min(5, Math.max(1, Number(import.meta.env.VITE_DOCUMENT_MAX_FILES_PER_DOCUMENT) || 5));

function inputDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }

export default function DocumentFormPage() {
  const { documentId } = useParams();
  const editing = Boolean(documentId);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return undefined;
    let active = true;
    getDocument(documentId).then((document) => {
      if (active) setForm({ documentType: document.documentType, displayName: document.displayName, issuingCountry: document.issuingCountry || '', issueDate: inputDate(document.issueDate), expiryDate: inputDate(document.expiryDate), validFrom: inputDate(document.validFrom), visaEntryType: document.visaEntryType || '', allowedStayDays: document.allowedStayDays || '' });
    }).catch(() => { if (active) setError('We couldn’t load that document. It may have been removed or may not belong to your account.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documentId, editing]);

  function setField(event) { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })); }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.issueDate && form.expiryDate && form.expiryDate < form.issueDate) { setError('Expiry date must be on or after issue date.'); return; }
    if (form.documentType === 'visa' && form.validFrom && form.expiryDate && form.expiryDate < form.validFrom) { setError('Visa valid-until date must be on or after valid-from date.'); return; }
    if (files.length > maxFiles) { setError(`Choose no more than ${maxFiles} files.`); return; }
    if (files.some((file) => file.size > maxFileSizeMb * 1024 * 1024)) { setError(`Each file must be no larger than ${maxFileSizeMb} MB.`); return; }
    setSaving(true);
    let savedDocument = null;
    try {
      const values = { ...form, issueDate: form.issueDate || null, expiryDate: form.expiryDate || null };
      if (form.documentType === 'visa') { values.validFrom = form.validFrom || null; values.visaEntryType = form.visaEntryType || undefined; values.allowedStayDays = form.allowedStayDays || undefined; }
      else { delete values.validFrom; delete values.visaEntryType; delete values.allowedStayDays; }
      savedDocument = editing ? await updateDocument(documentId, values) : await createDocument(values);
      if (files.length) await uploadDocumentFiles(savedDocument.id, files);
      emitTrackerDataChanged();
      navigate(`/app/documents/${savedDocument.id}`, { replace: true });
    } catch {
      if (savedDocument) {
        emitTrackerDataChanged();
        navigate(`/app/documents/${savedDocument.id}`, { replace: true, state: { uploadWarning: true } });
      } else setError('We couldn’t save the document. Check the information and try again.');
    } finally { setSaving(false); }
  }

  if (loading) return <Card><LoadingIndicator label="Loading document details…"/></Card>;

  return <>
    <PageHeader eyebrow="Your travel workspace" title={editing ? 'Edit document' : 'Add a document'} description={editing ? 'Update the document details and add supporting files.' : 'Enter the document details, then optionally attach private copies.'} action={<Link to={editing ? `/app/documents/${documentId}` : '/app/documents'} className="text-sm font-semibold text-teal-800 hover:underline">← Back</Link>} />
    {error && <div className="mb-5"><ErrorState title="Couldn’t save document" description={error}/></div>}
    <Card className="max-w-3xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold text-slate-800">Document type<select required name="documentType" value={form.documentType} onChange={setField} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">Choose type</option>{Object.entries(documentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <FormField label="Display name" id="displayName" name="displayName" value={form.displayName} onChange={setField} required minLength={2} maxLength={120} placeholder="e.g. Main passport" />
          <FormField label="Issuing country code" id="issuingCountry" name="issuingCountry" value={form.issuingCountry} onChange={setField} required maxLength={2} minLength={2} pattern="[A-Za-z]{2}" placeholder="IN" hint="Use a two-letter code, such as IN or GB." />
          <FormField label="Issue date" id="issueDate" name="issueDate" type="date" value={form.issueDate} onChange={setField} max={new Date().toISOString().slice(0, 10)} />
          <FormField label="Expiry date" id="expiryDate" name="expiryDate" type="date" value={form.expiryDate} onChange={setField} min={form.issueDate || undefined} hint="Leave blank if the document has no expiry date." />
        </div>
        {form.documentType === 'visa' && <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-5" aria-labelledby="visa-validity-heading"><h2 id="visa-validity-heading" className="font-semibold text-sky-950">Visa validity information</h2><p className="mt-1 text-xs leading-5 text-sky-900">These dates describe the visa document. They do not confirm permission to enter or stay; immigration conditions vary by country.</p><div className="mt-4 grid gap-5 sm:grid-cols-2"><FormField label="Valid from" id="validFrom" name="validFrom" type="date" value={form.validFrom} onChange={setField} max={form.expiryDate || undefined} /><label className="space-y-1.5 text-sm font-semibold text-slate-800">Entry type<select name="visaEntryType" value={form.visaEntryType} onChange={setField} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">Not provided</option><option value="single_entry">Single entry</option><option value="multiple_entry">Multiple entry</option></select></label><FormField label="Allowed stay length (days)" id="allowedStayDays" name="allowedStayDays" type="number" min="1" max="730" step="1" value={form.allowedStayDays} onChange={setField} hint="Optional. Use the stay limit printed on your visa." /></div></section>}
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-5">
          <label htmlFor="document-files" className="block text-sm font-semibold text-slate-900">Supporting files <span className="font-normal text-slate-500">(optional)</span></label>
          <p className="mt-1 text-xs leading-5 text-slate-600">Private PDF, JPEG, or PNG files. Up to {maxFiles} files, {maxFileSizeMb} MB each.</p>
          <input id="document-files" type="file" multiple accept={allowedAccept} onChange={(event) => setFiles(Array.from(event.target.files || []))} className="mt-3 block w-full text-sm text-slate-700 file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-teal-800 file:px-4 file:text-sm file:font-semibold file:text-white" />
          {files.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-600" aria-label="Selected files">{files.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</li>)}</ul>}
        </div>
        <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving}>{saving ? 'Saving securely…' : editing ? 'Save changes' : 'Create document'}</Button><Link to={editing ? `/app/documents/${documentId}` : '/app/documents'} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Cancel</Link></div>
      </form>
    </Card>
  </>;
}
