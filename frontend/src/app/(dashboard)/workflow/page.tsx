'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/auth';

const roles = [
  { icon: '🏢', name: 'Asset Issuer', color: 'indigo', desc: 'Creates and submits tokenized real-world assets for approval.' },
  { icon: '✅', name: 'Compliance Officer', color: 'green', desc: 'Reviews compliance and approves at Stage 1.' },
  { icon: '⚖️', name: 'Legal Officer', color: 'blue', desc: 'Reviews legal documents and approves at Stage 2.' },
  { icon: '👑', name: 'Enterprise Admin', color: 'purple', desc: 'Final approval authority. Manages users and roles.' },
  { icon: '💰', name: 'Treasury Officer', color: 'yellow', desc: 'Configures and deploys smart contract tokens on-chain.' },
  { icon: '📣', name: 'Marketplace Manager', color: 'orange', desc: 'Creates and publishes marketplace listings for investors.' },
  { icon: '💼', name: 'Investor', color: 'teal', desc: 'Browses the marketplace and invests in tokenized assets.' },
];

const steps = [
  {
    number: 1,
    phase: 'Asset Creation',
    role: 'Asset Issuer',
    roleIcon: '🏢',
    color: 'indigo',
    title: 'Create & Submit Asset',
    description: 'Log in as Asset Issuer. Navigate to Assets → New Asset. Fill in the 3-step wizard:',
    substeps: [
      'Step 1 — Basic Info: name, type (Real Estate, Bond, Equity…), description, jurisdiction, currency, value.',
      'Step 2 — Documentation: Upload property images, legal deeds, valuations, or prospectuses via drag & drop.',
      'Step 3 — Token Config: Set token symbol, total supply, decimals, price per token, and target chain.',
      'Click Finish. The asset is now in draft status.',
      'Open the asset and click Submit for Review. Status changes to Pending Compliance.',
    ],
    url: '/assets/new',
    urlLabel: 'Create Asset →',
  },
  {
    number: 2,
    phase: 'Compliance Review',
    role: 'Compliance Officer',
    roleIcon: '✅',
    color: 'green',
    title: 'Compliance Approval',
    description: 'Log in as Compliance Officer. Go to Approvals.',
    substeps: [
      'Find the asset in Pending Compliance status.',
      'Review all uploaded documents and asset details.',
      'Click Approve (or Reject with a reason).',
      'Status advances to Pending Legal.',
      'The Compliance Officer CANNOT approve again — a 409 Conflict is returned on duplicate attempts.',
    ],
    url: '/approvals',
    urlLabel: 'Go to Approvals →',
  },
  {
    number: 3,
    phase: 'Legal Review',
    role: 'Legal Officer',
    roleIcon: '⚖️',
    color: 'blue',
    title: 'Legal Approval',
    description: 'Log in as Legal Officer. Go to Approvals.',
    substeps: [
      'Find the asset in Pending Legal status.',
      'Review contracts, jurisdiction, and compliance findings.',
      'Click Approve.',
      'Status advances to Pending Admin.',
    ],
    url: '/approvals',
    urlLabel: 'Go to Approvals →',
  },
  {
    number: 4,
    phase: 'Admin Approval',
    role: 'Enterprise Admin',
    roleIcon: '👑',
    color: 'purple',
    title: 'Final Admin Sign-Off',
    description: 'Log in as Enterprise Admin. Go to Approvals.',
    substeps: [
      'Find the asset in Pending Admin status.',
      'Perform final checks and click Approve.',
      'Status advances to Approved.',
    ],
    url: '/approvals',
    urlLabel: 'Go to Approvals →',
  },
  {
    number: 5,
    phase: 'Tokenization',
    role: 'Treasury Officer',
    roleIcon: '💰',
    color: 'yellow',
    title: 'Deploy Smart Contract',
    description: 'Log in as Treasury Officer (or Enterprise Admin with Treasury role). Go to Assets.',
    substeps: [
      'Open the Approved asset.',
      'Click Deploy Token — this creates a new ERC-20 RWAToken smart contract on-chain.',
      'The contract address is stored in the database.',
      'Asset status changes to Tokenized.',
      'Optionally: mint initial supply to admin wallet using the Mint Tokens button.',
    ],
    url: '/assets',
    urlLabel: 'Go to Assets →',
  },
  {
    number: 6,
    phase: 'Marketplace',
    role: 'Marketplace Manager',
    roleIcon: '📣',
    color: 'orange',
    title: 'Create & Publish Listing',
    description: 'Log in as Marketplace Manager. Go to Marketplace.',
    substeps: [
      'Click Create Listing and select the tokenized asset.',
      'A draft listing is created.',
      'Click Publish Listing.',
      'Asset status changes to Listed. Investors can now see it.',
    ],
    url: '/marketplace',
    urlLabel: 'Go to Marketplace →',
  },
  {
    number: 7,
    phase: 'Investment',
    role: 'Investor',
    roleIcon: '💼',
    color: 'teal',
    title: 'Invest in Asset',
    description: 'Log in as Investor. KYC must be approved and wallet address must be registered.',
    substeps: [
      'Browse the Marketplace and find the listed asset.',
      'Click View Details to see token price, supply, and asset information.',
      'Click Invest, enter investment amount and payment method.',
      'Investment is created in Pending status.',
    ],
    url: '/marketplace',
    urlLabel: 'Browse Marketplace →',
  },
  {
    number: 8,
    phase: 'Investment Approval',
    role: 'Marketplace Manager',
    roleIcon: '📣',
    color: 'orange',
    title: 'Approve Investment (On-Chain)',
    description: 'Log in as Marketplace Manager. Go to Investments.',
    substeps: [
      'Find the Pending investment.',
      'Click Approve Investment.',
      'Two-phase execution: (1) payment is captured to "paid" status, then (2) on-chain operations run.',
      'Investor wallet is whitelisted on the smart contract.',
      'Tokens are minted directly to the investor\'s wallet address.',
      'Investment status changes to Confirmed.',
    ],
    url: '/marketplace',
    urlLabel: 'Go to Investments →',
  },
  {
    number: 9,
    phase: 'Portfolio',
    role: 'Investor',
    roleIcon: '💼',
    color: 'teal',
    title: 'View Portfolio',
    description: 'Log in as Investor. Go to Portfolio.',
    substeps: [
      'See all confirmed investments and on-chain token allocations.',
      'Each holding shows the asset name, token amount, investment value, and status.',
    ],
    url: '/portfolio',
    urlLabel: 'View Portfolio →',
  },
];

