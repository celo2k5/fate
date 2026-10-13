import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-44 pb-24 text-center">
      <h1 className="display text-[56px]">No such <span className="display-light text-[64px]">fate</span></h1>
      <p className="lede mt-3">That page or coin doesn&apos;t exist on this ledger.</p>
      <Link href="/coins" className="btn btn-gold mt-6">Browse coins</Link>
    </div>
  );
}
