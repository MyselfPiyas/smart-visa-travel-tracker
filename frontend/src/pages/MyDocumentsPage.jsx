import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingIndicator, PageHeader } from '../components/ui/index.jsx';
import DocumentStatusBadge from '../components/documents/DocumentStatusBadge.jsx';
import { deleteDocument, listDocuments } from '../services/documents.js';
import { emitTrackerDataChanged } from '../services/api.js';
import { documentTypeLabels, formatDocumentDate, formatRemainingDays } from '../utils/documentPresentation.js';

const initialPagination = { page: 1, limit: 10, total: 0, pages: 0 };

export default function MyDocumentsPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [filters, setFilters] = useState({ q: '', documentType: '', expiryStatus: '', sort: 'expiryDate', order: 'asc' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listDocuments({ ...filters, page, limit: 10 })
      .then((result) => { if (active) { setItems(result.items); setPagination(result.pagination); } })
      .catch(() => { if (active) setError('We couldn’t load your documents. Check your connection and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page, retryToken]);

  function updateFilter(key, value) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await deleteDocument(deleteTarget.id);
      emitTrackerDataChanged();
      setDeleteTarget(null);
      setItems((current) => current.filter((item) => item.id !== deleteTarget.id));
      const total = Math.max(0, pagination.total - 1);
      const pages = Math.ceil(total / pagination.limit);
      setPagination((current) => ({ ...current, total, pages }));
      if (page > pages) setPage(Math.max(1, pages));
    } catch {
      setError('We couldn’t delete that document. Please try again.');
    } finally { setDeleting(false); }
  }

  return <>
    <PageHeader eyebrow="Your travel workspace" title="My documents" description="Keep your travel documents and important dates together." action={<Link to="/app/documents/upload" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900">＋ Add document</Link>} />

    <Card className="mb-5">
      <form onSubmit={(event) => { event.preventDefault(); updateFilter('q', searchText.trim()); }} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(9rem,1fr))_auto]">
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Search documents<input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search by display name" className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20" /></label>
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Document type<select value={filters.documentType} onChange={(event) => updateFilter('documentType', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">All types</option>{Object.entries(documentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Expiry status<select value={filters.expiryStatus} onChange={(event) => updateFilter('expiryStatus', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">All statuses</option><option value="valid">Valid</option><option value="expiring_soon">Expiring soon</option><option value="expired">Expired</option><option value="pending_information">Pending information</option><option value="not_yet_valid">Not yet valid</option></select></label>
        <label className="space-y-1.5 text-sm font-semibold text-slate-800">Sort by<select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="expiryDate">Expiry date</option><option value="createdAt">Date added</option></select></label>
        <Button type="submit" className="self-end">Search</Button>
      </form>
    </Card>

    {loading ? <Card><LoadingIndicator label="Loading your documents…"/></Card> : error ? <Card><ErrorState title="Documents unavailable" description={error}/><Button className="mt-4" onClick={() => setRetryToken((value) => value + 1)}>Try again</Button></Card> : items.length === 0 ? <Card><EmptyState title="No documents found" description={filters.q || filters.documentType || filters.expiryStatus ? 'Try changing your search or filters, or add a document.' : 'Add your first travel document to start organizing important dates.'}/></Card> : <div className="space-y-3" aria-label="Your travel documents">
      {items.map((document) => <Card key={document.id} className="!p-4 sm:!p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-bold text-slate-950">{document.displayName}</h2><DocumentStatusBadge status={document.status}/></div><p className="mt-1 text-sm text-slate-600">{documentTypeLabels[document.documentType] || documentTypeLabels.other}{document.issuingCountry ? ` · Issued by ${document.issuingCountry}` : ''}</p>{document.documentType === 'visa' && <p className="mt-1 text-xs text-slate-500">Valid from {formatDocumentDate(document.validFrom)} · {document.visaEntryType?.replaceAll('_', ' ') || 'Entry type not provided'}</p>}<p className="mt-1 text-xs text-slate-500">{document.documentType === 'visa' ? 'Valid until' : 'Expires'} {formatDocumentDate(document.expiryDate)} · {formatRemainingDays(document.remainingDays, document.status)} · {document.files?.length || 0} file{document.files?.length === 1 ? '' : 's'}</p></div><div className="flex shrink-0 gap-2"><Link to={`/app/documents/${document.id}`} className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Details</Link><Button variant="secondary" onClick={() => setDeleteTarget(document)}>Delete</Button></div></div></Card>)}
    </div>}

    {!loading && pagination.pages > 1 && <nav aria-label="Document pages" className="mt-5 flex items-center justify-between"><p className="text-sm text-slate-600">Page {pagination.page} of {pagination.pages} · {pagination.total} documents</p><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</Button></div></nav>}

    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this document?" onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={confirmDelete}>{deleteTarget && <p><strong>{deleteTarget.displayName}</strong> and its uploaded files will be permanently removed from your workspace.</p>}{deleting && <p className="mt-3">Deleting safely…</p>}</ConfirmDialog>
  </>;
}