const colorMap: Record<string, { bg: string; border: string; badge: string; num: string }> = {
  indigo: { bg: 'bg-indigo-950/40', border: 'border-indigo-700/50', badge: 'bg-indigo-900/60 text-indigo-300', num: 'bg-indigo-600' },
  green:  { bg: 'bg-green-950/40',  border: 'border-green-700/50',  badge: 'bg-green-900/60 text-green-300',   num: 'bg-green-600' },
  blue:   { bg: 'bg-blue-950/40',   border: 'border-blue-700/50',   badge: 'bg-blue-900/60 text-blue-300',     num: 'bg-blue-600' },
  purple: { bg: 'bg-purple-950/40', border: 'border-purple-700/50', badge: 'bg-purple-900/60 text-purple-300', num: 'bg-purple-600' },
  yellow: { bg: 'bg-yellow-950/40', border: 'border-yellow-700/50', badge: 'bg-yellow-900/60 text-yellow-300', num: 'bg-yellow-600' },
  orange: { bg: 'bg-orange-950/40', border: 'border-orange-700/50', badge: 'bg-orange-900/60 text-orange-300', num: 'bg-orange-600' },
  teal:   { bg: 'bg-teal-950/40',   border: 'border-teal-700/50',   badge: 'bg-teal-900/60 text-teal-300',     num: 'bg-teal-600' },
};

const demoUsers = [
  { email: 'admin@demo.com',    password: 'Demo1234!', roles: 'Enterprise Admin + Treasury Officer', note: 'Full access: approvals, token ops, user management' },
  { email: 'issuer@demo.com',   password: 'Demo1234!', roles: 'Asset Issuer',                        note: 'Create assets, upload documents, configure tokens' },
  { email: 'investor@demo.com', password: 'Demo1234!', roles: 'Investor',                            note: 'Browse marketplace, invest (KYC approved, wallet set)' },
];

