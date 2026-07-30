'use client';

import { useState, useRef, type FormEvent, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorMessage } from '@/components/ui/Spinner';

// ── Step type ─────────────────────────────────────────────────────────────────

interface Step1Data {
  name: string;
  asset_type: string;
  description: string;
  jurisdiction: string;
  currency: string;
  total_value: string;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ASSET_TYPES = [
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'equity',      label: 'Equity' },
  { value: 'bond',        label: 'Bond' },
  { value: 'commodity',   label: 'Commodity' },
  { value: 'fund',        label: 'Fund' },
  { value: 'other',       label: 'Other' },
];

const STEPS = ['Basic Info', 'Documentation'];

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_FILE_MB = 5;
const MAX_FILES   = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
  return '📎';
}

// ── Wizard (2 steps only) ─────────────────────────────────────────────────────
//
// Step 1  — Basic Info   → POST /api/assets → sets assetId, moves to step 2
// Step 2  — Documentation → PATCH /api/assets/:id (optional), then navigate
//                           to the new asset's detail page /assets/:id
//
// Token configuration (configure + deploy + mint) is intentionally NOT here.
// Those operations require asset.status === 'approved', which cannot be true
// during the creation wizard. They live on the asset detail page instead.

export default function NewAssetPage() {
  const api    = useApi();
  const router = useRouter();

  const [step,    setStep]    = useState(1);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [step1, setStep1] = useState<Step1Data>({
    name: '', asset_type: '', description: '',
    jurisdiction: '', currency: '', total_value: '',
  });

  const [files,    setFiles]    = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ────────────────────────────────────────────────────────────

  function readFile(file: File): Promise<UploadedFile> {
    return new Promise((resolve, reject) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        reject(new Error(`Unsupported file type: ${file.type || 'unknown'}`));
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        reject(new Error(`${file.name} exceeds the ${MAX_FILE_MB} MB limit.`));
        return;
      }
      const reader = new FileReader();
      reader.onload  = () => resolve({ name: file.name, size: file.size, type: file.type, dataUrl: reader.result as string });
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(incoming: FileList | File[]) {
    setError(null);
    const arr       = Array.from(incoming);
    const remaining = MAX_FILES - files.length;
    if (remaining <= 0) { setError(`Maximum ${MAX_FILES} files allowed.`); return; }
    const results: UploadedFile[] = [];
    for (const f of arr.slice(0, remaining)) {
      try   { results.push(await readFile(f)); }
      catch (e) { setError(e instanceof Error ? e.message : 'File error'); return; }
    }
    setFiles(prev => [...prev, ...results]);
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  // ── Step 1: create draft asset ───────────────────────────────────────────────

  async function handleStep1(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!step1.name.trim() || !step1.asset_type) {
      setError('Name and Asset Type are required.');
      return;
    }
    setLoading(true);
    try {
      const asset = await api.post<{ id: string }>('/api/assets', {
        name:         step1.name.trim(),
        asset_type:   step1.asset_type,
        description:  step1.description  || undefined,
        jurisdiction: step1.jurisdiction || undefined,
        currency:     step1.currency     || undefined,
        total_value:  step1.total_value  ? Number(step1.total_value) : undefined,
      });
      setAssetId(asset.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create asset.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: attach documents, then go to detail page ────────────────────────

  async function handleFinish() {
    setError(null);
    if (files.length > 0 && assetId) {
      setLoading(true);
      try {
        const documents = files.map(f => ({
          name:       f.name,
          type:       f.type,
          size:       f.size,
          dataUrl:    f.dataUrl,
          uploadedAt: new Date().toISOString(),
        }));
        await api.patch(`/api/assets/${assetId}`, { metadata: { documents } });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to attach documents.');
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }
    // Navigate to the asset detail page. Token configuration happens there
    // once the asset has been approved through the review workflow.
    router.push(`/assets/${assetId}`);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-white">New Asset</h1>

      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const n      = i + 1;
          const active = step === n;
          const done   = step > n;
          return (
            <div key={n} className="flex items-center gap-2">
              <div
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                  done   ? 'bg-indigo-600 text-white'
                         : active ? 'border-2 border-indigo-500 text-indigo-300'
                                  : 'border border-gray-600 text-gray-500',
                ].join(' ')}
              >
                {done ? '✓' : n}
              </div>
              <span className={['text-sm', active ? 'font-medium text-white' : 'text-gray-500'].join(' ')}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="mx-2 h-px w-8 bg-gray-700" />}
            </div>
          );
        })}
      </div>

      {error && <ErrorMessage message={error} className="mb-4" />}

      {/* ── Step 1: Basic Info ──────────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <form onSubmit={handleStep1} className="space-y-4">
            <Input
              label="Asset Name"
              value={step1.name}
              onChange={(e) => setStep1({ ...step1, name: e.target.value })}
              placeholder="e.g. Green Energy Bond Series A"
              required
            />
            <Select
              label="Asset Type"
              options={ASSET_TYPES}
              placeholder="Select type…"
              value={step1.asset_type}
              onChange={(e) => setStep1({ ...step1, asset_type: e.target.value })}
              required
            />
            <Textarea
              label="Description"
              value={step1.description}
              onChange={(e) => setStep1({ ...step1, description: e.target.value })}
              placeholder="Brief description of the asset"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Jurisdiction"
                value={step1.jurisdiction}
                onChange={(e) => setStep1({ ...step1, jurisdiction: e.target.value })}
                placeholder="e.g. US, UK, SG"
              />
              <Input
                label="Currency"
                value={step1.currency}
                onChange={(e) => setStep1({ ...step1, currency: e.target.value.toUpperCase().slice(0, 3) })}
                placeholder="USD"
                maxLength={3}
              />
            </div>
            <Input
              label="Total Value"
              type="number"
              min="0"
              step="0.01"
              value={step1.total_value}
              onChange={(e) => setStep1({ ...step1, total_value: e.target.value })}
              placeholder="1000000"
              hint="In the asset's currency"
            />
            <div className="flex justify-end">
              <Button type="submit" loading={loading}>Continue →</Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Step 2: Documentation ────────────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <p className="text-sm font-medium text-gray-300 mb-1">Upload Documents &amp; Images</p>
          <p className="text-xs text-gray-500 mb-4">
            Attach property images, legal deeds, valuation reports, or prospectuses.
            Accepted: JPG, PNG, WEBP, GIF, PDF, DOC, DOCX · Max {MAX_FILE_MB} MB each · Up to {MAX_FILES} files.
          </p>

          {/* Drop zone */}
          <div
            className={[
              'rounded-lg border-2 border-dashed transition-colors cursor-pointer',
              dragOver ? 'border-indigo-500 bg-indigo-950/30' : 'border-gray-600 hover:border-gray-500',
            ].join(' ')}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-2 py-10 select-none">
              <span className="text-3xl">📁</span>
              <p className="text-sm text-gray-300 font-medium">
                {dragOver ? 'Drop files here' : 'Click or drag & drop files'}
              </p>
              <p className="text-xs text-gray-500">Images and documents for compliance review</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />

          {/* File list */}
          {files.length > 0 && (
            <ul className="mt-4 space-y-2">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-3 rounded-md bg-gray-800 px-3 py-2">
                  {f.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.dataUrl} alt={f.name} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <span className="text-2xl flex-shrink-0">{fileIcon(f.type)}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-gray-200">{f.name}</p>
                    <p className="text-xs text-gray-500">{formatBytes(f.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="ml-auto flex-shrink-0 text-gray-500 hover:text-red-400 transition-colors text-lg leading-none"
                    aria-label={`Remove ${f.name}`}
                  >×</button>
                </li>
              ))}
            </ul>
          )}

          {files.length === 0 && (
            <p className="mt-3 text-center text-xs text-gray-600">
              No files selected — you can skip and add documents later.
            </p>
          )}

          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)} type="button">← Back</Button>
            <Button onClick={handleFinish} loading={loading}>
              {files.length > 0
                ? `Finish with ${files.length} file${files.length > 1 ? 's' : ''}`
                : 'Finish'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
