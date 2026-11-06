import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingIndicator, PageHeader } from '../components/ui/index.jsx';
import DocumentStatusBadge from '../components/documents/DocumentStatusBadge.jsx';
import { deleteDocument, downloadDocumentFile, getDocument } from '../services/documents.js';
import { emitTrackerDataChanged } from '../services/api.js';
import { documentTypeLabels, formatDocumentDate, formatRemainingDays, statusExplanations } from '../utils/documentPresentation.js';

export default function DocumentDetailsPage() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (location.state?.uploadWarning) setNotice('Document details were saved, but the file upload did not finish. You can add files again from here.');
  }, [location.state]);

  useEffect(() => {
    let active = true;
    getDocument(documentId).then((result) => { if (active) setDocument(result); })
      .catch(() => { if (active) setError('We couldn’t load this document. It may not exist or may not belong to your account.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documentId]);

  async function download(file) {
    setBusy(true);
    setNotice('');
    try {
      const blob = await downloadDocumentFile(documentId, file.id);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = file.name || 'travel-document';
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice('Your file download has started.');
    } catch { setError('We couldn’t retrieve this private file. Please try again.'); }
    finally { setBusy(false); }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteDocument(documentId);
      emitTrackerDataChanged();
      navigate('/app/documents', { replace: true });
    } catch { setError('We couldn’t delete this document. Please try again.'); setDeleteOpen(false); }
    finally { setBusy(false); }
  }

  if (loading) return <Card><LoadingIndicator label="Loading document…"/></Card>;
  if (!document) return <><PageHeader eyebrow="Your travel workspace" title="Document details"/><ErrorState title="Document unavailable" description={error || 'This document is unavailable.'}/><Link className="mt-4 inline-block text-sm font-semibold text-teal-800" to="/app/documents">← Back to my documents</Link></>;

  return <>
    <PageHeader eyebrow="Your travel workspace" title={document.displayName} description="Private information for your travel document." action={<div className="flex gap-2"><Link to={`/app/documents/${documentId}/edit`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-white">Edit</Link><Button variant="danger" onClick={() => setDeleteOpen(true)}>Delete</Button></div>} />
    {error && <div className="mb-5"><ErrorState title="Document action failed" description={error}/></div>}
    {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
      <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Document type</p><h2 className="mt-1 text-lg font-bold">{documentTypeLabels[document.documentType] || documentTypeLabels.other}</h2></div><DocumentStatusBadge status={document.status}/></div><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{statusExplanations[document.status] || document.statusMessage} {document.remainingDays != null && ` ${formatRemainingDays(document.remainingDays, document.status)}.`}</p><dl className="mt-6 grid gap-5 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issuing country</dt><dd className="mt-1 font-medium">{document.issuingCountry || 'Not provided'}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issue date</dt><dd className="mt-1 font-medium">{formatDocumentDate(document.issueDate)}</dd></div>{document.documentType === 'visa' && <><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valid from</dt><dd className="mt-1 font-medium">{formatDocumentDate(document.validFrom)}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entry type</dt><dd className="mt-1 font-medium">{document.visaEntryType?.replaceAll('_', ' ') || 'Not provided'}</dd></div>{document.allowedStayDays && <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allowed stay (recorded)</dt><dd className="mt-1 font-medium">{document.allowedStayDays} days</dd></div>}</>}<div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{document.documentType === 'visa' ? 'Valid until' : 'Expiry date'}</dt><dd className="mt-1 font-medium">{formatDocumentDate(document.expiryDate)}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</dt><dd className="mt-1 font-medium">{formatDocumentDate(document.updatedAt)}</dd></div></dl>{document.documentType === 'visa' && <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-600">Visa date and entry-count information is a record of the document only. Entry permission and allowed stay depend on destination-specific conditions. Verify them with official sources.</p>}</Card>
      <Card><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Private files</h2><p className="mt-1 text-xs text-slate-500">Only you can retrieve these files.</p></div><Link to={`/app/documents/${documentId}/edit`} className="text-xs font-semibold text-teal-800 hover:underline">Add files</Link></div>{document.files?.length ? <ul className="mt-4 divide-y divide-slate-100">{document.files.map((file) => <li key={file.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{file.name}</p><p className="mt-1 text-xs text-slate-500">{file.mimeType} · {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB</p></div><Button variant="secondary" disabled={busy} onClick={() => download(file)}>Download</Button></li>)}</ul> : <div className="mt-4"><EmptyState title="No files attached" description="You can add a private copy or supporting file while editing this document."/></div>}</Card>
    </div>
    <p className="mt-5"><Link to="/app/documents" className="text-sm font-semibold text-teal-800 hover:underline">← Back to my documents</Link></p>
    <ConfirmDialog open={deleteOpen} title="Delete this document?" onCancel={() => !busy && setDeleteOpen(false)} onConfirm={confirmDelete}><p><strong>{document.displayName}</strong> and its private files will be permanently removed.</p>{busy && <p className="mt-3">Deleting safely…</p>}</ConfirmDialog>
  </>;
}