export default function WorkflowPage() {
  const { user } = useAuth();

  return (
    <div className="max-w-4xl space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Workflow Guide</h1>
        <p className="mt-2 text-gray-400">
          End-to-end walkthrough of the RWA Tokenization Marketplace — from asset creation to on-chain investment confirmation.
        </p>
        {user && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-indigo-900/50 px-3 py-1 text-sm text-indigo-300 border border-indigo-700/40">
            <span>Logged in as:</span>
            <span className="font-mono">{user.userId.slice(0, 8)}…</span>
            <span className="text-indigo-500">({user.permissions.length} permissions)</span>
          </div>
        )}
      </div>

      {/* Demo credentials */}
      <section className="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
        <h2 className="text-lg font-semibold text-white mb-1">🔑 Demo Credentials</h2>
        <p className="text-xs text-gray-500 mb-4">Use these pre-seeded accounts to walk through the flow.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="pb-2 pr-6">Email</th>
                <th className="pb-2 pr-6">Password</th>
                <th className="pb-2 pr-6">Roles</th>
                <th className="pb-2">Can do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {demoUsers.map(u => (
                <tr key={u.email}>
                  <td className="py-2 pr-6 font-mono text-indigo-300">{u.email}</td>
                  <td className="py-2 pr-6 font-mono text-gray-300">{u.password}</td>
                  <td className="py-2 pr-6 text-gray-300">{u.roles}</td>
                  <td className="py-2 text-gray-400 text-xs">{u.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Roles overview */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">👥 Platform Roles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map(r => (
            <div key={r.name} className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{r.icon}</span>
                <span className="font-medium text-white text-sm">{r.name}</span>
              </div>
              <p className="text-xs text-gray-400">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Step-by-step flow */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-6">📋 Step-by-Step Workflow</h2>

        {/* Flow connector line */}
        <div className="relative space-y-6">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-700 hidden sm:block" />

          {steps.map((s) => {
            const c = colorMap[s.color] ?? colorMap['indigo']!;
            return (
              <div key={s.number} className="relative sm:pl-16">
                {/* Step number bubble */}
                <div className={`absolute left-0 top-4 hidden sm:flex h-10 w-10 items-center justify-center rounded-full text-white text-sm font-bold shadow-lg ${c.num}`}>
                  {s.number}
                </div>

                {/* Card */}
                <div className={`rounded-xl border p-5 ${c.bg} ${c.border}`}>
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium mb-2 ${c.badge}`}>
                        {s.roleIcon} {s.role}
                      </span>
                      <h3 className="text-base font-semibold text-white">{s.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{s.phase}</p>
                    </div>
                    <Link
                      href={s.url}
                      className="flex-shrink-0 rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600 transition-colors"
                    >
                      {s.urlLabel}
                    </Link>
                  </div>

                  <p className="text-sm text-gray-300 mb-3">{s.description}</p>

                  <ol className="space-y-1.5">
                    {s.substeps.map((sub, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-400">
                        <span className="flex-shrink-0 text-gray-600 font-mono text-xs mt-0.5">{i + 1}.</span>
                        <span>{sub}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Asset status lifecycle */}
      <section className="rounded-xl border border-gray-700 bg-gray-800/30 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">🔄 Asset Status Lifecycle</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[
            ['draft', 'gray'],
            ['→', ''],
            ['pending_compliance', 'yellow'],
            ['→', ''],
            ['pending_legal', 'blue'],
            ['→', ''],
            ['pending_admin', 'purple'],
            ['→', ''],
            ['approved', 'green'],
            ['→', ''],
            ['tokenized', 'indigo'],
            ['→', ''],
            ['listed', 'teal'],
          ].map(([label, color], i) =>
            label === '→' ? (
              <span key={i} className="text-gray-600 font-bold">→</span>
            ) : (
              <span
                key={i}
                className={`rounded-full px-3 py-1 text-xs font-mono font-medium border ${
                  color === 'gray'   ? 'bg-gray-800 border-gray-600 text-gray-400' :
                  color === 'yellow' ? 'bg-yellow-950/60 border-yellow-700/50 text-yellow-300' :
                  color === 'blue'   ? 'bg-blue-950/60 border-blue-700/50 text-blue-300' :
                  color === 'purple' ? 'bg-purple-950/60 border-purple-700/50 text-purple-300' :
                  color === 'green'  ? 'bg-green-950/60 border-green-700/50 text-green-300' :
                  color === 'indigo' ? 'bg-indigo-950/60 border-indigo-700/50 text-indigo-300' :
                  color === 'teal'   ? 'bg-teal-950/60 border-teal-700/50 text-teal-300' : ''
                }`}
              >
                {label}
              </span>
            )
          )}
        </div>
      </section>
    </div>
  );
}
