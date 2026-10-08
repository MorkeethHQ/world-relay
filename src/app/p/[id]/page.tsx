import { ProductScreen } from "@/components/ProductScreen";

// /p/<id>: one product on FAVOUR. DESIGN-SYSTEM.md, Flow 1, steps 2 to 4.
// `TopProductsLive` links here. No live screen mounts that component yet.
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductScreen id={id} />;
}
