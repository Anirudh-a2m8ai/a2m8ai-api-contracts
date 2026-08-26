import { notFound } from 'next/navigation';
import { getSpecMeta } from '@/lib/specs-registry';

/** 404s the whole /[spec]/* subtree if the slug isn't a spec this app hosts. */
export default async function SpecLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ spec: string }>;
}) {
  const { spec } = await params;
  if (!getSpecMeta(spec)) notFound();
  return children;
}
